import { apiUrl } from '../api/http';
import type { Lancamento, Pagamento } from '../api/pagamentos';
import type { Pedido } from '../api/pedidos';
import {
  COBRANCA_ATRASO_MS,
  MOTIVO_RECUSA_LIMITE,
  cobrancasAgendadas,
  pagamentosSnapshot,
  processarCobrancas,
  saldoDe,
} from './pagamentos';
import { pedidosSnapshot } from './pedidos';

const FARMA = 'farmaceutica-boa-saude';
const DIP = 'prd-farmaceutica-boa-saude-001'; // R$ 224,50
const SOR = 'prd-farmaceutica-boa-saude-003'; // R$ 93,60

interface Chamada {
  usuario?: string | null;
  tenant?: string | null;
  method?: string;
  body?: unknown;
}

/** Chama as APIs simuladas como o navegador: token demo-<usuario> e X-Tenant-Id. */
async function call(path: string, { usuario, tenant, method = 'GET', body }: Chamada = {}) {
  const headers = new Headers({ Accept: 'application/json' });
  if (usuario !== null) headers.set('Authorization', `Bearer demo-${usuario ?? 'admin'}`);
  if (tenant !== null) headers.set('X-Tenant-Id', tenant ?? FARMA);
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    headers.set('Idempotency-Key', `chave-${Math.random().toString(36).slice(2, 12)}`);
  }
  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

type PaginaPagamentos = { itens: Pagamento[]; proximoCursor: string | null };
type PaginaLancamentos = PaginaPagamentos & { itens: Lancamento[]; saldo: Pagamento['valor'] };

async function pagamentos(query = ''): Promise<PaginaPagamentos> {
  return (await call(`api/v1/pagamentos${query}`)).json as unknown as PaginaPagamentos;
}

async function extrato(query = ''): Promise<PaginaLancamentos> {
  return (await call(`api/v1/ledger/lancamentos${query}`)).json as unknown as PaginaLancamentos;
}

/** Bruno cria um pedido (201) e devolve o corpo. */
async function criarPedido(itens: { produtoId: string; quantidade: number }[]): Promise<Pedido> {
  const { status, json } = await call('api/v1/pedidos', {
    usuario: 'bruno',
    method: 'POST',
    body: { itens },
  });
  expect(status).toBe(201);
  return json as unknown as Pedido;
}

