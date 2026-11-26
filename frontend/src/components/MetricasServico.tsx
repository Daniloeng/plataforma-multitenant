import type { ReactNode } from 'react';
import type { ServiceMetrics } from '../api/status';
import { formatLatency } from '../utils/format';
import {
  ATRASO_OUTBOX_ALERTA_S,
  P99_ALERTA_MS,
  TAXA_ERRO_ALERTA,
  atrasoOutboxEmAlerta,
  errosEmAlerta,
  falhasDeConsumo,
  formatCount,
  formatPercent,
  formatSeconds,
  p99EmAlerta,
  plural,
} from '../utils/metricas';

type Destaque = 'alerta' | 'atencao';

interface Item {
  rotulo: string;
  valor: ReactNode;
  destaque?: Destaque;
  /** Explicação do destaque, lida pelo leitor de tela e mostrada no title. */
  motivo?: string;
}

function presente(n: number | null | undefined): n is number {
  return typeof n === 'number' && !Number.isNaN(n);
}

function itens(m: ServiceMetrics): Item[] {
  const lista: Item[] = [{ rotulo: 'Requisições', valor: formatCount(m.requests) }];

  if (presente(m.p99Ms)) {
    const alerta = p99EmAlerta(m);
    lista.push({
      rotulo: 'p99',
      valor: formatLatency(m.p99Ms),
      destaque: alerta ? 'alerta' : undefined,
      motivo: alerta ? `acima da meta de ${formatLatency(P99_ALERTA_MS)}` : undefined,
    });
  }

  const erros = errosEmAlerta(m);
  lista.push({
    rotulo: 'Erros',
    valor: formatPercent(m.errorRate),
    destaque: erros ? 'alerta' : undefined,
    motivo: erros ? `acima de ${formatPercent(TAXA_ERRO_ALERTA)}` : undefined,
  });

  const partesOutbox: string[] = [];
  if (presente(m.outboxPending)) {
    partesOutbox.push(plural(m.outboxPending, 'pendente', 'pendentes'));
  }
  if (presente(m.outboxLagSeconds)) {
    partesOutbox.push(`atraso ${formatSeconds(m.outboxLagSeconds)}`);
  }
  if (m.outboxUnreadable === true) {
    lista.push({
      rotulo: 'Outbox',
      valor: 'sem leitura',
      destaque: 'alerta',
      motivo: 'não foi possível contar o outbox',
    });
  } else if (partesOutbox.length > 0) {
    const atraso = atrasoOutboxEmAlerta(m);
    lista.push({
      rotulo: 'Outbox',
      valor: partesOutbox.join(' · '),
      destaque: atraso ? 'alerta' : undefined,
      motivo: atraso ? `atraso acima de ${ATRASO_OUTBOX_ALERTA_S} s` : undefined,
    });
  }

  const partesEventos: string[] = [];
  if (presente(m.eventsConsumed)) {
    partesEventos.push(plural(m.eventsConsumed, 'consumido', 'consumidos'));
  }
  if (presente(m.eventsFailed)) {
    partesEventos.push(plural(m.eventsFailed, 'falha', 'falhas'));
  }
  if (partesEventos.length > 0) {
    const falhas = falhasDeConsumo(m);
    lista.push({
      rotulo: 'Eventos',
      valor: partesEventos.join(' · '),
      destaque: falhas ? 'atencao' : undefined,
      motivo: falhas ? 'houve falhas de consumo' : undefined,
    });
  }
  return lista;
}

/** Métricas compactas de um serviço, desde a sua subida (Dia 10). */
export function MetricasServico({ nome, metrics }: { nome: string; metrics: ServiceMetrics }) {
  return (
    <div className="metricas">
      <dl className="metricas__lista" aria-label={`Métricas de ${nome}`}>
        {itens(metrics).map((item) => (
          <div
            key={item.rotulo}
            className={item.destaque ? `metrica metrica--${item.destaque}` : 'metrica'}
            title={item.motivo}
          >
            <dt>{item.rotulo}</dt>
            <dd className="num">
              {item.valor}
              {item.motivo ? (
                <span className="sr-only">
                  {` (${item.destaque === 'alerta' ? 'alerta' : 'atenção'}: ${item.motivo})`}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="metricas__nota">desde a subida do serviço</p>
    </div>
  );
}
