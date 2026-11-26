import { SKU_PATTERN, type Produto } from '../api/catalogo';
import { apiUrl } from '../api/http';
import { catalogoSnapshot, resetCatalogoStore, seedSkus } from './catalogo';
import { SEED_TENANTS, resetTenantStore } from './tenants';

interface Pedido {
  usuario?: string | null;
  tenant?: string | null;
  method?: string;
  body?: unknown;
  rawBody?: string;
}

/** Chama o catálogo simulado como o gateway veria: token demo-<usuario> e X-Tenant-Id. */
async function call(path: string, { usuario, tenant, method = 'GET', body, rawBody }: Pedido = {}) {
  const headers = new Headers({ Accept: 'application/json' });
  if (usuario !== null) headers.set('Authorization', `Bearer demo-${usuario ?? 'ana'}`);
  if (tenant !== null) headers.set('X-Tenant-Id', tenant ?? 'distribuidora-aurora');
  if (body !== undefined || rawBody !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json, headers: response.headers };
}

type Pagina = { itens: Produto[]; proximoCursor: string | null; total: number; usados: number };

describe('dados de exemplo', () => {
  it('cada tenant ativo da demo tem de 8 a 15 produtos com SKUs válidos e únicos', () => {
    for (const id of [
      'distribuidora-aurora',
      'atacado-vale-verde',
      'farmaceutica-boa-saude',
      'metalurgica-serra-azul',
    ]) {
      const produtos = catalogoSnapshot(id);
      expect(produtos.length).toBeGreaterThanOrEqual(8);
      expect(produtos.length).toBeLessThanOrEqual(15);
      expect(produtos.some((p) => !p.ativo)).toBe(true);
      expect(new Set(produtos.map((p) => p.sku)).size).toBe(produtos.length);
    }
    expect(seedSkus().every((sku) => SKU_PATTERN.test(sku))).toBe(true);
    expect(catalogoSnapshot('tenant-sem-catalogo')).toEqual([]);
  });

  it('resetCatalogoStore troca o catálogo de um tenant', () => {
    resetCatalogoStore({ 'distribuidora-aurora': [] });
    expect(catalogoSnapshot('distribuidora-aurora')).toEqual([]);
  });
});

describe('gateway na frente do catálogo', () => {
  it('401 sem token, 400 sem X-Tenant-Id, 403 para tenant de outro usuário e suspenso', async () => {
    expect((await call('api/v1/produtos', { usuario: null })).status).toBe(401);
    const semTenant = await call('api/v1/produtos', { tenant: null });
    expect(semTenant.status).toBe(400);
    expect(semTenant.json.detail).toBe('O cabeçalho X-Tenant-Id é obrigatório.');
    const outro = await call('api/v1/produtos', { tenant: 'farmaceutica-boa-saude' });
    expect(outro.status).toBe(403);
    expect(outro.json.type).toBe('https://plataforma.dev.br/problemas/acesso-negado');
    const suspenso = await call('api/v1/produtos', {
      usuario: 'admin',
      tenant: 'ceramica-paraiba',
    });
    expect(suspenso.status).toBe(403);
    expect(suspenso.json.type).toBe('https://plataforma.dev.br/problemas/tenant-suspenso');
  });

  it('403 para comprador em toda escrita', async () => {
    const bruno = { usuario: 'bruno', tenant: 'farmaceutica-boa-saude' };
    const id = catalogoSnapshot('farmaceutica-boa-saude')[0]!.id;
    const respostas = await Promise.all([
      call('api/v1/produtos', {
        ...bruno,
        method: 'POST',
        body: { sku: 'XYZ', nome: 'Xy', preco: { centavos: 1, moeda: 'BRL' } },
      }),
      call(`api/v1/produtos/${id}`, { ...bruno, method: 'PATCH', body: { ativo: false } }),
      call(`api/v1/produtos/${id}/preco`, {
        ...bruno,
        method: 'PUT',
        body: { centavos: 1, moeda: 'BRL' },
      }),
    ]);
    for (const r of respostas) {
      expect(r.status).toBe(403);
      expect(r.json.detail).toBe(
        'Alterar o catálogo exige o papel gestor-tenant ou plataforma-admin.',
      );
    }
  });
});

