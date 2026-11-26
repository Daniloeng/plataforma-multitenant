// Migração de nível simulada (modo demo e testes), como o Dia 9 (ADR-0014):
//
// - A promoção (POST /api/v1/tenants/{id}/promocao, src/mocks/tenants.ts) chama `iniciarMigracao`:
//   por MIGRACAO_MS (1,5 s) o tenant fica MIGRANDO.
// - Não há setTimeout: o fim da migração é conferido a cada requisição (`migrandoAgora`), como o
//   `processarCobrancas` dos pagamentos. Nada fica rodando entre os testes, e os timers falsos do
//   Vitest (que falsificam o Date) controlam quando a migração termina.
// - Enquanto migra, as APIs de negócio simuladas do tenant (produtos, pedidos, pagamentos)
//   respondem 503 `tenant-em-migracao` com Retry-After: 1 (`respostaSeEmMigracao`).
// - GET /api/v1/isolamento/pedidos responde o nível, a database (`pedidos` no POOL,
//   `pedidos_t_<tenant>` no BRIDGE e no SILO) e a situação PRONTO ou MIGRANDO.

import { http, HttpResponse } from 'msw';
import { DATABASE_COMPARTILHADA, type Isolamento } from '../api/isolamento';
import { veTodosOsPedidos } from '../api/pedidos';
import type { NivelIsolamento } from '../api/tenants';
import { guard, problemResponse } from './gateway';

/** Quanto dura a migração simulada. */
export const MIGRACAO_MS = 1500;
/** Retry-After (segundos) do 503 durante a migração simulada. */
export const MIGRACAO_RETRY_AFTER_S = 1;

interface Migracao {
  /** Fim da migração em andamento (epoch ms), ou null quando PRONTO. */
  terminaEm: number | null;
  /** Fim da última migração (ISO 8601). */
  migradoEm: string | null;
}

let migracoes = new Map<string, Migracao>();

/** Esquece as migrações (use nos testes, em afterEach). */
export function resetIsolamentoStore(): void {
  migracoes = new Map();
}

/** Começa a migração do tenant (a promoção publicou tenant.alterado). */
export function iniciarMigracao(tenantId: string, agora: number = Date.now()): void {
  const atual = migracoes.get(tenantId);
  migracoes.set(tenantId, {
    terminaEm: agora + MIGRACAO_MS,
    migradoEm: atual?.migradoEm ?? null,
  });
}

/** O tenant está migrando agora? Uma migração vencida é concluída aqui (com o horário do fim). */
export function migrandoAgora(tenantId: string, agora: number = Date.now()): boolean {
  const m = migracoes.get(tenantId);
  if (m?.terminaEm == null) return false;
  if (m.terminaEm > agora) return true;
  m.migradoEm = new Date(m.terminaEm).toISOString();
  m.terminaEm = null;
  return false;
}

/** Database dos pedidos do tenant no nível dado. */
export function databaseDosPedidos(tenantId: string, nivel: NivelIsolamento): string {
  return nivel === 'POOL' ? DATABASE_COMPARTILHADA : `pedidos_t_${tenantId}`;
}

/** 503 tenant-em-migracao, se o tenant estiver migrando; senão null. */
export function respostaSeEmMigracao(tenantId: string): Response | null {
  if (!migrandoAgora(tenantId)) return null;
  return problemResponse(
    503,
    'tenant-em-migracao',
    'Tenant em migração',
    `Os dados do tenant '${tenantId}' estão migrando de nível de isolamento; tente de novo em instantes.`,
    { 'Retry-After': String(MIGRACAO_RETRY_AFTER_S) },
  );
}

export const isolamentoHandlers = [
  http.get('*/api/v1/isolamento/pedidos', ({ request }) => {
    const result = guard(request, { rateLimit: true });
    if ('response' in result) return result.response;
    if (!result.tenant) {
      return problemResponse(
        400,
        'requisicao-invalida',
        'Requisição inválida',
        'O cabeçalho X-Tenant-Id é obrigatório.',
      );
    }
    if (!veTodosOsPedidos(result.user.papeis)) {
      return problemResponse(
        403,
        'acesso-negado',
        'Acesso negado',
        'O isolamento dos pedidos exige o papel gestor-tenant ou plataforma-admin.',
      );
    }
    const { id, nivelIsolamento } = result.tenant;
    const migrando = migrandoAgora(id);
    const body: Isolamento = {
      tenantId: id,
      nivel: nivelIsolamento,
      database: databaseDosPedidos(id, nivelIsolamento),
      situacao: migrando ? 'MIGRANDO' : 'PRONTO',
      migradoEm: migracoes.get(id)?.migradoEm ?? null,
    };
    return HttpResponse.json(body);
  }),
];
