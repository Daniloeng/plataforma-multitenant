// Cliente e tipos do contrato do Tenant Service (libs/contracts/.../openapi/tenants.yaml).

import { ApiError, apiUrl } from './http';

export const PLANOS = ['GRATUITO', 'PROFISSIONAL', 'EMPRESARIAL'] as const;
export const NIVEIS_ISOLAMENTO = ['POOL', 'BRIDGE', 'SILO'] as const;

export type Plano = (typeof PLANOS)[number];
export type NivelIsolamento = (typeof NIVEIS_ISOLAMENTO)[number];

export interface Tenant {
  id: string;
  nome: string;
  plano: Plano;
  nivelIsolamento: NivelIsolamento;
  ativo: boolean;
  /** Data-hora ISO 8601. */
  criadoEm: string;
}

export interface NovoTenant {
  id: string;
  nome: string;
  plano: Plano;
  /** Opcional no contrato; o servidor assume POOL. */
  nivelIsolamento?: NivelIsolamento;
}

export interface AlteracaoTenant {
  nome?: string;
  plano?: Plano;
  nivelIsolamento?: NivelIsolamento;
  ativo?: boolean;
}

export interface PaginaTenants {
  itens: Tenant[];
  proximoCursor: string | null;
}

/** Problem Details (RFC 9457), formato de erro de todas as APIs. */
export interface Problema {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

/** Tamanho de página padrão do contrato (parâmetro `limite`). */
export const LIMITE_PADRAO = 20;

// ---- Validação (as mesmas regras do contrato e do TenantId de libs/platform-core) ----

/** Mesmo padrão de `NovoTenant.id` no OpenAPI. */
export const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
export const NOME_MIN = 2;
export const NOME_MAX = 120;

/** Devolve a mensagem de erro do id, ou null se for válido. */
export function validateTenantId(id: string): string | null {
  if (id.length === 0) return 'Informe o id do tenant.';
  if (!TENANT_ID_PATTERN.test(id)) {
    return 'Use de 3 a 40 caracteres: letras minúsculas, números e hífen, começando por letra e sem terminar em hífen.';
  }
  if (id.includes('--')) return 'Hífens consecutivos não são permitidos.';
  return null;
}

/** Devolve a mensagem de erro do nome, ou null se for válido. */
export function validateNome(nome: string): string | null {
  const tamanho = nome.trim().length;
  if (tamanho === 0) return 'Informe o nome do tenant.';
  if (tamanho < NOME_MIN || tamanho > NOME_MAX) {
    return `O nome deve ter de ${NOME_MIN} a ${NOME_MAX} caracteres.`;
  }
  return null;
}

export function isPlano(value: unknown): value is Plano {
  return typeof value === 'string' && (PLANOS as readonly string[]).includes(value);
}

export function isNivelIsolamento(value: unknown): value is NivelIsolamento {
  return typeof value === 'string' && (NIVEIS_ISOLAMENTO as readonly string[]).includes(value);
}

function isTenant(value: unknown): value is Tenant {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.nome === 'string' &&
    isPlano(t.plano) &&
    isNivelIsolamento(t.nivelIsolamento) &&
    typeof t.ativo === 'boolean' &&
    typeof t.criadoEm === 'string'
  );
}

function isPaginaTenants(value: unknown): value is PaginaTenants {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    Array.isArray(p.itens) &&
    p.itens.every(isTenant) &&
    (p.proximoCursor === undefined ||
      p.proximoCursor === null ||
      typeof p.proximoCursor === 'string')
  );
}

// ---- Cliente HTTP ----

/** URL absoluta de /api/v1/tenants (ou de um tenant, quando `id` é informado). */
export function tenantsUrl(
  id?: string,
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  const path = id === undefined ? 'api/v1/tenants' : `api/v1/tenants/${encodeURIComponent(id)}`;
  return apiUrl(path, baseUrl, origin);
}

/** Lê o corpo de erro: usa o `detail` do Problem Details quando houver. */
async function toApiError(response: Response): Promise<ApiError> {
  let detail: string | null = null;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const p = body as Partial<Problema>;
      if (typeof p.detail === 'string' && p.detail.trim()) detail = p.detail;
      else if (typeof p.title === 'string' && p.title.trim()) detail = p.title;
    }
  } catch {
    // corpo vazio ou não JSON: fica só o código HTTP
  }
  return new ApiError(detail ?? `A API respondeu com HTTP ${response.status}.`, response.status);
}

async function readJson<T>(response: Response, guard: (v: unknown) => v is T): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('A API devolveu uma resposta que não é JSON.', response.status);
  }
  if (!guard(body)) {
    throw new ApiError('A resposta da API está fora do contrato esperado.', response.status);
  }
  return body;
}

const JSON_HEADERS = {
  Accept: 'application/json, application/problem+json',
  'Content-Type': 'application/json',
};

/** GET /api/v1/tenants?limite=&cursor= — uma página de tenants. */
export async function listTenants(
  options: { cursor?: string | null; limite?: number; signal?: AbortSignal } = {},
): Promise<PaginaTenants> {
  const url = new URL(tenantsUrl());
  url.searchParams.set('limite', String(options.limite ?? LIMITE_PADRAO));
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  const response = await fetch(url, {
    headers: { Accept: JSON_HEADERS.Accept },
    signal: options.signal,
  });
  const pagina = await readJson(response, isPaginaTenants);
  return { itens: pagina.itens, proximoCursor: pagina.proximoCursor ?? null };
}

/** POST /api/v1/tenants — cadastra um tenant (201). Erros 400/409 trazem o `detail`. */
export async function createTenant(novo: NovoTenant): Promise<Tenant> {
  const response = await fetch(tenantsUrl(), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(novo),
  });
  return readJson(response, isTenant);
}

/** PATCH /api/v1/tenants/{id} — altera nome, plano ou situação (200); o nível não muda (409). */
export async function updateTenant(id: string, alteracao: AlteracaoTenant): Promise<Tenant> {
  const response = await fetch(tenantsUrl(id), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(alteracao),
  });
  return readJson(response, isTenant);
}

/** Mensagem legível em pt-BR para qualquer falha (rede vira "não foi possível conectar"). */
export function describeTenantError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar ao tenant-service.';
}
