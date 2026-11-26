import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { signInAs } from '../test/session';
import { ApiError } from './http';
import {
  describePagamentoError,
  getPagamento,
  isLancamento,
  isPagamento,
  lancamentosUrl,
  listLancamentos,
  listPagamentos,
  pagamentosUrl,
  veFinanceiro,
  type Lancamento,
  type Pagamento,
} from './pagamentos';
import { isPedido } from './pedidos';

const FARMA = 'farmaceutica-boa-saude';

const pagamento: Pagamento = {
  id: 'pag-1',
  pedidoId: 'ped-1',
  status: 'APROVADO',
  valor: { centavos: 100, moeda: 'BRL' },
  criadoEm: '2026-11-26T12:00:00Z',
};

const lancamento: Lancamento = {
  id: 'lan-1',
  pagamentoId: 'pag-1',
  conta: 'CAIXA_GATEWAY',
  natureza: 'DEBITO',
  valor: { centavos: 100, moeda: 'BRL' },
  ocorridoEm: '2026-11-26T12:00:00Z',
};

describe('regras e guardas', () => {
  it('veFinanceiro: só gestor-tenant e plataforma-admin', () => {
    expect(veFinanceiro(['gestor-tenant'])).toBe(true);
    expect(veFinanceiro(['plataforma-admin'])).toBe(true);
    expect(veFinanceiro(['comprador'])).toBe(false);
    expect(veFinanceiro([])).toBe(false);
  });

  it('isPagamento aceita o contrato (opcionais ausentes ou null) e rejeita o resto', () => {
    expect(isPagamento(pagamento)).toBe(true);
    expect(
      isPagamento({
        ...pagamento,
        status: 'RECUSADO',
        clienteId: 'cli-1',
        motivoRecusa: 'Valor acima do limite.',
        atualizadoEm: '2026-11-26T12:00:01Z',
      }),
    ).toBe(true);
    expect(isPagamento({ ...pagamento, motivoRecusa: null })).toBe(true);
    expect(isPagamento(null)).toBe(false);
    expect(isPagamento({ ...pagamento, status: 'PAGO' })).toBe(false);
    expect(isPagamento({ ...pagamento, valor: { centavos: -1, moeda: 'BRL' } })).toBe(false);
    expect(isPagamento({ ...pagamento, valor: null })).toBe(false);
    expect(isPagamento({ ...pagamento, clienteId: 7 })).toBe(false);
    expect(isPagamento({ ...pagamento, pedidoId: undefined })).toBe(false);
  });

  it('isLancamento valida conta e natureza', () => {
    expect(isLancamento(lancamento)).toBe(true);
    expect(isLancamento({ ...lancamento, pedidoId: 'ped-1' })).toBe(true);
    expect(isLancamento('x')).toBe(false);
    expect(isLancamento({ ...lancamento, conta: 'BANCO' })).toBe(false);
    expect(isLancamento({ ...lancamento, natureza: 'ENTRADA' })).toBe(false);
    expect(isLancamento({ ...lancamento, ocorridoEm: 1 })).toBe(false);
  });

  it('o Pedido aceita pagamentoId ausente, null ou texto', () => {
    const pedido = {
      id: 'ped-1',
      clienteId: 'cli-1',
      status: 'CONFIRMADO',
      itens: [],
      total: { centavos: 0, moeda: 'BRL' },
      criadoEm: '2026-11-26T12:00:00Z',
    };
    expect(isPedido(pedido)).toBe(true);
    expect(isPedido({ ...pedido, pagamentoId: null })).toBe(true);
    expect(isPedido({ ...pedido, pagamentoId: 'pag-1' })).toBe(true);
    expect(isPedido({ ...pedido, pagamentoId: 1 })).toBe(false);
  });

  it('URLs absolutas a partir do BASE_URL', () => {
    expect(pagamentosUrl(undefined, '/plataforma-multitenant/', 'https://x.dev')).toBe(
      'https://x.dev/plataforma-multitenant/api/v1/pagamentos',
    );
    expect(pagamentosUrl('pag 1', '/', 'https://x.dev')).toBe(
      'https://x.dev/api/v1/pagamentos/pag%201',
    );
    expect(lancamentosUrl('/', 'https://x.dev')).toBe('https://x.dev/api/v1/ledger/lancamentos');
  });

  it('describePagamentoError: detail do problema ou falha de conexão', () => {
    expect(describePagamentoError(new ApiError('Acesso negado.'))).toBe('Acesso negado.');
    expect(describePagamentoError(new TypeError('fetch failed'))).toBe(
      'Não foi possível conectar ao pagamentos-service.',
    );
  });
});

