import { tenantsUrl } from '../api/tenants';
import { makeTenants } from '../test/fixtures';
import { SEED_TENANTS, resetTenantStore, tenantStoreSnapshot } from './tenants';

async function call(method: string, path = '', body?: unknown) {
  const response = await fetch(`${tenantsUrl()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    location: response.headers.get('Location'),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

describe('store inicial', () => {
  it('tem 5 tenants realistas, com pelo menos um Bridge e um Silo', () => {
    expect(SEED_TENANTS).toHaveLength(5);
    const niveis = SEED_TENANTS.map((t) => t.nivelIsolamento);
    expect(niveis).toContain('BRIDGE');
    expect(niveis).toContain('SILO');
    expect(niveis).toContain('POOL');
  });
});

describe('GET /api/v1/tenants', () => {
  it('lista em ordem de id, como o tenant-service, e sem próxima página', async () => {
    const { status, body } = await call('GET');
    expect(status).toBe(200);
    const itens = body?.itens as { id: string }[];
    expect(itens.map((t) => t.id)).toEqual([
      'atacado-vale-verde',
      'ceramica-paraiba',
      'distribuidora-aurora',
      'farmaceutica-boa-saude',
      'metalurgica-serra-azul',
    ]);
    expect(body?.proximoCursor).toBeNull();
  });

  it('pagina por cursor (id do último item)', async () => {
    resetTenantStore(makeTenants(5));
    const p1 = await call('GET', '?limite=2');
    expect((p1.body?.itens as { id: string }[]).map((t) => t.id)).toEqual([
      'tenant-01',
      'tenant-02',
    ]);
    expect(p1.body?.proximoCursor).toBe('tenant-02');
    const p2 = await call('GET', '?limite=2&cursor=tenant-02');
    expect(p2.body?.proximoCursor).toBe('tenant-04');
    const p3 = await call('GET', '?limite=2&cursor=tenant-04');
    expect((p3.body?.itens as { id: string }[]).map((t) => t.id)).toEqual(['tenant-05']);
    expect(p3.body?.proximoCursor).toBeNull();
  });

  it('desempata pelo id quando a data de criação é igual', async () => {
    const [a, b] = makeTenants(2);
    resetTenantStore([
      { ...b!, criadoEm: a!.criadoEm },
      { ...a!, id: 'tenant-00' },
    ]);
    const { body } = await call('GET');
    expect((body?.itens as { id: string }[]).map((t) => t.id)).toEqual(['tenant-00', 'tenant-02']);
  });

  it.each(['0', '101', 'abc', '2.5'])('rejeita limite=%s com 400', async (limite) => {
    const { status, contentType, body } = await call('GET', `?limite=${limite}`);
    expect(status).toBe(400);
    expect(contentType).toContain('application/problem+json');
    expect(body).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/requisicao-invalida',
      title: 'Requisição inválida',
      status: 400,
    });
  });

  it('rejeita cursor desconhecido com 400', async () => {
    const { status, body } = await call('GET', '?cursor=fantasma');
    expect(status).toBe(400);
    expect(body?.detail).toBe("cursor inválido: 'fantasma'.");
  });
});

describe('POST /api/v1/tenants', () => {
  it('cria com POOL por padrão, ativo, e devolve 201 com Location', async () => {
    const { status, body, location } = await call('POST', '', {
      id: 'nova-empresa',
      nome: '  Nova Empresa  ',
      plano: 'PROFISSIONAL',
    });
    expect(status).toBe(201);
    expect(location).toBe('/api/v1/tenants/nova-empresa');
    expect(body).toMatchObject({
      id: 'nova-empresa',
      nome: 'Nova Empresa',
      plano: 'PROFISSIONAL',
      nivelIsolamento: 'POOL',
      ativo: true,
    });
    expect(Number.isNaN(Date.parse(String(body?.criadoEm)))).toBe(false);
    expect(tenantStoreSnapshot().map((t) => t.id)).toContain('nova-empresa');
  });

  it('respeita o nível informado', async () => {
    const { body } = await call('POST', '', {
      id: 'silo-sa',
      nome: 'Silo SA',
      plano: 'EMPRESARIAL',
      nivelIsolamento: 'SILO',
    });
    expect(body?.nivelIsolamento).toBe('SILO');
  });

  it.each([
    ['corpo não JSON', 'xxx', 'objeto JSON'],
    ['corpo lista', [], 'objeto JSON'],
    ['sem id', { nome: 'Ab', plano: 'GRATUITO' }, 'id é obrigatório.'],
    ['id inválido', { id: 'A', nome: 'Ab', plano: 'GRATUITO' }, "tenantId inválido: 'A'."],
    ['id com --', { id: 'a--b', nome: 'Ab', plano: 'GRATUITO' }, 'Hífens consecutivos'],
    ['sem nome', { id: 'abc', plano: 'GRATUITO' }, 'nome é obrigatório.'],
    ['sem plano', { id: 'abc', nome: 'Ab' }, 'plano é obrigatório.'],
    ['nome não textual', { id: 'abc', nome: 3, plano: 'GRATUITO' }, 'nome deve ser texto.'],
    ['nome curto', { id: 'abc', nome: 'A', plano: 'GRATUITO' }, 'de 2 a 120'],
    ['plano inválido', { id: 'abc', nome: 'Ab', plano: 'X' }, 'plano inválido'],
    [
      'nível inválido',
      { id: 'abc', nome: 'Ab', plano: 'GRATUITO', nivelIsolamento: 'X' },
      'nivelIsolamento inválido',
    ],
  ])('responde 400 (%s)', async (_, body, detail) => {
    const response = await call('POST', '', body);
    expect(response.status).toBe(400);
    expect(response.contentType).toContain('application/problem+json');
    expect(String(response.body?.detail)).toContain(detail);
  });

  it('responde 409 para id repetido', async () => {
    const { status, body } = await call('POST', '', {
      id: 'atacado-vale-verde',
      nome: 'Outro',
      plano: 'GRATUITO',
    });
    expect(status).toBe(409);
    expect(body).toMatchObject({ title: 'Tenant já existe', status: 409 });
  });
});

describe('GET e PATCH /api/v1/tenants/{id}', () => {
  it('obtém um tenant ou responde 404', async () => {
    expect((await call('GET', '/ceramica-paraiba')).body).toMatchObject({ ativo: false });
    const missing = await call('GET', '/nao-existe');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ instance: '/api/v1/tenants/nao-existe' });
  });

  it('altera nome, plano, nível e situação', async () => {
    const { status, body } = await call('PATCH', '/ceramica-paraiba', {
      nome: 'Cerâmica Paraíba S.A.',
      plano: 'PROFISSIONAL',
      nivelIsolamento: 'BRIDGE',
      ativo: true,
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      nome: 'Cerâmica Paraíba S.A.',
      plano: 'PROFISSIONAL',
      nivelIsolamento: 'BRIDGE',
      ativo: true,
    });
    expect(tenantStoreSnapshot().find((t) => t.id === 'ceramica-paraiba')?.ativo).toBe(true);
  });

  it.each([
    ['corpo não JSON', 'x', 'objeto JSON'],
    ['corpo vazio', {}, 'ao menos um campo'],
    ['ativo não booleano', { ativo: 'sim' }, 'ativo deve ser true ou false.'],
    ['plano inválido', { plano: 'X' }, 'plano inválido'],
  ])('responde 400 (%s)', async (_, body, detail) => {
    const response = await call('PATCH', '/ceramica-paraiba', body);
    expect(response.status).toBe(400);
    expect(String(response.body?.detail)).toContain(detail);
  });

  it('responde 404 para tenant inexistente', async () => {
    const { status, body } = await call('PATCH', '/nao-existe', { ativo: false });
    expect(status).toBe(404);
    expect(body?.detail).toBe("Tenant 'nao-existe' não encontrado.");
  });
});

describe('resetTenantStore', () => {
  it('volta ao estado inicial', async () => {
    await call('POST', '', { id: 'temporario', nome: 'Temp', plano: 'GRATUITO' });
    expect(tenantStoreSnapshot()).toHaveLength(6);
    resetTenantStore();
    expect(tenantStoreSnapshot()).toHaveLength(5);
    resetTenantStore([]);
    expect((await call('GET')).body).toEqual({ itens: [], proximoCursor: null });
  });
});
