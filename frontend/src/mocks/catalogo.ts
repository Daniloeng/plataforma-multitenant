// Catalogo-service simulado (modo demo e testes): store em memória por tenant, atrás do gateway
// simulado, com as regras do contrato catalogo.yaml.

import { http, HttpResponse } from 'msw';
import {
  BUSCA_MAX,
  LIMITE_PADRAO,
  LIMITE_PRODUTOS_POR_PLANO,
  MOEDA_PADRAO,
  podeGerirCatalogo,
  validateNomeProduto,
  validateSku,
  type Dinheiro,
  type Produto,
} from '../api/catalogo';
import type { Tenant } from '../api/tenants';
import type { DemoUser } from '../auth/demoUsers';
import { guard, problemResponse } from './gateway';

type Seed = readonly [sku: string, nome: string, centavos: number, ativo?: boolean];

/** Produtos B2B fictícios de cada tenant de demonstração. */
const SEEDS: Record<string, readonly Seed[]> = {
  'distribuidora-aurora': [
    ['ARZ-T1-5KG', 'Arroz agulhinha tipo 1 — fardo 6 × 5 kg', 15990],
    ['FEJ-CAR-1KG', 'Feijão carioca tipo 1 — fardo 10 × 1 kg', 8990],
    ['ACU-CRI-5KG', 'Açúcar cristal — fardo 6 × 5 kg', 11450],
    ['OLE-SOJ-900', 'Óleo de soja 900 ml — caixa com 20', 15600],
    ['CAF-TOR-500', 'Café torrado e moído 500 g — caixa com 20', 39800],
    ['MAC-ESP-500', 'Macarrão espaguete 500 g — fardo com 20', 7380],
    ['LEI-UHT-1L', 'Leite UHT integral 1 L — caixa com 12', 6588],
    ['FAR-TRI-1KG', 'Farinha de trigo tipo 1 — fardo 10 × 1 kg', 5290],
    ['SAL-REF-1KG', 'Sal refinado iodado — fardo 10 × 1 kg', 2190, false],
    ['EXT-TOM-340', 'Extrato de tomate 340 g — caixa com 24', 8160],
    ['BIS-MRI-400', 'Biscoito Maria 400 g — caixa com 20', 9800, false],
    ['MOL-SHO-150', 'Molho shoyu 150 ml — caixa com 24', 7440],
  ],
  'atacado-vale-verde': [
    ['DET-LIQ-500', 'Detergente líquido neutro 500 ml — caixa com 24', 4680],
    ['PAP-HIG-F30', 'Papel higiênico folha dupla — fardo com 64 rolos', 12990],
    ['SAB-PO-1KG', 'Sabão em pó 1 kg — caixa com 20', 18900],
    ['AGU-SAN-2L', 'Água sanitária 2 L — caixa com 6', 3540],
    ['DES-PIN-2L', 'Desinfetante pinho 2 L — caixa com 6', 5370],
    ['ESP-MUL-10', 'Esponja multiuso — pacote com 10 (caixa com 20)', 11800],
    ['SAC-LIX-100', 'Saco de lixo 100 L reforçado — pacote com 100', 8990],
    ['LUV-NIT-M', 'Luva nitrílica tamanho M — caixa com 100', 3290],
    ['PAN-MUL-50', 'Pano multiuso — rolo com 50 panos', 2750, false],
    ['COP-DES-200', 'Copo descartável 200 ml — caixa com 2.500', 18500],
  ],
  'farmaceutica-boa-saude': [
    ['DIP-500-CX10', 'Dipirona 500 mg — caixa com 10 comprimidos (lote de 50)', 22450],
    ['PAR-750-CX20', 'Paracetamol 750 mg — caixa com 20 comprimidos (lote de 50)', 31900],
    ['SOR-FIS-500', 'Soro fisiológico 0,9% 500 ml — caixa com 24', 9360],
    ['ALC-GEL-70', 'Álcool em gel 70% 500 g — caixa com 12', 10680],
    ['LUV-PRO-M', 'Luva de procedimento látex M — caixa com 100', 2890],
    ['MAS-TRI-50', 'Máscara tripla descartável — caixa com 50', 1490],
    ['SER-5ML-100', 'Seringa descartável 5 ml — caixa com 100', 4250],
    ['GAZ-EST-10', 'Gaze estéril 7,5 × 7,5 cm — pacote com 10 (caixa com 50)', 3990],
    ['ESP-ALG-500', 'Algodão hidrófilo 500 g — fardo com 10', 12900, false],
    ['TER-DIG-01', 'Termômetro clínico digital — caixa com 10', 15900],
  ],
  'metalurgica-serra-azul': [
    ['PAR-SXT-M8', 'Parafuso sextavado M8 × 30 zincado — caixa com 500', 18900],
    ['POR-SXT-M8', 'Porca sextavada M8 zincada — caixa com 1.000', 9900],
    ['ARR-LIS-M8', 'Arruela lisa M8 — caixa com 1.000', 4900],
    ['CHA-ACO-3MM', 'Chapa de aço carbono 3 mm 1.000 × 2.000 mm', 68500],
    ['TUB-QUA-30', 'Tubo quadrado 30 × 30 × 1,5 mm — barra de 6 m', 8790],
    ['CAN-L-1POL', 'Cantoneira L 1" × 1/8" — barra de 6 m', 6490],
    ['ELE-6013-25', 'Eletrodo 6013 2,5 mm — pacote de 5 kg', 14500],
    ['DIS-COR-115', 'Disco de corte 115 mm — caixa com 25', 7250, false],
  ],
  // Suspenso no cadastro (o gateway responde 403); 19 produtos para quem reativar e testar o limite
  // do plano Gratuito (20).
  'ceramica-paraiba': Array.from({ length: 19 }, (_, i): Seed => [
    `PIS-${String(i + 1).padStart(2, '0')}`,
    `Piso cerâmico 45 × 45 cm — modelo ${i + 1} (caixa 2,5 m²)`,
    3990 + i * 150,
  ]),
};

