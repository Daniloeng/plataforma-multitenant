import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { signInAs } from '../test/session';
import { ApiError } from './http';
import { pedidosSnapshot } from '../mocks/pedidos';
import {
  CANCELAMENTO_LABEL,
  MOTIVOS_CANCELAMENTO,
  PROBLEMA_CHAVE_REUTILIZADA,
  RECUSA_GENERICA,
  PROBLEMA_PRODUTO_INDISPONIVEL,
  cancelarPedido,
  createPedido,
  describePedidoError,
  acompanharPedido,
  descreverMarco,
  getPedido,
  historicoDe,
  isNetworkError,
  isPedido,
  listPedidos,
  novaIdempotencyKey,
  pedidoFinal,
  pedidosUrl,
  podeComprar,
  quantidadeValida,
  resumoItens,
  subtotal,
  veTodosOsPedidos,
  type Pedido,
} from './pedidos';

const FARMA = 'farmaceutica-boa-saude';
const DIP = 'prd-farmaceutica-boa-saude-001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const pedido: Pedido = {
  id: 'ped-1',
  clienteId: 'cli-1',
  status: 'PENDENTE',
  itens: [{ produtoId: 'p1', quantidade: 2 }],
  total: { centavos: 100, moeda: 'BRL' },
  criadoEm: '2026-11-26T12:00:00Z',
};

describe('regras e utilitários', () => {
  it('podeComprar e veTodosOsPedidos seguem os papéis', () => {
    expect(podeComprar(['comprador'], 'cli-bruno')).toBe(true);
    expect(podeComprar(['comprador'], null)).toBe(false);
    expect(podeComprar(['comprador'], '')).toBe(false);
    expect(podeComprar(['gestor-tenant'], 'cli-bruno')).toBe(false);
    expect(veTodosOsPedidos(['gestor-tenant'])).toBe(true);
    expect(veTodosOsPedidos(['plataforma-admin'])).toBe(true);
    expect(veTodosOsPedidos(['comprador'])).toBe(false);
  });

  it.each([
    [1, true],
    [10000, true],
    [0, false],
    [10001, false],
    [1.5, false],
    [Number.NaN, false],
  ])('quantidadeValida(%s) = %s', (q, ok) => {
    expect(quantidadeValida(q)).toBe(ok);
  });

  it('subtotal multiplica centavos e resumoItens resume com "e mais N"', () => {
    expect(subtotal({ centavos: 1290, moeda: 'BRL' }, 3)).toEqual({ centavos: 3870, moeda: 'BRL' });
    expect(
      resumoItens([
        { produtoId: 'a', nome: 'Dipirona', quantidade: 2 },
        { produtoId: 'b', sku: 'SER-5ML', quantidade: 1200 },
        { produtoId: 'c', quantidade: 1 },
        { produtoId: 'd', quantidade: 1 },
      ]),
    ).toBe('Dipirona × 2, SER-5ML × 1.200 e mais 2');
    expect(resumoItens([{ produtoId: 'c', quantidade: 1 }])).toBe('c × 1');
  });

  it('novaIdempotencyKey usa randomUUID e, sem ele, getRandomValues ou Math.random (UUID v4)', () => {
    expect(novaIdempotencyKey()).toMatch(UUID);
    expect(
      novaIdempotencyKey({
        randomUUID: () => 'a-b-c-d-e' as `${string}-${string}-${string}-${string}-${string}`,
      }),
    ).toBe('a-b-c-d-e');
    const semRandomUuid = novaIdempotencyKey({
      getRandomValues: <T extends ArrayBufferView | null>(array: T) => {
        if (array instanceof Uint8Array) array.fill(0xff);
        return array;
      },
    });
    expect(semRandomUuid).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(novaIdempotencyKey({})).toMatch(UUID);
    expect(novaIdempotencyKey()).not.toBe(novaIdempotencyKey());
  });

  it('pedidosUrl respeita o BASE_URL e codifica o id', () => {
    expect(pedidosUrl(undefined, undefined, '/plataforma-multitenant/', 'https://x.dev')).toBe(
      'https://x.dev/plataforma-multitenant/api/v1/pedidos',
    );
    expect(pedidosUrl('a/b', 'cancelamento', '/', 'https://x.dev')).toBe(
      'https://x.dev/api/v1/pedidos/a%2Fb/cancelamento',
    );
  });

  it('isPedido valida o formato do contrato', () => {
    expect(isPedido(pedido)).toBe(true);
    expect(isPedido({ ...pedido, motivoCancelamento: 'SOLICITADO_PELO_CLIENTE' })).toBe(true);
    expect(isPedido({ ...pedido, motivoCancelamento: 'QUALQUER' })).toBe(false);
    expect(isPedido({ ...pedido, status: 'PAGO' })).toBe(false);
    expect(isPedido({ ...pedido, total: { centavos: -1, moeda: 'BRL' } })).toBe(false);
    expect(isPedido({ ...pedido, total: null })).toBe(false);
    expect(isPedido({ ...pedido, itens: [{ produtoId: 'p', quantidade: 1.5 }] })).toBe(false);
    expect(isPedido({ ...pedido, itens: [null] })).toBe(false);
    expect(
      isPedido({ ...pedido, itens: [{ produtoId: 'p', quantidade: 1, precoUnitario: 3 }] }),
    ).toBe(false);
    expect(isPedido({ ...pedido, atualizadoEm: 3 })).toBe(false);
    expect(isPedido(null)).toBe(false);
  });

  it('isPedido aceita historico ausente (respostas antigas) e valida cada marco', () => {
    const marco = { tipo: 'CRIADO', em: '2026-11-26T12:00:00Z' };
    expect(isPedido({ ...pedido, historico: [] })).toBe(true);
    expect(isPedido({ ...pedido, historico: null })).toBe(true);
    expect(
      isPedido({ ...pedido, historico: [marco, { ...marco, tipo: 'PAGO', detalhe: 'p' }] }),
    ).toBe(true);
    expect(isPedido({ ...pedido, historico: [{ ...marco, detalhe: null }] })).toBe(true);
    expect(isPedido({ ...pedido, historico: [{ ...marco, tipo: 'ENVIADO' }] })).toBe(false);
    expect(isPedido({ ...pedido, historico: [{ tipo: 'CRIADO' }] })).toBe(false);
    expect(isPedido({ ...pedido, historico: [{ ...marco, detalhe: 3 }] })).toBe(false);
    expect(isPedido({ ...pedido, historico: [null] })).toBe(false);
    expect(isPedido({ ...pedido, historico: 'CRIADO' })).toBe(false);
  });

  it('pedidosUrl monta a linha do tempo', () => {
    expect(pedidosUrl('ped-1', 'linha-do-tempo', '/', 'https://x.dev')).toBe(
      'https://x.dev/api/v1/pedidos/ped-1/linha-do-tempo',
    );
  });

  it('describePedidoError e isNetworkError distinguem rede de resposta da API', () => {
    expect(describePedidoError(new ApiError('detalhe', 409))).toBe('detalhe');
    expect(describePedidoError(new TypeError('Failed to fetch'))).toBe(
      'Não foi possível conectar ao pedidos-service.',
    );
    expect(isNetworkError(new TypeError('x'))).toBe(true);
    expect(isNetworkError(new ApiError('x', 500))).toBe(false);
  });
});

