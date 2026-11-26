import type { StatusResponse } from '../api/status';

export function makeStatus(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    status: 'UP',
    checkedAt: '2026-11-26T12:00:00Z',
    version: '0.1.0-dia01',
    components: [
      {
        name: 'mongo-tenants',
        type: 'MONGODB',
        status: 'UP',
        latencyMs: 3,
        details: 'replica set rs0',
      },
      {
        name: 'mongo-catalogo',
        type: 'MONGODB',
        status: 'UP',
        latencyMs: 4,
        details: 'replica set rs0',
      },
      {
        name: 'mongo-pedidos',
        type: 'MONGODB',
        status: 'UP',
        latencyMs: 4,
        details: 'replica set rs0',
      },
      {
        name: 'mongo-pagamentos',
        type: 'MONGODB',
        status: 'UP',
        latencyMs: 5,
        details: 'replica set rs0',
      },
      { name: 'pulsar', type: 'PULSAR', status: 'UP', latencyMs: 12, details: 'broker saudável' },
    ],
    ...overrides,
  };
}
