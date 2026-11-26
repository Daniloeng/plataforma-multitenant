import type { Pedido } from '../api/pedidos';
import { apiUrl } from '../api/http';
import { resetCatalogoStore, catalogoSnapshot } from './catalogo';
import { clienteIdOf } from './gateway';
import { findDemoUser } from '../auth/demoUsers';
import { SseParser, type MensagemSse } from '../api/sse';
import { COBRANCA_ATRASO_MS } from './pagamentos';
import {
  LINHA_DO_TEMPO_PING_MS,
  LINHA_DO_TEMPO_TIMEOUT_MS,
  LINHA_DO_TEMPO_VERIFICACAO_MS,
  MOTIVO_RECUSA_LIMITE,
  aplicarEstorno,
  aplicarPagamento,
  assinarPedidos,
  hashCorpo,
  linhasDoTempoAbertas,
  mensagemPedido,
  pedidosSnapshot,
  resetPedidosStore,
} from './pedidos';

const FARMA = 'farmaceutica-boa-saude';
const DIP = 'prd-farmaceutica-boa-saude-001';
const SOR = 'prd-farmaceutica-boa-saude-003';
const ALGODAO_INATIVO = 'prd-farmaceutica-boa-saude-009';

interface Chamada {
  usuario?: string | null;
  tenant?: string | null;
  method?: string;
  body?: unknown;
  rawBody?: string;
  chave?: string | null;
  headers?: Record<string, string>;
}

/** Chama o pedidos-service simulado como o navegador: token demo-<usuario> e X-Tenant-Id. */
async function call(
  path: string,
  { usuario, tenant, method = 'GET', body, rawBody, chave, headers: extra = {} }: Chamada = {},
) {
  const headers = new Headers({ Accept: 'application/json', ...extra });
  if (usuario !== null) headers.set('Authorization', `Bearer demo-${usuario ?? 'bruno'}`);
  if (tenant !== null) headers.set('X-Tenant-Id', tenant ?? FARMA);
  if (chave) headers.set('Idempotency-Key', chave);
  if (body !== undefined || rawBody !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json, headers: response.headers };
}

const criar = (body: unknown, chave = 'chave-0001', opts: Chamada = {}) =>
  call('api/v1/pedidos', { method: 'POST', body, chave, ...opts });

type Pagina = { itens: Pedido[]; proximoCursor: string | null };

