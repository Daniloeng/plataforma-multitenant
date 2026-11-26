// Pagamentos-service simulado (modo demo e testes), com as regras do pagamentos-service do Dia 7:
//
// - pedido.criado agenda a cobrança no gateway simulado para COBRANCA_ATRASO_MS (1,2 s) depois.
//   Não há setTimeout: a cobrança vencida é processada no começo de cada requisição aos pedidos e
//   aos pagamentos (`processarCobrancas`). Assim a tela que consulta de novo (o poll do detalhe do
//   pedido) vê a confirmação chegar, nada fica rodando entre os testes, e nos testes os timers
//   falsos do Vitest (que também falsificam o Date) controlam quando a cobrança acontece.
// - Gateway simulado: aprova até LIMITE_APROVACAO_CENTAVOS (R$ 10.000,00) e recusa acima.
//   Aprovado: pagamento APROVADO, lançamentos de captura (débito CAIXA_GATEWAY + crédito
//   RECEITA_TENANT) e pedido CONFIRMADO com o pagamentoId. Recusado: pagamento RECUSADO com o
//   motivo, sem lançamentos, e pedido CANCELADO por PAGAMENTO_RECUSADO.
// - Pedido cancelado antes da cobrança nunca é cobrado; pedido CONFIRMADO cancelado é estornado:
//   pagamento ESTORNADO, lançamentos de estorno (débito ESTORNOS + crédito CAIXA_GATEWAY) e, como o
//   evento pagamento.estornado, o marco ESTORNADO no histórico do pedido (`aplicarEstorno`).
// - Saldo = créditos em RECEITA_TENANT − débitos em ESTORNOS (a receita líquida do tenant), na
//   moeda pedida (`moeda`, padrão BRL), como no backend: moedas diferentes nunca são somadas.
// - Listas do mais recente para o mais antigo, cursor = id do último item da página.

import { http, HttpResponse } from 'msw';
import {
  LIMITE_PADRAO,
  isStatusPagamento,
  veFinanceiro,
  type Conta,
  type Lancamento,
  type Natureza,
  type Pagamento,
} from '../api/pagamentos';
import { MOEDA_PADRAO } from '../api/catalogo';
import type { Pedido } from '../api/pedidos';
import { guard, problemResponse } from './gateway';
import {
  MOTIVO_RECUSA_LIMITE,
  aplicarEstorno,
  aplicarPagamento,
  assinarPedidos,
  pedidosSnapshot,
} from './pedidos';

/** Atraso entre o pedido.criado e a cobrança no gateway simulado. */
export const COBRANCA_ATRASO_MS = 1200;
/** O gateway simulado aprova até R$ 10.000,00 (em centavos) e recusa acima. */
export const LIMITE_APROVACAO_CENTAVOS = 1_000_000;
/** Motivo da recusa acima do limite (definido no pedidos simulado, que o cita no histórico). */
export { MOTIVO_RECUSA_LIMITE };

interface Cobranca {
  tenantId: string;
  pedido: Pedido;
  venceEm: number;
}

interface Livro {
  /** Do mais recente para o mais antigo. */
  pagamentos: Pagamento[];
  /** Do mais recente para o mais antigo. */
  lancamentos: Lancamento[];
}

let livros = new Map<string, Livro>();
let agenda: Cobranca[] = [];
let sequence = 0;

/** Volta aos dados iniciais (derivados dos pedidos de exemplo) e esvazia a agenda de cobranças. */
export function resetPagamentosStore(): void {
  livros = new Map();
  agenda = [];
  sequence = 0;
}

function novoId(prefixo: 'pag' | 'lan'): string {
  sequence += 1;
  return `${prefixo}-n${String(sequence).padStart(5, '0')}`;
}

