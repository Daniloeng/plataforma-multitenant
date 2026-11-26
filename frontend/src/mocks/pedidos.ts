// Pedidos-service simulado (modo demo e testes): store em memória por tenant, atrás do gateway
// simulado, com as regras do contrato pedidos.yaml. Nome, SKU e preço de cada item vêm do store
// do catálogo simulado (no serviço real, da cópia local alimentada por produto.alterado e
// preco.alterado); o cliente vem do X-Cliente-Id que o gateway escreve a partir do token.

import { http, HttpResponse } from 'msw';
import { MOEDA_PADRAO, type Produto } from '../api/catalogo';
import {
  IDEMPOTENCY_KEY_MAX,
  IDEMPOTENCY_KEY_MIN,
  ITENS_MAX,
  LIMITE_PADRAO,
  isStatusPedido,
  podeComprar,
  quantidadeValida,
  veTodosOsPedidos,
  type ItemPedido,
  type Pedido,
  type StatusPedido,
} from '../api/pedidos';
import type { Tenant } from '../api/tenants';
import { catalogoSnapshot } from './catalogo';
import { clienteIdOf, guard, problemResponse } from './gateway';

type SeedItem = readonly [sku: string, quantidade: number];
type Seed = readonly [clienteId: string, itens: readonly SeedItem[], cancelado?: boolean];

/** Pedidos de exemplo, do mais recente para o mais antigo. */
const SEEDS: Record<string, readonly Seed[]> = {
  'farmaceutica-boa-saude': [
    [
      'cli-bruno',
      [
        ['DIP-500-CX10', 4],
        ['SOR-FIS-500', 10],
      ],
    ],
    ['cli-hospital-sao-lucas', [['LUV-PRO-M', 50]]],
    [
      'cli-drogaria-central',
      [
        ['PAR-750-CX20', 3],
        ['ALC-GEL-70', 6],
        ['MAS-TRI-50', 20],
      ],
    ],
    ['cli-bruno', [['SER-5ML-100', 12]], true],
    [
      'cli-clinica-vida',
      [
        ['GAZ-EST-10', 8],
        ['TER-DIG-01', 1],
      ],
    ],
    [
      'cli-bruno',
      [
        ['ALC-GEL-70', 2],
        ['MAS-TRI-50', 15],
        ['LUV-PRO-M', 10],
      ],
    ],
    ['cli-hospital-sao-lucas', [['SOR-FIS-500', 40]], true],
    ['cli-drogaria-central', [['DIP-500-CX10', 2]]],
  ],
  'distribuidora-aurora': [
    [
      'cli-mercado-bom-preco',
      [
        ['ARZ-T1-5KG', 10],
        ['FEJ-CAR-1KG', 8],
      ],
    ],
    ['cli-padaria-trigo-de-ouro', [['FAR-TRI-1KG', 25]]],
    ['cli-mercado-bom-preco', [['CAF-TOR-500', 3]], true],
  ],
  'atacado-vale-verde': [['cli-hotel-serra-verde', [['PAP-HIG-F30', 6]]]],
};

/** Datas dos exemplos: antes do primeiro dia do pedidos-service; pedidos novos ficam no topo. */
const SEED_DATE = Date.UTC(2026, 10, 25, 18, 0, 0);
const HORA = 3_600_000;

function itemDe(produto: Produto, quantidade: number): ItemPedido {
  return {
    produtoId: produto.id,
    sku: produto.sku,
    nome: produto.nome,
    quantidade,
    precoUnitario: { ...produto.preco },
  };
}

function totalDe(itens: readonly ItemPedido[]): Pedido['total'] {
  const centavos = itens.reduce(
    (soma, i) => soma + (i.precoUnitario?.centavos ?? 0) * i.quantidade,
    0,
  );
  return { centavos, moeda: itens[0]?.precoUnitario?.moeda ?? MOEDA_PADRAO };
}

function seedPedidos(tenantId: string): Pedido[] {
  const catalogo = catalogoSnapshot(tenantId);
  return (SEEDS[tenantId] ?? []).map(([clienteId, seedItens, cancelado = false], i) => {
    const itens = seedItens.flatMap(([sku, quantidade]) => {
      const produto = catalogo.find((p) => p.sku === sku);
      return produto ? [itemDe(produto, quantidade)] : [];
    });
    const criadoEm = new Date(SEED_DATE - i * 7 * HORA).toISOString();
    const atualizadoEm = cancelado
      ? new Date(SEED_DATE - i * 7 * HORA + HORA).toISOString()
      : criadoEm;
    return {
      id: `ped-${tenantId.split('-')[0]}-${String(SEEDS[tenantId]!.length - i).padStart(4, '0')}`,
      clienteId,
      status: cancelado ? 'CANCELADO' : 'PENDENTE',
      itens,
      total: totalDe(itens),
      motivoCancelamento: cancelado ? 'SOLICITADO_PELO_CLIENTE' : null,
      criadoEm,
      atualizadoEm,
    };
  });
}

interface Chave {
  hash: string;
  pedidoId: string;
}

