import type { ServiceMetrics, StatusComponent } from '../api/status';
import {
  atrasoOutboxEmAlerta,
  avaliarAlertas,
  errosEmAlerta,
  falhasDeConsumo,
  formatCount,
  formatPercent,
  formatSeconds,
  p99EmAlerta,
  plural,
} from './metricas';

function metricas(overrides: Partial<ServiceMetrics> = {}): ServiceMetrics {
  return {
    requests: 100,
    errorRate: 0,
    p99Ms: 100,
    outboxPending: 0,
    outboxLagSeconds: 0,
    eventsConsumed: 10,
    eventsFailed: 0,
    ...overrides,
  };
}

function componente(overrides: Partial<StatusComponent> = {}): StatusComponent {
  return {
    name: 'pedidos-service',
    type: 'SERVICE',
    status: 'UP',
    latencyMs: 5,
    details: null,
    ...overrides,
  };
}

describe('formatação das métricas', () => {
  it.each([
    [0, '0'],
    [1234, '1.234'],
    [1234567, '1.234.567'],
    [12.6, '13'],
  ])('formatCount(%s) -> %s', (n, esperado) => {
    expect(formatCount(n)).toBe(esperado);
  });

  it.each([
    [0, '0%'],
    [0.012, '1,2%'],
    [0.01, '1%'],
    [0.0004, '< 0,1%'],
    [1, '100%'],
  ])('formatPercent(%s) -> %s', (n, esperado) => {
    expect(formatPercent(n)).toBe(esperado);
  });

  it.each([
    [0, '0 s'],
    [0.4, '0 s'],
    [12.4, '12 s'],
    [60, '1 min'],
    [90, '1 min 30 s'],
    [3600, '1 h'],
    [3720, '1 h 2 min'],
    [-5, '0 s'],
  ])('formatSeconds(%s) -> %s', (n, esperado) => {
    expect(formatSeconds(n)).toBe(esperado);
  });

  it('flexiona singular e plural', () => {
    expect(plural(1, 'falha', 'falhas')).toBe('1 falha');
    expect(plural(0, 'falha', 'falhas')).toBe('0 falhas');
    expect(plural(1500, 'falha', 'falhas')).toBe('1.500 falhas');
  });
});

describe('limiares', () => {
  it('p99 em alerta só acima de 3000 ms', () => {
    expect(p99EmAlerta(metricas({ p99Ms: 3000 }))).toBe(false);
    expect(p99EmAlerta(metricas({ p99Ms: 3001 }))).toBe(true);
    expect(p99EmAlerta(metricas({ p99Ms: null }))).toBe(false);
  });

  it('erros em alerta só acima de 1%', () => {
    expect(errosEmAlerta(metricas({ errorRate: 0.01 }))).toBe(false);
    expect(errosEmAlerta(metricas({ errorRate: 0.0101 }))).toBe(true);
  });

  it('atraso do outbox em alerta só acima de 60 s', () => {
    expect(atrasoOutboxEmAlerta(metricas({ outboxLagSeconds: 60 }))).toBe(false);
    expect(atrasoOutboxEmAlerta(metricas({ outboxLagSeconds: 61 }))).toBe(true);
    expect(atrasoOutboxEmAlerta(metricas({ outboxLagSeconds: null }))).toBe(false);
    expect(atrasoOutboxEmAlerta(metricas({ outboxLagSeconds: undefined }))).toBe(false);
    expect(atrasoOutboxEmAlerta(metricas({ outboxLagSeconds: Number.NaN }))).toBe(false);
  });

  it('falhas de consumo destacadas quando maiores que zero', () => {
    expect(falhasDeConsumo(metricas({ eventsFailed: 0 }))).toBe(false);
    expect(falhasDeConsumo(metricas({ eventsFailed: 2 }))).toBe(true);
    expect(falhasDeConsumo(metricas({ eventsFailed: null }))).toBe(false);
  });
});

describe('avaliarAlertas', () => {
  it('não alerta quando tudo está dentro das metas ou sem métricas', () => {
    expect(
      avaliarAlertas([
        componente({ metrics: metricas() }),
        componente({ name: 'mongo-pedidos', type: 'MONGODB' }),
        componente({ name: 'pulsar', type: 'PULSAR', metrics: null }),
      ]),
    ).toEqual([]);
  });

  it('lista cada regra violada, na ordem dos componentes', () => {
    const alertas = avaliarAlertas([
      componente({ name: 'mongo-pedidos', type: 'MONGODB', status: 'DOWN', latencyMs: null }),
      componente({
        name: 'pagamentos-service',
        metrics: metricas({ p99Ms: 3250, errorRate: 0.025, outboxLagSeconds: 95 }),
      }),
    ]);
    expect(alertas).toEqual([
      {
        componente: 'mongo-pedidos',
        regra: 'COMPONENTE_FORA',
        mensagem: 'componente indisponível',
      },
      {
        componente: 'pagamentos-service',
        regra: 'P99',
        mensagem: 'p99 de 3,3 s, acima da meta de 3 s',
      },
      {
        componente: 'pagamentos-service',
        regra: 'ERROS',
        mensagem: '2,5% de erros 5xx, acima de 1%',
      },
      {
        componente: 'pagamentos-service',
        regra: 'ATRASO_OUTBOX',
        mensagem: 'outbox com atraso de 1 min 35 s, acima de 60 s',
      },
    ]);
  });

  it('trata status desconhecido como fora do ar e mostra o valor recebido', () => {
    const [alerta] = avaliarAlertas([
      componente({ status: 'STARTING' as StatusComponent['status'] }),
    ]);
    expect(alerta).toMatchObject({ regra: 'COMPONENTE_FORA', mensagem: 'componente starting' });
  });
});
