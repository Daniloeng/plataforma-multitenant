import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { ApiError } from './http';
import {
  createTenant,
  describeTenantError,
  isNivelIsolamento,
  isPlano,
  listTenants,
  niveisAcima,
  promocaoUrl,
  promoteTenant,
  tenantsUrl,
  updateTenant,
  validateNome,
  validateTenantId,
  type Tenant,
} from './tenants';
import { signInAs } from '../test/session';

// Desde o Dia 4 a API de tenants exige token com o papel plataforma-admin.
beforeEach(() => signInAs('admin'));

const tenant: Tenant = {
  id: 'acme',
  nome: 'Acme',
  plano: 'GRATUITO',
  nivelIsolamento: 'POOL',
  ativo: true,
  criadoEm: '2026-11-26T12:00:00Z',
};

describe('tenantsUrl', () => {
  it('monta a URL da coleção e de um tenant, respeitando o BASE_URL', () => {
    expect(tenantsUrl(undefined, '/', 'http://localhost:5173')).toBe(
      'http://localhost:5173/api/v1/tenants',
    );
    expect(tenantsUrl('acme', '/plataforma-multitenant', 'https://x.github.io')).toBe(
      'https://x.github.io/plataforma-multitenant/api/v1/tenants/acme',
    );
    expect(tenantsUrl()).toBe(`${window.location.origin}/api/v1/tenants`);
  });
});

describe('validateTenantId', () => {
  it.each(['abc', 'distribuidora-aurora', 'a1-b2', `a${'b'.repeat(38)}c`])('aceita %s', (id) => {
    expect(validateTenantId(id)).toBeNull();
  });

  it.each([
    ['', 'Informe o id'],
    ['ab', 'de 3 a 40'],
    ['1abc', 'começando por letra'],
    ['Acme', 'minúsculas'],
    ['acme-', 'sem terminar em hífen'],
    ['ac_me', 'letras minúsculas'],
    [`a${'b'.repeat(39)}c`, 'de 3 a 40'],
    ['ac--me', 'Hífens consecutivos'],
  ])('rejeita "%s"', (id, mensagem) => {
    expect(validateTenantId(id)).toContain(mensagem);
  });
});

describe('validateNome', () => {
  it('exige de 2 a 120 caracteres, ignorando espaços nas pontas', () => {
    expect(validateNome('')).toBe('Informe o nome do tenant.');
    expect(validateNome('   ')).toBe('Informe o nome do tenant.');
    expect(validateNome(' a ')).toBe('O nome deve ter de 2 a 120 caracteres.');
    expect(validateNome('x'.repeat(121))).toBe('O nome deve ter de 2 a 120 caracteres.');
    expect(validateNome('Ab')).toBeNull();
    expect(validateNome('x'.repeat(120))).toBeNull();
  });
});

describe('guards de enum', () => {
  it('reconhece planos e níveis do contrato', () => {
    expect(isPlano('EMPRESARIAL')).toBe(true);
    expect(isPlano('PREMIUM')).toBe(false);
    expect(isPlano(1)).toBe(false);
    expect(isNivelIsolamento('SILO')).toBe(true);
    expect(isNivelIsolamento('pool')).toBe(false);
  });
});

describe('listTenants', () => {
  it('envia limite=20 por padrão e o cursor quando informado', async () => {
    const urls: URL[] = [];
    server.use(
      http.get('*/api/v1/tenants', ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json({ itens: [tenant] });
      }),
    );
    await expect(listTenants()).resolves.toEqual({ itens: [tenant], proximoCursor: null });
    await listTenants({ cursor: 'acme', limite: 5 });
    expect(urls[0]?.searchParams.get('limite')).toBe('20');
    expect(urls[0]?.searchParams.has('cursor')).toBe(false);
    expect(urls[1]?.searchParams.get('limite')).toBe('5');
    expect(urls[1]?.searchParams.get('cursor')).toBe('acme');
  });

  it.each([
    ['nulo', null],
    ['sem itens', { proximoCursor: null }],
    ['tenant sem id', { itens: [{ ...tenant, id: 1 }] }],
    ['plano desconhecido', { itens: [{ ...tenant, plano: 'PREMIUM' }] }],
    ['cursor numérico', { itens: [], proximoCursor: 3 }],
    ['item nulo', { itens: [null] }],
  ])('lança ApiError quando a página está fora do contrato (%s)', async (_, body) => {
    server.use(http.get('*/api/v1/tenants', () => HttpResponse.json(body)));
    await expect(listTenants()).rejects.toThrow('fora do contrato');
  });

  it('lança ApiError quando o corpo não é JSON', async () => {
    server.use(http.get('*/api/v1/tenants', () => HttpResponse.text('oops')));
    await expect(listTenants()).rejects.toThrow('não é JSON');
  });

  it('propaga falhas de rede como TypeError', async () => {
    server.use(http.get('*/api/v1/tenants', () => HttpResponse.error()));
    await expect(listTenants()).rejects.toBeInstanceOf(TypeError);
  });
});