describe('dados de exemplo', () => {
  it('o tenant de bruno tem pedidos dele e de outros clientes, em todas as situações de pagamento, com preços do catálogo', () => {
    const pedidos = pedidosSnapshot(FARMA);
    expect(pedidos).toHaveLength(8);
    const clientes = new Set(pedidos.map((p) => p.clienteId));
    expect(clientes.has('cli-bruno')).toBe(true);
    expect(clientes.size).toBeGreaterThanOrEqual(3);
    expect(pedidos.map((p) => [p.id, p.status, p.motivoCancelamento, p.pagamentoId])).toEqual([
      ['ped-farmaceutica-0008', 'PENDENTE', null, null],
      ['ped-farmaceutica-0007', 'CONFIRMADO', null, 'pag-farmaceutica-0007'],
      ['ped-farmaceutica-0006', 'CONFIRMADO', null, 'pag-farmaceutica-0006'],
      // Pago e depois cancelado pelo cliente: guarda o pagamento (estornado).
      ['ped-farmaceutica-0005', 'CANCELADO', 'SOLICITADO_PELO_CLIENTE', 'pag-farmaceutica-0005'],
      // Acima de R$ 10.000,00: o gateway simulado recusa.
      ['ped-farmaceutica-0004', 'CANCELADO', 'PAGAMENTO_RECUSADO', null],
      ['ped-farmaceutica-0003', 'CONFIRMADO', null, 'pag-farmaceutica-0003'],
      // Cancelado antes de qualquer cobrança.
      ['ped-farmaceutica-0002', 'CANCELADO', 'SOLICITADO_PELO_CLIENTE', null],
      ['ped-farmaceutica-0001', 'CONFIRMADO', null, 'pag-farmaceutica-0001'],
    ]);
    expect(pedidos[4]!.total.centavos).toBeGreaterThan(1_000_000);
    // Do mais recente para o mais antigo.
    const datas = pedidos.map((p) => Date.parse(p.criadoEm));
    expect([...datas].sort((a, b) => b - a)).toEqual(datas);
    const primeiro = pedidos[0]!;
    expect(primeiro).toMatchObject({ id: 'ped-farmaceutica-0008', clienteId: 'cli-bruno' });
    expect(primeiro.itens[0]).toMatchObject({
      produtoId: DIP,
      sku: 'DIP-500-CX10',
      quantidade: 4,
      precoUnitario: { centavos: 22450, moeda: 'BRL' },
    });
    expect(primeiro.total).toEqual({ centavos: 22450 * 4 + 9360 * 10, moeda: 'BRL' });
    expect(pedidosSnapshot('distribuidora-aurora')).toHaveLength(4);
    expect(pedidosSnapshot('tenant-sem-pedidos')).toEqual([]);
  });

  it('item cujo SKU não existe mais no catálogo some do exemplo; total sem preço vale 0', () => {
    resetCatalogoStore({ [FARMA]: [] });
    expect(pedidosSnapshot(FARMA)[0]).toMatchObject({
      itens: [],
      total: { centavos: 0, moeda: 'BRL' },
    });
  });

  it('resetPedidosStore troca os pedidos de um tenant (cópias)', () => {
    const base = pedidosSnapshot(FARMA)[0]!;
    resetPedidosStore({ [FARMA]: [{ ...base, itens: [{ produtoId: 'x', quantidade: 1 }] }] });
    expect(pedidosSnapshot(FARMA)).toHaveLength(1);
    expect(pedidosSnapshot(FARMA)[0]!.itens[0]!.precoUnitario).toBeUndefined();
  });

  it('hashCorpo é estável e muda com produto, quantidade ou ordem', () => {
    const a = [
      { produtoId: 'p1', quantidade: 1 },
      { produtoId: 'p2', quantidade: 2 },
    ];
    expect(hashCorpo(a)).toBe(hashCorpo(a.map((i) => ({ ...i }))));
    expect(hashCorpo(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashCorpo(a)).not.toBe(hashCorpo([...a].reverse()));
    expect(hashCorpo(a)).not.toBe(hashCorpo([{ produtoId: 'p1', quantidade: 2 }, a[1]!]));
  });

  it('o gateway escreve o X-Cliente-Id a partir do usuário do token', () => {
    expect(clienteIdOf(findDemoUser('bruno')!)).toBe('cli-bruno');
    expect(clienteIdOf(findDemoUser('ana')!)).toBeNull();
  });
});

describe('POST /api/v1/pedidos', () => {
  it('cria PENDENTE com preço, SKU e nome do catálogo (201 + Location) e entra no topo da lista', async () => {
    const { status, json, headers } = await criar({
      itens: [
        { produtoId: DIP, quantidade: 3, precoUnitario: { centavos: 1, moeda: 'BRL' } },
        { produtoId: SOR, quantidade: 1 },
      ],
    });
    expect(status).toBe(201);
    expect(headers.get('Location')).toBe(`/api/v1/pedidos/${String(json.id)}`);
    expect(headers.get('Idempotent-Replayed')).toBeNull();
    expect(json).toMatchObject({
      clienteId: 'cli-bruno',
      status: 'PENDENTE',
      motivoCancelamento: null,
      total: { centavos: 22450 * 3 + 9360, moeda: 'BRL' },
    });
    // O preço enviado pelo cliente é ignorado: vale o do catálogo.
    expect((json.itens as Pedido['itens'])[0]).toEqual({
      produtoId: DIP,
      sku: 'DIP-500-CX10',
      nome: 'Dipirona 500 mg — caixa com 10 comprimidos (lote de 50)',
      quantidade: 3,
      precoUnitario: { centavos: 22450, moeda: 'BRL' },
    });
    expect(pedidosSnapshot(FARMA)[0]!.id).toBe(json.id);
  });

  it('ignora o X-Cliente-Id enviado pelo navegador (vem só do token)', async () => {
    const { json } = await criar({ itens: [{ produtoId: DIP, quantidade: 1 }] }, 'chave-cliente', {
      headers: { 'X-Cliente-Id': 'cli-outro' },
    });
    expect(json.clienteId).toBe('cli-bruno');
  });

  it('mesma chave e mesmo corpo: 200 com Idempotent-Replayed e o mesmo pedido, sem duplicar', async () => {
    const corpo = { itens: [{ produtoId: DIP, quantidade: 2 }] };
    const primeiro = await criar(corpo, 'chave-repetida');
    const segundo = await criar(corpo, 'chave-repetida');
    expect(segundo.status).toBe(200);
    expect(segundo.headers.get('Idempotent-Replayed')).toBe('true');
    expect(segundo.json.id).toBe(primeiro.json.id);
    expect(pedidosSnapshot(FARMA).filter((p) => p.id === primeiro.json.id)).toHaveLength(1);
    expect(pedidosSnapshot(FARMA)).toHaveLength(9);
  });

  it('mesma chave com outro corpo: 409 chave-reutilizada', async () => {
    await criar({ itens: [{ produtoId: DIP, quantidade: 2 }] }, 'chave-reusada');
    const { status, json } = await criar(
      { itens: [{ produtoId: DIP, quantidade: 5 }] },
      'chave-reusada',
    );
    expect(status).toBe(409);
    expect(json.type).toBe('https://plataforma.dev.br/problemas/chave-reutilizada');
    expect(json.detail).toMatch(/já foi usada com outro corpo/);
  });

  it.each([ALGODAO_INATIVO, 'prd-distribuidora-aurora-001', 'prd-inexistente'])(
    'produto %s: 409 produto-indisponivel com o id em `produtos`',
    async (produtoId) => {
      const { status, json } = await criar({ itens: [{ produtoId, quantidade: 1 }] });
      expect(status).toBe(409);
      expect(json.type).toBe('https://plataforma.dev.br/problemas/produto-indisponivel');
      expect(json.detail).toBe(
        `Produto indisponível (inexistente, inativo ou sem preço no catálogo): ${produtoId}.`,
      );
      expect(json.produtos).toEqual([produtoId]);
    },
  );

  it('lista todos os indisponíveis (sem repetir), não só o primeiro', async () => {
    const { status, json } = await criar({
      itens: [
        { produtoId: 'prd-inexistente', quantidade: 1 },
        { produtoId: DIP, quantidade: 1 },
        { produtoId: ALGODAO_INATIVO, quantidade: 1 },
        { produtoId: 'prd-inexistente', quantidade: 2 },
      ],
    });
    expect(status).toBe(409);
    expect(json.produtos).toEqual(['prd-inexistente', ALGODAO_INATIVO]);
    expect(json.detail).toBe(
      `Produto indisponível (inexistente, inativo ou sem preço no catálogo): prd-inexistente, ${ALGODAO_INATIVO}.`,
    );
    expect(pedidosSnapshot(FARMA)).toHaveLength(8);
  });

  it('produto desativado depois de ir ao carrinho também fica indisponível', async () => {
    resetCatalogoStore({
      [FARMA]: catalogoSnapshot(FARMA).map((p) => (p.id === DIP ? { ...p, ativo: false } : p)),
    });
    const { status } = await criar({ itens: [{ produtoId: DIP, quantidade: 1 }] });
    expect(status).toBe(409);
  });

  it.each([
    [null, /Idempotency-Key é obrigatório/],
    ['curta', /de 8 a 64 caracteres/],
    ['x'.repeat(65), /de 8 a 64 caracteres/],
  ])('Idempotency-Key %s: 400', async (chave, detail) => {
    const { status, json } = await call('api/v1/pedidos', {
      method: 'POST',
      body: { itens: [{ produtoId: DIP, quantidade: 1 }] },
      chave,
    });
    expect(status).toBe(400);
    expect(json.detail).toMatch(detail);
  });

  it.each([
    [{ rawBody: '{' }, 'O corpo da requisição deve ser um objeto JSON.'],
    [{ body: [1] }, 'O corpo da requisição deve ser um objeto JSON.'],
    [{ body: {} }, 'itens deve ter de 1 a 200 produtos.'],
    [{ body: { itens: [] } }, 'itens deve ter de 1 a 200 produtos.'],
    [
      {
        body: {
          itens: Array.from({ length: 201 }, () => ({ produtoId: DIP, quantidade: 1 })),
        },
      },
      'itens deve ter de 1 a 200 produtos.',
    ],
    [{ body: { itens: [null] } }, 'itens[0].produtoId é obrigatório.'],
    [{ body: { itens: [{ produtoId: '', quantidade: 1 }] } }, 'itens[0].produtoId é obrigatório.'],
    [
      { body: { itens: [{ produtoId: DIP, quantidade: 0 }] } },
      'itens[0].quantidade deve ser um inteiro de 1 a 10000.',
    ],
    [
      {
        body: {
          itens: [
            { produtoId: DIP, quantidade: 1 },
            { produtoId: DIP, quantidade: 10001 },
          ],
        },
      },
      'itens[1].quantidade deve ser um inteiro de 1 a 10000.',
    ],
    [
      { body: { itens: [{ produtoId: DIP, quantidade: '2' }] } },
      'itens[0].quantidade deve ser um inteiro de 1 a 10000.',
    ],
  ])('corpo inválido %#: 400', async (opts, detail) => {
    const { status, json } = await call('api/v1/pedidos', {
      method: 'POST',
      chave: 'chave-0001',
      ...opts,
    });
    expect(status).toBe(400);
    expect(json.detail).toBe(detail);
  });

  it.each(['ana', 'admin'])('%s (sem papel comprador) recebe 403', async (usuario) => {
    const tenant = usuario === 'ana' ? 'distribuidora-aurora' : FARMA;
    const { status, json } = await criar(
      { itens: [{ produtoId: DIP, quantidade: 1 }] },
      'k-12345678',
      {
        usuario,
        tenant,
      },
    );
    expect(status).toBe(403);
    expect(json.type).toBe('https://plataforma.dev.br/problemas/acesso-negado');
    expect(json.detail).toMatch(/exige o papel comprador/);
  });

  it('passa pelo gateway: 401 sem token, 403 com tenant de outro usuário, 400 sem X-Tenant-Id', async () => {
    const corpo = { itens: [{ produtoId: DIP, quantidade: 1 }] };
    expect((await criar(corpo, 'chave-0001', { usuario: null })).status).toBe(401);
    expect((await criar(corpo, 'chave-0001', { tenant: 'distribuidora-aurora' })).status).toBe(403);
    const semTenant = await criar(corpo, 'chave-0001', { tenant: null });
    expect(semTenant.status).toBe(400);
    expect(semTenant.json.detail).toBe('O cabeçalho X-Tenant-Id é obrigatório.');
  });
});

describe('GET /api/v1/pedidos', () => {
  it('comprador vê só os do próprio cliente, do mais recente para o mais antigo', async () => {
    const { status, json } = await call('api/v1/pedidos');
    expect(status).toBe(200);
    const pagina = json as unknown as Pagina;
    expect(pagina.itens.map((p) => p.id)).toEqual([
      'ped-farmaceutica-0008',
      'ped-farmaceutica-0005',
      'ped-farmaceutica-0003',
    ]);
    expect(pagina.itens.every((p) => p.clienteId === 'cli-bruno')).toBe(true);
    expect(pagina.proximoCursor).toBeNull();
  });

  it('gestor (admin) vê os de todos os clientes; filtro por status', async () => {
    const todos = (await call('api/v1/pedidos', { usuario: 'admin' })).json as unknown as Pagina;
    expect(todos.itens).toHaveLength(8);
    const cancelados = (await call('api/v1/pedidos?status=CANCELADO', { usuario: 'admin' }))
      .json as unknown as Pagina;
    expect(cancelados.itens.map((p) => p.clienteId)).toEqual([
      'cli-bruno',
      'cli-clinica-vida',
      'cli-hospital-sao-lucas',
    ]);
    const pendentes = (await call('api/v1/pedidos?status=PENDENTE', { usuario: 'admin' }))
      .json as unknown as Pagina;
    expect(pendentes.itens.map((p) => p.id)).toEqual(['ped-farmaceutica-0008']);
  });

  it('pagina por cursor (id do último), sem repetir nem pular, também com filtro', async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `api/v1/pedidos?limite=3${cursor ? `&cursor=${cursor}` : ''}`;
      const pagina = (await call(path, { usuario: 'admin' })).json as unknown as Pagina;
      expect(pagina.itens.length).toBeLessThanOrEqual(3);
      vistos.push(...pagina.itens.map((p) => p.id));
      cursor = pagina.proximoCursor;
    } while (cursor);
    expect(vistos).toEqual(pedidosSnapshot(FARMA).map((p) => p.id));

    const p1 = (await call('api/v1/pedidos?limite=2&status=CONFIRMADO', { usuario: 'admin' }))
      .json as unknown as Pagina;
    const p2 = (
      await call(`api/v1/pedidos?limite=2&status=CONFIRMADO&cursor=${p1.proximoCursor}`, {
        usuario: 'admin',
      })
    ).json as unknown as Pagina;
    expect(p2.itens.every((p) => p.status === 'CONFIRMADO')).toBe(true);
    expect(p2.itens[0]!.id).not.toBe(p1.itens[1]!.id);
    // Cursor do último pedido: página vazia.
    const ultimo = pedidosSnapshot(FARMA).at(-1)!.id;
    const fim = (await call(`api/v1/pedidos?cursor=${ultimo}`, { usuario: 'admin' }))
      .json as unknown as Pagina;
    expect(fim).toEqual({ itens: [], proximoCursor: null });
  });

  it.each([
    ['limite=0', 'limite deve ser um inteiro entre 1 e 100.'],
    ['limite=101', 'limite deve ser um inteiro entre 1 e 100.'],
    ['status=PAGO', 'status deve ser PENDENTE, CONFIRMADO ou CANCELADO.'],
    ['cursor=nao-existe', "cursor inválido: 'nao-existe'."],
  ])('%s: 400', async (query, detail) => {
    const { status, json } = await call(`api/v1/pedidos?${query}`);
    expect(status).toBe(400);
    expect(json.detail).toBe(detail);
  });

  it('gestor ana vê os pedidos dos tenants dela', async () => {
    const pagina = (await call('api/v1/pedidos', { usuario: 'ana', tenant: 'atacado-vale-verde' }))
      .json as unknown as Pagina;
    expect(pagina.itens.map((p) => p.clienteId)).toEqual(['cli-hotel-serra-verde']);
  });
});