async function pedido(id: string): Promise<Pedido> {
  return (await call(`api/v1/pedidos/${id}`, { usuario: 'bruno' })).json as unknown as Pedido;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('dados de exemplo', () => {
  it('pagamentos coerentes com os pedidos: aprovados, estornado e recusado, do mais recente ao mais antigo', () => {
    const { pagamentos: lista } = pagamentosSnapshot(FARMA);
    expect(lista.map((p) => [p.id, p.pedidoId, p.status])).toEqual([
      ['pag-farmaceutica-0007', 'ped-farmaceutica-0007', 'APROVADO'],
      ['pag-farmaceutica-0006', 'ped-farmaceutica-0006', 'APROVADO'],
      ['pag-farmaceutica-0005', 'ped-farmaceutica-0005', 'ESTORNADO'],
      ['pag-farmaceutica-0004', 'ped-farmaceutica-0004', 'RECUSADO'],
      ['pag-farmaceutica-0003', 'ped-farmaceutica-0003', 'APROVADO'],
      ['pag-farmaceutica-0001', 'ped-farmaceutica-0001', 'APROVADO'],
    ]);
    const pedidos = pedidosSnapshot(FARMA);
    for (const p of lista) {
      const ped = pedidos.find((x) => x.id === p.pedidoId)!;
      expect(p.valor).toEqual(ped.total);
      expect(p.clienteId).toBe(ped.clienteId);
    }
    expect(lista[3]!.motivoRecusa).toBe(MOTIVO_RECUSA_LIMITE);
    expect(lista[0]!.motivoRecusa).toBeNull();
    expect(Date.parse(lista[2]!.atualizadoEm!)).toBeGreaterThan(Date.parse(lista[2]!.criadoEm));
  });

  it('o ledger tem captura dos pagos e estorno do cancelado depois de pago; recusado não lança nada', () => {
    const { lancamentos } = pagamentosSnapshot(FARMA);
    expect(lancamentos).toHaveLength(12);
    expect(lancamentos.some((l) => l.pagamentoId === 'pag-farmaceutica-0004')).toBe(false);
    const do5 = lancamentos.filter((l) => l.pedidoId === 'ped-farmaceutica-0005');
    expect(do5.map((l) => [l.conta, l.natureza])).toEqual([
      ['ESTORNOS', 'DEBITO'],
      ['CAIXA_GATEWAY', 'CREDITO'],
      ['CAIXA_GATEWAY', 'DEBITO'],
      ['RECEITA_TENANT', 'CREDITO'],
    ]);
    // Partidas dobradas: débitos = créditos.
    const soma = (n: string) =>
      lancamentos.filter((l) => l.natureza === n).reduce((s, l) => s + l.valor.centavos, 0);
    expect(soma('DEBITO')).toBe(soma('CREDITO'));
    const datas = lancamentos.map((l) => Date.parse(l.ocorridoEm));
    expect([...datas].sort((a, b) => b - a)).toEqual(datas);
  });

  it('saldo = créditos na receita − débitos em estornos (0 em BRL sem lançamentos)', () => {
    const pagos = pedidosSnapshot(FARMA).filter((p) => p.status === 'CONFIRMADO');
    const esperado = pagos.reduce((s, p) => s + p.total.centavos, 0);
    expect(saldoDe(pagamentosSnapshot(FARMA).lancamentos)).toEqual({
      centavos: esperado,
      moeda: 'BRL',
    });
    expect(saldoDe([])).toEqual({ centavos: 0, moeda: 'BRL' });
    const usd: Lancamento = {
      ...pagamentosSnapshot(FARMA).lancamentos[0]!,
      conta: 'RECEITA_TENANT' as const,
      natureza: 'CREDITO' as const,
      valor: { centavos: 500, moeda: 'USD' },
    };
    expect(saldoDe([usd])).toEqual({ centavos: 0, moeda: 'BRL' });
    expect(saldoDe([usd], 'USD')).toEqual({ centavos: 500, moeda: 'USD' });
    expect(pagamentosSnapshot('metalurgica-serra-azul')).toEqual({
      pagamentos: [],
      lancamentos: [],
    });
  });

  it('aurora (da Ana) também tem aprovados, um estornado e um recusado', () => {
    const status = pagamentosSnapshot('distribuidora-aurora').pagamentos.map((p) => p.status);
    expect(status).toEqual(['APROVADO', 'APROVADO', 'ESTORNADO', 'RECUSADO']);
  });
});

describe('cobrança assíncrona no gateway simulado', () => {
  it('aprova até R$ 10.000,00: pagamento APROVADO, captura no ledger e pedido CONFIRMADO', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const antes = (await extrato()).saldo.centavos;
    const novo = await criarPedido([
      { produtoId: DIP, quantidade: 2 },
      { produtoId: SOR, quantidade: 1 },
    ]);
    expect(novo).toMatchObject({ status: 'PENDENTE', pagamentoId: null });
    expect(cobrancasAgendadas()).toBe(1);

    // Antes do atraso, nada muda.
    vi.advanceTimersByTime(COBRANCA_ATRASO_MS - 1);
    expect(await pedido(novo.id)).toMatchObject({ status: 'PENDENTE' });
    expect((await pagamentos(`?pedidoId=${novo.id}`)).itens).toEqual([]);

    vi.advanceTimersByTime(1);
    const confirmado = await pedido(novo.id);
    expect(cobrancasAgendadas()).toBe(0);
    expect(confirmado).toMatchObject({ status: 'CONFIRMADO', pagamentoId: 'pag-n00001' });
    expect(confirmado.atualizadoEm).toBe(
      new Date(Date.parse(novo.criadoEm) + COBRANCA_ATRASO_MS).toISOString(),
    );

    const [pag] = (await pagamentos(`?pedidoId=${novo.id}`)).itens;
    expect(pag).toMatchObject({
      id: 'pag-n00001',
      status: 'APROVADO',
      clienteId: 'cli-bruno',
      valor: { centavos: 22450 * 2 + 9360, moeda: 'BRL' },
      motivoRecusa: null,
    });
    const ledger = await extrato();
    expect(ledger.itens.slice(0, 2)).toMatchObject([
      { conta: 'CAIXA_GATEWAY', natureza: 'DEBITO', pedidoId: novo.id, pagamentoId: pag!.id },
      { conta: 'RECEITA_TENANT', natureza: 'CREDITO', valor: pag!.valor },
    ]);
    expect(ledger.saldo.centavos).toBe(antes + pag!.valor.centavos);
  });

  it('recusa acima do limite: pagamento RECUSADO com o motivo, sem lançamentos, e pedido CANCELADO por PAGAMENTO_RECUSADO', async () => {
    const antes = (await extrato()).itens.length;
    const novo = await criarPedido([{ produtoId: DIP, quantidade: 45 }]); // R$ 10.102,50
    processarCobrancas(Number.POSITIVE_INFINITY);
    expect(await pedido(novo.id)).toMatchObject({
      status: 'CANCELADO',
      motivoCancelamento: 'PAGAMENTO_RECUSADO',
      pagamentoId: null,
    });
    const { itens } = await pagamentos('?status=RECUSADO');
    expect(itens[0]).toMatchObject({
      pedidoId: novo.id,
      status: 'RECUSADO',
      motivoRecusa: 'Valor acima do limite de aprovação do gateway simulado (R$ 10.000,00).',
    });
    expect((await extrato('?limite=100')).itens).toHaveLength(antes);
  });

  it('exatamente R$ 10.000,00 é aprovado', async () => {
    const { status, json } = await call('api/v1/produtos', {
      usuario: 'admin',
      method: 'POST',
      body: { sku: 'LIM-10K', nome: 'Item de R$ 10.000,00', preco: { centavos: 1_000_000 } },
    });
    expect(status).toBe(201);
    const novo = await criarPedido([{ produtoId: String(json.id), quantidade: 1 }]);
    processarCobrancas(Number.POSITIVE_INFINITY);
    expect((await pedido(novo.id)).status).toBe('CONFIRMADO');
  });

  it('pedido cancelado antes da cobrança nunca é cobrado', async () => {
    const novo = await criarPedido([{ produtoId: DIP, quantidade: 1 }]);
    await call(`api/v1/pedidos/${novo.id}/cancelamento`, { usuario: 'bruno', method: 'POST' });
    processarCobrancas(Number.POSITIVE_INFINITY);
    expect(await pedido(novo.id)).toMatchObject({
      status: 'CANCELADO',
      motivoCancelamento: 'SOLICITADO_PELO_CLIENTE',
    });
    expect((await pagamentos(`?pedidoId=${novo.id}`)).itens).toEqual([]);
  });

  it('a repetição idempotente do POST não agenda outra cobrança', async () => {
    const body = { itens: [{ produtoId: DIP, quantidade: 1 }] };
    const headers = {
      Authorization: 'Bearer demo-bruno',
      'X-Tenant-Id': FARMA,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'chave-repetida-1',
    };
    const init = { method: 'POST', headers, body: JSON.stringify(body) };
    expect((await fetch(apiUrl('api/v1/pedidos'), init)).status).toBe(201);
    expect((await fetch(apiUrl('api/v1/pedidos'), init)).status).toBe(200);
    expect(cobrancasAgendadas()).toBe(1);
  });
});