describe('createTenant', () => {
  it('faz POST com o corpo JSON e devolve o tenant (201)', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/v1/tenants', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(tenant, { status: 201 });
      }),
    );
    await expect(createTenant({ id: 'acme', nome: 'Acme', plano: 'GRATUITO' })).resolves.toEqual(
      tenant,
    );
    expect(body).toEqual({ id: 'acme', nome: 'Acme', plano: 'GRATUITO' });
  });

  it('usa o detail do Problem Details em 409', async () => {
    const error = await createTenant({
      id: 'distribuidora-aurora',
      nome: 'Outra',
      plano: 'GRATUITO',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).httpStatus).toBe(409);
    expect((error as ApiError).message).toBe(
      "Já existe um tenant com o id 'distribuidora-aurora'.",
    );
  });

  it('usa o title quando o problema não tem detail, e o código HTTP sem corpo', async () => {
    server.use(
      http.post('*/api/v1/tenants', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Requisição inválida', status: 400 },
          {
            status: 400,
          },
        ),
      ),
    );
    await expect(createTenant({ id: 'abc', nome: 'Ab', plano: 'GRATUITO' })).rejects.toThrow(
      'Requisição inválida',
    );

    server.use(http.post('*/api/v1/tenants', () => new HttpResponse(null, { status: 500 })));
    await expect(createTenant({ id: 'abc', nome: 'Ab', plano: 'GRATUITO' })).rejects.toThrow(
      'A API respondeu com HTTP 500.',
    );

    server.use(http.post('*/api/v1/tenants', () => HttpResponse.json([1], { status: 502 })));
    await expect(createTenant({ id: 'abc', nome: 'Ab', plano: 'GRATUITO' })).rejects.toThrow(
      'A API respondeu com HTTP 502.',
    );
  });
});

describe('updateTenant', () => {
  it('faz PATCH em /api/v1/tenants/{id}', async () => {
    await expect(updateTenant('distribuidora-aurora', { ativo: false })).resolves.toMatchObject({
      id: 'distribuidora-aurora',
      ativo: false,
    });
  });

  it('lança ApiError com o detail em 404', async () => {
    await expect(updateTenant('nao-existe', { ativo: false })).rejects.toThrow(
      "Tenant 'nao-existe' não encontrado.",
    );
  });
});

describe('promoteTenant', () => {
  it('monta a URL da promoção', () => {
    expect(promocaoUrl('acme', '/plataforma-multitenant/', 'https://x.io')).toBe(
      'https://x.io/plataforma-multitenant/api/v1/tenants/acme/promocao',
    );
  });

  it('faz POST em /promocao com o nível novo, sem X-Tenant-Id, e devolve o tenant', async () => {
    signInAs('admin', 'atacado-vale-verde');
    let corpo: unknown = null;
    let tenantHeader: string | null = 'nao-lido';
    server.use(
      http.post('*/api/v1/tenants/:id/promocao', async ({ request }) => {
        corpo = await request.json();
        tenantHeader = request.headers.get('X-Tenant-Id');
        return HttpResponse.json({ ...tenant, nivelIsolamento: 'BRIDGE' });
      }),
    );
    await expect(promoteTenant('acme', 'BRIDGE')).resolves.toMatchObject({
      nivelIsolamento: 'BRIDGE',
    });
    expect(corpo).toEqual({ nivelIsolamento: 'BRIDGE' });
    expect(tenantHeader).toBeNull();
  });

  it('lança ApiError com o detail do 409 nivel-invalido', async () => {
    const erro: unknown = await promoteTenant('metalurgica-serra-azul', 'BRIDGE').catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).httpStatus).toBe(409);
    expect((erro as ApiError).problemType).toBe(
      'https://plataforma.dev.br/problemas/nivel-invalido',
    );
  });

  it('niveisAcima lista só os níveis maiores que o atual', () => {
    expect(niveisAcima('POOL')).toEqual(['BRIDGE', 'SILO']);
    expect(niveisAcima('BRIDGE')).toEqual(['SILO']);
    expect(niveisAcima('SILO')).toEqual([]);
  });
});

describe('describeTenantError', () => {
  it('usa a mensagem do ApiError e traduz falhas de rede', () => {
    expect(describeTenantError(new ApiError('detalhe', 400))).toBe('detalhe');
    expect(describeTenantError(new TypeError('Failed to fetch'))).toBe(
      'Não foi possível conectar ao tenant-service.',
    );
  });
});
