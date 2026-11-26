import { http, HttpResponse } from 'msw';
import type { StatusComponent, StatusResponse } from '../api/status';
import { tenantHandlers } from './tenants';

export const DEMO_VERSION = '0.1.0-dia03';

type Random = () => number;

/** Latência base + variação de até `spread` ms, para os números "respirarem" a cada polling. */
function jitter(base: number, spread: number, random: Random): number {
  return base + Math.round(random() * spread);
}

/** Monta uma resposta realista do status-service, com Mongo, Pulsar e tenant-service no ar. */
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
    ],
  };
}

export const handlers = [
  http.get('*/api/status', () => HttpResponse.json(buildDemoStatus())),
  ...tenantHandlers,
];