describe('GET /api/v1/produtos', () => {
  it('gestor vê ativos e inativos, ordenados por SKU, com total, limite do plano e usados', async () => {
    const { status, json } = await call('api/v1/produtos');
    const pagina = json as unknown as Pagina;
    expect(status).toBe(200);
    expect(pagina.itens).toHaveLength(12);
    expect(pagina.itens.some((p) => !p.ativo)).toBe(true);
    const skus = pagina.itens.map((p) => p.sku);
    expect(skus).toEqual([...skus].sort());
    expect(json).toMatchObject({ proximoCursor: null, total: 12, limitePlano: 500, usados: 12 });
  });

  it('limite do plano: EMPRESARIAL 10000; muda junto com o plano do tenant', async () => {
    expect((await call('api/v1/produtos', { tenant: 'atacado-vale-verde' })).json.limitePlano).toBe(
      10000,
    );
    resetTenantStore(
      SEED_TENANTS.map((t) => (t.id === 'distribuidora-aurora' ? { ...t, plano: 'GRATUITO' } : t)),
    );
    expect((await call('api/v1/produtos')).json.limitePlano).toBe(20);
  });

  it('filtra por situação (gestor) e busca por nome ou SKU sem diferenciar maiúsculas', async () => {
    const inativos = (await call('api/v1/produtos?ativo=false')).json as unknown as Pagina;
    expect(inativos.itens.map((p) => p.sku)).toEqual(['BIS-MRI-400', 'SAL-REF-1KG']);
    expect(inativos.total).toBe(2);
    expect(inativos.usados).toBe(12);
    const ativos = (await call('api/v1/produtos?ativo=true')).json as unknown as Pagina;
    expect(ativos.total).toBe(10);

    const porNome = (await call('api/v1/produtos?busca=CAFÉ')).json as unknown as Pagina;
    expect(porNome.itens.map((p) => p.sku)).toEqual(['CAF-TOR-500']);
    const porSku = (await call('api/v1/produtos?busca=fej-')).json as unknown as Pagina;
    expect(porSku.itens.map((p) => p.sku)).toEqual(['FEJ-CAR-1KG']);
    const nada = (await call('api/v1/produtos?busca=zzz')).json as unknown as Pagina;
    expect(nada).toMatchObject({ itens: [], total: 0, usados: 12 });
  });

  it('comprador nunca vê inativos, nem pedindo ativo=false', async () => {
    const bruno = { usuario: 'bruno', tenant: 'farmaceutica-boa-saude' };
    const todos = (await call('api/v1/produtos', bruno)).json as unknown as Pagina;
    expect(todos.itens.every((p) => p.ativo)).toBe(true);
    expect(todos.total).toBe(9);
    expect(todos.usados).toBe(10);
    const inativos = (await call('api/v1/produtos?ativo=false', bruno)).json as unknown as Pagina;
    expect(inativos.itens.every((p) => p.ativo)).toBe(true);
    expect(inativos.total).toBe(9);

    const inativo = catalogoSnapshot('farmaceutica-boa-saude').find((p) => !p.ativo)!;
    expect((await call(`api/v1/produtos/${inativo.id}`, bruno)).status).toBe(404);
    expect(
      (
        await call(`api/v1/produtos/${inativo.id}`, {
          usuario: 'admin',
          tenant: 'farmaceutica-boa-saude',
        })
      ).status,
    ).toBe(200);
  });

  it('pagina por cursor sem repetir nem pular, também com filtro', async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const query: string = cursor ? `&cursor=${cursor}` : '';
      const pagina = (await call(`api/v1/produtos?limite=5${query}`)).json as unknown as Pagina;
      vistos.push(...pagina.itens.map((p) => p.sku));
      cursor = pagina.proximoCursor;
      paginas += 1;
    } while (cursor);
    expect(paginas).toBe(3);
    expect(vistos).toEqual(catalogoSnapshot('distribuidora-aurora').map((p) => p.sku));

    const p1 = (await call('api/v1/produtos?limite=3&ativo=true')).json as unknown as Pagina;
    const p2 = (await call(`api/v1/produtos?limite=3&ativo=true&cursor=${p1.proximoCursor}`))
      .json as unknown as Pagina;
    expect(p2.itens.every((p) => p.ativo)).toBe(true);
    expect(p2.itens[0]!.sku > p1.itens[2]!.sku).toBe(true);

    // Cursor do último produto: página vazia.
    const ultimo = catalogoSnapshot('distribuidora-aurora').at(-1)!;
    const fim = (await call(`api/v1/produtos?cursor=${ultimo.id}`)).json as unknown as Pagina;
    expect(fim).toMatchObject({ itens: [], proximoCursor: null });
  });

  it.each([
    ['limite=0', 'limite deve ser um inteiro entre 1 e 100.'],
    ['limite=101', 'limite deve ser um inteiro entre 1 e 100.'],
    ['limite=x', 'limite deve ser um inteiro entre 1 e 100.'],
    ['ativo=sim', 'ativo deve ser true ou false.'],
    [`busca=${'a'.repeat(101)}`, 'busca deve ter no máximo 100 caracteres.'],
    ['cursor=nao-existe', "cursor inválido: 'nao-existe'."],
  ])('400 para %s', async (query, detail) => {
    const { status, json, headers } = await call(`api/v1/produtos?${query}`);
    expect(status).toBe(400);
    expect(json.detail).toBe(detail);
    expect(headers.get('Content-Type')).toContain('application/problem+json');
  });
});