describe('histórico do pedido', () => {
  const em = '2026-11-26T12:00:01Z';
  const base: Pedido = { ...pedido, atualizadoEm: em };
  const tipos = (p: Pedido) => historicoDe(p).map((m) => [m.tipo, m.detalhe ?? null]);

  it('usa o historico do servidor quando ele vem (mesmo vazio)', () => {
    const historico = [{ tipo: 'CRIADO' as const, em: pedido.criadoEm }];
    expect(historicoDe({ ...pedido, historico })).toBe(historico);
    expect(historicoDe({ ...pedido, historico: [] })).toEqual([]);
  });

  it('sem historico, deriva do status: pendente, pago, recusado, estornado e cancelado antes da cobrança', () => {
    expect(historicoDe(pedido)).toEqual([{ tipo: 'CRIADO', em: pedido.criadoEm, detalhe: null }]);
    expect(tipos({ ...base, status: 'CONFIRMADO', pagamentoId: 'pag-1' })).toEqual([
      ['CRIADO', null],
      ['PAGO', 'pag-1'],
    ]);
    expect(historicoDe({ ...base, status: 'CONFIRMADO' })[1]).toEqual({
      tipo: 'PAGO',
      em,
      detalhe: null,
    });
    expect(
      tipos({ ...base, status: 'CANCELADO', motivoCancelamento: 'PAGAMENTO_RECUSADO' }),
    ).toEqual([
      ['CRIADO', null],
      ['RECUSADO', null],
      ['CANCELADO', 'PAGAMENTO_RECUSADO'],
    ]);
    expect(
      tipos({
        ...base,
        status: 'CANCELADO',
        motivoCancelamento: 'SOLICITADO_PELO_CLIENTE',
        pagamentoId: 'pag-1',
      }),
    ).toEqual([
      ['CRIADO', null],
      ['PAGO', 'pag-1'],
      ['CANCELADO', 'SOLICITADO_PELO_CLIENTE'],
      ['ESTORNADO', 'pag-1'],
    ]);
    // Sem atualizadoEm nem motivo: a data do cancelamento fica a da criação.
    expect(historicoDe({ ...pedido, status: 'CANCELADO' })).toEqual([
      { tipo: 'CRIADO', em: pedido.criadoEm, detalhe: null },
      { tipo: 'CANCELADO', em: pedido.criadoEm, detalhe: null },
    ]);
  });

  it('pedidoFinal: CONFIRMADO, recusado, cancelado sem pagamento ou já estornado', () => {
    const marco = (tipo: 'CRIADO' | 'PAGO' | 'CANCELADO' | 'ESTORNADO') => ({ tipo, em });
    expect(pedidoFinal(pedido)).toBe(false);
    expect(pedidoFinal({ ...pedido, status: 'CONFIRMADO' })).toBe(true);
    expect(pedidoFinal({ ...pedido, status: 'CANCELADO' })).toBe(true);
    expect(
      pedidoFinal({ ...pedido, status: 'CANCELADO', motivoCancelamento: 'PAGAMENTO_RECUSADO' }),
    ).toBe(true);
    // Pago e cancelado, ainda sem o estorno: falta o pagamento.estornado.
    const pagoECancelado: Pedido = {
      ...pedido,
      status: 'CANCELADO',
      pagamentoId: 'pag-1',
      historico: [marco('CRIADO'), marco('PAGO'), marco('CANCELADO')],
    };
    expect(pedidoFinal(pagoECancelado)).toBe(false);
    expect(
      pedidoFinal({
        ...pagoECancelado,
        historico: [...pagoECancelado.historico!, marco('ESTORNADO')],
      }),
    ).toBe(true);
    // Sem historico, o derivado já traz o estorno.
    expect(pedidoFinal({ ...pagoECancelado, historico: undefined })).toBe(true);
  });

  it('descreverMarco: rótulos em português e detalhe traduzido', () => {
    const em2 = pedido.criadoEm;
    expect(descreverMarco({ tipo: 'CRIADO', em: em2 })).toEqual({
      rotulo: 'Pedido criado',
      detalhe: null,
    });
    expect(descreverMarco({ tipo: 'PAGO', em: em2, detalhe: 'pag-1' })).toEqual({
      rotulo: 'Pagamento aprovado',
      detalhe: { tipo: 'pagamento', id: 'pag-1' },
    });
    expect(descreverMarco({ tipo: 'PAGO', em: em2, detalhe: '  ' }).detalhe).toBeNull();
    expect(descreverMarco({ tipo: 'ESTORNADO', em: em2, detalhe: 'pag-1' })).toEqual({
      rotulo: 'Valor estornado',
      detalhe: { tipo: 'pagamento', id: 'pag-1' },
    });
    expect(descreverMarco({ tipo: 'RECUSADO', em: em2, detalhe: 'Saldo insuficiente.' })).toEqual({
      rotulo: 'Pagamento recusado',
      detalhe: { tipo: 'texto', texto: 'Saldo insuficiente.' },
    });
    // Sem o motivo (o comprador recebe detalhe null) ou sem permissão: a explicação genérica.
    expect(descreverMarco({ tipo: 'RECUSADO', em: em2, detalhe: null }).detalhe).toEqual({
      tipo: 'texto',
      texto: RECUSA_GENERICA,
    });
    expect(
      descreverMarco(
        { tipo: 'RECUSADO', em: em2, detalhe: 'Saldo insuficiente.' },
        { motivoRecusa: false },
      ).detalhe,
    ).toEqual({ tipo: 'texto', texto: RECUSA_GENERICA });
    const cancelado = (detalhe?: string | null) =>
      descreverMarco({ tipo: 'CANCELADO', em: em2, detalhe });
    expect(MOTIVOS_CANCELAMENTO.map((m) => cancelado(m).rotulo)).toEqual([
      'Pagamento recusado',
      'Cancelado pelo cliente',
      'Expirado (sem resposta do pagamento em 15 min)',
      'Cancelado (outro motivo)',
      'Cancelado pelo tenant',
    ]);
    expect(MOTIVOS_CANCELAMENTO.map((m) => CANCELAMENTO_LABEL[m])).toHaveLength(5);
    expect(cancelado('PAGAMENTO_RECUSADO').detalhe).toEqual({
      tipo: 'texto',
      texto: 'Pedido cancelado pela recusa.',
    });
    expect(cancelado('SOLICITADO_PELO_CLIENTE').detalhe).toBeNull();
    expect(cancelado('MOTIVO_NOVO')).toEqual({
      rotulo: 'Pedido cancelado',
      detalhe: { tipo: 'texto', texto: 'MOTIVO_NOVO' },
    });
    expect(cancelado(null)).toEqual({ rotulo: 'Pedido cancelado', detalhe: null });
  });
});

