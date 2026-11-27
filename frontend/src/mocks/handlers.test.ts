import { fetchStatus, type ServiceMetrics } from '../api/status';
import { avaliarAlertas } from '../utils/metricas';
import { DEMO_RUNTIME, DEMO_VERSION, buildDemoMetrics, buildDemoStatus } from './handlers';

describe('buildDemoStatus', () => {
  it('monta Mongo, Pulsar, tenant-service, catalogo-service, pedidos-service, pagamentos-service, gateway e keycloak no ar com latência base quando random = 0', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const status = buildDemoStatus(() => 0, now);
    expect(status.status).toBe('UP');
    expect(status.checkedAt).toBe('2026-11-26T12:00:00.000Z');
    expect(status.version).toBe(DEMO_VERSION);
    expect(DEMO_VERSION).toBe('0.1.0-mvp1');
    expect(status.runtime).toEqual({
      platform: 'kubernetes',
      namespace: 'plataforma',
      instance: 'status-service-7c9d8-xk2lp',
    });
    expect(status.runtime).not.toBe(DEMO_RUNTIME);
    expect(status.components.map((c) => c.name)).toEqual([
      'mongo-tenants',
      'mongo-catalogo',
      'mongo-pedidos',
      'mongo-pagamentos',
      'pulsar',
      'tenant-service',
      'catalogo-service',
      'pedidos-service',
      'pagamentos-service',
      'gateway',
      'keycloak',
    ]);
    expect(status.components.every((c) => c.status === 'UP')).toBe(true);
    expect(status.components.map((c) => c.latencyMs)).toEqual([2, 3, 3, 4, 10, 6, 5, 5, 6, 4, 12]);
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
    expect(status.components[7]).toMatchObject({
      name: 'pedidos-service',
      type: 'SERVICE',
      status: 'UP',
      details: 'readiness UP',
    });
    expect(status.components[8]).toMatchObject({
      name: 'pagamentos-service',
      type: 'SERVICE',
      status: 'UP',
      details: 'readiness UP',
    });
    expect(status.components[9]).toMatchObject({ name: 'gateway', details: 'readiness UP' });
    expect(status.components[10]).toMatchObject({ type: 'SERVICE', details: 'realm plataforma' });
    expect(status.components[0]).toMatchObject({
      type: 'MONGODB',
      details: 'replica set rs-tenants',
    });
  });

  it('varia a latência dentro de uma faixa pequena', () => {
    const status = buildDemoStatus(() => 1);
    expect(status.components.map((c) => c.latencyMs)).toEqual([
      6, 7, 7, 8, 18, 12, 11, 11, 12, 8, 22,
    ]);
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

describe('buildDemoMetrics', () => {
  it('dá métricas aos serviços e não ao Mongo, Pulsar e Keycloak', () => {
    const status = buildDemoStatus(() => 0);
    const comMetricas = status.components.filter((c) => c.metrics).map((c) => c.name);
    expect(comMetricas).toEqual([
      'tenant-service',
      'catalogo-service',
      'pedidos-service',
      'pagamentos-service',
      'gateway',
    ]);
    for (const c of status.components.filter((c) => !c.metrics)) {
      expect(c.metrics).toBeUndefined();
    }
  });

  it('o gateway não tem outbox nem consome; o tenant-service tem outbox e não consome', () => {
    const m = buildDemoMetrics(() => 0);
    expect(m.gateway).toEqual({
      requests: 5820,
      errorRate: 0.003,
      p99Ms: 320,
      outboxPending: null,
      outboxLagSeconds: null,
      eventsConsumed: null,
      eventsFailed: null,
    });
    expect(m['tenant-service']).toMatchObject({
      outboxPending: 0,
      outboxLagSeconds: 0,
      eventsConsumed: null,
      eventsFailed: null,
    });
    for (const nome of ['catalogo-service', 'pedidos-service', 'pagamentos-service']) {
      const s = m[nome] as ServiceMetrics;
      expect(s.outboxPending).not.toBeNull();
      expect(s.outboxLagSeconds).not.toBeNull();
      expect(s.eventsConsumed).toBeGreaterThan(0);
      expect(s.eventsFailed).not.toBeNull();
    }
  });

  it('varia requisições e p99 com o random, mantendo p99 abaixo da meta', () => {
    const m = buildDemoMetrics(() => 1);
    expect(m['pedidos-service']).toMatchObject({ requests: 2015, p99Ms: 320 });
    for (const s of Object.values(m)) {
      expect(s.p99Ms).toBeLessThan(3000);
    }
  });

  it('deixa o pagamentos-service em alerta para a demo mostrar o destaque', () => {
    const pagamentos = buildDemoMetrics()['pagamentos-service'] as ServiceMetrics;
    expect(pagamentos.eventsFailed).toBeGreaterThan(0);
    expect(avaliarAlertas(buildDemoStatus().components)).toEqual([
      {
        componente: 'pagamentos-service',
        regra: 'ERROS',
        mensagem: '1,4% de erros 5xx, acima de 1%',
      },
    ]);
  });
});

describe('handlers', () => {
  it('respondem /api/status dentro do contrato e sem token (servidor msw/node padrão)', async () => {
    const status = await fetchStatus();
    expect(status.status).toBe('UP');
    expect(status.components).toHaveLength(11);
  });
});
