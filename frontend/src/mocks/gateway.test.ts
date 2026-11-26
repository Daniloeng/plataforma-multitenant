import { apiUrl } from '../api/http';
import { DEMO_USERS, demoToken, findDemoUser } from '../auth/demoUsers';
import { meOf, takeToken, tenantsOf } from './gateway';
import { SEED_TENANTS, resetTenantStore } from './tenants';

async function get(path: string, headers: Record<string, string> = {}) {
  const response = await fetch(apiUrl(path), { headers });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    retryAfter: response.headers.get('Retry-After'),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

const bearer = (usuario: string) => ({ Authorization: `Bearer ${demoToken(usuario)}` });

describe('usuários de demonstração', () => {
  it('admin vê todos os tenants; ana e bruno só os seus, que existem no store', () => {
    expect(DEMO_USERS.map((u) => u.usuario)).toEqual(['admin', 'ana', 'bruno']);
    const ids = SEED_TENANTS.map((t) => t.id);
    expect(tenantsOf(findDemoUser('admin')!)).toHaveLength(5);
    for (const u of DEMO_USERS) {
      if (u.tenants !== 'todos') for (const id of u.tenants) expect(ids).toContain(id);
    }
    expect(tenantsOf(findDemoUser('ana')!).map((t) => t.id)).toEqual([
      'atacado-vale-verde',
      'distribuidora-aurora',
    ]);
    expect(findDemoUser('ninguem')).toBeNull();
    expect(findDemoUser(null)).toBeNull();
  });

  it('meOf reflete o cadastro atual (ex.: tenant suspenso depois)', () => {
    resetTenantStore(SEED_TENANTS.map((t) => ({ ...t, ativo: false })));
    expect(meOf(findDemoUser('bruno')!).tenants[0]).toMatchObject({ ativo: false });
  });
});

describe('GET /api/v1/me (gateway simulado)', () => {
  it.each([
    ['sem Authorization', {}],
    ['com esquema errado', { Authorization: 'Basic demo-ana' }],
    ['com token desconhecido', { Authorization: 'Bearer demo-zeca' }],
    ['com token que não é de demo', { Authorization: 'Bearer eyJhbGciOi' }],
  ])('responde 401 %s', async (_, headers) => {
    const r = await get('api/v1/me', headers);
    expect(r.status).toBe(401);
    expect(r.contentType).toBe('application/problem+json');
    expect(r.body).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/nao-autenticado',
      status: 401,
    });
  });

  it('responde o usuário com papéis e tenants', async () => {
    const r = await get('api/v1/me', bearer('ana'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      usuario: 'ana',
      nome: 'Ana Souza',
      papeis: ['gestor-tenant'],
      clienteId: null,
    });
    expect((r.body?.tenants as unknown[]).length).toBe(2);
  });

  it('responde 403 para tenant que não é do usuário e para tenant suspenso', async () => {
    const alheio = await get('api/v1/me', { ...bearer('ana'), 'X-Tenant-Id': 'ceramica-paraiba' });
    expect(alheio.status).toBe(403);
    expect(alheio.body).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/acesso-negado',
      detail: "O tenant 'ceramica-paraiba' não pertence ao usuário ana.",
    });
    const suspenso = await get('api/v1/me', {
      ...bearer('admin'),
      'X-Tenant-Id': 'ceramica-paraiba',
    });
    expect(suspenso.status).toBe(403);
    expect(suspenso.body).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/tenant-suspenso',
    });
  });

  it('aplica o limite do plano por tenant: 429 com Retry-After depois da rajada', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    const headers = { ...bearer('bruno'), 'X-Tenant-Id': 'farmaceutica-boa-saude' };
    for (let i = 0; i < 40; i += 1) expect((await get('api/v1/me', headers)).status).toBe(200);
    const r = await get('api/v1/me', headers);
    expect(r.status).toBe(429);
    expect(r.retryAfter).toBe('1');
    expect(r.body).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/limite-excedido',
      title: 'Limite de requisições excedido',
    });
    // O limite é por tenant: outro tenant (de outro usuário) não é afetado.
    const outro = await get('api/v1/me', { ...bearer('ana'), 'X-Tenant-Id': 'atacado-vale-verde' });
    expect(outro.status).toBe(200);
    vi.restoreAllMocks();
  });
});

describe('takeToken', () => {
  it('enche o balde no ritmo do plano até a rajada', () => {
    // Gratuito: 5 req/s, rajada 10.
    for (let i = 0; i < 10; i += 1) expect(takeToken('t1', 'GRATUITO', 0)).toBeNull();
    expect(takeToken('t1', 'GRATUITO', 0)).toBe(1);
    // 200 ms depois entra 1 token (5/s).
    expect(takeToken('t1', 'GRATUITO', 200)).toBeNull();
    expect(takeToken('t1', 'GRATUITO', 200)).toBe(1);
    // Muito tempo depois, o balde para na rajada.
    for (let i = 0; i < 10; i += 1) expect(takeToken('t1', 'GRATUITO', 60_000)).toBeNull();
    expect(takeToken('t1', 'GRATUITO', 60_000)).not.toBeNull();
  });

  it('relógio que volta não gera tokens', () => {
    for (let i = 0; i < 100; i += 1) takeToken('t2', 'EMPRESARIAL', 1_000);
    expect(takeToken('t2', 'EMPRESARIAL', 500)).toBe(1);
  });
});

describe('API de tenants pelo gateway', () => {
  it('exige token e o papel plataforma-admin', async () => {
    expect((await get('api/v1/tenants')).status).toBe(401);
    const ana = await get('api/v1/tenants', bearer('ana'));
    expect(ana.status).toBe(403);
    expect(ana.body).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/acesso-negado',
      detail: 'Esta operação exige o papel plataforma-admin.',
    });
    expect((await get('api/v1/tenants/acme', bearer('bruno'))).status).toBe(403);
    expect((await get('api/v1/tenants', bearer('admin'))).status).toBe(200);
  });

  it('POST e PATCH também exigem admin', async () => {
    for (const method of ['POST', 'PATCH']) {
      const path = method === 'POST' ? 'api/v1/tenants' : 'api/v1/tenants/atacado-vale-verde';
      const r = await fetch(apiUrl(path), {
        method,
        headers: { ...bearer('ana'), 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(r.status).toBe(403);
    }
  });
});