/** Partida dobrada: débito numa conta e crédito na outra, mesmo valor e mesmo instante. */
function lancar(
  livro: Livro,
  pagamento: Pagamento,
  debito: Conta,
  credito: Conta,
  ocorridoEm: string,
  ids: readonly [string, string],
): void {
  const base = { pagamentoId: pagamento.id, pedidoId: pagamento.pedidoId, ocorridoEm };
  const linha = (id: string, conta: Conta, natureza: Natureza): Lancamento => ({
    ...base,
    id,
    conta,
    natureza,
    valor: { ...pagamento.valor },
  });
  // Mais recente primeiro: no extrato o débito aparece logo acima do crédito.
  livro.lancamentos.unshift(linha(ids[0], debito, 'DEBITO'), linha(ids[1], credito, 'CREDITO'));
}

const porData =
  <T>(campo: (x: T) => string) =>
  (a: T, b: T) =>
    Date.parse(campo(b)) - Date.parse(campo(a));

/** Pagamentos e lançamentos coerentes com os pedidos de exemplo do tenant. */
function seedLivro(tenantId: string): Livro {
  const livro: Livro = { pagamentos: [], lancamentos: [] };
  // Do mais antigo para o mais recente, como os eventos aconteceram.
  for (const pedido of [...pedidosSnapshot(tenantId)].reverse()) {
    const recusado = pedido.motivoCancelamento === 'PAGAMENTO_RECUSADO';
    if (!pedido.pagamentoId && !recusado) continue; // pendente ou cancelado antes da cobrança
    const id = pedido.pagamentoId ?? pedido.id.replace(/^ped-/, 'pag-');
    const cobradoEm = new Date(Date.parse(pedido.criadoEm) + COBRANCA_ATRASO_MS).toISOString();
    // Pago e cancelado: estornado se o histórico já tem o estorno (ou, sem histórico, sempre).
    // Cancelado agora há pouco, ainda sem ESTORNADO, o pagamento segue APROVADO e o estorno vem do
    // pedido.cancelado que está chegando (o livro é montado sob demanda, às vezes nesse momento).
    const estornado =
      pedido.status === 'CANCELADO' &&
      !recusado &&
      (pedido.historico?.some((m) => m.tipo === 'ESTORNADO') ?? true);
    const pagamento: Pagamento = {
      id,
      pedidoId: pedido.id,
      clienteId: pedido.clienteId,
      status: recusado ? 'RECUSADO' : estornado ? 'ESTORNADO' : 'APROVADO',
      valor: { ...pedido.total },
      motivoRecusa: recusado ? MOTIVO_RECUSA_LIMITE : null,
      criadoEm: cobradoEm,
      atualizadoEm: estornado ? (pedido.atualizadoEm ?? cobradoEm) : cobradoEm,
    };
    livro.pagamentos.push(pagamento);
    if (recusado) continue;
    const sufixo = id.replace(/^pag-/, '');
    lancar(livro, pagamento, 'CAIXA_GATEWAY', 'RECEITA_TENANT', cobradoEm, [
      `lan-${sufixo}-1`,
      `lan-${sufixo}-2`,
    ]);
    if (estornado) {
      lancar(livro, pagamento, 'ESTORNOS', 'CAIXA_GATEWAY', pagamento.atualizadoEm!, [
        `lan-${sufixo}-3`,
        `lan-${sufixo}-4`,
      ]);
    }
  }
  livro.pagamentos.sort(porData((p) => p.criadoEm));
  livro.lancamentos.sort(porData((l) => l.ocorridoEm));
  return livro;
}

function livroDo(tenantId: string): Livro {
  let livro = livros.get(tenantId);
  if (!livro) {
    livro = seedLivro(tenantId);
    livros.set(tenantId, livro);
  }
  return livro;
}

/** Cópias dos pagamentos e lançamentos de um tenant (do mais recente para o mais antigo). */
export function pagamentosSnapshot(tenantId: string): Livro {
  const livro = livroDo(tenantId);
  return {
    pagamentos: livro.pagamentos.map((p) => ({ ...p, valor: { ...p.valor } })),
    lancamentos: livro.lancamentos.map((l) => ({ ...l, valor: { ...l.valor } })),
  };
}