/** Pedidos por tenant, do mais recente para o mais antigo (a ordem da listagem). */
let store = new Map<string, Pedido[]>();
/** Idempotência por (tenant, cliente, chave): hash do corpo e pedido criado. */
let chaves = new Map<string, Chave>();
let sequence = 0;

/** Volta aos pedidos iniciais; `initial` troca os pedidos de alguns tenants (testes). */
export function resetPedidosStore(initial: Record<string, readonly Pedido[]> = {}): void {
  store = new Map(Object.entries(initial).map(([t, ps]) => [t, ps.map(copia)]));
  chaves = new Map();
  sequence = 0;
}

function pedidosDo(tenantId: string): Pedido[] {
  let pedidos = store.get(tenantId);
  if (!pedidos) {
    pedidos = seedPedidos(tenantId);
    store.set(tenantId, pedidos);
  }
  return pedidos;
}

/** Cópia dos pedidos de um tenant, do mais recente para o mais antigo. */
export function pedidosSnapshot(tenantId: string): Pedido[] {
  return pedidosDo(tenantId).map(copia);
}

function copia(pedido: Pedido): Pedido {
  return {
    ...pedido,
    total: { ...pedido.total },
    itens: pedido.itens.map((i) => ({
      ...i,
      precoUnitario: i.precoUnitario ? { ...i.precoUnitario } : undefined,
    })),
  };
}

/** Hash estável do corpo (itens na ordem enviada): FNV-1a de 32 bits sobre o JSON canônico. */
export function hashCorpo(itens: readonly { produtoId: string; quantidade: number }[]): string {
  const texto = JSON.stringify(itens.map(({ produtoId, quantidade }) => [produtoId, quantidade]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---- Respostas de erro (Problem Details) ----

const invalida = (detail: string) =>
  problemResponse(400, 'requisicao-invalida', 'Requisição inválida', detail);

const naoEncontrado = (id: string) =>
  problemResponse(
    404,
    'nao-encontrado',
    'Pedido não encontrado',
    `Pedido '${id}' não encontrado neste tenant.`,
  );

const acessoNegado = (detail: string) =>
  problemResponse(403, 'acesso-negado', 'Acesso negado', detail);

// ---- Gateway: token, tenant, papel e cliente ----

/** `clienteId` null = gestor (vê todos os pedidos do tenant). */
type Acesso = { tenant: Tenant; clienteId: string | null } | { response: Response };

function acesso(request: Request, criar = false): Acesso {
  const result = guard(request, { rateLimit: true });
  if ('response' in result) return result;
  if (!result.tenant) return { response: invalida('O cabeçalho X-Tenant-Id é obrigatório.') };
  const { user, tenant } = result;
  const clienteId = clienteIdOf(user);
  const comprador = podeComprar(user.papeis, clienteId);
  if (criar) {
    return comprador
      ? { tenant, clienteId: clienteId! }
      : { response: acessoNegado('Criar pedidos exige o papel comprador (com cliente no token).') };
  }
  // Como o canManage() do pedidos-service: quem gere o tenant vê todos, mesmo sendo comprador.
  if (veTodosOsPedidos(user.papeis)) return { tenant, clienteId: null };
  if (comprador) return { tenant, clienteId: clienteId! };
  return { response: acessoNegado('Pedidos exigem o papel comprador ou gestor-tenant.') };
}

/** Pedido do tenant visível para quem pede (comprador só enxerga os do próprio cliente). */
function encontra(tenantId: string, id: string, clienteId: string | null): Pedido | undefined {
  return pedidosDo(tenantId).find(
    (p) => p.id === id && (clienteId === null || p.clienteId === clienteId),
  );
}

async function readItens(
  request: Request,
): Promise<{ produtoId: string; quantidade: number }[] | string> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return 'O corpo da requisição deve ser um objeto JSON.';
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'O corpo da requisição deve ser um objeto JSON.';
  }
  const itens = (body as Record<string, unknown>).itens;
  if (!Array.isArray(itens) || itens.length < 1 || itens.length > ITENS_MAX) {
    return `itens deve ter de 1 a ${ITENS_MAX} produtos.`;
  }
  const lidos: { produtoId: string; quantidade: number }[] = [];
  for (const [i, item] of itens.entries()) {
    const it = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof it.produtoId !== 'string' || it.produtoId.length === 0) {
      return `itens[${i}].produtoId é obrigatório.`;
    }
    if (typeof it.quantidade !== 'number' || !quantidadeValida(it.quantidade)) {
      return `itens[${i}].quantidade deve ser um inteiro de 1 a 10000.`;
    }
    lidos.push({ produtoId: it.produtoId, quantidade: it.quantidade });
  }
  return lidos;
}

