import type { ComponentStatus, PlatformStatus } from '../api/status';

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
