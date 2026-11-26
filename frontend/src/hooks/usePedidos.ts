import { useCallback, useEffect, useRef, useState } from 'react';
import { describePedidoError, listPedidos, type Pedido, type StatusPedido } from '../api/pedidos';

export interface PedidosState {
  items: Pedido[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  /** Falha ao carregar a primeira página. */
  error: string | null;
  /** Falha ao carregar mais. */
  actionError: string | null;
}

export interface UsePedidos extends PedidosState {
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Troca um pedido pela versão devolvida pela API (ex.: depois de cancelar). */
  replace: (pedido: Pedido) => void;
}

const INITIAL: PedidosState = {
  items: [],
  nextCursor: null,
  loading: true,
  loadingMore: false,
  error: null,
  actionError: null,
};

function merge(current: Pedido[], incoming: Pedido[]): Pedido[] {
  const known = new Set(current.map((p) => p.id));
  return [...current, ...incoming.filter((p) => !known.has(p.id))];
}

/**
 * Pedidos do tenant selecionado (GET /api/v1/pedidos), do mais recente para o mais antigo,
 * paginados por cursor e filtrados por status. Recarrega quando o tenant ou o filtro mudam.
 */
export function usePedidos(tenantId: string, status?: StatusPedido): UsePedidos {
  const [state, setState] = useState<PedidosState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, error: null, actionError: null }));
    try {
      const page = await listPedidos({ status, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        items: page.itens,
        nextCursor: page.proximoCursor,
        loading: false,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        items: [],
        nextCursor: null,
        loading: false,
        error: describePedidoError(err),
      }));
    }
    // tenantId: o apiFetch lê o tenant da sessão; a dependência faz a troca recarregar.
  }, [tenantId, status]);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor || state.loadingMore) return;
    setState((prev) => ({ ...prev, loadingMore: true, actionError: null }));
    const generation = controllerRef.current;
    const stale = () => controllerRef.current !== generation;
    try {
      const page = await listPedidos({ cursor, status });
      if (stale()) {
        setState((prev) => ({ ...prev, loadingMore: false }));
        return;
      }
      setState((prev) => ({
        ...prev,
        items: merge(prev.items, page.itens),
        nextCursor: page.proximoCursor,
        loadingMore: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        actionError: stale()
          ? null
          : `Não foi possível carregar mais pedidos: ${describePedidoError(err)}`,
      }));
    }
  }, [state.nextCursor, state.loadingMore, status]);

  const replace = useCallback(
    (pedido: Pedido) => {
      setState((prev) => ({
        ...prev,
        // Com filtro de status, o pedido que mudou de status sai da lista.
        items:
          status && pedido.status !== status
            ? prev.items.filter((p) => p.id !== pedido.id)
            : prev.items.map((p) => (p.id === pedido.id ? pedido : p)),
      }));
    },
    [status],
  );

  useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);

  return { ...state, reload, loadMore, replace };
}
