// Cliente e tipos do contrato do Catálogo (libs/contracts/.../openapi/catalogo.yaml).
//
// Toda chamada passa pelo gateway com o token e o X-Tenant-Id do tenant escolhido (apiFetch).
// Leitura: qualquer usuário do tenant (comprador vê só ativos). Escrita: gestor-tenant ou
// plataforma-admin.

import { ApiError, PROBLEM_BASE, apiFetch, apiUrl, readJson } from './http';
import type { Papel } from './me';

/** Dinheiro do _comum.yaml: valor em centavos (inteiro) e moeda ISO 4217. */
export interface Dinheiro {
  centavos: number;
  moeda: string;
}

export interface Produto {
  id: string;
  sku: string;
  nome: string;
  preco: Dinheiro;
  ativo: boolean;
  /** Data-hora ISO 8601 (opcional no contrato). */
  criadoEm?: string;
  atualizadoEm?: string;
}

export interface NovoProduto {
  sku: string;
  nome: string;
  preco: Dinheiro;
}

/** PATCH: ao menos um campo (minProperties: 1). */
export interface AlteracaoProduto {
  nome?: string;
  ativo?: boolean;
}

export interface PaginaProdutos {
  itens: Produto[];
  proximoCursor: string | null;
  /** Produtos que atendem ao filtro (todas as páginas). */
  total: number;
  /** Máximo de produtos do plano do tenant (ativos e inativos). */
  limitePlano: number;
  /** Produtos cadastrados no tenant, ativos e inativos. */
  usados: number;
}

export interface FiltroProdutos {
  /** Trecho do nome ou do SKU (sem diferenciar maiúsculas). */
  busca?: string;
  /** Só para gestores; compradores sempre veem os ativos. */
  ativo?: boolean;
}

export const LIMITE_PADRAO = 20;
export const MOEDA_PADRAO = 'BRL';

/** Limite de produtos por plano (descrição do contrato). */
export const LIMITE_PRODUTOS_POR_PLANO = {
  GRATUITO: 20,
  PROFISSIONAL: 500,
  EMPRESARIAL: 10000,
} as const;

/** `type` dos Problem Details que a tela destaca. */
export const PROBLEMA_SKU_DUPLICADO = `${PROBLEM_BASE}sku-duplicado`;
export const PROBLEMA_LIMITE_DO_PLANO = `${PROBLEM_BASE}limite-do-plano`;

/** Quem pode criar e alterar produtos. */
export function podeGerirCatalogo(papeis: readonly Papel[]): boolean {
  return papeis.includes('gestor-tenant') || papeis.includes('plataforma-admin');
}

// ---- Validação (as mesmas regras do contrato) ----

/** Mesmo padrão de `NovoProduto.sku`. */
export const SKU_PATTERN = /^[A-Z0-9-]{3,32}$/;
export const NOME_PRODUTO_MIN = 2;
export const NOME_PRODUTO_MAX = 200;
export const BUSCA_MAX = 100;

export function validateSku(sku: string): string | null {
  if (sku.length === 0) return 'Informe o SKU.';
  if (!SKU_PATTERN.test(sku)) {
    return 'Use de 3 a 32 caracteres: letras maiúsculas, números e hífen.';
  }
  return null;
}

export function validateNomeProduto(nome: string): string | null {
  const tamanho = nome.trim().length;
  if (tamanho === 0) return 'Informe o nome do produto.';
  if (tamanho < NOME_PRODUTO_MIN || tamanho > NOME_PRODUTO_MAX) {
    return `O nome deve ter de ${NOME_PRODUTO_MIN} a ${NOME_PRODUTO_MAX} caracteres.`;
  }
  return null;
}

/** Até 13 dígitos de reais: centavos continuam abaixo de Number.MAX_SAFE_INTEGER. */
const REAIS_MAX_DIGITOS = 13;

export type ReaisConvertidos = { centavos: number } | { erro: string };

/**
 * Converte o preço digitado em reais ("12,90", "R$ 1.234,5", "12.90", "15") em centavos, só com
 * aritmética de inteiros sobre os dígitos (sem ponto flutuante). Vírgula é o separador decimal;
 * pontos são de milhar quando formam grupos de 3 dígitos ("1.234"), senão um ponto único com 1 ou
 * 2 casas é aceito como decimal ("12.9").
 */
