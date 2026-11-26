// Cliente e tipos de GET /api/v1/me (gateway): quem é o usuário, seus papéis e tenants.

import { ApiError, apiFetch, readJson, toApiError } from './http';
import { isNivelIsolamento, isPlano, type NivelIsolamento, type Plano } from './tenants';
import { PLANO_LABEL } from '../utils/format';

export const PAPEIS = ['plataforma-admin', 'gestor-tenant', 'comprador'] as const;
export type Papel = (typeof PAPEIS)[number];

export const PAPEL_LABEL: Record<Papel, string> = {
  'plataforma-admin': 'Admin. da plataforma',
  'gestor-tenant': 'Gestor do tenant',
  comprador: 'Comprador',
};

/** Tenant a que o usuário tem acesso, com os dados do cadastro. */
export interface TenantDoUsuario {
  id: string;
  nome: string;
  plano: Plano;
  nivelIsolamento: NivelIsolamento;
  ativo: boolean;
}

export interface Me {
  usuario: string;
  nome: string | null;
  /** Papéis conhecidos; papéis que esta versão do frontend não conhece são descartados. */
  papeis: Papel[];
  clienteId: string | null;
  tenants: TenantDoUsuario[];
}

/** Limite do gateway por tenant, conforme o plano (rajada = 2x). */
export const LIMITE_POR_PLANO: Record<Plano, number> = {
  GRATUITO: 5,
  PROFISSIONAL: 20,
  EMPRESARIAL: 50,
};

export function rajada(plano: Plano): number {
  return LIMITE_POR_PLANO[plano] * 2;
}

/** Ex.: 'Plano Profissional · 20 req/s'. */
export function describePlano(plano: Plano): string {
  return `Plano ${PLANO_LABEL[plano]} · ${LIMITE_POR_PLANO[plano]} req/s`;
}

export function isPapel(value: unknown): value is Papel {
  return typeof value === 'string' && (PAPEIS as readonly string[]).includes(value);
}

function isTenantDoUsuario(value: unknown): value is TenantDoUsuario {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.nome === 'string' &&
    isPlano(t.plano) &&
    isNivelIsolamento(t.nivelIsolamento) &&
    typeof t.ativo === 'boolean'
  );
}

function isMeBody(value: unknown): value is Omit<Me, 'papeis'> & { papeis: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.usuario === 'string' &&
    (m.nome === null || m.nome === undefined || typeof m.nome === 'string') &&
    Array.isArray(m.papeis) &&
    (m.clienteId === null || m.clienteId === undefined || typeof m.clienteId === 'string') &&
    Array.isArray(m.tenants) &&
    m.tenants.every(isTenantDoUsuario)
  );
}

/** GET /api/v1/me — sem X-Tenant-Id: é a resposta que diz quais tenants o usuário pode usar. */
export async function fetchMe(signal?: AbortSignal): Promise<Me> {
  const response = await apiFetch('api/v1/me', {
    headers: { Accept: 'application/json, application/problem+json' },
    signal,
    tenant: false,
  });
  const body = await readJson(response, isMeBody);
  return {
    usuario: body.usuario,
    nome: body.nome ?? null,
    papeis: body.papeis.filter(isPapel),
    clienteId: body.clienteId ?? null,
    tenants: body.tenants,
  };
}

export interface ResultadoRajada {
  total: number;
  ok: number;
  limitadas: number;
  /** Outras respostas (403, 5xx) e falhas de rede. */
  outras: number;
  /** Maior Retry-After (segundos) visto nas respostas 429. */
  retryAfterSeconds: number | null;
  /** detail do primeiro erro que não foi 429 (ex.: tenant suspenso). */
  primeiroErro: string | null;
}

/** Quantas requisições o "Testar limite" dispara: a rajada do plano + 20, no mínimo 30. */
export function tamanhoDaRajada(plano: Plano): number {
  return Math.max(30, rajada(plano) + 20);
}

/**
 * Dispara `total` requisições simultâneas a GET /api/v1/me com o X-Tenant-Id selecionado, para
 * ver o rate limit por tenant do gateway (200 até esgotar a rajada, depois 429).
 */
export async function testarLimite(total: number): Promise<ResultadoRajada> {
  const resultado: ResultadoRajada = {
    total,
    ok: 0,
    limitadas: 0,
    outras: 0,
    retryAfterSeconds: null,
    primeiroErro: null,
  };
  const respostas = await Promise.allSettled(
    Array.from({ length: total }, () =>
      apiFetch('api/v1/me', { headers: { Accept: 'application/json' } }),
    ),
  );
  for (const r of respostas) {
    if (r.status === 'rejected') {
      resultado.outras += 1;
      resultado.primeiroErro ??= 'Não foi possível conectar ao gateway.';
      continue;
    }
    const response = r.value;
    if (response.ok) {
      resultado.ok += 1;
    } else if (response.status === 429) {
      resultado.limitadas += 1;
      const erro = await toApiError(response);
      if (erro.retryAfterSeconds !== null) {
        resultado.retryAfterSeconds = Math.max(
          resultado.retryAfterSeconds ?? 0,
          erro.retryAfterSeconds,
        );
      }
    } else {
      resultado.outras += 1;
      resultado.primeiroErro ??= (await toApiError(response)).message;
    }
  }
  return resultado;
}

/** Mensagem legível em pt-BR para falhas do /api/v1/me. */
export function describeMeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar ao gateway.';
}
