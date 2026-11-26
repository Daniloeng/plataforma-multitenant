import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  ApiError,
  apiFetch,
  apiUrl,
  parseRetryAfter,
  readJson,
  setSessionProvider,
  toApiError,
} from './http';

function captureHeaders() {
  const seen: Headers[] = [];
  server.use(
    http.get('*/api/teste', ({ request }) => {
      seen.push(request.headers);
      return HttpResponse.json({ ok: true });
    }),
  );
  return seen;
}

function provider(token: string | null, tenant: string | null, onUnauthorized = vi.fn()) {
  return { getAccessToken: () => token, getTenantId: () => tenant, onUnauthorized };
}

describe('apiUrl', () => {
  it('monta a URL a partir do BASE_URL, com ou sem barra final', () => {
    expect(apiUrl('api/v1/me', '/plataforma-multitenant', 'https://x.io')).toBe(
      'https://x.io/plataforma-multitenant/api/v1/me',
    );
    expect(apiUrl('api/v1/me', '/', 'http://localhost:5173')).toBe(
      'http://localhost:5173/api/v1/me',
    );
  });
});

describe('apiFetch', () => {
  it('sem sessão, não envia Authorization nem X-Tenant-Id', async () => {
    const seen = captureHeaders();
    await apiFetch('api/teste');
    expect(seen[0]?.get('Authorization')).toBeNull();
    expect(seen[0]?.get('X-Tenant-Id')).toBeNull();
  });

  it('injeta o token e o tenant da sessão, mantendo os cabeçalhos informados', async () => {
    const seen = captureHeaders();
    setSessionProvider(provider('abc', 'acme'));
    await apiFetch('api/teste', { headers: { Accept: 'application/json' } });
    expect(seen[0]?.get('Authorization')).toBe('Bearer abc');
    expect(seen[0]?.get('X-Tenant-Id')).toBe('acme');
    expect(seen[0]?.get('Accept')).toBe('application/json');
  });

  it('respeita auth: false e tenant: false, e aceita URL absoluta', async () => {
    const seen = captureHeaders();
    setSessionProvider(provider('abc', 'acme'));
    await apiFetch(apiUrl('api/teste'), { auth: false });
    await apiFetch(new URL(apiUrl('api/teste')), { tenant: false });
    expect(seen[0]?.get('Authorization')).toBeNull();
    expect(seen[0]?.get('X-Tenant-Id')).toBe('acme');
    expect(seen[1]?.get('Authorization')).toBe('Bearer abc');
    expect(seen[1]?.get('X-Tenant-Id')).toBeNull();
  });

  it('não envia X-Tenant-Id sem tenant selecionado', async () => {
    const seen = captureHeaders();
    setSessionProvider(provider('abc', null));
    await apiFetch('api/teste');
    expect(seen[0]?.get('X-Tenant-Id')).toBeNull();
  });

  it('avisa a sessão quando uma requisição com token volta 401', async () => {
    server.use(http.get('*/api/teste', () => new HttpResponse(null, { status: 401 })));
    const comToken = provider('abc', null);
    setSessionProvider(comToken);
    expect((await apiFetch('api/teste')).status).toBe(401);
    expect(comToken.onUnauthorized).toHaveBeenCalledTimes(1);

    const semToken = provider(null, null);
    setSessionProvider(semToken);
    await apiFetch('api/teste');
    expect(semToken.onUnauthorized).not.toHaveBeenCalled();
  });

  it('a função devolvida por setSessionProvider só remove o provider se ainda for o atual', async () => {
    const seen = captureHeaders();
    const removeA = setSessionProvider(provider('a', null));
    setSessionProvider(provider('b', null));
    removeA();
    await apiFetch('api/teste');
    expect(seen[0]?.get('Authorization')).toBe('Bearer b');
  });
});

describe('Problem Details', () => {
  it('lê type, detail e Retry-After', async () => {
    const response = new Response(
      JSON.stringify({ type: 'https://x/limite', title: 'Limite', status: 429, detail: 'Calma.' }),
      { status: 429, headers: { 'Retry-After': '2' } },
    );
    const erro = await toApiError(response);
    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.message).toBe('Calma.');
    expect(erro.httpStatus).toBe(429);
    expect(erro.problemType).toBe('https://x/limite');
    expect(erro.retryAfterSeconds).toBe(2);
  });

  it('usa o title sem detail e o código HTTP sem corpo', async () => {
    expect((await toApiError(Response.json({ title: 'Proibido' }, { status: 403 }))).message).toBe(
      'Proibido',
    );
    const vazio = await toApiError(new Response(null, { status: 502 }));
    expect(vazio.message).toBe('A API respondeu com HTTP 502.');
    expect(vazio.problemType).toBeNull();
    expect(vazio.problem).toBeNull();
    expect(vazio.problemStrings('produtos')).toBeNull();
  });

  it('guarda o corpo do problema com as propriedades de extensão', async () => {
    const erro = await toApiError(
      Response.json(
        {
          type: 'https://x/produto-indisponivel',
          title: 'Produto indisponível',
          status: 409,
          detail: 'Produto indisponível: a, b.',
          produtos: ['a', 'b'],
          outros: ['a', 1],
        },
        { status: 409 },
      ),
    );
    expect(erro.problem).toMatchObject({ status: 409, produtos: ['a', 'b'] });
    expect(erro.problemStrings('produtos')).toEqual(['a', 'b']);
    expect(erro.problemStrings('outros')).toBeNull();
    expect(erro.problemStrings('detail')).toBeNull();
    expect((await toApiError(Response.json(['x'], { status: 400 }))).problem).toBeNull();
  });

  it('parseRetryAfter aceita só segundos', () => {
    expect(parseRetryAfter('3')).toBe(3);
    expect(parseRetryAfter(' 10 ')).toBe(10);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
  });

  it('readJson rejeita corpo que não é JSON ou fora do contrato', async () => {
    const isOk = (v: unknown): v is { ok: true } =>
      typeof v === 'object' && v !== null && 'ok' in v;
    await expect(readJson(new Response('x', { status: 200 }), isOk)).rejects.toThrow('não é JSON');
    await expect(readJson(Response.json({}), isOk)).rejects.toThrow('fora do contrato');
    await expect(readJson(Response.json({ ok: true }), isOk)).resolves.toEqual({ ok: true });
  });
});
