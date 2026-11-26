// Tenant Service simulado (modo demo e testes): store em memória com as mesmas regras do contrato.

import { http, HttpResponse } from 'msw';
import {
  LIMITE_PADRAO,
  isNivelIsolamento,
  isPlano,
  validateNome,
  validateTenantId,
  type Problema,
  type Tenant,
} from '../api/tenants';

/** Tenants iniciais: empresas fictícias, com os três níveis de isolamento. */
export const SEED_TENANTS: readonly Tenant[] = [
  {
    id: 'distribuidora-aurora',
    nome: 'Distribuidora Aurora de Alimentos Ltda.',
    plano: 'PROFISSIONAL',
    nivelIsolamento: 'POOL',
    ativo: true,
    criadoEm: '2026-11-25T18:42:10Z',
  },
  {
    id: 'metalurgica-serra-azul',
    nome: 'Metalúrgica Serra Azul S.A.',
    plano: 'EMPRESARIAL',
    nivelIsolamento: 'SILO',
    ativo: true,
    criadoEm: '2026-11-24T13:05:00Z',
  },
  {
    id: 'atacado-vale-verde',
    nome: 'Atacado Vale Verde',
    plano: 'EMPRESARIAL',
    nivelIsolamento: 'BRIDGE',
    ativo: true,
    criadoEm: '2026-11-22T10:30:45Z',
  },
  {
    id: 'ceramica-paraiba',
    nome: 'Cerâmica Paraíba Indústria e Comércio',
    plano: 'GRATUITO',
    nivelIsolamento: 'POOL',
    ativo: false,
    criadoEm: '2026-11-20T21:15:00Z',
  },
  {
    id: 'farmaceutica-boa-saude',
    nome: 'Farmacêutica Boa Saúde Distribuidora',
    plano: 'PROFISSIONAL',
    nivelIsolamento: 'POOL',
    ativo: true,
    criadoEm: '2026-11-18T09:00:00Z',
  },
];

let store: Tenant[] = [];

/** Volta o store para os tenants iniciais (use nos testes, em beforeEach). */
export function resetTenantStore(initial: readonly Tenant[] = SEED_TENANTS): void {
  store = initial.map((t) => ({ ...t }));
}

/** Cópia do conteúdo atual do store, na ordem da listagem (pelo id). */
export function tenantStoreSnapshot(): Tenant[] {
  return sortById(store).map((t) => ({ ...t }));
}

resetTenantStore();