/** Receita líquida: créditos em RECEITA_TENANT menos débitos em ESTORNOS. */
export function saldoDe(
  lancamentos: readonly Lancamento[],
  moeda: string = MOEDA_PADRAO,
): Lancamento['valor'] {
  let centavos = 0;
  for (const l of lancamentos) {
    if (l.valor.moeda !== moeda) continue; // moedas diferentes nunca são somadas
    if (l.conta === 'RECEITA_TENANT' && l.natureza === 'CREDITO') centavos += l.valor.centavos;
    if (l.conta === 'ESTORNOS' && l.natureza === 'DEBITO') centavos -= l.valor.centavos;
  }
  return { centavos, moeda };
}

/** Cobrança no gateway simulado: aprova até o limite, recusa acima. */
function cobrar({ tenantId, pedido, venceEm }: Cobranca): void {
  const livro = livroDo(tenantId);
  const quando = new Date(venceEm).toISOString();
  const aprovado = pedido.total.centavos <= LIMITE_APROVACAO_CENTAVOS;
  const pagamento: Pagamento = {
    id: novoId('pag'),
    pedidoId: pedido.id,
    clienteId: pedido.clienteId,
    status: aprovado ? 'APROVADO' : 'RECUSADO',
    valor: { ...pedido.total },
    motivoRecusa: aprovado ? null : MOTIVO_RECUSA_LIMITE,
    criadoEm: quando,
    atualizadoEm: quando,
  };
  // Só pedido PENDENTE é cobrado (no máximo uma vez): cancelado antes da cobrança nunca é.
  const resultado = aprovado
    ? ({ aprovado: true, pagamentoId: pagamento.id } as const)
    : ({ aprovado: false, motivo: MOTIVO_RECUSA_LIMITE } as const);
  if (!aplicarPagamento(tenantId, pedido.id, resultado, quando)) return;
  livro.pagamentos.unshift(pagamento);
  if (aprovado) {
    lancar(livro, pagamento, 'CAIXA_GATEWAY', 'RECEITA_TENANT', quando, [
      novoId('lan'),
      novoId('lan'),
    ]);
  }
}

/** pedido.cancelado de um pedido CONFIRMADO: estorna o pagamento aprovado. */
function estornar(tenantId: string, pedidoId: string, agora: number = Date.now()): void {
  const livro = livroDo(tenantId);
  const pagamento = livro.pagamentos.find((p) => p.pedidoId === pedidoId);
  if (pagamento?.status !== 'APROVADO') return;
  const quando = new Date(agora).toISOString();
  pagamento.status = 'ESTORNADO';
  pagamento.atualizadoEm = quando;
  lancar(livro, pagamento, 'ESTORNOS', 'CAIXA_GATEWAY', quando, [novoId('lan'), novoId('lan')]);
  // pagamento.estornado: o pedidos-service anota o marco ESTORNADO no histórico do pedido.
  aplicarEstorno(tenantId, pedidoId, pagamento.id, quando);
}

/**
 * Processa as cobranças vencidas até `agora` (todas, com `Infinity`). Chamado no começo de cada
 * requisição aos pedidos e aos pagamentos simulados; os testes podem chamar direto.
 */
export function processarCobrancas(agora: number = Date.now()): void {
  const vencidas = agenda.filter((c) => c.venceEm <= agora);
  if (vencidas.length === 0) return;
  agenda = agenda.filter((c) => c.venceEm > agora);
  for (const c of vencidas) cobrar(c);
}

/** Quantas cobranças ainda esperam o gateway simulado (testes). */
export function cobrancasAgendadas(): number {
  return agenda.length;
}

// O pagamentos-service assina pedido.criado e pedido.cancelado (ADR-0010).
assinarPedidos({
  pedidoCriado(tenantId, pedido) {
    agenda.push({ tenantId, pedido, venceEm: Date.now() + COBRANCA_ATRASO_MS });
  },
  pedidoCancelado(tenantId, pedido, anterior) {
    if (anterior === 'CONFIRMADO') estornar(tenantId, pedido.id);
  },
  sincronizar() {
    processarCobrancas();
  },
});

// ---- Respostas e acesso ----

const invalida = (detail: string) =>
  problemResponse(400, 'requisicao-invalida', 'Requisição inválida', detail);

