// Cliente e tipos do contrato de Pagamentos (libs/contracts/.../openapi/pagamentos.yaml).
//
// Só leitura: a cobrança acontece de forma assíncrona no pagamentos-service, a partir do evento
// pedido.criado (não existe POST de pagamento). Pagamentos e o ledger são do financeiro do tenant:
// só gestor-tenant e plataforma-admin consultam; os demais papéis recebem 403.

import { formatDinheiro, type Dinheiro } from './catalogo';
import { ApiError, apiFetch, apiUrl, readJson } from './http';
import type { Papel } from './me';

export const STATUS_PAGAMENTO = ['AUTORIZANDO', 'APROVADO', 'RECUSADO', 'ESTORNADO'] as const;
export type StatusPagamento = (typeof STATUS_PAGAMENTO)[number];

export const STATUS_PAGAMENTO_LABEL: Record<StatusPagamento, string> = {
  AUTORIZANDO: 'Autorizando',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
  ESTORNADO: 'Estornado',
};

export const CONTAS = ['CAIXA_GATEWAY', 'RECEITA_TENANT', 'ESTORNOS'] as const;
export type Conta = (typeof CONTAS)[number];

/** Nome da conta do ledger para quem não é contador. */
export const CONTA_LABEL: Record<Conta, string> = {
  CAIXA_GATEWAY: 'Caixa no gateway',
  RECEITA_TENANT: 'Receita do tenant',
  ESTORNOS: 'Estornos',
};

/** O que cada conta representa, em uma frase curta. */
export const CONTA_DESCRICAO: Record<Conta, string> = {
  CAIXA_GATEWAY: 'Dinheiro que passa pelo gateway de pagamento.',
  RECEITA_TENANT: 'O que o tenant ganhou com as vendas.',
  ESTORNOS: 'Valores devolvidos aos clientes.',
};

export const NATUREZAS = ['DEBITO', 'CREDITO'] as const;
export type Natureza = (typeof NATUREZAS)[number];

export const NATUREZA_LABEL: Record<Natureza, string> = {
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
};

export interface Pagamento {
  id: string;
  pedidoId: string;
  status: StatusPagamento;
  valor: Dinheiro;
  /** Cliente B2B dono do pedido. */
  clienteId?: string;
  motivoRecusa?: string | null;
  criadoEm: string;
  atualizadoEm?: string;
}

/** Uma partida do ledger: todo movimento gera um débito e um crédito de mesmo valor. */
export interface Lancamento {
  id: string;
  pagamentoId: string;
  pedidoId?: string;
  conta: Conta;
  natureza: Natureza;
  valor: Dinheiro;
  ocorridoEm: string;
}

export interface PaginaPagamentos {
  itens: Pagamento[];
  proximoCursor: string | null;
}

/** Página do extrato; `saldo` é a receita líquida do tenant (vale para todas as páginas). */
export interface PaginaLancamentos {
  itens: Lancamento[];
  saldo: Dinheiro;
  proximoCursor: string | null;
}

export const LIMITE_PADRAO = 20;

/** Pagamentos e o ledger são do financeiro: gestor do tenant e administradora da plataforma. */
export function veFinanceiro(papeis: readonly Papel[]): boolean {
  return papeis.includes('gestor-tenant') || papeis.includes('plataforma-admin');
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

function oneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);
}

export const isStatusPagamento = oneOf(STATUS_PAGAMENTO);
const isConta = oneOf(CONTAS);
const isNatureza = oneOf(NATUREZAS);

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

export function isPagamento(value: unknown): value is Pagamento {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.pedidoId === 'string' &&
    isStatusPagamento(p.status) &&
    isDinheiro(p.valor) &&
    optionalString(p.clienteId) &&
    optionalString(p.motivoRecusa) &&
    typeof p.criadoEm === 'string' &&
    optionalString(p.atualizadoEm)
  );
}

export function isLancamento(value: unknown): value is Lancamento {
  if (typeof value !== 'object' || value === null) return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.id === 'string' &&
    typeof l.pagamentoId === 'string' &&
    optionalString(l.pedidoId) &&
    isConta(l.conta) &&
    isNatureza(l.natureza) &&
    isDinheiro(l.valor) &&
    typeof l.ocorridoEm === 'string'
  );
}

function isPaginaPagamentos(value: unknown): value is PaginaPagamentos {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return Array.isArray(p.itens) && p.itens.every(isPagamento) && optionalString(p.proximoCursor);
}

function isPaginaLancamentos(value: unknown): value is PaginaLancamentos {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    Array.isArray(p.itens) &&
    p.itens.every(isLancamento) &&
    isDinheiro(p.saldo) &&
    optionalString(p.proximoCursor)
  );
}

// ---- Cliente HTTP ----

/** URL absoluta de /api/v1/pagamentos (ou de um pagamento). */
export function pagamentosUrl(
  id?: string,
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  const path =
    id === undefined ? 'api/v1/pagamentos' : `api/v1/pagamentos/${encodeURIComponent(id)}`;
  return apiUrl(path, baseUrl, origin);
}

/** URL absoluta do extrato do ledger (/api/v1/ledger/lancamentos). */
export function lancamentosUrl(
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  return apiUrl('api/v1/ledger/lancamentos', baseUrl, origin);
}

const ACCEPT = 'application/json, application/problem+json';

/** GET /api/v1/pagamentos?limite=&cursor=&status=&pedidoId= — do mais recente para o mais antigo. */
export async function listPagamentos(
  options: {
    status?: StatusPagamento;
    pedidoId?: string;
    cursor?: string | null;
    limite?: number;
    signal?: AbortSignal;
  } = {},
): Promise<PaginaPagamentos> {
  const url = new URL(pagamentosUrl());
  url.searchParams.set('limite', String(options.limite ?? LIMITE_PADRAO));
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  if (options.status) url.searchParams.set('status', options.status);
  if (options.pedidoId) url.searchParams.set('pedidoId', options.pedidoId);
  const response = await apiFetch(url, { headers: { Accept: ACCEPT }, signal: options.signal });
  const pagina = await readJson(response, isPaginaPagamentos);
  return { itens: pagina.itens, proximoCursor: pagina.proximoCursor ?? null };
}

/** GET /api/v1/pagamentos/{id}. */
export async function getPagamento(id: string, signal?: AbortSignal): Promise<Pagamento> {
  const response = await apiFetch(pagamentosUrl(id), { headers: { Accept: ACCEPT }, signal });
  return readJson(response, isPagamento);
}

/** GET /api/v1/ledger/lancamentos?limite=&cursor= — extrato e saldo (receita líquida). */
export async function listLancamentos(
  options: { cursor?: string | null; limite?: number; signal?: AbortSignal } = {},
): Promise<PaginaLancamentos> {
  const url = new URL(lancamentosUrl());
  url.searchParams.set('limite', String(options.limite ?? LIMITE_PADRAO));
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  const response = await apiFetch(url, { headers: { Accept: ACCEPT }, signal: options.signal });
  const pagina = await readJson(response, isPaginaLancamentos);
  return { itens: pagina.itens, saldo: pagina.saldo, proximoCursor: pagina.proximoCursor ?? null };
}

/** Mensagem legível em pt-BR para qualquer falha (rede vira "não foi possível conectar"). */
export function describePagamentoError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar ao pagamentos-service.';
}
