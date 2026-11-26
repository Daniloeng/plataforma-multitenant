import { useCallback, useEffect, useRef, useState } from 'react';

/** Página de uma lista paginada por cursor (formato comum das APIs da plataforma). */
export interface CursorPage<T> {
  itens: T[];
  proximoCursor: string | null;
}

export interface CursorListState<T, P extends CursorPage<T>> {
  items: T[];
  nextCursor: string | null;
  /** Última página recebida (ex.: o `saldo` do extrato). */
  lastPage: P | null;
  loading: boolean;
  loadingMore: boolean;
  /** Falha ao carregar a primeira página. */
  error: string | null;
  /** Falha ao carregar mais. */
  actionError: string | null;
}

export interface UseCursorList<T, P extends CursorPage<T>> extends CursorListState<T, P> {
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
}

function merge<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const known = new Set(current.map((x) => x.id));
  return [...current, ...incoming.filter((x) => !known.has(x.id))];
}

/**
 * Lista paginada por cursor, do mais recente para o mais antigo. `load` busca uma página (cursor
 * null = a primeira); quando `load` muda (outro tenant, outro filtro), a lista recarrega e um
 * "Carregar mais" que ainda estava em voo é descartado. `describe` traduz o erro e `moreError`
 * prefixa a falha de "Carregar mais".
 */
export function useCursorList<T extends { id: string }, P extends CursorPage<T>>(
  load: (cursor: string | null, signal?: AbortSignal) => Promise<P>,
  describe: (error: unknown) => string,
  moreError: string,
): UseCursorList<T, P> {
  const [state, setState] = useState<CursorListState<T, P>>({
    items: [],
    nextCursor: null,
    lastPage: null,
    loading: true,
    loadingMore: false,
    error: null,
    actionError: null,
  });
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, error: null, actionError: null }));
    try {
      const page = await load(null, controller.signal);
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        items: page.itens,
        nextCursor: page.proximoCursor,
        lastPage: page,
        loading: false,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        items: [],
        nextCursor: null,
        lastPage: null,
        loading: false,
        error: describe(err),
      }));
    }
  }, [load, describe]);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor || state.loadingMore) return;
    setState((prev) => ({ ...prev, loadingMore: true, actionError: null }));
    const generation = controllerRef.current;
    const stale = () => controllerRef.current !== generation;
    try {
      const page = await load(cursor);
      if (stale()) {
        setState((prev) => ({ ...prev, loadingMore: false }));
        return;
      }
      setState((prev) => ({
        ...prev,
        items: merge(prev.items, page.itens),
        nextCursor: page.proximoCursor,
        lastPage: page,
        loadingMore: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        actionError: stale() ? null : `${moreError}: ${describe(err)}`,
      }));
    }
  }, [state.nextCursor, state.loadingMore, load, describe, moreError]);

  useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);

  return { ...state, reload, loadMore };
}