describe('acompanharPedido (linha do tempo SSE)', () => {
  beforeEach(() => signInAs('bruno', FARMA));

  it('abre o fluxo com token e X-Tenant-Id e entrega o estado atual com o histórico', async () => {
    const cabecalhos: Headers[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/linha-do-tempo')) cabecalhos.push(request.headers);
    });
    const controller = new AbortController();
    const recebidos: Pedido[] = [];
    const onAberto = vi.fn();
    const fluxo = acompanharPedido('ped-farmaceutica-0008', {
      signal: controller.signal,
      onAberto,
      onPedido: (p) => {
        recebidos.push(p);
        controller.abort();
      },
    });
    await expect(fluxo).resolves.toBeUndefined();
    server.events.removeAllListeners();
    expect(onAberto).toHaveBeenCalledTimes(1);
    expect(recebidos).toEqual([pedidosSnapshot(FARMA)[0]]);
    expect(recebidos[0]!.historico).toEqual([
      { tipo: 'CRIADO', em: recebidos[0]!.criadoEm, detalhe: null },
    ]);
    expect(cabecalhos[0]!.get('Authorization')).toBe('Bearer demo-bruno');
    expect(cabecalhos[0]!.get('X-Tenant-Id')).toBe(FARMA);
    expect(cabecalhos[0]!.get('Accept')).toBe('text/event-stream');
  });

  it('404 (pedido de outro cliente ou backend sem SSE) rejeita com ApiError sem abrir', async () => {
    const onAberto = vi.fn();
    await expect(
      acompanharPedido('ped-farmaceutica-0007', { onAberto, onPedido: () => undefined }),
    ).rejects.toMatchObject({ httpStatus: 404 });
    expect(onAberto).not.toHaveBeenCalled();
  });

  it('resposta que não é text/event-stream não conta como fluxo aberto', async () => {
    server.use(http.get('*/api/v1/pedidos/:id/linha-do-tempo', () => HttpResponse.json(pedido)));
    await expect(acompanharPedido('ped-1', { onPedido: () => undefined })).rejects.toThrow(
      'A linha do tempo não respondeu com um fluxo de eventos.',
    );
  });

  /** Fluxo SSE fixo, que termina depois de enviar o texto. */
  const fluxo = (texto: string) =>
    http.get(
      '*/api/v1/pedidos/:id/linha-do-tempo',
      () =>
        new HttpResponse(texto, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        }),
    );

  it('ignora outros eventos e comentários; termina quando o servidor encerra', async () => {
    server.use(
      fluxo(
        `: ping\n\nevent: outro\ndata: {}\n\nevent: pedido\nid: 1\ndata: ${JSON.stringify(pedido)}\n\n`,
      ),
    );
    const recebidos: Pedido[] = [];
    await acompanharPedido('ped-1', { onPedido: (p) => recebidos.push(p) });
    expect(recebidos).toEqual([pedido]);
  });

  it('evento que não é JSON ou fora do contrato rejeita', async () => {
    server.use(fluxo('event: pedido\ndata: {quebrado\n\n'));
    await expect(acompanharPedido('ped-1', { onPedido: () => undefined })).rejects.toThrow(
      'A linha do tempo enviou um evento que não é JSON.',
    );
    server.use(fluxo('event: pedido\ndata: {"id":1}\n\n'));
    await expect(acompanharPedido('ped-1', { onPedido: () => undefined })).rejects.toThrow(
      'A linha do tempo enviou um pedido fora do contrato.',
    );
  });
});

