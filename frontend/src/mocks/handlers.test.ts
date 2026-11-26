import { fetchStatus } from '../api/status';
import { DEMO_VERSION, buildDemoStatus } from './handlers';

describe('buildDemoStatus', () => {
  it('monta Mongo, Pulsar, tenant-service, catalogo-service, gateway e keycloak no ar com latência base quando random = 0', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const status = buildDemoStatus(() => 0, now);
    expect(status.status).toBe('UP');
    expect(status.checkedAt).toBe('2026-11-26T12:00:00.000Z');
    expect(status.version).toBe(DEMO_VERSION);
    expect(status.components.map((c) => c.name)).toEqual([
      'mongo-tenants',
      'mongo-catalogo',
      'mongo-pedidos',
      'mongo-pagamentos',
      'pulsar',
      'tenant-service',
      'catalogo-service',
      'gateway',
      'keycloak',
    ]);
    expect(status.components.every((c) => c.status === 'UP')).toBe(true);
    expect(status.components.map((c) => c.latencyMs)).toEqual([2, 3, 3, 4, 10, 6, 5, 4, 12]);
    expect(status.components[4]).toMatchObject({ type: 'PULSAR', details: 'broker saudável' });
    expect(status.components[5]).toMatchObject({
      type: 'SERVICE',
      status: 'UP',
      details: 'readiness UP',
    });
    expect(status.components[6]).toMatchObject({
      name: 'catalogo-service',
      type: 'SERVICE',
      status: 'UP',
      details: 'readiness UP',
    });
    expect(status.components[7]).toMatchObject({ type: 'SERVICE', details: 'readiness UP' });
    expect(status.components[8]).toMatchObject({ type: 'SERVICE', details: 'realm plataforma' });
    expect(status.components[0]).toMatchObject({
      type: 'MONGODB',
      details: 'replica set rs-tenants',
    });
  });

  it('varia a latência dentro de uma faixa pequena', () => {
    const status = buildDemoStatus(() => 1);
    expect(status.components.map((c) => c.latencyMs)).toEqual([6, 7, 7, 8, 18, 12, 11, 8, 22]);
  });

  it('usa Math.random e a hora atual por padrão', () => {
    const before = Date.now();
    const status = buildDemoStatus();
    expect(new Date(status.checkedAt).getTime()).toBeGreaterThanOrEqual(before - 1);
    for (const c of status.components) {
      expect(c.latencyMs).toBeGreaterThanOrEqual(2);
      expect(c.latencyMs).toBeLessThanOrEqual(22);
    }
  });
});

describe('handlers', () => {
  it('respondem /api/status dentro do contrato e sem token (servidor msw/node padrão)', async () => {
    const status = await fetchStatus();
    expect(status.status).toBe('UP');
    expect(status.components).toHaveLength(9);
  });
});
