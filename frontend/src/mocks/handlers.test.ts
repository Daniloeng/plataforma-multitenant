import { fetchStatus } from '../api/status';
import { DEMO_VERSION, buildDemoStatus } from './handlers';

describe('buildDemoStatus', () => {
  it('monta Mongo e Pulsar no ar com latência base quando random = 0', () => {
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
    ]);
    expect(status.components.every((c) => c.status === 'UP')).toBe(true);
    expect(status.components.map((c) => c.latencyMs)).toEqual([2, 3, 3, 4, 10]);
    expect(status.components[4]).toMatchObject({ type: 'PULSAR', details: 'standalone' });
    expect(status.components[0]).toMatchObject({ type: 'MONGODB', details: 'replica set rs0' });
  });

  it('varia a latência dentro de uma faixa pequena', () => {
    const status = buildDemoStatus(() => 1);
    expect(status.components.map((c) => c.latencyMs)).toEqual([6, 7, 7, 8, 18]);
  });

  it('usa Math.random e a hora atual por padrão', () => {
    const before = Date.now();
    const status = buildDemoStatus();
    expect(new Date(status.checkedAt).getTime()).toBeGreaterThanOrEqual(before - 1);
    for (const c of status.components) {
      expect(c.latencyMs).toBeGreaterThanOrEqual(2);
      expect(c.latencyMs).toBeLessThanOrEqual(18);
    }
  });
});

describe('handlers', () => {
  it('respondem /api/status dentro do contrato (servidor msw/node padrão)', async () => {
    const status = await fetchStatus();
    expect(status.status).toBe('UP');
    expect(status.components).toHaveLength(5);
  });
});
