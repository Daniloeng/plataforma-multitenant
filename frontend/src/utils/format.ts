import type { ComponentStatus, PlatformStatus } from '../api/status';
import type { NivelIsolamento, Plano } from '../api/tenants';

/** Fuso usado na exibição: o projeto é brasileiro, então mostramos o horário de Brasília. */
export const DISPLAY_TIME_ZONE = 'America/Sao_Paulo';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: DISPLAY_TIME_ZONE,
});

/** Ex.: '2026-11-26T12:00:00Z' -> '26/11/2026, 09:00:00'. Data inválida -> 'data inválida'. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'data inválida';
  return dateTimeFormatter.format(date);
}

/** Ex.: 3 -> '3 ms'; 0.4 -> '< 1 ms'; 1530 -> '1,5 s'; null -> '—'. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) return '—';
  if (ms < 1) return '< 1 ms';
  if (ms >= 1000) {
    return `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
  }
  return `${Math.round(ms)} ms`;
}

export const PLATFORM_STATUS_LABEL: Record<PlatformStatus, string> = {
  UP: 'Operacional',
  DEGRADED: 'Degradada',
  DOWN: 'Fora do ar',
};

export const COMPONENT_STATUS_LABEL: Record<ComponentStatus, string> = {
  UP: 'Disponível',
  DOWN: 'Indisponível',
};

export const PLANO_LABEL: Record<Plano, string> = {
  GRATUITO: 'Gratuito',
  PROFISSIONAL: 'Profissional',
  EMPRESARIAL: 'Empresarial',
};

export const NIVEL_ISOLAMENTO_LABEL: Record<NivelIsolamento, string> = {
  POOL: 'Pool',
  BRIDGE: 'Bridge',
  SILO: 'Silo',
};

/** Explicação curta de cada nível (ADR-0005). */
export const NIVEL_ISOLAMENTO_DESCRICAO: Record<NivelIsolamento, string> = {
  POOL: 'coleções e tópicos compartilhados, filtrados por tenantId (mais barato).',
  BRIDGE: 'database MongoDB e namespace Pulsar dedicados, na mesma infraestrutura.',
  SILO: 'instância MongoDB e namespace Kubernetes próprios (isolamento máximo).',
};

/** Texto do selo do nível (title e leitor de tela), no cabeçalho e na lista de tenants. */
export const NIVEL_ISOLAMENTO_SELO: Record<NivelIsolamento, string> = {
  POOL: 'Pool: dados compartilhados, filtrados por tenant',
  BRIDGE: 'Bridge: database e namespace Pulsar dedicados',
  SILO: 'Silo: isolamento máximo',
};
