// Cliente e tipos do contrato GET /api/status (implementado pelo status-service em Java).

export type PlatformStatus = 'UP' | 'DEGRADED' | 'DOWN';
export type ComponentStatus = 'UP' | 'DOWN';

export interface StatusComponent {
  name: string;
  type: string;
  status: ComponentStatus;
  latencyMs: number | null;
  details: string | null;
}

export interface StatusResponse {
  status: PlatformStatus;
  checkedAt: string;
  version: string;
  components: StatusComponent[];
}

/** Erro de resposta da API (HTTP diferente de 2xx ou corpo fora do contrato). */
export class ApiError extends Error {
  readonly httpStatus: number | null;

  constructor(message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
  }
}

const PLATFORM_STATUSES: readonly string[] = ['UP', 'DEGRADED', 'DOWN'];

/** URL absoluta do endpoint, respeitando o BASE_URL do Vite ('/' ou '/plataforma-multitenant/'). */
export function statusUrl(
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`${base}api/status`, origin).toString();
}

function isStatusResponse(value: unknown): value is StatusResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === 'string' &&
    PLATFORM_STATUSES.includes(v.status) &&
    typeof v.checkedAt === 'string' &&
    typeof v.version === 'string' &&
    Array.isArray(v.components)
  );
}

/** Busca o status atual da plataforma. Lança ApiError (HTTP/formato) ou TypeError (rede). */
export async function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const response = await fetch(statusUrl(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new ApiError(`A API respondeu com HTTP ${response.status}.`, response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('A API devolveu uma resposta que não é JSON.', response.status);
  }
  if (!isStatusResponse(body)) {
    throw new ApiError('A resposta da API está fora do contrato esperado.', response.status);
  }
  return body;
}

/** Converte qualquer falha em uma mensagem legível em pt-BR. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar à API.';
}
