import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { makeStatus } from '../test/fixtures';
import { ApiError, describeError, fetchStatus, statusUrl } from './status';

describe('statusUrl', () => {
  it('usa o BASE_URL local', () => {
    expect(statusUrl('/', 'http://localhost:5173')).toBe('http://localhost:5173/api/status');
  });

  it('respeita o BASE_URL do GitHub Pages, com ou sem barra final', () => {
    expect(statusUrl('/plataforma-multitenant/', 'https://x.github.io')).toBe(
      'https://x.github.io/plataforma-multitenant/api/status',
    );
    expect(statusUrl('/plataforma-multitenant', 'https://x.github.io')).toBe(
      'https://x.github.io/plataforma-multitenant/api/status',
    );
  });

  it('usa import.meta.env.BASE_URL e a origem da janela por padrão', () => {
    expect(statusUrl()).toBe(`${window.location.origin}/api/status`);
  });
});

describe('fetchStatus', () => {
  it('devolve o corpo quando a API responde 200 dentro do contrato', async () => {
    const body = makeStatus({ status: 'DEGRADED' });
    server.use(http.get('*/api/status', () => HttpResponse.json(body)));
    await expect(fetchStatus()).resolves.toEqual(body);
  });

  it('lança ApiError com o código HTTP em respostas de erro', async () => {
    server.use(http.get('*/api/status', () => new HttpResponse(null, { status: 503 })));
    const error = await fetchStatus().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).httpStatus).toBe(503);
    expect((error as ApiError).message).toBe('A API respondeu com HTTP 503.');
  });

  it('lança ApiError quando o corpo não é JSON', async () => {
    server.use(http.get('*/api/status', () => HttpResponse.text('<html>oops</html>')));
    await expect(fetchStatus()).rejects.toThrow('não é JSON');
  });

  it('aceita metrics completas, nulas, ausentes ou com campos opcionais omitidos (Dia 10)', async () => {
    const base = makeStatus();
    const body = {
      ...base,
      components: [
        { ...base.components[0], metrics: null },
        base.components[1],
        {
          name: 'pedidos-service',
          type: 'SERVICE',
          status: 'UP',
          latencyMs: 5,
          details: 'readiness UP',
          metrics: {
            requests: 1234,
            errorRate: 0.012,
            p99Ms: 180,
            outboxPending: 0,
            outboxLagSeconds: 0,
            eventsConsumed: 50,
            eventsFailed: 1,
            outboxUnreadable: false,
          },
        },
        {
          name: 'gateway',
          type: 'SERVICE',
          status: 'UP',
          latencyMs: 4,
          details: null,
          metrics: { requests: 0, errorRate: 0, p99Ms: null },
        },
      ],
    };
    server.use(http.get('*/api/status', () => HttpResponse.json(body)));
    await expect(fetchStatus()).resolves.toEqual(body);
  });

  it.each([
    ['nulo', null],
    ['status desconhecido', { ...makeStatus(), status: 'MAYBE' }],
    ['sem components', { status: 'UP', checkedAt: 'x', version: 'v' }],
    ['componente nulo', { ...makeStatus(), components: [null] }],
    [
      'componente sem nome',
      {
        ...makeStatus(),
        components: [{ type: 'MONGODB', status: 'UP', latencyMs: 1, details: null }],
      },
    ],
    [
      'latência não numérica',
      {
        ...makeStatus(),
        components: [{ name: 'm', type: 'MONGODB', status: 'UP', latencyMs: '1', details: null }],
      },
    ],
    [
      'details não textual',
      {
        ...makeStatus(),
        components: [{ name: 'm', type: 'MONGODB', status: 'UP', latencyMs: 1, details: 42 }],
      },
    ],
  ])('lança ApiError quando o corpo está fora do contrato (%s)', async (_, body) => {
    server.use(http.get('*/api/status', () => HttpResponse.json(body)));
    await expect(fetchStatus()).rejects.toThrow('fora do contrato');
  });

  it.each([
    ['metrics não objeto', 'muitas'],
    ['metrics sem requests', { errorRate: 0, p99Ms: 1 }],
    ['errorRate textual', { requests: 1, errorRate: '0', p99Ms: 1 }],
    ['p99Ms textual', { requests: 1, errorRate: 0, p99Ms: '1' }],
    ['outboxPending textual', { requests: 1, errorRate: 0, p99Ms: 1, outboxPending: '0' }],
    ['outboxLagSeconds textual', { requests: 1, errorRate: 0, p99Ms: 1, outboxLagSeconds: 'x' }],
    ['eventsConsumed textual', { requests: 1, errorRate: 0, p99Ms: 1, eventsConsumed: 'x' }],
    ['eventsFailed textual', { requests: 1, errorRate: 0, p99Ms: 1, eventsFailed: false }],
    ['outboxLagSeconds NaN serializado', { requests: 1, errorRate: 0, outboxLagSeconds: 'NaN' }],
    ['outboxUnreadable textual', { requests: 1, errorRate: 0, outboxUnreadable: 'sim' }],
  ])(
    'descarta só as métricas fora do contrato, sem invalidar a resposta (%s)',
    async (_, metrics) => {
      const body = {
        ...makeStatus(),
        components: [
          { name: 's', type: 'SERVICE', status: 'UP', latencyMs: 1, details: null, metrics },
        ],
      };
      server.use(http.get('*/api/status', () => HttpResponse.json(body)));
      const status = await fetchStatus();
      expect(status.components[0]?.status).toBe('UP');
      expect(status.components[0]?.metrics).toBeNull();
    },
  );

  it('propaga falhas de rede', async () => {
    server.use(http.get('*/api/status', () => HttpResponse.error()));
    await expect(fetchStatus()).rejects.toBeInstanceOf(TypeError);
  });
});

describe('describeError', () => {
  it('usa a mensagem do ApiError', () => {
    expect(describeError(new ApiError('A API respondeu com HTTP 500.', 500))).toBe(
      'A API respondeu com HTTP 500.',
    );
    expect(new ApiError('x').httpStatus).toBeNull();
  });

  it('traduz outras falhas para erro de conexão', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toBe(
      'Não foi possível conectar à API.',
    );
  });
});
