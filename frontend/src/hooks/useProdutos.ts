import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeProdutoError,
  listProdutos,
  updateProduto,
  type FiltroProdutos,
  type Produto,
} from '../api/catalogo';
import type { Plano } from '../api/tenants';

export interface ProdutosState {
  /** Produtos carregados até agora (páginas acumuladas). */
  items: Produto[];
  nextCursor: string | null;
  /** Produtos que atendem ao filtro, em todas as páginas (null até a primeira resposta). */
  total: number | null;
  limitePlano: number | null;
  /** Plano que o catálogo usou para o limite (null até a primeira resposta). */
  plano: Plano | null;
  usados: number | null;
  loading: boolean;
  loadingMore: boolean;
  /** Falha ao carregar a primeira página. */
  error: string | null;
  /** Falha da última ação (paginação ou ativar/desativar). */
  actionError: string | null;
  /** Ids com PATCH de situação em andamento. */
  pendingIds: ReadonlySet<string>;
}

export interface UseProdutos extends ProdutosState {
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Produto recém-criado: entra no topo (se atende ao filtro) e conta no plano. */
  added: (produto: Produto) => void;
  /** Troca um produto da lista pela versão devolvida pela API. */
  replace: (produto: Produto) => void;
  /** Ativa (true) ou desativa (false) um produto via PATCH. */
  setActive: (id: string, ativo: boolean) => Promise<void>;
}

const INITIAL: ProdutosState = {
  items: [],
  nextCursor: null,
  total: null,
  limitePlano: null,
  plano: null,
  usados: null,
  loading: true,
  loadingMore: false,
  error: null,
  actionError: null,
  pendingIds: new Set(),
};

function merge(current: Produto[], incoming: Produto[]): Produto[] {
  const known = new Set(current.map((p) => p.id));
  return [...current, ...incoming.filter((p) => !known.has(p.id))];
}

/** O produto atende ao filtro atual? (mesma regra do contrato: nome ou SKU, sem maiúsculas.) */
export function matchesFilter(produto: Produto, { busca, ativo }: FiltroProdutos): boolean {
  if (ativo !== undefined && produto.ativo !== ativo) return false;
  const termo = busca?.trim().toLocaleLowerCase('pt-BR') ?? '';
  return (
    termo === '' ||
    produto.nome.toLocaleLowerCase('pt-BR').includes(termo) ||
    produto.sku.toLowerCase().includes(termo)
  );
}

/**
 * Catálogo do tenant selecionado (GET /api/v1/produtos), paginado por cursor, com busca e filtro
 * de situação. Recarrega quando o tenant ou o filtro mudam.
 */
export function useProdutos(tenantId: string, filtro: FiltroProdutos): UseProdutos {
  const [state, setState] = useState<ProdutosState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  const { busca, ativo } = filtro;

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, error: null, actionError: null }));
    try {
      const page = await listProdutos({ busca, ativo, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        items: page.itens,
        nextCursor: page.proximoCursor,
        total: page.total,
        limitePlano: page.limitePlano,
        plano: page.plano,
        usados: page.usados,
        loading: false,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        items: [],
        nextCursor: null,
        loading: false,
        error: describeProdutoError(err),
      }));
    }
    // tenantId: o apiFetch lê o tenant da sessão; a dependência faz a troca recarregar.
  }, [tenantId, busca, ativo]);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor || state.loadingMore) return;
    setState((prev) => ({ ...prev, loadingMore: true, actionError: null }));
    const generation = controllerRef.current;
    const stale = () => controllerRef.current !== generation;
    try {
      const page = await listProdutos({ cursor, busca, ativo });
      if (stale()) {
        setState((prev) => ({ ...prev, loadingMore: false }));
        return;
      }
      setState((prev) => ({
        ...prev,
        items: merge(prev.items, page.itens),
        nextCursor: page.proximoCursor,
        total: page.total,
        limitePlano: page.limitePlano,
        plano: page.plano,
        usados: page.usados,
        loadingMore: false,
      }));
    } catch (err) {
      if (stale()) {
        setState((prev) => ({ ...prev, loadingMore: false }));
        return;
      }
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        actionError: `Não foi possível carregar mais produtos: ${describeProdutoError(err)}`,
      }));
    }
  }, [state.nextCursor, state.loadingMore, busca, ativo]);

  const added = useCallback(
    (produto: Produto) => {
      const visivel = matchesFilter(produto, { busca, ativo });
      setState((prev) => ({
        ...prev,
        items: visivel ? [produto, ...prev.items.filter((p) => p.id !== produto.id)] : prev.items,
        total: prev.total !== null && visivel ? prev.total + 1 : prev.total,
        usados: prev.usados !== null ? prev.usados + 1 : prev.usados,
      }));
    },
    [busca, ativo],
  );

  const replace = useCallback((produto: Produto) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((p) => (p.id === produto.id ? produto : p)),
    }));
  }, []);

  const setActive = useCallback(
    async (id: string, ativoNovo: boolean) => {
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
        const updated = await updateProduto(id, { ativo: ativoNovo });
        setState((prev) => {
          // Com o filtro "Ativos" ou "Inativos", o produto que mudou de situação sai da lista.
          const sai =
            !matchesFilter(updated, { busca, ativo }) && prev.items.some((p) => p.id === id);
          return {
            ...prev,
            items: sai
              ? prev.items.filter((p) => p.id !== id)
              : prev.items.map((p) => (p.id === id ? updated : p)),
            total: sai && prev.total !== null ? prev.total - 1 : prev.total,
            pendingIds: done(prev.pendingIds),
          };
        });
      } catch (err) {
        const acao = ativoNovo ? 'ativar' : 'desativar';
        setState((prev) => ({
          ...prev,
          pendingIds: done(prev.pendingIds),
          actionError: `Não foi possível ${acao} o produto: ${describeProdutoError(err)}`,
        }));
      }
    },
    [busca, ativo],
  );

  useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);

  return { ...state, reload, loadMore, added, replace, setActive };
}
