import { useCallback, useEffect, useRef, useState } from 'react';
import { describeTenantError, listTenants, updateTenant, type Tenant } from '../api/tenants';

export interface TenantsState {
  /** Tenants carregados até agora (páginas acumuladas). */
  items: Tenant[];
  /** Cursor da próxima página; null quando não há mais páginas. */
  nextCursor: string | null;
  /** true durante a primeira carga (ou ao recarregar). */
  loading: boolean;
  /** true enquanto "Carregar mais" busca a próxima página. */
  loadingMore: boolean;
  /** Falha ao carregar a lista (primeira página). */
  error: string | null;
  /** Falha da última ação (paginação ou suspender/reativar). */
  actionError: string | null;
  /** Ids com PATCH em andamento. */
  pendingIds: ReadonlySet<string>;
}

export interface UseTenants extends TenantsState {
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Insere um tenant recém-criado no topo da lista. */
  prepend: (tenant: Tenant) => void;
  /** Suspende (false) ou reativa (true) um tenant via PATCH. */
  setActive: (id: string, ativo: boolean) => Promise<void>;
}

const INITIAL: TenantsState = {
  items: [],
  nextCursor: null,
  loading: true,
  loadingMore: false,
  error: null,
  actionError: null,
  pendingIds: new Set(),
};

/** Junta páginas sem repetir ids (um tenant criado aqui pode reaparecer numa página seguinte). */
function merge(current: Tenant[], incoming: Tenant[]): Tenant[] {
  const known = new Set(current.map((t) => t.id));
  return [...current, ...incoming.filter((t) => !known.has(t.id))];
}

/** Lista paginada de tenants (GET /api/v1/tenants) e ações de suspender/reativar. */
export function useTenants(): UseTenants {
  const [state, setState] = useState<TenantsState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, error: null, actionError: null }));
    try {
      const page = await listTenants({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        items: page.itens,
        nextCursor: page.proximoCursor,
        loading: false,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({ ...prev, loading: false, error: describeTenantError(err) }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor || state.loadingMore) return;
    setState((prev) => ({ ...prev, loadingMore: true, actionError: null }));
    try {
      const page = await listTenants({ cursor });
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
        actionError: `Não foi possível carregar mais tenants: ${describeTenantError(err)}`,
      }));
    }
  }, [state.nextCursor, state.loadingMore]);

  const prepend = useCallback((tenant: Tenant) => {
    setState((prev) => ({
      ...prev,
      items: [tenant, ...prev.items.filter((t) => t.id !== tenant.id)],
    }));
  }, []);

  const setActive = useCallback(async (id: string, ativo: boolean) => {
    setState((prev) => ({
      ...prev,
      actionError: null,
      pendingIds: new Set(prev.pendingIds).add(id),
    }));
    const done = (pendingIds: ReadonlySet<string>) => {
      const next = new Set(pendingIds);
      next.delete(id);
      return next;
    };
    try {
      const updated = await updateTenant(id, { ativo });
      setState((prev) => ({
        ...prev,
        items: prev.items.map((t) => (t.id === id ? updated : t)),
        pendingIds: done(prev.pendingIds),
      }));
    } catch (err) {
      const acao = ativo ? 'reativar' : 'suspender';
      setState((prev) => ({
        ...prev,
        pendingIds: done(prev.pendingIds),
        actionError: `Não foi possível ${acao} '${id}': ${describeTenantError(err)}`,
      }));
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);

  return { ...state, reload, loadMore, prepend, setActive };
}