describe('GET /api/v1/pedidos/{id} e POST /cancelamento', () => {
  it('comprador lê o próprio pedido; o de outro cliente responde 404', async () => {
    expect((await call('api/v1/pedidos/ped-farmaceutica-0008')).json.clienteId).toBe('cli-bruno');
    const outro = await call('api/v1/pedidos/ped-farmaceutica-0007');
    expect(outro.status).toBe(404);
    expect(outro.json.detail).toBe("Pedido 'ped-farmaceutica-0007' não encontrado neste tenant.");
    expect((await call('api/v1/pedidos/ped-farmaceutica-0007', { usuario: 'admin' })).status).toBe(
      200,
    );
  });

  it('comprador cancela o próprio pedido (SOLICITADO_PELO_CLIENTE); de novo, 409', async () => {
    const { status, json } = await call('api/v1/pedidos/ped-farmaceutica-0008/cancelamento', {
      method: 'POST',
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      status: 'CANCELADO',
      motivoCancelamento: 'SOLICITADO_PELO_CLIENTE',
    });
    expect(json.atualizadoEm).not.toBe(json.criadoEm);
    const repetido = await call('api/v1/pedidos/ped-farmaceutica-0008/cancelamento', {
      method: 'POST',
    });
    expect(repetido.status).toBe(409);
    expect(repetido.json.type).toBe('https://plataforma.dev.br/problemas/pedido-ja-cancelado');
  });

  it('comprador não cancela pedido de outro cliente (404); gestor cancela qualquer um', async () => {
    const path = 'api/v1/pedidos/ped-farmaceutica-0007/cancelamento';
    expect((await call(path, { method: 'POST' })).status).toBe(404);
    const { status, json } = await call(path, { method: 'POST', usuario: 'admin' });
    expect(status).toBe(200);
    expect(json.status).toBe('CANCELADO');
  });

  it('quem é gestor e comprador ao mesmo tempo vê todos e cancela como tenant (canManage primeiro)', async () => {
    const bruno = findDemoUser('bruno')!;
    bruno.papeis.push('gestor-tenant');
    try {
      const lista = await call('api/v1/pedidos?limite=100');
      const clientes = new Set((lista.json.itens as Pedido[]).map((p) => p.clienteId));
      expect(clientes.size).toBeGreaterThan(1);
      const { status, json } = await call('api/v1/pedidos/ped-farmaceutica-0007/cancelamento', {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(json.motivoCancelamento).toBe('CANCELADO_PELO_TENANT');
    } finally {
      bruno.papeis.pop();
    }
  });

  it('comprador sem cliente no token: 403 para listar e para criar', async () => {
    const bruno = findDemoUser('bruno')!;
    bruno.clienteId = null;
    try {
      const lista = await call('api/v1/pedidos');
      expect(lista.status).toBe(403);
      expect(lista.json.detail).toBe('Pedidos exigem o papel comprador ou gestor-tenant.');
      expect((await criar({ itens: [{ produtoId: DIP, quantidade: 1 }] })).status).toBe(403);
    } finally {
      bruno.clienteId = 'cli-bruno';
    }
  });

  it('pedido de outro tenant não existe neste', async () => {
    const { status } = await call('api/v1/pedidos/ped-distribuidora-0003', { usuario: 'admin' });
    expect(status).toBe(404);
  });
});

describe('integração com o pagamentos-service simulado', () => {
  it('assinarPedidos entrega pedido.criado e devolve a função que remove o assinante', async () => {
    const criados: string[] = [];
    const sair = assinarPedidos({
      pedidoCriado: (_tenant, p) => criados.push(p.id),
      pedidoCancelado: () => {},
      sincronizar: () => {},
    });
    const primeiro = await criar({ itens: [{ produtoId: DIP, quantidade: 1 }] }, 'chave-assina-1');
    sair();
    await criar({ itens: [{ produtoId: DIP, quantidade: 2 }] }, 'chave-assina-2');
    expect(criados).toEqual([primeiro.json.id]);
  });

  it('aplicarPagamento só muda pedido PENDENTE existente', () => {
    const quando = '2026-11-26T12:00:00.000Z';
    expect(aplicarPagamento(FARMA, 'nao-existe', { aprovado: false }, quando)).toBe(false);
    expect(
      aplicarPagamento(
        FARMA,
        'ped-farmaceutica-0007',
        { aprovado: true, pagamentoId: 'x' },
        quando,
      ),
    ).toBe(false);
    expect(aplicarPagamento(FARMA, 'ped-farmaceutica-0008', { aprovado: false }, quando)).toBe(
      true,
    );
    expect(pedidosSnapshot(FARMA)[0]).toMatchObject({
      status: 'CANCELADO',
      motivoCancelamento: 'PAGAMENTO_RECUSADO',
      atualizadoEm: quando,
    });
  });
});

describe('histórico (marcos da saga)', () => {
  const tipos = (p: Pedido) => (p.historico ?? []).map((m) => [m.tipo, m.detalhe ?? null]);

  it('os exemplos têm histórico coerente com a situação, do mais antigo ao mais recente', () => {
    const porId = new Map(pedidosSnapshot(FARMA).map((p) => [p.id, p]));
    const pendente = porId.get('ped-farmaceutica-0008')!;
    expect(pendente.historico).toEqual([{ tipo: 'CRIADO', em: pendente.criadoEm, detalhe: null }]);
    expect(tipos(porId.get('ped-farmaceutica-0007')!)).toEqual([
      ['CRIADO', null],
      ['PAGO', 'pag-farmaceutica-0007'],
    ]);
    expect(tipos(porId.get('ped-farmaceutica-0005')!)).toEqual([
      ['CRIADO', null],
      ['PAGO', 'pag-farmaceutica-0005'],
      ['CANCELADO', 'SOLICITADO_PELO_CLIENTE'],
      ['ESTORNADO', 'pag-farmaceutica-0005'],
    ]);
    expect(tipos(porId.get('ped-farmaceutica-0004')!)).toEqual([
      ['CRIADO', null],
      ['RECUSADO', MOTIVO_RECUSA_LIMITE],
      ['CANCELADO', 'PAGAMENTO_RECUSADO'],
    ]);
    expect(tipos(porId.get('ped-farmaceutica-0002')!)).toEqual([
      ['CRIADO', null],
      ['CANCELADO', 'SOLICITADO_PELO_CLIENTE'],
    ]);
    for (const p of porId.values()) {
      const datas = p.historico!.map((m) => Date.parse(m.em));
      expect([...datas].sort((a, b) => a - b)).toEqual(datas);
      expect(p.historico!.at(-1)!.em).toBe(p.atualizadoEm);
    }
  });

  it('criação, aprovação, cancelamento e estorno anotam cada marco (o pagamentos simulado avisa o estorno)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { json } = await criar(
        { itens: [{ produtoId: DIP, quantidade: 1 }] },
        'chave-historico',
      );
      const novo = json as unknown as Pedido;
      expect(tipos(novo)).toEqual([['CRIADO', null]]);
      vi.advanceTimersByTime(COBRANCA_ATRASO_MS);
      const pago = (await call(`api/v1/pedidos/${novo.id}`)).json as unknown as Pedido;
      expect(tipos(pago)).toEqual([
        ['CRIADO', null],
        ['PAGO', 'pag-n00001'],
      ]);
      vi.advanceTimersByTime(60_000);
      const cancelado = (await call(`api/v1/pedidos/${novo.id}/cancelamento`, { method: 'POST' }))
        .json as unknown as Pedido;
      expect(tipos(cancelado)).toEqual([
        ['CRIADO', null],
        ['PAGO', 'pag-n00001'],
        ['CANCELADO', 'SOLICITADO_PELO_CLIENTE'],
        ['ESTORNADO', 'pag-n00001'],
      ]);
      expect(cancelado.historico![3]!.em).toBe(cancelado.atualizadoEm);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recusa anota RECUSADO com o motivo e CANCELADO; o gestor cancela como tenant', async () => {
    const quando = '2026-11-26T12:00:00.000Z';
    aplicarPagamento(
      FARMA,
      'ped-farmaceutica-0008',
      { aprovado: false, motivo: 'Sem saldo.' },
      quando,
    );
    expect(tipos(pedidosSnapshot(FARMA)[0]!)).toEqual([
      ['CRIADO', null],
      ['RECUSADO', 'Sem saldo.'],
      ['CANCELADO', 'PAGAMENTO_RECUSADO'],
    ]);
    const { json } = await call('api/v1/pedidos/ped-farmaceutica-0007/cancelamento', {
      usuario: 'admin',
      method: 'POST',
    });
    expect(tipos(json as unknown as Pedido).slice(2)).toEqual([
      ['CANCELADO', 'CANCELADO_PELO_TENANT'],
      ['ESTORNADO', 'pag-farmaceutica-0007'],
    ]);
  });

  it('o comprador recebe o RECUSADO com detalhe null no GET e na listagem; gestor e admin recebem o motivo', async () => {
    aplicarPagamento(
      FARMA,
      'ped-farmaceutica-0008',
      { aprovado: false, motivo: MOTIVO_RECUSA_LIMITE },
      '2026-11-26T12:00:00.000Z',
    );
    const recusado = (p: Pedido) => p.historico!.find((m) => m.tipo === 'RECUSADO');
    const doComprador = (await call('api/v1/pedidos/ped-farmaceutica-0008'))
      .json as unknown as Pedido;
    expect(recusado(doComprador)).toMatchObject({ tipo: 'RECUSADO', detalhe: null });
    const lista = (await call('api/v1/pedidos')).json as unknown as Pagina;
    for (const p of lista.itens) {
      if (recusado(p)) expect(recusado(p)!.detalhe).toBeNull();
    }
    expect(lista.itens.filter(recusado)).toHaveLength(1);
    const doAdmin = (await call('api/v1/pedidos/ped-farmaceutica-0008', { usuario: 'admin' }))
      .json as unknown as Pedido;
    expect(recusado(doAdmin)!.detalhe).toBe(MOTIVO_RECUSA_LIMITE);
    const listaAdmin = (await call('api/v1/pedidos?limite=100', { usuario: 'admin' }))
      .json as unknown as Pagina;
    expect(listaAdmin.itens.filter(recusado).map((p) => recusado(p)!.detalhe)).toEqual([
      MOTIVO_RECUSA_LIMITE,
      MOTIVO_RECUSA_LIMITE,
    ]);
    // O store guarda o motivo: a máscara é só na resposta.
    expect(recusado(pedidosSnapshot(FARMA)[0]!)!.detalhe).toBe(MOTIVO_RECUSA_LIMITE);
  });

  it('aplicarEstorno só anota em pedido CANCELADO, uma vez; pedido sem histórico ganha um', () => {
    const quando = '2026-11-26T12:00:00.000Z';
    expect(aplicarEstorno(FARMA, 'nao-existe', 'pag-x', quando)).toBe(false);
    expect(aplicarEstorno(FARMA, 'ped-farmaceutica-0007', 'pag-x', quando)).toBe(false); // CONFIRMADO
    expect(aplicarEstorno(FARMA, 'ped-farmaceutica-0005', 'pag-x', quando)).toBe(false); // já estornado
    const base = pedidosSnapshot(FARMA)[0]!;
    resetPedidosStore({
      [FARMA]: [{ ...base, status: 'CANCELADO', pagamentoId: 'pag-y', historico: undefined }],
    });
    expect(aplicarEstorno(FARMA, base.id, 'pag-y', quando)).toBe(true);
    expect(pedidosSnapshot(FARMA)[0]).toMatchObject({
      historico: [{ tipo: 'ESTORNADO', em: quando, detalhe: 'pag-y' }],
      atualizadoEm: quando,
    });
  });
});

