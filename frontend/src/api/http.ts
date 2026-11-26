// Utilitários HTTP compartilhados pelos clientes da API.
//
// Desde o Dia 4 toda chamada passa pelo gateway: `apiFetch` injeta `Authorization: Bearer <token>`
// e `X-Tenant-Id` a partir do "session provider" que a camada de autenticação (src/auth) registra.

/** Erro de resposta da API (HTTP diferente de 2xx ou corpo fora do contrato). */
export class ApiError extends Error {
  readonly httpStatus: number | null;
  /** `type` do Problem Details (ex.: https://plataforma.dev.br/problemas/limite-excedido). */
  readonly problemType: string | null;
  /** Cabeçalho `Retry-After` (segundos), quando a resposta trouxer. */
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    httpStatus: number | null = null,
    problemType: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.problemType = problemType;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Problem Details (RFC 9457), formato de erro de todas as APIs e do gateway. */
export interface Problema {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

/** Prefixo dos `type` de Problem Details da plataforma. */
export const PROBLEM_BASE = 'https://plataforma.dev.br/problemas/';

/**
 * URL absoluta de um caminho da API, respeitando o BASE_URL do Vite ('/' ou
 * '/plataforma-multitenant/'). `path` vem sem barra inicial, ex.: 'api/v1/tenants'.
 */
export function apiUrl(
  path: string,
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`${base}${path}`, origin).toString();
}

// ---- Sessão (token + tenant) ----

/** O que a camada de autenticação fornece para as chamadas à API. */
export interface SessionProvider {
  /** Access token atual, ou null sem login. */
  getAccessToken(): string | null;
  /** Tenant selecionado (vai no X-Tenant-Id), ou null. */
  getTenantId(): string | null;
  /** Chamado quando uma requisição com token volta 401 (token expirado ou revogado). */
  onUnauthorized(): void;
}

let sessionProvider: SessionProvider | null = null;

/** Registra o provider da sessão; devolve a função que o remove (se ainda for o atual). */
export function setSessionProvider(provider: SessionProvider | null): () => void {
  sessionProvider = provider;
  return () => {
    if (sessionProvider === provider) sessionProvider = null;
  };
}

export interface ApiFetchOptions extends RequestInit {
  /** false: não envia o token (APIs públicas, como GET /api/status). Padrão: true. */
  auth?: boolean;
  /** false: não envia o X-Tenant-Id mesmo com tenant selecionado. Padrão: true. */
  tenant?: boolean;
}

/**
 * fetch com os cabeçalhos da sessão. `target` é um caminho relativo à API ('api/v1/me') ou uma
 * URL absoluta. Uma resposta 401 a uma requisição que levou token avisa o provider.
 */
export async function apiFetch(
  target: string | URL,
  { auth = true, tenant = true, headers, ...init }: ApiFetchOptions = {},
): Promise<Response> {
  const url = typeof target === 'string' && !/^https?:/.test(target) ? apiUrl(target) : target;
  const merged = new Headers(headers);
  const provider = sessionProvider;
  const token = auth ? (provider?.getAccessToken() ?? null) : null;
  if (token) merged.set('Authorization', `Bearer ${token}`);
  const tenantId = tenant ? (provider?.getTenantId() ?? null) : null;
  if (tenantId) merged.set('X-Tenant-Id', tenantId);
  const response = await fetch(url, { ...init, headers: merged });
  if (response.status === 401 && token) provider?.onUnauthorized();
  return response;
}

/** Lê o `Retry-After` em segundos (formato numérico); outro formato vira null. */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Monta o ApiError de uma resposta de erro: usa o `detail` do Problem Details quando houver. */
export async function toApiError(response: Response): Promise<ApiError> {
  let detail: string | null = null;
  let type: string | null = null;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const p = body as Partial<Problema>;
      if (typeof p.type === 'string') type = p.type;
      if (typeof p.detail === 'string' && p.detail.trim()) detail = p.detail;
      else if (typeof p.title === 'string' && p.title.trim()) detail = p.title;
    }
  } catch {
    // corpo vazio ou não JSON: fica só o código HTTP
  }
  return new ApiError(
    detail ?? `A API respondeu com HTTP ${response.status}.`,
    response.status,
    type,
    parseRetryAfter(response.headers.get('Retry-After')),
  );
}

/** Lê o JSON de uma resposta 2xx validando o formato; erros viram ApiError. */
export async function readJson<T>(response: Response, guard: (v: unknown) => v is T): Promise<T> {
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
