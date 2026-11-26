import { http, HttpResponse } from 'msw';
import type { ServiceMetrics, StatusComponent, StatusResponse } from '../api/status';
import { catalogoHandlers } from './catalogo';
import { gatewayHandlers } from './gateway';
import { isolamentoHandlers } from './isolamento';
import { pagamentosHandlers } from './pagamentos';
import { pedidosHandlers } from './pedidos';
import { tenantHandlers } from './tenants';

export const DEMO_VERSION = '0.1.0-dia10';

type Random = () => number;

/** Latência base + variação de até `spread` ms, para os números "respirarem" a cada polling. */
function jitter(base: number, spread: number, random: Random): number {
  return base + Math.round(random() * spread);
}

/**
 * Métricas plausíveis de cada serviço desde a subida (Dia 10). O gateway não tem outbox nem consome;
 * o tenant-service publica pelo outbox mas não consome; catálogo, pedidos e pagamentos fazem os dois.
 * O pagamentos-service fica com erros acima de 1% e falhas de consumo, para a demo mostrar o
 * destaque e o painel de alertas.
 */
export function buildDemoMetrics(random: Random = Math.random): Record<string, ServiceMetrics> {
  const semOutbox = { outboxPending: null, outboxLagSeconds: null };
  const semConsumo = { eventsConsumed: null, eventsFailed: null };
  return {
    'tenant-service': {
      requests: jitter(312, 40, random),
      errorRate: 0,
      p99Ms: jitter(85, 30, random),
      outboxPending: 0,
      outboxLagSeconds: 0,
      ...semConsumo,
    },
    'catalogo-service': {
      requests: jitter(2480, 200, random),
      errorRate: 0.002,
      p99Ms: jitter(120, 40, random),
      outboxPending: 0,
      outboxLagSeconds: 0,
      eventsConsumed: 48,
      eventsFailed: 0,
    },
    'pedidos-service': {
      requests: jitter(1865, 150, random),
      errorRate: 0.004,
      p99Ms: jitter(240, 80, random),
      outboxPending: 1,
      outboxLagSeconds: 0.8,
      eventsConsumed: 1290,
      eventsFailed: 0,
    },
    'pagamentos-service': {
      requests: jitter(940, 80, random),
      errorRate: 0.014,
      p99Ms: jitter(410, 120, random),
      outboxPending: 0,
      outboxLagSeconds: 0,
      eventsConsumed: 1352,
      eventsFailed: 3,
    },
    gateway: {
      requests: jitter(5820, 400, random),
      errorRate: 0.003,
      p99Ms: jitter(320, 90, random),
      ...semOutbox,
      ...semConsumo,
    },
  };
}

/** Resposta realista do status-service: Mongo, Pulsar, tenant-service, catalogo-service, pedidos-service, pagamentos-service, gateway e Keycloak no ar. */
export function buildDemoStatus(
  random: Random = Math.random,
  now: Date = new Date(),
): StatusResponse {
  const mongo = (name: string, base: number): StatusComponent => ({
    name,
    type: 'MONGODB',
    status: 'UP',
    latencyMs: jitter(base, 4, random),
    details: `replica set rs-${name.replace('mongo-', '')}`,
  });
  const metrics = buildDemoMetrics(random);
  return {
    status: 'UP',
    checkedAt: now.toISOString(),
    version: DEMO_VERSION,
    components: [
      mongo('mongo-tenants', 2),
      mongo('mongo-catalogo', 3),
      mongo('mongo-pedidos', 3),
      mongo('mongo-pagamentos', 4),
      {
        name: 'pulsar',
        type: 'PULSAR',
        status: 'UP',
        latencyMs: jitter(10, 8, random),
        details: 'broker saudável',
      },
      {
        // Desde o Dia 3 o status-service também consulta a readiness do tenant-service.
        name: 'tenant-service',
        type: 'SERVICE',
        status: 'UP',
        latencyMs: jitter(6, 6, random),
        details: 'readiness UP',
        metrics: metrics['tenant-service'],
      },
      {
        // Desde o Dia 5: o catalogo-service (produtos e preços por tenant).
        name: 'catalogo-service',
        type: 'SERVICE',
        status: 'UP',
        latencyMs: jitter(5, 6, random),
        details: 'readiness UP',
        metrics: metrics['catalogo-service'],
      },
      {
        // Desde o Dia 6: o pedidos-service (pedidos B2B com Idempotency-Key).
        name: 'pedidos-service',
        type: 'SERVICE',
        status: 'UP',
        latencyMs: jitter(5, 6, random),
        details: 'readiness UP',
        metrics: metrics['pedidos-service'],
      },
      {
        // Desde o Dia 7: o pagamentos-service (gateway de pagamento simulado e ledger).
        name: 'pagamentos-service',
        type: 'SERVICE',
        status: 'UP',
        latencyMs: jitter(6, 6, random),
        details: 'readiness UP',
        metrics: metrics['pagamentos-service'],
      },
      {
        // Desde o Dia 4: o gateway (porta de entrada das APIs) e o Keycloak (login).
        name: 'gateway',
        type: 'SERVICE',
        status: 'UP',
        latencyMs: jitter(4, 4, random),
        details: 'readiness UP',
        metrics: metrics['gateway'],
      },
      {
        name: 'keycloak',
        type: 'SERVICE',
        status: 'UP',
        latencyMs: jitter(12, 10, random),
        details: 'realm plataforma',
      },
    ],
  };
}

export const handlers = [
  // /api/status continua público (sem token).
  http.get('*/api/status', () => HttpResponse.json(buildDemoStatus())),
  ...gatewayHandlers,
  ...tenantHandlers,
  ...catalogoHandlers,
  ...pedidosHandlers,
  ...pagamentosHandlers,
  ...isolamentoHandlers,
];