const SEED_DATE = Date.UTC(2026, 10, 26, 9, 0, 0);

function seedProdutos(tenantId: string): Produto[] {
  return (SEEDS[tenantId] ?? []).map(([sku, nome, centavos, ativo = true], i) => {
    const data = new Date(SEED_DATE - i * 3_600_000).toISOString();
    return {
      id: `prd-${tenantId}-${String(i + 1).padStart(3, '0')}`,
      sku,
      nome,
      preco: { centavos, moeda: MOEDA_PADRAO },
      ativo,
      criadoEm: data,
      atualizadoEm: data,
    };
  });
}

/** Banco por tenant (como o catálogo: tudo filtrado por tenantId). */
let store = new Map<string, Produto[]>();
let sequence = 0;

/** Volta ao catálogo inicial; `initial` troca o catálogo de alguns tenants (testes). */
export function resetCatalogoStore(initial: Record<string, readonly Produto[]> = {}): void {
  store = new Map(Object.entries(initial).map(([t, ps]) => [t, ps.map((p) => ({ ...p }))]));
  sequence = 0;
}

function produtosDo(tenantId: string): Produto[] {
  let produtos = store.get(tenantId);
  if (!produtos) {
    produtos = seedProdutos(tenantId);
    store.set(tenantId, produtos);
  }
  return produtos;
}

/** Cópia do catálogo de um tenant, na ordem da listagem (pelo SKU). */
export function catalogoSnapshot(tenantId: string): Produto[] {
  return ordenados(produtosDo(tenantId)).map((p) => ({ ...p, preco: { ...p.preco } }));
}

function ordenados(produtos: readonly Produto[]): Produto[] {
  return [...produtos].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
}

function copia(produto: Produto): Produto {
  return { ...produto, preco: { ...produto.preco } };
}

// ---- Respostas de erro (Problem Details) ----

const invalida = (detail: string) =>
  problemResponse(400, 'requisicao-invalida', 'Requisição inválida', detail);

const naoEncontrado = (id: string) =>
  problemResponse(
    404,
    'nao-encontrado',
    'Produto não encontrado',
    `Produto '${id}' não encontrado neste tenant.`,
  );

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

