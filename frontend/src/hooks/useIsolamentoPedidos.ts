import { useEffect, useRef, useState } from 'react';
import { isTenantEmMigracao, ApiError } from '../api/http';
import {
  describeIsolamentoError,
  fetchIsolamentoPedidos,
  type Isolamento,
} from '../api/isolamento';

/** Durante a migração (situacao MIGRANDO), consulta de novo a cada 1 s até PRONTO. */
export const ISOLAMENTO_POLL_MS = 1000;

export interface IsolamentoState {
  isolamento: Isolamento | null;
  /** true enquanto os dados migram (MIGRANDO, ou 503 tenant-em-migracao na consulta). */
  migrando: boolean;
  error: string | null;
  loading: boolean;
}

/**
 * GET /api/v1/isolamento/pedidos do tenant `tenantId` (vai no X-Tenant-Id da sessão). Enquanto a
 * migração de nível durar, consulta de novo a cada ISOLAMENTO_POLL_MS. A cada resposta chama
 * `onSituacao(migrando)`: a lista de pedidos espera a migração terminar para carregar.
 */
export function useIsolamentoPedidos(
  tenantId: string,
  onSituacao?: (migrando: boolean) => void,
): IsolamentoState {
  const [state, setState] = useState<IsolamentoState>({
    isolamento: null,
    migrando: false,
    error: null,
    loading: true,
  });
  const situacaoRef = useRef(onSituacao);
  situacaoRef.current = onSituacao;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const consultar = async () => {
      try {
        const isolamento = await fetchIsolamentoPedidos(controller.signal);
        if (controller.signal.aborted) return;
        const migrando = isolamento.situacao === 'MIGRANDO';
        setState({ isolamento, migrando, error: null, loading: false });
        situacaoRef.current?.(migrando);
        if (migrando) timer = window.setTimeout(() => void consultar(), ISOLAMENTO_POLL_MS);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (isTenantEmMigracao(err)) {
          // O pedidos-service pode recusar a própria consulta durante a migração: espera o
          // Retry-After (no mínimo 1 s) e tenta de novo.
          setState((prev) => ({ ...prev, migrando: true, error: null, loading: false }));
          situacaoRef.current?.(true);
          const segundos = (err as ApiError).retryAfterSeconds ?? 1;
          timer = window.setTimeout(
            () => void consultar(),
            Math.max(ISOLAMENTO_POLL_MS, segundos * 1000),
          );
          return;
        }
        setState((prev) => ({
          ...prev,
          migrando: false,
          error: describeIsolamentoError(err),
          loading: false,
        }));
        // Sem saber do isolamento, a lista carrega mesmo assim (e trata um eventual 503).
        situacaoRef.current?.(false);
      }
    };

    void consultar();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [tenantId]);

  return state;
}