/** Ordem da listagem: pelo id, como o tenant-service (o _id do MongoDB dá a ordem do cursor). */
function sortById(tenants: readonly Tenant[]): Tenant[] {
  return [...tenants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Mesmos type e title do tenant-service (ApiErrors).
const PROBLEM_TYPES: Record<400 | 404 | 409, [string, string]> = {
  400: ['requisicao-invalida', 'Requisição inválida'],
  404: ['nao-encontrado', 'Tenant não encontrado'],
  409: ['conflito', 'Tenant já existe'],
};

function problem(status: 400 | 404 | 409, detail: string, instance?: string, customTitle?: string) {
  const [type, defaultTitle] = PROBLEM_TYPES[status];
  const title = customTitle ?? defaultTitle;
  const body: Problema = {
    type: `https://plataforma.dev.br/problemas/${type}`,
    title,
    status,
    detail,
  };
  if (instance) body.instance = instance;
  return HttpResponse.json(body, {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Valida nome/plano/nível presentes no corpo; devolve a primeira mensagem de erro. */
function validateOptionalFields(body: Record<string, unknown>): string | null {
  if ('nome' in body) {
    if (typeof body.nome !== 'string') return 'nome deve ser texto.';
    const erro = validateNome(body.nome);
    if (erro) return erro;
  }
  if ('plano' in body && !isPlano(body.plano)) {
    return 'plano inválido. Use GRATUITO, PROFISSIONAL ou EMPRESARIAL.';
  }
  if ('nivelIsolamento' in body && !isNivelIsolamento(body.nivelIsolamento)) {
    return 'nivelIsolamento inválido. Use POOL, BRIDGE ou SILO.';
  }
  return null;
}

export const tenantHandlers = [
  http.get('*/api/v1/tenants', ({ request }) => {
    const params = new URL(request.url).searchParams;
    const limiteRaw = params.get('limite');
    const limite = limiteRaw === null ? LIMITE_PADRAO : Number(limiteRaw);
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
      return problem(400, 'limite deve ser um inteiro entre 1 e 100.');
    }
    const ordered = sortById(store);
    const cursor = params.get('cursor');
    let start = 0;
    if (cursor) {
      // Cursor = id do último item da página anterior.
      const index = ordered.findIndex((t) => t.id === cursor);
      if (index < 0) return problem(400, `cursor inválido: '${cursor}'.`);
      start = index + 1;
    }
    const itens = ordered.slice(start, start + limite);
    const hasMore = start + limite < ordered.length;
    return HttpResponse.json({
      itens,
      proximoCursor: hasMore ? (itens.at(-1)?.id ?? null) : null,
    });
  }),

  http.post('*/api/v1/tenants', async ({ request }) => {
    const body = await readBody(request);
    if (!body) return problem(400, 'O corpo da requisição deve ser um objeto JSON.');
    if (typeof body.id !== 'string') return problem(400, 'id é obrigatório.');
    const idError = validateTenantId(body.id);
    if (idError) return problem(400, `tenantId inválido: '${body.id}'. ${idError}`);
    if (!('nome' in body)) return problem(400, 'nome é obrigatório.');
    if (!('plano' in body)) return problem(400, 'plano é obrigatório.');
    const fieldError = validateOptionalFields(body);
    if (fieldError) return problem(400, fieldError);
    if (store.some((t) => t.id === body.id)) {
      return problem(409, `Já existe um tenant com o id '${body.id}'.`);
    }
    const tenant: Tenant = {
      id: body.id,
      nome: (body.nome as string).trim(),
      plano: body.plano as Tenant['plano'],
      nivelIsolamento: (body.nivelIsolamento as Tenant['nivelIsolamento'] | undefined) ?? 'POOL',
      ativo: true,
      criadoEm: new Date().toISOString(),
    };
    store.push(tenant);
    return HttpResponse.json(tenant, {
      status: 201,
      headers: { Location: `/api/v1/tenants/${tenant.id}` },
    });
  }),

  http.get('*/api/v1/tenants/:id', ({ params }) => {
    const id = String(params.id);
    const tenant = store.find((t) => t.id === id);
    if (!tenant) return problem(404, `Tenant '${id}' não encontrado.`, `/api/v1/tenants/${id}`);
    return HttpResponse.json({ ...tenant });
  }),

  http.patch('*/api/v1/tenants/:id', async ({ request, params }) => {
    const id = String(params.id);
    const tenant = store.find((t) => t.id === id);
    if (!tenant) return problem(404, `Tenant '${id}' não encontrado.`, `/api/v1/tenants/${id}`);
    const body = await readBody(request);
    if (!body) return problem(400, 'O corpo da requisição deve ser um objeto JSON.');
    const known = ['nome', 'plano', 'nivelIsolamento', 'ativo'].filter((k) => k in body);
    if (known.length === 0) {
      return problem(400, 'Informe ao menos um campo: nome, plano, nivelIsolamento ou ativo.');
    }
    const fieldError = validateOptionalFields(body);
    if (fieldError) return problem(400, fieldError);
    if ('ativo' in body && typeof body.ativo !== 'boolean') {
      return problem(400, 'ativo deve ser true ou false.');
    }
    if (
      isNivelIsolamento(body.nivelIsolamento) &&
      body.nivelIsolamento !== tenant.nivelIsolamento
    ) {
      // Como no tenant-service: trocar de nível é uma migração (Dia 9), não um PATCH.
      return problem(
        409,
        `O nível de isolamento de '${id}' não muda por PATCH: a migração entre níveis chega no Dia 9.`,
        `/api/v1/tenants/${id}`,
        'Mudança de nível não suportada',
      );
    }
    if (typeof body.nome === 'string') tenant.nome = body.nome.trim();
    if (isPlano(body.plano)) tenant.plano = body.plano;
    if (typeof body.ativo === 'boolean') tenant.ativo = body.ativo;
    return HttpResponse.json({ ...tenant });
  }),
];