/** Valida um Dinheiro do corpo; devolve o valor ou a mensagem de erro. */
function readDinheiro(value: unknown, campo: string): Dinheiro | string {
  if (typeof value !== 'object' || value === null) return `${campo} é obrigatório.`;
  const d = value as Record<string, unknown>;
  if (typeof d.centavos !== 'number' || !Number.isSafeInteger(d.centavos) || d.centavos < 0) {
    return `${campo}.centavos deve ser um inteiro maior ou igual a zero.`;
  }
  const moeda = d.moeda ?? MOEDA_PADRAO;
  if (typeof moeda !== 'string' || !/^[A-Z]{3}$/.test(moeda)) {
    return `${campo}.moeda deve ter 3 letras maiúsculas (ex.: BRL).`;
  }
  return { centavos: d.centavos, moeda };
}

// ---- Gateway: token, tenant e papel ----

type Acesso = { user: DemoUser; tenant: Tenant; gestor: boolean } | { response: Response };

function acesso(request: Request, escrita = false): Acesso {
  const result = guard(request, { rateLimit: true });
  if ('response' in result) return result;
  if (!result.tenant) {
    return { response: invalida('O cabeçalho X-Tenant-Id é obrigatório.') };
  }
  const gestor = podeGerirCatalogo(result.user.papeis);
  if (escrita && !gestor) {
    return {
      response: problemResponse(
        403,
        'acesso-negado',
        'Acesso negado',
        'Alterar o catálogo exige o papel gestor-tenant ou plataforma-admin.',
      ),
    };
  }
  return { user: result.user, tenant: result.tenant, gestor };
}

/** Produto do tenant visível para o usuário (comprador não enxerga inativos). */
function encontra(tenantId: string, id: string, gestor: boolean): Produto | undefined {
  return produtosDo(tenantId).find((p) => p.id === id && (gestor || p.ativo));
}