type Acesso = { tenantId: string } | { response: Response };

/** Gateway (token, tenant, rate limit) e papel: só gestor-tenant ou plataforma-admin. */
function acesso(request: Request): Acesso {
  const result = guard(request, { rateLimit: true });
  if ('response' in result) return result;
  if (!result.tenant) return { response: invalida('O cabeçalho X-Tenant-Id é obrigatório.') };
  if (!veFinanceiro(result.user.papeis)) {
    return {
      response: problemResponse(
        403,
        'acesso-negado',
        'Acesso negado',
        'Pagamentos e o ledger exigem o papel gestor-tenant ou plataforma-admin.',
      ),
    };
  }
  processarCobrancas();
  return { tenantId: result.tenant.id };
}

/** Lê `limite` e `cursor` e devolve a página de `itens` (cursor = id do último item). */
function paginar<T extends { id: string }>(
  params: URLSearchParams,
  todos: readonly T[],
  filtrados: readonly T[],
): { itens: T[]; proximoCursor: string | null } | Response {
  const limiteRaw = params.get('limite');
  const limite = limiteRaw === null ? LIMITE_PADRAO : Number(limiteRaw);
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
    return invalida('limite deve ser um inteiro entre 1 e 100.');
  }
  let inicio = 0;
  const cursor = params.get('cursor');
  if (cursor) {
    const posicao = todos.findIndex((x) => x.id === cursor);
    if (posicao < 0) return invalida(`cursor inválido: '${cursor}'.`);
    inicio = filtrados.findIndex((x) => todos.indexOf(x) > posicao);
    if (inicio < 0) inicio = filtrados.length;
  }
  const itens = filtrados.slice(inicio, inicio + limite);
  const temMais = inicio + limite < filtrados.length;
  return { itens, proximoCursor: temMais ? (itens.at(-1)?.id ?? null) : null };
}

export const pagamentosHandlers = [
  http.get('*/api/v1/pagamentos', ({ request }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const params = new URL(request.url).searchParams;
    const status = params.get('status');
    if (status !== null && !isStatusPagamento(status)) {
      return invalida('status deve ser AUTORIZANDO, APROVADO, RECUSADO ou ESTORNADO.');
    }
    const pedidoId = params.get('pedidoId');
    const todos = livroDo(a.tenantId).pagamentos;
    const filtrados = todos.filter(
      (p) => (status === null || p.status === status) && (!pedidoId || p.pedidoId === pedidoId),
    );
    const pagina = paginar(params, todos, filtrados);
    if (pagina instanceof Response) return pagina;
    return HttpResponse.json({
      itens: pagina.itens.map((p) => ({ ...p, valor: { ...p.valor } })),
      proximoCursor: pagina.proximoCursor,
    });
  }),

  http.get('*/api/v1/pagamentos/:id', ({ request, params }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const id = String(params.id);
    const pagamento = livroDo(a.tenantId).pagamentos.find((p) => p.id === id);
    return pagamento
      ? HttpResponse.json({ ...pagamento, valor: { ...pagamento.valor } })
      : problemResponse(
          404,
          'nao-encontrado',
          'Pagamento não encontrado',
          `Pagamento '${id}' não encontrado neste tenant.`,
        );
  }),

  http.get('*/api/v1/ledger/lancamentos', ({ request }) => {
    const a = acesso(request);
    if ('response' in a) return a.response;
    const todos = livroDo(a.tenantId).lancamentos;
    const params = new URL(request.url).searchParams;
    const moeda = params.get('moeda') ?? MOEDA_PADRAO;
    if (!/^[A-Z]{3}$/.test(moeda)) {
      return invalida('moeda deve ter 3 letras maiúsculas (ISO 4217).');
    }
    const pagina = paginar(params, todos, todos);
    if (pagina instanceof Response) return pagina;
    return HttpResponse.json({
      itens: pagina.itens.map((l) => ({ ...l, valor: { ...l.valor } })),
      saldo: saldoDe(todos, moeda),
      proximoCursor: pagina.proximoCursor,
    });
  }),
];
