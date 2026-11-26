// Cliente de GET /api/v1/isolamento/pedidos (pedidos.yaml, Dia 9, ADR-0014): onde o pedidos-service
// guarda os dados do tenant selecionado e se uma migração de nível está em andamento.

import { ApiError, apiFetch, readJson } from './http';
import { isNivelIsolamento, type NivelIsolamento } from './tenants';
import { NIVEL_ISOLAMENTO_LABEL } from '../utils/format';

export const SITUACOES_ISOLAMENTO = ['PRONTO', 'MIGRANDO'] as const;
export type SituacaoIsolamento = (typeof SITUACOES_ISOLAMENTO)[number];

export interface Isolamento {
  tenantId: string;
  nivel: NivelIsolamento;
  /** Database MongoDB dos pedidos do tenant: `pedidos` (POOL) ou `pedidos_t_<tenant>`. */
  database: string;
  situacao: SituacaoIsolamento;
  /** Fim da última migração de nível (ISO 8601), ou null se o tenant nunca migrou. */
  migradoEm: string | null;
}

/** Database compartilhada do nível POOL. */
export const DATABASE_COMPARTILHADA = 'pedidos';

export function isSituacaoIsolamento(value: unknown): value is SituacaoIsolamento {
  return typeof value === 'string' && (SITUACOES_ISOLAMENTO as readonly string[]).includes(value);
}

function isIsolamentoBody(value: unknown): value is Isolamento {
  if (typeof value !== 'object' || value === null) return false;
  const i = value as Record<string, unknown>;
  return (
    typeof i.tenantId === 'string' &&
    isNivelIsolamento(i.nivel) &&
    typeof i.database === 'string' &&
    isSituacaoIsolamento(i.situacao) &&
    (i.migradoEm === undefined || i.migradoEm === null || typeof i.migradoEm === 'string')
  );
}

/** GET /api/v1/isolamento/pedidos — com o X-Tenant-Id da sessão; comprador recebe 403. */
export async function fetchIsolamentoPedidos(signal?: AbortSignal): Promise<Isolamento> {
  const response = await apiFetch('api/v1/isolamento/pedidos', {
    headers: { Accept: 'application/json, application/problem+json' },
    signal,
  });
  const body = await readJson(response, isIsolamentoBody);
  return { ...body, migradoEm: body.migradoEm ?? null };
}

/**
 * Frase da tela, ex.: "Seus pedidos ficam na database pedidos_t_acme (Bridge)" — devolvida
 * em partes para a tela pôr o nome da database em <code>.
 */
export function descreveLocal(isolamento: Isolamento): {
  antes: string;
  database: string;
  depois: string;
} {
  const nivel = NIVEL_ISOLAMENTO_LABEL[isolamento.nivel];
  const compartilhada = isolamento.nivel === 'POOL';
  return {
    antes: compartilhada
      ? 'Seus pedidos ficam na database compartilhada'
      : 'Seus pedidos ficam na database',
    database: isolamento.database,
    depois: `(${nivel})`,
  };
}

/** Mensagem legível em pt-BR para qualquer falha (rede vira "não foi possível conectar"). */
export function describeIsolamentoError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Não foi possível conectar ao pedidos-service.';
}
