// Cliente e tipos do contrato de Pedidos (libs/contracts/.../openapi/pedidos.yaml).
//
// Toda chamada passa pelo gateway com o token e o X-Tenant-Id (apiFetch); o X-Cliente-Id é o
// gateway que injeta, a partir da claim cliente_id do token, e nunca sai do frontend. O corpo da
// criação só traz produto e quantidade: o preço é sempre o do servidor.

import { formatDinheiro, type Dinheiro } from './catalogo';
import { ApiError, PROBLEM_BASE, apiFetch, apiUrl, readJson } from './http';
import type { Papel } from './me';

export const STATUS_PEDIDO = ['PENDENTE', 'CONFIRMADO', 'CANCELADO'] as const;
export type StatusPedido = (typeof STATUS_PEDIDO)[number];

export const MOTIVOS_CANCELAMENTO = [
  'PAGAMENTO_RECUSADO',
  'SOLICITADO_PELO_CLIENTE',
  'EXPIRADO',
  'OUTRO',
  'CANCELADO_PELO_TENANT',
] as const;
export type MotivoCancelamento = (typeof MOTIVOS_CANCELAMENTO)[number];

export const STATUS_PEDIDO_LABEL: Record<StatusPedido, string> = {
  PENDENTE: 'Pendente',
  CONFIRMADO: 'Confirmado',
  CANCELADO: 'Cancelado',
};

export const MOTIVO_CANCELAMENTO_LABEL: Record<MotivoCancelamento, string> = {
  PAGAMENTO_RECUSADO: 'Pagamento recusado',
  SOLICITADO_PELO_CLIENTE: 'Solicitado pelo cliente',
  EXPIRADO: 'Expirado',
  OUTRO: 'Outro motivo',
  CANCELADO_PELO_TENANT: 'Cancelado pelo tenant',
};

/** Item como o servidor devolve: sku, nome e preço são do catálogo no momento do pedido. */
export interface ItemPedido {
  produtoId: string;
  quantidade: number;
  sku?: string;
  nome?: string;
  precoUnitario?: Dinheiro;
}

/** Item do corpo de POST /api/v1/pedidos: só produto e quantidade. */
export interface NovoItemPedido {
  produtoId: string;
  quantidade: number;
}

export interface NovoPedido {
  itens: NovoItemPedido[];
}

export interface Pedido {
  id: string;
  clienteId: string;
  status: StatusPedido;
  itens: ItemPedido[];
  total: Dinheiro;
  motivoCancelamento?: MotivoCancelamento | null;
  criadoEm: string;
  atualizadoEm?: string;
}

export interface PaginaPedidos {
  itens: Pedido[];
  proximoCursor: string | null;
}

/** Resultado da criação: `replayed` quando o servidor devolveu o pedido de uma chave já usada. */
export interface PedidoCriado {
  pedido: Pedido;
  replayed: boolean;
}

export const LIMITE_PADRAO = 20;
export const QUANTIDADE_MIN = 1;
export const QUANTIDADE_MAX = 10000;
export const ITENS_MAX = 200;
export const IDEMPOTENCY_KEY_MIN = 8;
export const IDEMPOTENCY_KEY_MAX = 64;

/** `type` dos Problem Details que a tela destaca. */
export const PROBLEMA_PRODUTO_INDISPONIVEL = `${PROBLEM_BASE}produto-indisponivel`;
export const PROBLEMA_CHAVE_REUTILIZADA = `${PROBLEM_BASE}chave-reutilizada`;

/** Só compradores (com cliente no token) criam pedidos. */
export function podeComprar(papeis: readonly Papel[]): boolean {
  return papeis.includes('comprador');
}

/** Gestor do tenant (e a administradora da plataforma) veem os pedidos de todos os clientes. */
export function veTodosOsPedidos(papeis: readonly Papel[]): boolean {
  return papeis.includes('gestor-tenant') || papeis.includes('plataforma-admin');
}

/** Quantidade aceita pelo contrato (inteiro de 1 a 10.000). */
export function quantidadeValida(quantidade: number): boolean {
  return (
    Number.isInteger(quantidade) && quantidade >= QUANTIDADE_MIN && quantidade <= QUANTIDADE_MAX
  );
}

/** Nova Idempotency-Key (UUID v4, 36 caracteres), com alternativa fora de contexto seguro. */
export function novaIdempotencyKey(cryptoImpl: Partial<Crypto> = globalThis.crypto): string {
  if (typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoImpl.getRandomValues === 'function') cryptoImpl.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Subtotal estimado de um item (preço × quantidade), em centavos. */
export function subtotal(preco: Dinheiro, quantidade: number): Dinheiro {
  return { centavos: preco.centavos * quantidade, moeda: preco.moeda };
}

/** Resumo curto dos itens: "Dipirona 500 mg × 2, Seringa × 1 e mais 2". */
export function resumoItens(itens: readonly ItemPedido[], max = 2): string {
  const nomes = itens
    .slice(0, max)
    .map((i) => `${i.nome ?? i.sku ?? i.produtoId} × ${i.quantidade.toLocaleString('pt-BR')}`);
  const resto = itens.length - max;
  return resto > 0 ? `${nomes.join(', ')} e mais ${resto}` : nomes.join(', ');
}

export { formatDinheiro };

// ---- Guardas do formato das respostas ----

function isDinheiro(value: unknown): value is Dinheiro {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.centavos === 'number' &&
    Number.isInteger(d.centavos) &&
    d.centavos >= 0 &&
    typeof d.moeda === 'string'
  );
}