describe('estorno', () => {
  it('cancelar um pedido CONFIRMADO estorna: pagamento ESTORNADO, débito em ESTORNOS + crédito em CAIXA_GATEWAY, saldo menor', async () => {
    const antes = await extrato();
    const { status } = await call('api/v1/pedidos/ped-farmaceutica-0003/cancelamento', {
      usuario: 'bruno',
      method: 'POST',
    });
    expect(status).toBe(200);
    const pag = (await call('api/v1/pagamentos/pag-farmaceutica-0003'))
      .json as unknown as Pagamento;
    expect(pag.status).toBe('ESTORNADO');
    expect(Date.parse(pag.atualizadoEm!)).toBeGreaterThan(Date.parse(pag.criadoEm));
    const depois = await extrato();
    expect(depois.itens.slice(0, 2)).toMatchObject([
      { conta: 'ESTORNOS', natureza: 'DEBITO', valor: pag.valor, pedidoId: pag.pedidoId },
      { conta: 'CAIXA_GATEWAY', natureza: 'CREDITO', valor: pag.valor },
    ]);
    expect(depois.saldo.centavos).toBe(antes.saldo.centavos - pag.valor.centavos);
    // O pedido continua com o pagamento que o confirmou.
    expect(await pedido('ped-farmaceutica-0003')).toMatchObject({
      status: 'CANCELADO',
      pagamentoId: 'pag-farmaceutica-0003',
    });
  });

  it('cancelar um pedido PENDENTE não mexe no ledger', async () => {
    const antes = pagamentosSnapshot(FARMA);
    await call('api/v1/pedidos/ped-farmaceutica-0008/cancelamento', {
      usuario: 'bruno',
      method: 'POST',
    });
    expect(pagamentosSnapshot(FARMA)).toEqual(antes);
  });
});

