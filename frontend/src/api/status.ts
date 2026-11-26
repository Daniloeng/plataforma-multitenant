// Cliente e tipos do contrato GET /api/status (implementado pelo status-service em Java).

import { ApiError, apiUrl } from './http';

// Mantido aqui por compatibilidade: quem já importava ApiError de './status' continua funcionando.
export { ApiError };

export type PlatformStatus = 'UP' | 'DEGRADED' | 'DOWN';
export type ComponentStatus = 'UP' | 'DOWN';

/**
 * Métricas de um serviço desde a subida (Dia 10). Ausentes (ou null) para MongoDB, Pulsar e
 * Keycloak, ou quando o serviço não respondeu as métricas. Campos null não se aplicam ao serviço.
 */
export interface ServiceMetrics {
  /** Requisições HTTP atendidas desde a subida (sem /actuator). */
  requests: number;
  /** Fração de respostas 5xx, de 0 a 1. */
  errorRate: number;
  /** p99 de latência em ms; null se ainda não houve requisição. */
  p99Ms: number | null;
  /** Eventos esperando publicação no outbox; null se o serviço não tem outbox. */
  outboxPending?: number | null;
  /** Idade do evento pendente mais antigo, em segundos; null se o serviço não tem outbox. */
  outboxLagSeconds?: number | null;
  /** Eventos consumidos com sucesso; null se o serviço não consome eventos. */
  eventsConsumed?: number | null;
  /** Tentativas de consumo que falharam; null se o serviço não consome eventos. */
  eventsFailed?: number | null;
}

export interface StatusComponent {
  name: string;
  type: string;
  status: ComponentStatus;
  latencyMs: number | null;
  details: string | null;
  /** Opcional desde o Dia 10: respostas anteriores não trazem o campo. */
  metrics?: ServiceMetrics | null;
}

export interface StatusResponse {
  status: PlatformStatus;
  checkedAt: string;
  version: string;
  components: StatusComponent[];
}

const PLATFORM_STATUSES: readonly string[] = ['UP', 'DEGRADED', 'DOWN'];

/** URL absoluta do endpoint, respeitando o BASE_URL do Vite ('/' ou '/plataforma-multitenant/'). */
export function statusUrl(
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  return apiUrl('api/status', baseUrl, origin);
}

function isOptionalNumber(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'number';
}

function isServiceMetrics(value: unknown): value is ServiceMetrics {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.requests === 'number' &&
    typeof m.errorRate === 'number' &&
    isOptionalNumber(m.p99Ms) &&
    isOptionalNumber(m.outboxPending) &&
    isOptionalNumber(m.outboxLagSeconds) &&
    isOptionalNumber(m.eventsConsumed) &&
    isOptionalNumber(m.eventsFailed)
  );
}

function isStatusComponent(value: unknown): value is StatusComponent {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.name === 'string' &&
    typeof c.type === 'string' &&
    // status desconhecido é aceito e exibido como veio (compatibilidade com versões novas da API)
    typeof c.status === 'string' &&
    (c.latencyMs === null || typeof c.latencyMs === 'number') &&
    (c.details === null || c.details === undefined || typeof c.details === 'string')
  );
}

function isStatusResponse(value: unknown): value is StatusResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === 'string' &&
    PLATFORM_STATUSES.includes(v.status) &&
    typeof v.checkedAt === 'string' &&
    typeof v.version === 'string' &&
    Array.isArray(v.components) &&
    v.components.every(isStatusComponent)
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
  // Métrica malformada (ex.: NaN de um serviço com o MongoDB lento) some só daquele card: a saúde
  // dos outros componentes continua visível.
  return {
    ...body,
    components: body.components.map((c) =>
      c.metrics === null || c.metrics === undefined || isServiceMetrics(c.metrics)
        ? c
        : { ...c, metrics: null },
    ),
  };
}

/** Converte qualquer falha em uma mensagem legível em pt-BR. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar à API.';
}