export function reaisParaCentavos(texto: string): ReaisConvertidos {
  const limpo = texto.replace(/R\$/i, '').replace(/[\s ]/g, '');
  if (limpo.length === 0) return { erro: 'Informe o preço.' };
  if (limpo.startsWith('-')) return { erro: 'O preço não pode ser negativo.' };

  let inteiro: string;
  let fracao = '';
  if (limpo.includes(',')) {
    const partes = limpo.split(',');
    if (partes.length !== 2) return { erro: 'Use só uma vírgula, antes dos centavos.' };
    [inteiro, fracao] = partes as [string, string];
    if (/\./.test(inteiro) && !/^\d{1,3}(\.\d{3})+$/.test(inteiro)) {
      return { erro: 'Pontos só separam milhares (ex.: 1.234,56).' };
    }
    inteiro = inteiro.replace(/\./g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
    inteiro = limpo.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(limpo)) {
    [inteiro, fracao] = limpo.split('.') as [string, string];
  } else {
    inteiro = limpo;
  }

  if (inteiro === '') inteiro = '0';
  if (!/^\d+$/.test(inteiro) || !/^\d*$/.test(fracao)) {
    return { erro: 'Digite o preço em reais, ex.: 12,90.' };
  }
  if (fracao.length > 2) return { erro: 'Use no máximo duas casas decimais.' };
  const digitos = inteiro.replace(/^0+(?=\d)/, '');
  if (digitos.length > REAIS_MAX_DIGITOS) return { erro: 'Preço alto demais.' };
  return { centavos: Number(digitos) * 100 + Number(fracao.padEnd(2, '0')) };
}

/** Centavos como texto editável em reais, sem símbolo: 1290 -> "12,90"; 5 -> "0,05". */
export function centavosParaTexto(centavos: number): string {
  const texto = String(Math.trunc(Math.abs(centavos))).padStart(3, '0');
  return `${texto.slice(0, -2)},${texto.slice(-2)}`;
}

const formatadores = new Map<string, Intl.NumberFormat>();

/** Ex.: { centavos: 123456, moeda: 'BRL' } -> 'R$ 1.234,56' (com espaço não separável). */
export function formatDinheiro({ centavos, moeda }: Dinheiro): string {
  let formatador = formatadores.get(moeda);
  if (!formatador) {
    try {
      formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda });
    } catch {
      formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: MOEDA_PADRAO });
    }
    formatadores.set(moeda, formatador);
  }
  return formatador.format(centavos / 100);
}

// ---- Guardas do formato das respostas ----

function isDinheiro(value: unknown): value is Dinheiro {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.centavos === 'number' &&
    Number.isInteger(d.centavos) &&
    d.centavos >= 0 &&
    typeof d.moeda === 'string'
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

export function isProduto(value: unknown): value is Produto {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.sku === 'string' &&
    typeof p.nome === 'string' &&
    isDinheiro(p.preco) &&
    typeof p.ativo === 'boolean' &&
    optionalString(p.criadoEm) &&
    optionalString(p.atualizadoEm)
  );
}

function isPaginaProdutos(value: unknown): value is PaginaProdutos {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    Array.isArray(p.itens) &&
    p.itens.every(isProduto) &&
    optionalString(p.proximoCursor) &&
    Number.isInteger(p.total) &&
    Number.isInteger(p.limitePlano) &&
    Number.isInteger(p.usados)
  );
}

// ---- Cliente HTTP ----

/** URL absoluta de /api/v1/produtos (ou de um produto; `sub` = 'preco' para o PUT). */
export function produtosUrl(
  id?: string,
  sub?: 'preco',
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
): string {
  let path = 'api/v1/produtos';
  if (id !== undefined) path += `/${encodeURIComponent(id)}`;
  if (id !== undefined && sub) path += `/${sub}`;
  return apiUrl(path, baseUrl, origin);
}

const ACCEPT = 'application/json, application/problem+json';
const JSON_HEADERS = { Accept: ACCEPT, 'Content-Type': 'application/json' };

/** GET /api/v1/produtos?limite=&cursor=&busca=&ativo= — uma página do catálogo do tenant. */
export async function listProdutos(
  options: FiltroProdutos & { cursor?: string | null; limite?: number; signal?: AbortSignal } = {},
): Promise<PaginaProdutos> {
  const url = new URL(produtosUrl());
  url.searchParams.set('limite', String(options.limite ?? LIMITE_PADRAO));
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  const busca = options.busca?.trim();
  if (busca) url.searchParams.set('busca', busca);
  if (options.ativo !== undefined) url.searchParams.set('ativo', String(options.ativo));
  const response = await apiFetch(url, { headers: { Accept: ACCEPT }, signal: options.signal });
  const pagina = await readJson(response, isPaginaProdutos);
  return { ...pagina, proximoCursor: pagina.proximoCursor ?? null };
}

/** GET /api/v1/produtos/{id}. */
export async function getProduto(id: string): Promise<Produto> {
  const response = await apiFetch(produtosUrl(id), { headers: { Accept: ACCEPT } });
  return readJson(response, isProduto);
}

/** POST /api/v1/produtos — 201; 409 com `sku-duplicado` ou `limite-do-plano`. */
export async function createProduto(novo: NovoProduto): Promise<Produto> {
  const response = await apiFetch(produtosUrl(), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(novo),
  });
  return readJson(response, isProduto);
}

/** PATCH /api/v1/produtos/{id} — renomeia, ativa ou desativa. */
export async function updateProduto(id: string, alteracao: AlteracaoProduto): Promise<Produto> {
  const response = await apiFetch(produtosUrl(id), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(alteracao),
  });
  return readJson(response, isProduto);
}

/** PUT /api/v1/produtos/{id}/preco — corpo é um Dinheiro. */
export async function updatePreco(id: string, preco: Dinheiro): Promise<Produto> {
  const response = await apiFetch(produtosUrl(id, 'preco'), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(preco),
  });
  return readJson(response, isProduto);
}

/** Mensagem legível em pt-BR para qualquer falha (rede vira "não foi possível conectar"). */
export function describeProdutoError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar ao catalogo-service.';
}

/** `type` do Problem Details do erro, se houver. */
export function problemTypeOf(error: unknown): string | null {
  return error instanceof ApiError ? error.problemType : null;
}