describe('API e gateway', () => {
  it.each([
    ['api/v1/pagamentos'],
    ['api/v1/pagamentos/pag-farmaceutica-0007'],
    ['api/v1/ledger/lancamentos'],
  ])('comprador recebe 403 acesso-negado em %s', async (path) => {
    const { status, json } = await call(path, { usuario: 'bruno' });
    expect(status).toBe(403);
    expect(json).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/acesso-negado',
      detail: 'Pagamentos e o ledger exigem o papel gestor-tenant ou plataforma-admin.',
    });
  });

  it('401 sem token, 403 para tenant de outro usuário, 400 sem X-Tenant-Id; ana vê os seus', async () => {
    expect((await call('api/v1/pagamentos', { usuario: null })).status).toBe(401);
    expect((await call('api/v1/pagamentos', { usuario: 'ana' })).status).toBe(403);
    const semTenant = await call('api/v1/ledger/lancamentos', { tenant: null });
    expect(semTenant.status).toBe(400);
    expect(semTenant.json.detail).toBe('O cabeçalho X-Tenant-Id é obrigatório.');
    expect((await call('api/v1/ledger/lancamentos?moeda=real')).status).toBe(400);
    const ana = await call('api/v1/pagamentos', { usuario: 'ana', tenant: 'distribuidora-aurora' });
    expect(ana.status).toBe(200);
    expect((ana.json.itens as Pagamento[]).length).toBe(4);
  });

  it('404 para pagamento inexistente ou de outro tenant', async () => {
    const { status, json } = await call('api/v1/pagamentos/pag-distribuidora-0004');
    expect(status).toBe(404);
    expect(json.detail).toBe("Pagamento 'pag-distribuidora-0004' não encontrado neste tenant.");
  });

  it('pagina pagamentos e lançamentos por cursor, sem repetir nem pular, também com filtro', async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const pagina: PaginaPagamentos = await pagamentos(
        `?limite=4${cursor ? `&cursor=${cursor}` : ''}`,
      );
      vistos.push(...pagina.itens.map((p) => p.id));
      cursor = pagina.proximoCursor;
    } while (cursor);
    expect(vistos).toEqual(pagamentosSnapshot(FARMA).pagamentos.map((p) => p.id));

    const a1 = await pagamentos('?limite=2&status=APROVADO');
    expect(a1.itens.map((p) => p.id)).toEqual(['pag-farmaceutica-0007', 'pag-farmaceutica-0006']);
    const a2 = await pagamentos(`?limite=2&status=APROVADO&cursor=${a1.proximoCursor}`);
    expect(a2).toEqual({
      itens: expect.arrayContaining([expect.objectContaining({ id: 'pag-farmaceutica-0003' })]),
      proximoCursor: null,
    });
    expect(a2.itens.map((p) => p.id)).toEqual(['pag-farmaceutica-0003', 'pag-farmaceutica-0001']);
    const fim = await pagamentos('?cursor=pag-farmaceutica-0001');
    expect(fim).toEqual({ itens: [], proximoCursor: null });

    const l1 = await extrato('?limite=5');
    const l2 = await extrato(`?limite=5&cursor=${l1.proximoCursor}`);
    const l3 = await extrato(`?limite=5&cursor=${l2.proximoCursor}`);
    expect([...l1.itens, ...l2.itens, ...l3.itens].map((l) => l.id)).toEqual(
      pagamentosSnapshot(FARMA).lancamentos.map((l) => l.id),
    );
    expect(l3.proximoCursor).toBeNull();
    expect(l1.saldo).toEqual(l3.saldo);
  });

  it.each([
    ['api/v1/pagamentos?limite=0', 'limite deve ser um inteiro entre 1 e 100.'],
    [
      'api/v1/pagamentos?status=PAGO',
      'status deve ser AUTORIZANDO, APROVADO, RECUSADO ou ESTORNADO.',
    ],
    ['api/v1/pagamentos?cursor=nao-existe', "cursor inválido: 'nao-existe'."],
    ['api/v1/ledger/lancamentos?limite=101', 'limite deve ser um inteiro entre 1 e 100.'],
    ['api/v1/ledger/lancamentos?cursor=x', "cursor inválido: 'x'."],
  ])('%s: 400', async (path, detail) => {
    const { status, json } = await call(path);
    expect(status).toBe(400);
    expect(json.detail).toBe(detail);
  });
});