export const pedidosHandlers = [
  http.post('*/api/v1/pedidos', async ({ request }) => {
    const a = acesso(request, true);
    if ('response' in a) return a.response;
    const clienteId = a.clienteId!;
    const chave = request.headers.get('Idempotency-Key') ?? '';
    if (chave.length < IDEMPOTENCY_KEY_MIN || chave.length > IDEMPOTENCY_KEY_MAX) {
      return invalida(
        `O cabeçalho Idempotency-Key é obrigatório (de ${IDEMPOTENCY_KEY_MIN} a ${IDEMPOTENCY_KEY_MAX} caracteres).`,
      );
    }
    const itens = await readItens(request);
    if (typeof itens === 'string') return invalida(itens);

    const hash = hashCorpo(itens);
    const chaveId = `${a.tenant.id}|${clienteId}|${chave}`;
    const anterior = chaves.get(chaveId);
    if (anterior) {
      if (anterior.hash !== hash) {
        return problemResponse(
          409,
          'chave-reutilizada',
          'Idempotency-Key reutilizada',
          'Esta Idempotency-Key já foi usada com outro corpo. Gere uma chave nova para um pedido diferente.',
        );
      }
      const pedido = encontra(a.tenant.id, anterior.pedidoId, clienteId)!;
      return HttpResponse.json(copia(pedido), {
        status: 200,
        headers: { 'Idempotent-Replayed': 'true' },
      });
    }

    // Preço, SKU e nome vêm do catálogo do tenant; inexistente, inativo ou de outro tenant =
    // indisponível. Como o pedidos-service, lista todos os indisponíveis (sem repetir), não só o
    // primeiro.
    const catalogo = catalogoSnapshot(a.tenant.id);
    const itensPedido: ItemPedido[] = [];
    const indisponiveis: string[] = [];
    for (const { produtoId, quantidade } of itens) {
      const produto = catalogo.find((p) => p.id === produtoId && p.ativo);
      if (produto) itensPedido.push(itemDe(produto, quantidade));
      else if (!indisponiveis.includes(produtoId)) indisponiveis.push(produtoId);
    }
    if (indisponiveis.length > 0) {
      return problemResponse(
        409,
        'produto-indisponivel',
        'Produto indisponível',
        `Produto indisponível (inexistente, inativo ou sem preço no catálogo): ${indisponiveis.join(', ')}.`,
        {},
        { produtos: indisponiveis },
      );
    }

    sequence += 1;
    const agora = new Date().toISOString();
    const pedido: Pedido = {
      id: `ped-n${String(sequence).padStart(5, '0')}`,
      clienteId,
      status: 'PENDENTE',
      itens: itensPedido,
      total: totalDe(itensPedido),
      motivoCancelamento: null,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    pedidosDo(a.tenant.id).unshift(pedido);
    chaves.set(chaveId, { hash, pedidoId: pedido.id });
    return HttpResponse.json(copia(pedido), {
      status: 201,
      headers: { Location: `/api/v1/pedidos/${pedido.id}` },
    });
  }),

  http.get('*/api/v1/pedidos', ({ request }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const params = new URL(request.url).searchParams;

    const limiteRaw = params.get('limite');
    const limite = limiteRaw === null ? LIMITE_PADRAO : Number(limiteRaw);
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
      return invalida('limite deve ser um inteiro entre 1 e 100.');
    }
    const status = params.get('status');
    if (status !== null && !isStatusPedido(status)) {
      return invalida('status deve ser PENDENTE, CONFIRMADO ou CANCELADO.');
    }
    const filtrados = pedidosDo(a.tenant.id).filter(
      (p) =>
        (a.clienteId === null || p.clienteId === a.clienteId) &&
        (status === null || p.status === (status as StatusPedido)),
    );

    let inicio = 0;
    const cursor = params.get('cursor');
    if (cursor) {
      // Cursor = id do último pedido da página anterior; a próxima começa logo depois dele.
      const todos = pedidosDo(a.tenant.id);
      const posicao = todos.findIndex((p) => p.id === cursor);
      if (posicao < 0) return invalida(`cursor inválido: '${cursor}'.`);
      inicio = filtrados.findIndex((p) => todos.indexOf(p) > posicao);
      if (inicio < 0) inicio = filtrados.length;
    }
    const itens = filtrados.slice(inicio, inicio + limite);
    const temMais = inicio + limite < filtrados.length;
    return HttpResponse.json({
      itens: itens.map(copia),
      proximoCursor: temMais ? (itens.at(-1)?.id ?? null) : null,
    });
  }),

  http.get('*/api/v1/pedidos/:id', ({ request, params }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const id = String(params.id);
    const pedido = encontra(a.tenant.id, id, a.clienteId);
    return pedido ? HttpResponse.json(copia(pedido)) : naoEncontrado(id);
  }),

  http.post('*/api/v1/pedidos/:id/cancelamento', ({ request, params }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const id = String(params.id);
    const pedido = encontra(a.tenant.id, id, a.clienteId);
    if (!pedido) return naoEncontrado(id);
    if (pedido.status === 'CANCELADO') {
      return problemResponse(
        409,
        'pedido-ja-cancelado',
        'Pedido já cancelado',
        `O pedido '${id}' já está cancelado.`,
      );
    }
    pedido.status = 'CANCELADO';
    // Quem cancela entra no motivo, como no pedidos-service.
    pedido.motivoCancelamento =
      a.clienteId === null ? 'CANCELADO_PELO_TENANT' : 'SOLICITADO_PELO_CLIENTE';
    pedido.atualizadoEm = new Date().toISOString();
    return HttpResponse.json(copia(pedido));
  }),
];
