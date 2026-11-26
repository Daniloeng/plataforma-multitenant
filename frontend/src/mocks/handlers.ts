import { http, HttpResponse } from 'msw';
import type { StatusComponent, StatusResponse } from '../api/status';
import { gatewayHandlers } from './gateway';
import { tenantHandlers } from './tenants';

export const DEMO_VERSION = '0.1.0-dia04';

type Random = () => number;

/** Latência base + variação de até `spread` ms, para os números "respirarem" a cada polling. */
function jitter(base: number, spread: number, random: Random): number {
  return base + Math.round(random() * spread);
}

/** Resposta realista do status-service: Mongo, Pulsar, tenant-service, gateway e Keycloak no ar. */
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
      },
      {
        // Desde o Dia 4: o gateway (porta de entrada das APIs) e o Keycloak (login).
        name: 'gateway',
        type: 'SERVICE',
        status: 'UP',
        latencyMs: jitter(4, 4, random),
        details: 'readiness UP',
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
];