export const catalogoHandlers = [
  http.get('*/api/v1/produtos', ({ request }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const params = new URL(request.url).searchParams;

    const limiteRaw = params.get('limite');
    const limite = limiteRaw === null ? LIMITE_PADRAO : Number(limiteRaw);
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
      return invalida('limite deve ser um inteiro entre 1 e 100.');
    }
    const busca = (params.get('busca') ?? '').trim().toLocaleLowerCase('pt-BR');
    if (busca.length > BUSCA_MAX) {
      return invalida(`busca deve ter no máximo ${BUSCA_MAX} caracteres.`);
    }
    const ativoRaw = params.get('ativo');
    if (ativoRaw !== null && ativoRaw !== 'true' && ativoRaw !== 'false') {
      return invalida('ativo deve ser true ou false.');
    }
    // Compradores sempre veem só os ativos, qualquer que seja o filtro pedido.
    const ativo = a.gestor ? (ativoRaw === null ? null : ativoRaw === 'true') : true;

    const todos = produtosDo(a.tenant.id);
    const filtrados = ordenados(todos).filter(
      (p) =>
        (ativo === null || p.ativo === ativo) &&
        (busca === '' ||
          p.nome.toLocaleLowerCase('pt-BR').includes(busca) ||
          p.sku.toLowerCase().includes(busca)),
    );

    let inicio = 0;
    const cursor = params.get('cursor');
    if (cursor) {
      // Cursor = id do último produto da página anterior; a próxima começa depois do SKU dele.
      const ultimo = todos.find((p) => p.id === cursor);
      if (!ultimo) return invalida(`cursor inválido: '${cursor}'.`);
      inicio = filtrados.findIndex((p) => p.sku > ultimo.sku);
      if (inicio < 0) inicio = filtrados.length;
    }
    const itens = filtrados.slice(inicio, inicio + limite);
    const temMais = inicio + limite < filtrados.length;
    return HttpResponse.json({
      itens: itens.map(copia),
      proximoCursor: temMais ? (itens.at(-1)?.id ?? null) : null,
      total: filtrados.length,
      limitePlano: LIMITE_PRODUTOS_POR_PLANO[a.tenant.plano],
      plano: a.tenant.plano,
      usados: todos.length,
    });
  }),

  http.post('*/api/v1/produtos', async ({ request }) => {
    const a = acesso(request, true);
    if ('response' in a) return a.response;
    const body = await readBody(request);
    if (!body) return invalida('O corpo da requisição deve ser um objeto JSON.');
    if (typeof body.sku !== 'string') return invalida('sku é obrigatório.');
    const skuErro = validateSku(body.sku);
    if (skuErro) return invalida(`sku inválido: '${body.sku}'. ${skuErro}`);
    if (typeof body.nome !== 'string') return invalida('nome é obrigatório.');
    const nomeErro = validateNomeProduto(body.nome);
    if (nomeErro) return invalida(nomeErro);
    const preco = readDinheiro(body.preco, 'preco');
    if (typeof preco === 'string') return invalida(preco);

    const produtos = produtosDo(a.tenant.id);
    if (produtos.some((p) => p.sku === body.sku)) {
      return problemResponse(
        409,
        'sku-duplicado',
        'SKU já cadastrado',
        `Já existe um produto com o SKU '${body.sku}' neste tenant.`,
      );
    }
    const limite = LIMITE_PRODUTOS_POR_PLANO[a.tenant.plano];
    if (produtos.length >= limite) {
      return problemResponse(
        409,
        'limite-do-plano',
        'Limite do plano atingido',
        `O plano ${a.tenant.plano} permite ${limite} produtos e o tenant já tem ${produtos.length}.`,
      );
    }
    sequence += 1;
    const agora = new Date().toISOString();
    const produto: Produto = {
      id: `prd-${a.tenant.id}-n${String(sequence).padStart(3, '0')}`,
      sku: body.sku,
      nome: body.nome.trim(),
      preco,
      ativo: true,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    produtos.push(produto);
    return HttpResponse.json(copia(produto), {
      status: 201,
      headers: { Location: `/api/v1/produtos/${produto.id}` },
    });
  }),

  http.get('*/api/v1/produtos/:id', ({ request, params }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const id = String(params.id);
    const produto = encontra(a.tenant.id, id, a.gestor);
    return produto ? HttpResponse.json(copia(produto)) : naoEncontrado(id);
  }),

  http.patch('*/api/v1/produtos/:id', async ({ request, params }) => {
    const a = acesso(request, true);
    if ('response' in a) return a.response;
    const id = String(params.id);
    const produto = encontra(a.tenant.id, id, true);
    if (!produto) return naoEncontrado(id);
    const body = await readBody(request);
    if (!body) return invalida('O corpo da requisição deve ser um objeto JSON.');
    if (!('nome' in body) && !('ativo' in body)) {
      return invalida('Informe ao menos um campo: nome ou ativo.');
    }
    if ('nome' in body) {
      if (typeof body.nome !== 'string') return invalida('nome deve ser texto.');
      const erro = validateNomeProduto(body.nome);
      if (erro) return invalida(erro);
    }
    if ('ativo' in body && typeof body.ativo !== 'boolean') {
      return invalida('ativo deve ser true ou false.');
    }
    const nome = typeof body.nome === 'string' ? body.nome.trim() : produto.nome;
    const ativo = typeof body.ativo === 'boolean' ? body.ativo : produto.ativo;
    // Sem mudança, sem evento (e sem nova data de atualização).
    if (nome !== produto.nome || ativo !== produto.ativo) {
      produto.nome = nome;
      produto.ativo = ativo;
      produto.atualizadoEm = new Date().toISOString();
    }
    return HttpResponse.json(copia(produto));
  }),

  http.put('*/api/v1/produtos/:id/preco', async ({ request, params }) => {
    const a = acesso(request, true);
    if ('response' in a) return a.response;
    const id = String(params.id);
    const produto = encontra(a.tenant.id, id, true);
    if (!produto) return naoEncontrado(id);
    const preco = readDinheiro(await readBody(request), 'preço');
    if (typeof preco === 'string') return invalida(preco);
    produto.preco = preco;
    produto.atualizadoEm = new Date().toISOString();
    return HttpResponse.json(copia(produto));
  }),
];

/** Para os testes: todos os SKUs de exemplo seguem o padrão do contrato. */
export function seedSkus(): string[] {
  return Object.values(SEEDS).flatMap((seeds) => seeds.map(([sku]) => sku));
}
