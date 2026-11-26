import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, fetchStatus, type StatusResponse } from '../api/status';

export const POLL_INTERVAL_MS = 10_000;

export interface PlatformStatusState {
  /** Última resposta válida (mantida mesmo se uma atualização posterior falhar). */
  data: StatusResponse | null;
  /** Mensagem da última falha, ou null se a última busca deu certo. */
  error: string | null;
  /** true enquanto uma busca está em andamento. */
  loading: boolean;
}

export interface UsePlatformStatus extends PlatformStatusState {
  refresh: () => Promise<void>;
}

/** Busca /api/status ao montar e a cada `intervalMs`; expõe `refresh` para o botão. */
export function usePlatformStatus(intervalMs: number = POLL_INTERVAL_MS): UsePlatformStatus {
  const [state, setState] = useState<PlatformStatusState>({
    data: null,
    error: null,
    loading: true,
  });
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Cancela a busca anterior para que uma resposta antiga não sobrescreva a nova.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetchStatus(controller.signal);
      if (controller.signal.aborted) return;
      setState({ data, error: null, loading: false });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({ data: prev.data, error: describeError(err), loading: false }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      window.clearInterval(id);
      controllerRef.current?.abort();
    };
  }, [refresh, intervalMs]);

  return { ...state, refresh };
}
