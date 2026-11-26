import type { Produto } from '../api/catalogo';
import type { StatusResponse } from '../api/status';
import type { Tenant } from '../api/tenants';

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

/** Gera `count` tenants com ids e datas distintos (mais recente primeiro). */
export function makeTenants(count: number): Tenant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tenant-${String(i + 1).padStart(2, '0')}`,
    nome: `Empresa ${i + 1}`,
    plano: 'GRATUITO',
    nivelIsolamento: 'POOL',
    ativo: true,
    criadoEm: new Date(Date.UTC(2026, 10, 26, 12, 0, 0) - i * 60_000).toISOString(),
  }));
}

/** Gera `count` produtos com SKUs em ordem (PRD-001, PRD-002…), todos ativos e a R$ 10,00. */
export function makeProdutos(count: number, prefixo = 'PRD'): Produto[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      id: `id-${prefixo.toLowerCase()}-${n}`,
      sku: `${prefixo}-${n}`,
      nome: `Produto ${i + 1}`,
      preco: { centavos: 1000, moeda: 'BRL' },
      ativo: true,
    };
  });
}
