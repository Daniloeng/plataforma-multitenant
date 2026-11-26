import { apiUrl } from '../api/http';
import {
  MIGRACAO_MS,
  databaseDosPedidos,
  iniciarMigracao,
  migrandoAgora,
  resetIsolamentoStore,
} from './isolamento';
import { tenantStoreSnapshot } from './tenants';

const AURORA = 'distribuidora-aurora';

interface Chamada {
  usuario?: string;
  tenant?: string | null;
  method?: string;
  body?: unknown;
}

/** Chama as APIs simuladas como o navegador: token demo-<usuario> e X-Tenant-Id. */
async function call(
  path: string,
  { usuario = 'admin', tenant = null, method, body }: Chamada = {},
) {
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer demo-${usuario}`,
  });
  if (tenant) headers.set('X-Tenant-Id', tenant);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiUrl(path), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    retryAfter: response.headers.get('Retry-After'),
    json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null,
  };
}

const promover = (id: string, nivelIsolamento: unknown, usuario = 'admin') =>
  call(`api/v1/tenants/${id}/promocao`, { usuario, body: { nivelIsolamento } });

const isolamento = (tenant = AURORA, usuario = 'ana') =>
  call('api/v1/isolamento/pedidos', { usuario, tenant });

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/v1/tenants/{id}/promocao', () => {
  it('sobe de POOL para BRIDGE, atualiza o cadastro e o /me', async () => {
    const { status, json } = await promover(AURORA, 'BRIDGE');
    expect(status).toBe(200);
    expect(json).toMatchObject({ id: AURORA, nivelIsolamento: 'BRIDGE' });
    expect(tenantStoreSnapshot().find((t) => t.id === AURORA)?.nivelIsolamento).toBe('BRIDGE');

    const me = await call('api/v1/me', { usuario: 'ana' });
    const tenants = me.json?.tenants as { id: string; nivelIsolamento: string }[];
    expect(tenants.find((t) => t.id === AURORA)?.nivelIsolamento).toBe('BRIDGE');
  });

  it('pode pular de POOL direto para SILO', async () => {
    const { status, json } = await promover(AURORA, 'SILO');
    expect(status).toBe(200);
    expect(json?.nivelIsolamento).toBe('SILO');
  });

  it.each([
    ['repetir o nível', 'atacado-vale-verde', 'BRIDGE', 'já está no nível BRIDGE'],
    ['rebaixar', 'metalurgica-serra-azul', 'BRIDGE', 'só sobe de nível'],
    ['rebaixar para POOL', 'atacado-vale-verde', 'POOL', 'só sobe de nível'],
  ])('responde 409 nivel-invalido ao %s', async (_, id, nivel, detail) => {
    const antes = tenantStoreSnapshot().find((t) => t.id === id)?.nivelIsolamento;
    const { status, json } = await promover(id, nivel);
    expect(status).toBe(409);
    expect(json).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/nivel-invalido',
      status: 409,
      instance: `/api/v1/tenants/${id}/promocao`,
    });
    expect(String(json?.detail)).toContain(detail);
    expect(tenantStoreSnapshot().find((t) => t.id === id)?.nivelIsolamento).toBe(antes);
    expect(migrandoAgora(id)).toBe(false);
  });

  it('responde 400 sem nível válido ou sem corpo JSON', async () => {
    expect((await promover(AURORA, 'X')).status).toBe(400);
    const semCorpo = await call(`api/v1/tenants/${AURORA}/promocao`, { body: 'x' });
    expect(semCorpo.status).toBe(400);
    expect(String(semCorpo.json?.detail)).toContain('objeto JSON');
  });

  it('responde 404 para tenant inexistente e 403 para quem não é admin', async () => {
    expect((await promover('nao-existe', 'BRIDGE')).status).toBe(404);
    const ana = await promover(AURORA, 'BRIDGE', 'ana');
    expect(ana.status).toBe(403);
    expect(ana.json?.type).toBe('https://plataforma.dev.br/problemas/acesso-negado');
  });

  it('o PATCH continua recusando troca de nível e aponta a promoção', async () => {
    const { status, json } = await call(`api/v1/tenants/${AURORA}`, {
      method: 'PATCH',
      body: { nivelIsolamento: 'SILO' },
    });
    expect(status).toBe(409);
    expect(String(json?.detail)).toContain(`POST /api/v1/tenants/${AURORA}/promocao`);
  });
});

describe('migração simulada', () => {
  it('fica MIGRANDO por 1,5 s e depois PRONTO na database dedicada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 26, 12, 0, 0));
    expect((await isolamento()).json).toEqual({
      tenantId: AURORA,
      nivel: 'POOL',
      database: 'pedidos',
      situacao: 'PRONTO',
      migradoEm: null,
    });

    await promover(AURORA, 'BRIDGE');
    expect((await isolamento()).json).toMatchObject({
      nivel: 'BRIDGE',
      database: `pedidos_t_${AURORA}`,
      situacao: 'MIGRANDO',
      migradoEm: null,
    });

    vi.advanceTimersByTime(MIGRACAO_MS - 1);
    expect((await isolamento()).json?.situacao).toBe('MIGRANDO');

    vi.advanceTimersByTime(1);
    expect((await isolamento()).json).toMatchObject({
      situacao: 'PRONTO',
      database: `pedidos_t_${AURORA}`,
      migradoEm: new Date(Date.UTC(2026, 10, 26, 12, 0, 0) + MIGRACAO_MS).toISOString(),
    });
  });

  it('durante a migração, as APIs de negócio do tenant respondem 503 com Retry-After: 1', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await promover(AURORA, 'SILO');
    for (const path of [
      'api/v1/produtos',
      'api/v1/pedidos',
      'api/v1/pagamentos',
      'api/v1/ledger/lancamentos',
    ]) {
      const r = await call(path, { usuario: 'ana', tenant: AURORA });
      expect(r.status, path).toBe(503);
      expect(r.retryAfter).toBe('1');
      expect(r.json).toMatchObject({
        type: 'https://plataforma.dev.br/problemas/tenant-em-migracao',
        status: 503,
      });
    }
    // Outro tenant segue normal.
    expect(
      (await call('api/v1/pedidos', { usuario: 'ana', tenant: 'atacado-vale-verde' })).status,
    ).toBe(200);

    vi.advanceTimersByTime(MIGRACAO_MS);
    expect((await call('api/v1/pedidos', { usuario: 'ana', tenant: AURORA })).status).toBe(200);
  });

  it('GET /isolamento/pedidos: comprador 403, sem X-Tenant-Id 400', async () => {
    const comprador = await isolamento('farmaceutica-boa-saude', 'bruno');
    expect(comprador.status).toBe(403);
    const semTenant = await call('api/v1/isolamento/pedidos', { usuario: 'ana' });
    expect(semTenant.status).toBe(400);
  });

  it('uma nova migração guarda a data da anterior até terminar', () => {
    iniciarMigracao('x', 0);
    expect(migrandoAgora('x', MIGRACAO_MS)).toBe(false);
    iniciarMigracao('x', 10_000);
    expect(migrandoAgora('x', 10_001)).toBe(true);
    expect(migrandoAgora('y')).toBe(false);
    resetIsolamentoStore();
    expect(migrandoAgora('x', 10_001)).toBe(false);
  });

  it('databaseDosPedidos: pedidos no POOL, pedidos_t_<tenant> no BRIDGE e no SILO', () => {
    expect(databaseDosPedidos('acme', 'POOL')).toBe('pedidos');
    expect(databaseDosPedidos('acme', 'BRIDGE')).toBe('pedidos_t_acme');
    expect(databaseDosPedidos('acme', 'SILO')).toBe('pedidos_t_acme');
  });
});