export function isStatusPedido(value: unknown): value is StatusPedido {
  return typeof value === 'string' && (STATUS_PEDIDO as readonly string[]).includes(value);
}

function isMotivo(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && (MOTIVOS_CANCELAMENTO as readonly string[]).includes(value))
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isItemPedido(value: unknown): value is ItemPedido {
  if (typeof value !== 'object' || value === null) return false;
  const i = value as Record<string, unknown>;
  return (
    typeof i.produtoId === 'string' &&
    typeof i.quantidade === 'number' &&
    Number.isInteger(i.quantidade) &&
    optionalString(i.sku) &&
    optionalString(i.nome) &&
    (i.precoUnitario === undefined || isDinheiro(i.precoUnitario))
  );
}

export function isPedido(value: unknown): value is Pedido {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.clienteId === 'string' &&
    isStatusPedido(p.status) &&
    Array.isArray(p.itens) &&
    p.itens.every(isItemPedido) &&
    isDinheiro(p.total) &&
    isMotivo(p.motivoCancelamento) &&
    typeof p.criadoEm === 'string' &&
    optionalString(p.atualizadoEm)
  );
}

function isPaginaPedidos(value: unknown): value is PaginaPedidos {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return Array.isArray(p.itens) && p.itens.every(isPedido) && optionalString(p.proximoCursor);
}

// ---- Cliente HTTP ----

/** URL absoluta de /api/v1/pedidos (ou de um pedido; `sub` = 'cancelamento' para o POST). */
export function pedidosUrl(
  id?: string,
  sub?: 'cancelamento',
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  let path = 'api/v1/pedidos';
  if (id !== undefined) path += `/${encodeURIComponent(id)}`;
  if (id !== undefined && sub) path += `/${sub}`;
  return apiUrl(path, baseUrl, origin);
}

const ACCEPT = 'application/json, application/problem+json';

/** GET /api/v1/pedidos?limite=&cursor=&status= — do mais recente para o mais antigo. */
export async function listPedidos(
  options: {
    status?: StatusPedido;
    cursor?: string | null;
    limite?: number;
    signal?: AbortSignal;
  } = {},
): Promise<PaginaPedidos> {
  const url = new URL(pedidosUrl());
  url.searchParams.set('limite', String(options.limite ?? LIMITE_PADRAO));
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  if (options.status) url.searchParams.set('status', options.status);
  const response = await apiFetch(url, { headers: { Accept: ACCEPT }, signal: options.signal });
  const pagina = await readJson(response, isPaginaPedidos);
  return { itens: pagina.itens, proximoCursor: pagina.proximoCursor ?? null };
}

/** GET /api/v1/pedidos/{id} — pedido de outro cliente responde 404 para o comprador. */
export async function getPedido(id: string, signal?: AbortSignal): Promise<Pedido> {
  const response = await apiFetch(pedidosUrl(id), { headers: { Accept: ACCEPT }, signal });
  return readJson(response, isPedido);
}

/**
 * POST /api/v1/pedidos com a Idempotency-Key da tentativa: 201 (criado) ou 200 com
 * `Idempotent-Replayed: true` (a mesma chave e o mesmo corpo já criaram o pedido).
 */
export async function createPedido(
  novo: NovoPedido,
  idempotencyKey: string,
): Promise<PedidoCriado> {
  if (idempotencyKey.length < IDEMPOTENCY_KEY_MIN || idempotencyKey.length > IDEMPOTENCY_KEY_MAX) {
    throw new ApiError(
      `A Idempotency-Key deve ter de ${IDEMPOTENCY_KEY_MIN} a ${IDEMPOTENCY_KEY_MAX} caracteres.`,
    );
  }
  const response = await apiFetch(pedidosUrl(), {
    method: 'POST',
    headers: {
      Accept: ACCEPT,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      itens: novo.itens.map(({ produtoId, quantidade }) => ({ produtoId, quantidade })),
    }),
  });
  const pedido = await readJson(response, isPedido);
  const replayed =
    response.status === 200 ||
    response.headers.get('Idempotent-Replayed')?.toLowerCase() === 'true';
  return { pedido, replayed };
}

/** POST /api/v1/pedidos/{id}/cancelamento — 409 se já estiver cancelado. */
export async function cancelarPedido(id: string): Promise<Pedido> {
  const response = await apiFetch(pedidosUrl(id, 'cancelamento'), {
    method: 'POST',
    headers: { Accept: ACCEPT },
  });
  return readJson(response, isPedido);
}

/** Mensagem legível em pt-BR para qualquer falha (rede vira "não foi possível conectar"). */
export function describePedidoError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar ao pedidos-service.';
}

/** A falha foi de rede (sem resposta do servidor)? Repetir com a mesma chave é seguro. */
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof ApiError);
}
