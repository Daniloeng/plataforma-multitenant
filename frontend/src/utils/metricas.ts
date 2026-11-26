// Métricas por serviço (Dia 10): formatação e as regras de alerta que o frontend consegue avaliar
// só com o /api/status. As regras completas (com histórico e notificação) ficam no Prometheus.

import type { ServiceMetrics, StatusComponent } from '../api/status';
import { COMPONENT_STATUS_LABEL, formatLatency } from './format';

/** Meta do projeto: p99 abaixo de 3 s. */
export const P99_ALERTA_MS = 3000;
/** Acima de 1% de respostas 5xx. */
export const TAXA_ERRO_ALERTA = 0.01;
/**
 * Mínimo de requisições para a taxa de erros valer como alerta: os números são acumulados desde a
 * subida, e com pouco tráfego um 5xx isolado ficaria em alerta até o serviço reiniciar.
 */
export const MIN_REQUISICOES_ERRO = 100;
/** Evento mais antigo do outbox esperando há mais de 60 s. */
export const ATRASO_OUTBOX_ALERTA_S = 60;

export type RegraAlerta = 'COMPONENTE_FORA' | 'P99' | 'ERROS' | 'ATRASO_OUTBOX' | 'OUTBOX_ILEGIVEL';

export interface Alerta {
  componente: string;
  regra: RegraAlerta;
  mensagem: string;
}

/** Converte `undefined` (campo ausente numa resposta antiga) em null. */
function valor(n: number | null | undefined): number | null {
  return n === undefined || n === null || Number.isNaN(n) ? null : n;
}

/** Ex.: 1234 -> '1.234'. */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}

/** Ex.: 0.012 -> '1,2%'; 0 -> '0%'; 0.0004 -> '< 0,1%'. */
export function formatPercent(rate: number): string {
  const pct = rate * 100;
  if (pct > 0 && pct < 0.1) return '< 0,1%';
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** Ex.: 0 -> '0 s'; 12.4 -> '12 s'; 90 -> '1 min 30 s'; 3720 -> '1 h 2 min'. */
export function formatSeconds(s: number): string {
  const total = Math.max(0, Math.round(s));
  if (total < 60) return `${total} s`;
  if (total < 3600) {
    const min = Math.floor(total / 60);
    const seg = total % 60;
    return seg === 0 ? `${min} min` : `${min} min ${seg} s`;
  }
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

/** Ex.: (1, 'falha', 'falhas') -> '1 falha'; (2, ...) -> '2 falhas'. */
export function plural(n: number, singular: string, pluralForm: string): string {
  return `${formatCount(n)} ${Math.round(n) === 1 ? singular : pluralForm}`;
}

export function p99EmAlerta(m: ServiceMetrics): boolean {
  const p99 = valor(m.p99Ms);
  return p99 !== null && p99 > P99_ALERTA_MS;
}

export function errosEmAlerta(m: ServiceMetrics): boolean {
  return m.requests >= MIN_REQUISICOES_ERRO && m.errorRate > TAXA_ERRO_ALERTA;
}

export function atrasoOutboxEmAlerta(m: ServiceMetrics): boolean {
  const atraso = valor(m.outboxLagSeconds);
  return atraso !== null && atraso > ATRASO_OUTBOX_ALERTA_S;
}

/** Falha de consumo não é regra de alerta aqui (o dead letter cuida), mas merece destaque. */
export function falhasDeConsumo(m: ServiceMetrics): boolean {
  const falhas = valor(m.eventsFailed);
  return falhas !== null && falhas > 0;
}

/** Avalia as regras do frontend em cada componente, na ordem em que vieram. */
export function avaliarAlertas(components: readonly StatusComponent[]): Alerta[] {
  const alertas: Alerta[] = [];
  for (const c of components) {
    if (c.status !== 'UP') {
      const situacao = COMPONENT_STATUS_LABEL[c.status] ?? c.status;
      alertas.push({
        componente: c.name,
        regra: 'COMPONENTE_FORA',
        mensagem: `componente ${situacao.toLowerCase()}`,
      });
    }
    const m = c.metrics;
    if (!m) continue;
    if (p99EmAlerta(m)) {
      alertas.push({
        componente: c.name,
        regra: 'P99',
        mensagem: `p99 de ${formatLatency(m.p99Ms)}, acima da meta de ${formatLatency(P99_ALERTA_MS)}`,
      });
    }
    if (errosEmAlerta(m)) {
      alertas.push({
        componente: c.name,
        regra: 'ERROS',
        mensagem: `${formatPercent(m.errorRate)} de erros 5xx, acima de ${formatPercent(TAXA_ERRO_ALERTA)}`,
      });
    }
    if (atrasoOutboxEmAlerta(m)) {
      alertas.push({
        componente: c.name,
        regra: 'ATRASO_OUTBOX',
        mensagem: `outbox com atraso de ${formatSeconds(m.outboxLagSeconds as number)}, acima de ${ATRASO_OUTBOX_ALERTA_S} s`,
      });
    }
    if (m.outboxUnreadable === true) {
      alertas.push({
        componente: c.name,
        regra: 'OUTBOX_ILEGIVEL',
        mensagem: 'não foi possível contar o outbox (MongoDB lento ou fora)',
      });
    }
  }
  return alertas;
}
