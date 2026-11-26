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

  it.each([
    ['nulo', null],
    ['status desconhecido', { ...makeStatus(), status: 'MAYBE' }],
    ['sem components', { status: 'UP', checkedAt: 'x', version: 'v' }],
  ])('lança ApiError quando o corpo está fora do contrato (%s)', async (_, body) => {
    server.use(http.get('*/api/status', () => HttpResponse.json(body)));
    await expect(fetchStatus()).rejects.toThrow('fora do contrato');
  });

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
