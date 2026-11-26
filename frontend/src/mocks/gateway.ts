// Gateway simulado (modo demo e testes): o que o gateway do Dia 4 faz antes de chegar aos serviços.
// - Authorization: Bearer demo-<usuario> (401 sem token ou com token desconhecido);
// - papel exigido por rota (403 acesso-negado);
// - X-Tenant-Id precisa ser de um tenant do usuário (403 acesso-negado) e ativo (403 tenant-suspenso);
// - rate limit por tenant conforme o plano, token bucket em memória (429 + Retry-After).

import { http, HttpResponse } from 'msw';
import { PROBLEM_BASE, type Problema } from '../api/http';
import { LIMITE_POR_PLANO, rajada, type Me, type Papel } from '../api/me';
import type { Plano, Tenant } from '../api/tenants';
import { DEMO_TOKEN_PREFIX, findDemoUser, type DemoUser } from '../auth/demoUsers';
import { tenantStoreSnapshot } from './tenants';

/** Resposta de erro em Problem Details (application/problem+json). */
export function problemResponse(
  status: number,
  type: string,
  title: string,
  detail: string,
  headers: Record<string, string> = {},
  extensions: Record<string, unknown> = {},
): HttpResponse<Problema> {
  // Propriedades de extensão (RFC 9457 §3.2) primeiro: não sobrescrevem os campos padrão.
  const body: Problema = { ...extensions, type: `${PROBLEM_BASE}${type}`, title, status, detail };
  return HttpResponse.json(body, {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
}

/** Usuário de demonstração do cabeçalho Authorization, ou null. */
export function demoUserFrom(request: Request): DemoUser | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1];
  if (!token?.startsWith(DEMO_TOKEN_PREFIX)) return null;
  return findDemoUser(token.slice(DEMO_TOKEN_PREFIX.length));
}

/** Tenants a que o usuário tem acesso, com os dados atuais do cadastro (store do tenant-service). */
export function tenantsOf(user: DemoUser): Tenant[] {
  const all = tenantStoreSnapshot();
  if (user.tenants === 'todos') return all;
  const ids = user.tenants;
  return all.filter((t) => ids.includes(t.id));
}

/**
 * O X-Cliente-Id que o gateway escreve para os serviços: vem só da claim cliente_id do token
 * (aqui, do usuário de demo). Um X-Cliente-Id enviado pelo navegador é descartado (ADR-0007).
 */
export function clienteIdOf(user: DemoUser): string | null {
  return user.clienteId;
}

export function meOf(user: DemoUser): Me {
  return {
    usuario: user.usuario,
    nome: user.nome,
    papeis: [...user.papeis],
    clienteId: user.clienteId,
    tenants: tenantsOf(user).map(({ id, nome, plano, nivelIsolamento, ativo }) => ({
      id,
      nome,
      plano,
      nivelIsolamento,
      ativo,
    })),
  };
}

// ---- Rate limit (token bucket por tenant) ----

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Consome um token do balde do tenant. O balde enche a `LIMITE_POR_PLANO[plano]` tokens/s até a
 * rajada (2x). Devolve null se passou, ou os segundos de espera (Retry-After) se estourou.
 */
export function takeToken(tenantId: string, plano: Plano, now: number = Date.now()): number | null {
  const rate = LIMITE_POR_PLANO[plano];
  const capacity = rajada(plano);
  const bucket = buckets.get(tenantId) ?? { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * rate);
  bucket.updatedAt = now;
  buckets.set(tenantId, bucket);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return null;
  }
  return Math.max(1, Math.ceil((1 - bucket.tokens) / rate));
}

// ---- Filtros do gateway ----

type Guarded = { user: DemoUser; tenant: Tenant | null } | { response: HttpResponse<Problema> };

/** Autentica, confere o papel e o X-Tenant-Id; com `rateLimit`, aplica o limite do tenant. */
export function guard(
  request: Request,
  options: { role?: Papel; rateLimit?: boolean } = {},
): Guarded {
  const user = demoUserFrom(request);
  if (!user) {
    return {
      response: problemResponse(
        401,
        'nao-autenticado',
        'Não autenticado',
        'Envie um token válido no cabeçalho Authorization (Bearer).',
      ),
    };
  }
  if (options.role && !user.papeis.includes(options.role)) {
    return {
      response: problemResponse(
        403,
        'acesso-negado',
        'Acesso negado',
        `Esta operação exige o papel ${options.role}.`,
      ),
    };
  }
  const tenantId = request.headers.get('X-Tenant-Id');
  if (!tenantId) return { user, tenant: null };
  const tenant = tenantsOf(user).find((t) => t.id === tenantId);
  if (!tenant) {
    return {
      response: problemResponse(
        403,
        'acesso-negado',
        'Acesso negado',
        `O tenant '${tenantId}' não pertence ao usuário ${user.usuario}.`,
      ),
    };
  }
  if (!tenant.ativo) {
    return {
      response: problemResponse(
        403,
        'tenant-suspenso',
        'Tenant suspenso',
        `O tenant '${tenantId}' está suspenso.`,
      ),
    };
  }
  if (options.rateLimit) {
    const retryAfter = takeToken(tenant.id, tenant.plano);
    if (retryAfter !== null) {
      return {
        response: problemResponse(
          429,
          'limite-excedido',
          'Limite de requisições excedido',
          `O tenant '${tenant.id}' passou de ${LIMITE_POR_PLANO[tenant.plano]} req/s (plano ${tenant.plano}).`,
          { 'Retry-After': String(retryAfter) },
        ),
      };
    }
  }
  return { user, tenant };
}

export const gatewayHandlers = [
  http.get('*/api/v1/me', ({ request }) => {
    const result = guard(request, { rateLimit: true });
    if ('response' in result) return result.response;
    return HttpResponse.json(meOf(result.user));
  }),
];