describe('cliente HTTP (contra o pedidos-service simulado)', () => {
  beforeEach(() => signInAs('bruno', FARMA));

  it('createPedido manda só produto e quantidade, com Idempotency-Key, e reconhece a repetição', async () => {
    const recebidos: { chave: string | null; corpo: unknown }[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'POST') return;
      void request
        .clone()
        .json()
        .then((corpo) => recebidos.push({ chave: request.headers.get('Idempotency-Key'), corpo }));
    });
    const itens = [{ produtoId: DIP, quantidade: 2, sku: 'ignorado' } as never];
    const primeiro = await createPedido({ itens }, 'chave-teste-1');
    expect(primeiro.replayed).toBe(false);
    expect(primeiro.pedido).toMatchObject({ status: 'PENDENTE', clienteId: 'cli-bruno' });
    const segundo = await createPedido({ itens }, 'chave-teste-1');
    expect(segundo).toEqual({ pedido: primeiro.pedido, replayed: true });
    expect(recebidos[0]).toEqual({
      chave: 'chave-teste-1',
      corpo: { itens: [{ produtoId: DIP, quantidade: 2 }] },
    });
    server.events.removeAllListeners();
  });

  it('createPedido recusa chave fora de 8 a 64 caracteres sem chamar a API', async () => {
    await expect(createPedido({ itens: [] }, 'curta')).rejects.toThrow(
      'A Idempotency-Key deve ter de 8 a 64 caracteres.',
    );
    await expect(createPedido({ itens: [] }, 'x'.repeat(65))).rejects.toBeInstanceOf(ApiError);
  });

  it('createPedido: 409 com o type do Problem Details', async () => {
    const indisponivel = await createPedido(
      { itens: [{ produtoId: 'prd-x', quantidade: 1 }] },
      'chave-teste-2',
    ).catch((e: unknown) => e);
    expect(indisponivel).toBeInstanceOf(ApiError);
    expect((indisponivel as ApiError).problemType).toBe(PROBLEMA_PRODUTO_INDISPONIVEL);
    expect((indisponivel as ApiError).httpStatus).toBe(409);

    await createPedido({ itens: [{ produtoId: DIP, quantidade: 1 }] }, 'chave-teste-3');
    const reutilizada = await createPedido(
      { itens: [{ produtoId: DIP, quantidade: 9 }] },
      'chave-teste-3',
    ).catch((e: unknown) => e);
    expect((reutilizada as ApiError).problemType).toBe(PROBLEMA_CHAVE_REUTILIZADA);
  });

  it('createPedido: 201 com Idempotent-Replayed também conta como repetição', async () => {
    server.use(
      http.post('*/api/v1/pedidos', () =>
        HttpResponse.json(pedido, { status: 201, headers: { 'Idempotent-Replayed': 'TRUE' } }),
      ),
    );
    expect((await createPedido({ itens: [] }, 'chave-teste-4')).replayed).toBe(true);
  });

  it('listPedidos manda limite, cursor e status; proximoCursor ausente vira null', async () => {
    const urls: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      urls.push(new URL(request.url));
    });
    const pagina = await listPedidos({ status: 'CANCELADO', limite: 5 });
    expect(pagina.itens.map((p) => p.id)).toEqual(['ped-farmaceutica-0005']);
    expect(urls[0]!.searchParams.get('status')).toBe('CANCELADO');
    expect(urls[0]!.searchParams.get('limite')).toBe('5');
    expect(urls[0]!.searchParams.has('cursor')).toBe(false);

    server.use(http.get('*/api/v1/pedidos', () => HttpResponse.json({ itens: [pedido] })));
    expect(await listPedidos({ cursor: 'ped-x' })).toEqual({
      itens: [pedido],
      proximoCursor: null,
    });
    expect(urls[1]!.searchParams.get('cursor')).toBe('ped-x');
    expect(urls[1]!.searchParams.get('limite')).toBe('20');
    server.events.removeAllListeners();
  });

  it('listPedidos rejeita resposta fora do contrato', async () => {
    server.use(http.get('*/api/v1/pedidos', () => HttpResponse.json({ itens: [{ id: 1 }] })));
    await expect(listPedidos()).rejects.toThrow(
      'A resposta da API está fora do contrato esperado.',
    );
  });

  it('getPedido e cancelarPedido; 404 e 409 viram ApiError com o detail', async () => {
    expect((await getPedido('ped-farmaceutica-0008')).clienteId).toBe('cli-bruno');
    await expect(getPedido('ped-farmaceutica-0007')).rejects.toMatchObject({ httpStatus: 404 });
    const cancelado = await cancelarPedido('ped-farmaceutica-0008');
    expect(cancelado).toMatchObject({
      status: 'CANCELADO',
      motivoCancelamento: 'SOLICITADO_PELO_CLIENTE',
    });
    await expect(cancelarPedido('ped-farmaceutica-0008')).rejects.toThrow(
      "O pedido 'ped-farmaceutica-0008' já está cancelado.",
    );
  });
});