describe('cliente HTTP (contra o pagamentos-service simulado)', () => {
  it('listPagamentos manda token, X-Tenant-Id, limite, cursor, status e pedidoId', async () => {
    signInAs('admin', FARMA);
    const urls: URL[] = [];
    const headers: Headers[] = [];
    server.events.on('request:start', ({ request }) => {
      urls.push(new URL(request.url));
      headers.push(request.headers);
    });
    const pagina = await listPagamentos({ limite: 2 });
    expect(pagina.itens).toHaveLength(2);
    expect(pagina.proximoCursor).toBe(pagina.itens[1]!.id);
    expect(headers[0]!.get('Authorization')).toBe('Bearer demo-admin');
    expect(headers[0]!.get('X-Tenant-Id')).toBe(FARMA);

    const filtrada = await listPagamentos({
      status: 'APROVADO',
      pedidoId: 'ped-farmaceutica-0007',
      cursor: null,
    });
    expect(filtrada.itens.map((p) => p.id)).toEqual(['pag-farmaceutica-0007']);
    expect(urls[1]!.searchParams.get('limite')).toBe('20');
    expect(urls[1]!.searchParams.get('status')).toBe('APROVADO');
    expect(urls[1]!.searchParams.get('pedidoId')).toBe('ped-farmaceutica-0007');
    expect(urls[1]!.searchParams.has('cursor')).toBe(false);

    const segunda = await listPagamentos({ limite: 2, cursor: pagina.proximoCursor });
    expect(urls[2]!.searchParams.get('cursor')).toBe(pagina.proximoCursor);
    expect(segunda.itens[0]!.id).not.toBe(pagina.itens[1]!.id);
    server.events.removeAllListeners();
  });

  it('getPagamento e listLancamentos (com saldo)', async () => {
    signInAs('admin', FARMA);
    const pag = await getPagamento('pag-farmaceutica-0005');
    expect(pag).toMatchObject({ status: 'ESTORNADO', pedidoId: 'ped-farmaceutica-0005' });
    const extrato = await listLancamentos({ limite: 3 });
    expect(extrato.itens).toHaveLength(3);
    expect(extrato.saldo.moeda).toBe('BRL');
    expect(extrato.proximoCursor).toBe(extrato.itens[2]!.id);
    const resto = await listLancamentos({ cursor: extrato.proximoCursor });
    expect(resto.proximoCursor).toBeNull();
  });

  it('comprador recebe 403 acesso-negado em pagamentos e no ledger', async () => {
    signInAs('bruno', FARMA);
    const erro = await listPagamentos().catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect(erro).toMatchObject({
      httpStatus: 403,
      problemType: 'https://plataforma.dev.br/problemas/acesso-negado',
      message: 'Pagamentos e o ledger exigem o papel gestor-tenant ou plataforma-admin.',
    });
    await expect(listLancamentos()).rejects.toMatchObject({ httpStatus: 403 });
    await expect(getPagamento('pag-farmaceutica-0007')).rejects.toMatchObject({
      httpStatus: 403,
    });
  });

  it('resposta fora do contrato vira ApiError; sem proximoCursor vira null', async () => {
    signInAs('admin', FARMA);
    server.use(
      http.get('*/api/v1/pagamentos', () => HttpResponse.json({ itens: [pagamento] }), {
        once: true,
      }),
      http.get('*/api/v1/ledger/lancamentos', () =>
        HttpResponse.json({ itens: [lancamento], saldo: { centavos: 5, moeda: 'BRL' } }),
      ),
    );
    expect(await listPagamentos()).toEqual({ itens: [pagamento], proximoCursor: null });
    expect(await listLancamentos()).toEqual({
      itens: [lancamento],
      saldo: { centavos: 5, moeda: 'BRL' },
      proximoCursor: null,
    });
    server.use(
      http.get('*/api/v1/pagamentos', () => HttpResponse.json({ itens: 'x' })),
      http.get('*/api/v1/ledger/lancamentos', () => HttpResponse.json({ itens: [] })),
      http.get('*/api/v1/pagamentos/:id', () => HttpResponse.json([])),
    );
    await expect(listPagamentos()).rejects.toThrow('fora do contrato');
    await expect(listLancamentos()).rejects.toThrow('fora do contrato');
    await expect(getPagamento('x')).rejects.toThrow('fora do contrato');
  });

  it('a página do extrato rejeita corpos que não são objeto', async () => {
    signInAs('admin', FARMA);
    server.use(
      http.get('*/api/v1/ledger/lancamentos', () => HttpResponse.json(null)),
      http.get('*/api/v1/pagamentos', () => HttpResponse.json(null)),
    );
    await expect(listLancamentos()).rejects.toThrow('fora do contrato');
    await expect(listPagamentos()).rejects.toThrow('fora do contrato');
  });
});
