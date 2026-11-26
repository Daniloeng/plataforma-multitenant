import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { signInAs } from '../test/session';
import { ApiError } from './http';
import {
  PROBLEMA_CHAVE_REUTILIZADA,
  PROBLEMA_PRODUTO_INDISPONIVEL,
  cancelarPedido,
  createPedido,
  describePedidoError,
  getPedido,
  isNetworkError,
  isPedido,
  listPedidos,
  novaIdempotencyKey,
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
    expect(podeComprar(['comprador'])).toBe(true);
    expect(podeComprar(['gestor-tenant'])).toBe(false);
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

  it('describePedidoError e isNetworkError distinguem rede de resposta da API', () => {
    expect(describePedidoError(new ApiError('detalhe', 409))).toBe('detalhe');
    expect(describePedidoError(new TypeError('Failed to fetch'))).toBe(
      'Não foi possível conectar ao pedidos-service.',
    );
    expect(isNetworkError(new TypeError('x'))).toBe(true);
    expect(isNetworkError(new ApiError('x', 500))).toBe(false);
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