describe('POST /api/v1/produtos', () => {
  const novo = { sku: 'CAF-GRAO-1KG', nome: '  Café em grão 1 kg  ', preco: { centavos: 5990 } };

  it('cria (201 + Location), com moeda BRL por padrão e nome sem espaços nas pontas', async () => {
    const { status, json, headers } = await call('api/v1/produtos', { method: 'POST', body: novo });
    expect(status).toBe(201);
    expect(json).toMatchObject({
      sku: 'CAF-GRAO-1KG',
      nome: 'Café em grão 1 kg',
      preco: { centavos: 5990, moeda: 'BRL' },
      ativo: true,
    });
    expect(headers.get('Location')).toBe(`/api/v1/produtos/${String(json.id)}`);
    expect(catalogoSnapshot('distribuidora-aurora')).toHaveLength(13);
    // O catálogo é por tenant: o outro tenant da Ana não muda.
    expect(catalogoSnapshot('atacado-vale-verde')).toHaveLength(10);
  });

  it('409 sku-duplicado no mesmo tenant, mas o SKU pode repetir em outro tenant', async () => {
    const dup = await call('api/v1/produtos', {
      method: 'POST',
      body: { ...novo, sku: 'CAF-TOR-500' },
    });
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/sku-duplicado',
      title: 'SKU já cadastrado',
      detail: "Já existe um produto com o SKU 'CAF-TOR-500' neste tenant.",
    });
    const outro = await call('api/v1/produtos', {
      tenant: 'atacado-vale-verde',
      method: 'POST',
      body: { ...novo, sku: 'CAF-TOR-500' },
    });
    expect(outro.status).toBe(201);
  });

  it('409 limite-do-plano quando o tenant chega ao limite (GRATUITO = 20)', async () => {
    // A cerâmica (Gratuito, 19 produtos) reativada pela admin.
    resetTenantStore(
      SEED_TENANTS.map((t) => (t.id === 'ceramica-paraiba' ? { ...t, ativo: true } : t)),
    );
    const admin = { usuario: 'admin', tenant: 'ceramica-paraiba', method: 'POST' };
    expect(
      (await call('api/v1/produtos', { ...admin, body: { ...novo, sku: 'PIS-20' } })).status,
    ).toBe(201);
    const cheio = await call('api/v1/produtos', { ...admin, body: { ...novo, sku: 'PIS-21' } });
    expect(cheio.status).toBe(409);
    expect(cheio.json).toMatchObject({
      type: 'https://plataforma.dev.br/problemas/limite-do-plano',
      detail: 'O plano GRATUITO permite 20 produtos e o tenant já tem 20.',
    });
    const lista = await call('api/v1/produtos', { usuario: 'admin', tenant: 'ceramica-paraiba' });
    expect(lista.json).toMatchObject({ usados: 20, limitePlano: 20 });
  });

  it.each([
    [undefined, '[1]', 'O corpo da requisição deve ser um objeto JSON.'],
    [undefined, '{', 'O corpo da requisição deve ser um objeto JSON.'],
    [{ nome: 'X1', preco: { centavos: 1 } }, undefined, 'sku é obrigatório.'],
    [
      { sku: 'caf', nome: 'X1', preco: { centavos: 1 } },
      undefined,
      "sku inválido: 'caf'. Use de 3 a 32 caracteres: letras maiúsculas, números e hífen.",
    ],
    [{ sku: 'ABC', preco: { centavos: 1 } }, undefined, 'nome é obrigatório.'],
    [
      { sku: 'ABC', nome: 'X', preco: { centavos: 1 } },
      undefined,
      'O nome deve ter de 2 a 200 caracteres.',
    ],
    [{ sku: 'ABC', nome: 'Xy' }, undefined, 'preco é obrigatório.'],
    [
      { sku: 'ABC', nome: 'Xy', preco: { centavos: 1.5 } },
      undefined,
      'preco.centavos deve ser um inteiro maior ou igual a zero.',
    ],
    [
      { sku: 'ABC', nome: 'Xy', preco: { centavos: -1 } },
      undefined,
      'preco.centavos deve ser um inteiro maior ou igual a zero.',
    ],
    [
      { sku: 'ABC', nome: 'Xy', preco: { centavos: 1, moeda: 'real' } },
      undefined,
      'preco.moeda deve ter 3 letras maiúsculas (ex.: BRL).',
    ],
  ])('400 para corpo inválido %#', async (body, rawBody, detail) => {
    const { status, json } = await call('api/v1/produtos', { method: 'POST', body, rawBody });
    expect(status).toBe(400);
    expect(json.detail).toBe(detail);
  });
});

