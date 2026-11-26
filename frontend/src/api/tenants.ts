// Cliente e tipos do contrato do Tenant Service (libs/contracts/.../openapi/tenants.yaml).

import { ApiError, apiFetch, apiUrl, readJson } from './http';

export type { Problema } from './http';

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
// Desde o Dia 4 a API passa pelo gateway e exige o papel plataforma-admin (token Bearer). Ela é
// administrativa e não é de um tenant: o X-Tenant-Id não é enviado (tenant: false), o que também
// deixa o admin reativar um tenant suspenso mesmo com outro tenant selecionado.

/** URL absoluta de /api/v1/tenants (ou de um tenant, quando `id` é informado). */
export function tenantsUrl(
  id?: string,
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  const path = id === undefined ? 'api/v1/tenants' : `api/v1/tenants/${encodeURIComponent(id)}`;
  return apiUrl(path, baseUrl, origin);
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
  const response = await apiFetch(url, {
    headers: { Accept: JSON_HEADERS.Accept },
    signal: options.signal,
    tenant: false,
  });
  const pagina = await readJson(response, isPaginaTenants);
  return { itens: pagina.itens, proximoCursor: pagina.proximoCursor ?? null };
}

/** POST /api/v1/tenants — cadastra um tenant (201). Erros 400/409 trazem o `detail`. */
export async function createTenant(novo: NovoTenant): Promise<Tenant> {
  const response = await apiFetch(tenantsUrl(), {
    tenant: false,
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(novo),
  });
  return readJson(response, isTenant);
}

/** PATCH /api/v1/tenants/{id} — altera nome, plano ou situação (200); o nível não muda (409). */
export async function updateTenant(id: string, alteracao: AlteracaoTenant): Promise<Tenant> {
  const response = await apiFetch(tenantsUrl(id), {
    tenant: false,
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(alteracao),
  });
  return readJson(response, isTenant);
}

/**
 * Níveis para os quais o tenant pode ser promovido: só os acima do atual (POOL → BRIDGE → SILO,
 * podendo pular para SILO). SILO não tem para onde subir.
 */
export function niveisAcima(atual: NivelIsolamento): NivelIsolamento[] {
  return NIVEIS_ISOLAMENTO.slice(NIVEIS_ISOLAMENTO.indexOf(atual) + 1);
}

/** URL absoluta de POST /api/v1/tenants/{id}/promocao. */
export function promocaoUrl(
  id: string,
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  return apiUrl(`api/v1/tenants/${encodeURIComponent(id)}/promocao`, baseUrl, origin);
}

/**
 * POST /api/v1/tenants/{id}/promocao — sobe o tenant de nível (200 com o tenant no nível novo).
 * Rebaixar ou repetir o nível responde 409 `nivel-invalido`. Os serviços migram os dados ao
 * receber o tenant.alterado (ADR-0014).
 */
export async function promoteTenant(id: string, nivelIsolamento: NivelIsolamento): Promise<Tenant> {
  const response = await apiFetch(promocaoUrl(id), {
    tenant: false,
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ nivelIsolamento }),
  });
  return readJson(response, isTenant);
}

/** Mensagem legível em pt-BR para qualquer falha (rede vira "não foi possível conectar"). */
export function describeTenantError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar ao tenant-service.';
}