describe('GET /api/v1/pedidos/{id}/linha-do-tempo (SSE)', () => {
  /** Abre a linha do tempo como o navegador e junta as mensagens que chegam. */
  async function abrir(id: string, usuario = 'bruno') {
    const controller = new AbortController();
    const response = await fetch(apiUrl(`api/v1/pedidos/${id}/linha-do-tempo`), {
      headers: { Authorization: `Bearer demo-${usuario}`, 'X-Tenant-Id': FARMA },
      signal: controller.signal,
    });
    const mensagens: MensagemSse[] = [];
    const comentarios: string[] = [];
    let terminou = false;
    if (response.ok) {
      const parser = new SseParser({
        onMessage: (m) => mensagens.push(m),
        onComment: (c) => comentarios.push(c),
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        terminou = true;
      })();
    }
    const pedidos = () => mensagens.map((m) => JSON.parse(m.data) as Pedido);
    return { response, mensagens, comentarios, pedidos, fim: () => terminou, controller };
  }

  async function avancar(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('responde text/event-stream e envia o estado atual (event pedido, id = versão, data = JSON numa linha)', async () => {
    const fluxo = await abrir('ped-farmaceutica-0005');
    expect(fluxo.response.status).toBe(200);
    expect(fluxo.response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(fluxo.response.headers.get('Cache-Control')).toBe('no-cache');
    await avancar(0);
    expect(fluxo.mensagens).toHaveLength(1);
    expect(fluxo.mensagens[0]).toMatchObject({ event: 'pedido', id: '4' });
    expect(fluxo.mensagens[0]!.data).not.toContain('\n');
    expect(fluxo.pedidos()[0]).toEqual(pedidosSnapshot(FARMA)[3]);
    // Sem mudança, nada novo.
    await avancar(LINHA_DO_TEMPO_VERIFICACAO_MS * 5);
    expect(fluxo.mensagens).toHaveLength(1);
    fluxo.controller.abort();
  });

  it('a cobrança vencida chega pelo fluxo, sem outra requisição; o cancelamento também', async () => {
    const { json } = await criar({ itens: [{ produtoId: DIP, quantidade: 1 }] }, 'chave-sse-001');
    const id = String(json.id);
    const fluxo = await abrir(id);
    await avancar(0);
    expect(fluxo.pedidos().map((p) => p.status)).toEqual(['PENDENTE']);
    await avancar(COBRANCA_ATRASO_MS + LINHA_DO_TEMPO_VERIFICACAO_MS);
    expect(fluxo.pedidos().map((p) => p.status)).toEqual(['PENDENTE', 'CONFIRMADO']);
    expect(fluxo.mensagens.map((m) => m.id)).toEqual(['1', '2']);

    await call(`api/v1/pedidos/${id}/cancelamento`, { method: 'POST' });
    await avancar(LINHA_DO_TEMPO_VERIFICACAO_MS);
    expect(
      fluxo
        .pedidos()
        .at(-1)!
        .historico!.map((m) => m.tipo),
    ).toEqual(['CRIADO', 'PAGO', 'CANCELADO', 'ESTORNADO']);
    expect(fluxo.mensagens.at(-1)!.id).toBe('4');
    fluxo.controller.abort();
  });

  it('envia de novo quando só o atualizadoEm muda', async () => {
    const fluxo = await abrir('ped-farmaceutica-0008');
    await avancar(0);
    const base = pedidosSnapshot(FARMA);
    resetPedidosStore({
      [FARMA]: base.map((p, i) =>
        i === 0 ? { ...p, atualizadoEm: '2026-11-26T00:00:00.000Z' } : p,
      ),
    });
    // O reset fecha os fluxos abertos (nada fica rodando entre os testes).
    await avancar(0);
    expect(fluxo.fim()).toBe(true);
    expect(linhasDoTempoAbertas()).toBe(0);
  });

  it('`: ping` a cada 15 s e fim do fluxo depois de 5 min', async () => {
    const fluxo = await abrir('ped-farmaceutica-0008');
    await avancar(LINHA_DO_TEMPO_PING_MS);
    expect(fluxo.comentarios).toEqual(['ping']);
    await avancar(LINHA_DO_TEMPO_PING_MS);
    expect(fluxo.comentarios).toEqual(['ping', 'ping']);
    expect(fluxo.fim()).toBe(false);
    await avancar(LINHA_DO_TEMPO_TIMEOUT_MS);
    expect(fluxo.fim()).toBe(true);
    expect(linhasDoTempoAbertas()).toBe(0);
    expect(fluxo.mensagens).toHaveLength(1);
  });

  it('abortar a requisição fecha o fluxo e para a verificação', async () => {
    const fluxo = await abrir('ped-farmaceutica-0008');
    await avancar(0);
    expect(linhasDoTempoAbertas()).toBe(1);
    fluxo.controller.abort();
    await avancar(0);
    expect(linhasDoTempoAbertas()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('o pedido que some do store encerra o fluxo', async () => {
    const fluxo = await abrir('ped-farmaceutica-0008');
    await avancar(0);
    // Troca o store por fora, sem o reset (que fecharia o fluxo antes).
    aplicarPagamento(FARMA, 'ped-farmaceutica-0008', { aprovado: true, pagamentoId: 'p' }, 'x');
    await avancar(LINHA_DO_TEMPO_VERIFICACAO_MS);
    expect(fluxo.pedidos().map((p) => p.status)).toEqual(['PENDENTE', 'CONFIRMADO']);
    fluxo.controller.abort();
  });

  it('o comprador recebe o RECUSADO sem o motivo do gateway no fluxo; o gestor, com', async () => {
    aplicarPagamento(
      FARMA,
      'ped-farmaceutica-0008',
      { aprovado: false, motivo: 'Sem saldo.' },
      'x',
    );
    const recusado = (p: Pedido) => p.historico!.find((m) => m.tipo === 'RECUSADO');
    const comprador = await abrir('ped-farmaceutica-0008');
    const gestor = await abrir('ped-farmaceutica-0008', 'admin');
    await avancar(0);
    expect(recusado(comprador.pedidos()[0]!)).toMatchObject({ detalhe: null });
    expect(recusado(gestor.pedidos()[0]!)).toMatchObject({ detalhe: 'Sem saldo.' });
    comprador.controller.abort();
    gestor.controller.abort();
  });

  it('mesmos 404 e 403 do GET do pedido', async () => {
    const outro = await abrir('ped-farmaceutica-0007');
    expect(outro.response.status).toBe(404);
    expect(((await outro.response.json()) as { detail: string }).detail).toBe(
      "Pedido 'ped-farmaceutica-0007' não encontrado neste tenant.",
    );
    const semPapel = await fetch(apiUrl('api/v1/pedidos/ped-farmaceutica-0008/linha-do-tempo'), {
      headers: { Authorization: 'Bearer demo-ana', 'X-Tenant-Id': FARMA },
    });
    expect(semPapel.status).toBe(403);
    const semToken = await fetch(apiUrl('api/v1/pedidos/ped-farmaceutica-0008/linha-do-tempo'));
    expect(semToken.status).toBe(401);
  });

  it('mensagemPedido usa o tamanho do histórico como versão (0 sem histórico)', () => {
    const p = { ...pedidosSnapshot(FARMA)[0]!, historico: undefined };
    expect(mensagemPedido(p)).toBe(`event: pedido\nid: 0\ndata: ${JSON.stringify(p)}\n\n`);
  });
});