describe('GET, PATCH e PUT de um produto', () => {
  const primeiro = () => catalogoSnapshot('distribuidora-aurora')[0]!;

  it('obtém um produto e responde 404 para id de outro tenant', async () => {
    const p = primeiro();
    expect((await call(`api/v1/produtos/${p.id}`)).json).toEqual(p);
    const outro = await call(`api/v1/produtos/${p.id}`, { tenant: 'atacado-vale-verde' });
    expect(outro.status).toBe(404);
    expect(outro.json.detail).toBe(`Produto '${p.id}' não encontrado neste tenant.`);
  });

  it('PATCH renomeia e desativa; sem mudança, não mexe em atualizadoEm', async () => {
    const p = primeiro();
    const renomeado = await call(`api/v1/produtos/${p.id}`, {
      method: 'PATCH',
      body: { nome: ' Novo nome ', ativo: false },
    });
    expect(renomeado.json).toMatchObject({ nome: 'Novo nome', ativo: false });
    expect(renomeado.json.atualizadoEm).not.toBe(p.atualizadoEm);
    const igual = await call(`api/v1/produtos/${p.id}`, {
      method: 'PATCH',
      body: { nome: 'Novo nome' },
    });
    expect(igual.json.atualizadoEm).toBe(renomeado.json.atualizadoEm);
  });

  it.each([
    [{}, 'Informe ao menos um campo: nome ou ativo.'],
    [{ nome: 1 }, 'nome deve ser texto.'],
    [{ nome: 'x' }, 'O nome deve ter de 2 a 200 caracteres.'],
    [{ ativo: 'sim' }, 'ativo deve ser true ou false.'],
    [[], 'O corpo da requisição deve ser um objeto JSON.'],
  ])('PATCH 400 para %j', async (body, detail) => {
    const { status, json } = await call(`api/v1/produtos/${primeiro().id}`, {
      method: 'PATCH',
      body,
    });
    expect(status).toBe(400);
    expect(json.detail).toBe(detail);
  });

  it('PUT /preco troca o preço e valida o Dinheiro', async () => {
    const p = primeiro();
    const ok = await call(`api/v1/produtos/${p.id}/preco`, {
      method: 'PUT',
      body: { centavos: 0, moeda: 'BRL' },
    });
    expect(ok.json).toMatchObject({ preco: { centavos: 0, moeda: 'BRL' } });
    const ruim = await call(`api/v1/produtos/${p.id}/preco`, { method: 'PUT', body: {} });
    expect(ruim.status).toBe(400);
    expect(ruim.json.detail).toBe('preço.centavos deve ser um inteiro maior ou igual a zero.');
    const semCorpo = await call(`api/v1/produtos/${p.id}/preco`, { method: 'PUT', rawBody: 'x' });
    expect(semCorpo.json.detail).toBe('preço é obrigatório.');
  });

  it('PATCH e PUT respondem 404 para produto inexistente', async () => {
    const patch = await call('api/v1/produtos/nada', { method: 'PATCH', body: { ativo: true } });
    expect(patch.status).toBe(404);
    const put = await call('api/v1/produtos/nada/preco', {
      method: 'PUT',
      body: { centavos: 1 },
    });
    expect(put.status).toBe(404);
  });
});
