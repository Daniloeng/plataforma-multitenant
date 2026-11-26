import { useCallback, useEffect, useState } from 'react';
import { MOEDA_PADRAO, type Dinheiro, type Produto } from '../api/catalogo';
import { ITENS_MAX, QUANTIDADE_MAX, QUANTIDADE_MIN } from '../api/pedidos';
import { safeSession } from '../auth/client';

/** Item do carrinho: o preço é o do catálogo quando foi adicionado (só uma estimativa). */
export interface ItemCarrinho {
  produtoId: string;
  sku: string;
  nome: string;
  precoUnitario: Dinheiro;
  quantidade: number;
}

export interface UseCarrinho {
  itens: ItemCarrinho[];
  /** Soma das quantidades. */
  unidades: number;
  /** Total estimado com os preços do catálogo; null quando os itens têm moedas diferentes. */
  totalEstimado: Dinheiro | null;
  /** Os itens têm mais de uma moeda: o servidor recusa o pedido (400), então não há total. */
  moedasDiferentes: boolean;
  /** Soma a quantidade ao item (ou o cria); devolve false se o carrinho já tem 200 produtos. */
  adicionar: (produto: Produto, quantidade: number) => boolean;
  definirQuantidade: (produtoId: string, quantidade: number) => void;
  remover: (produtoId: string) => void;
  esvaziar: () => void;
}

/** Chave do sessionStorage: um carrinho por usuário e tenant. */
export function carrinhoKey(usuario: string, tenantId: string): string {
  return `plataforma.carrinho.${usuario}.${tenantId}`;
}

function limita(quantidade: number): number {
  return Math.min(QUANTIDADE_MAX, Math.max(QUANTIDADE_MIN, Math.trunc(quantidade)));
}

function isItem(value: unknown): value is ItemCarrinho {
  if (typeof value !== 'object' || value === null) return false;
  const i = value as Record<string, unknown>;
  const preco = i.precoUnitario as Record<string, unknown> | null | undefined;
  return (
    typeof i.produtoId === 'string' &&
    typeof i.sku === 'string' &&
    typeof i.nome === 'string' &&
    typeof preco === 'object' &&
    preco !== null &&
    Number.isInteger(preco.centavos) &&
    typeof preco.moeda === 'string' &&
    Number.isInteger(i.quantidade)
  );
}

/** Lê o carrinho guardado; JSON inválido ou storage indisponível viram carrinho vazio. */
export function lerCarrinho(key: string): ItemCarrinho[] {
  const raw = safeSession.get(key);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(isItem)
      .slice(0, ITENS_MAX)
      .map((i) => ({ ...i, quantidade: limita(i.quantidade) }));
  } catch {
    return [];
  }
}

function salvarCarrinho(key: string, itens: readonly ItemCarrinho[]): void {
  // safeSession ignora falhas do storage: sem ele, o carrinho vale até recarregar a página.
  safeSession.set(key, itens.length > 0 ? JSON.stringify(itens) : null);
}

/**
 * Carrinho do comprador no tenant atual, guardado no sessionStorage (`key` muda com o tenant:
 * cada tenant tem o próprio carrinho).
 */
export function useCarrinho(key: string): UseCarrinho {
  const [state, setState] = useState(() => ({ key, itens: lerCarrinho(key) }));
  // Trocou de tenant (ou de usuário) sem remontar: carrega o carrinho da nova chave.
  const itens = state.key === key ? state.itens : lerCarrinho(key);
  if (state.key !== key) setState({ key, itens });

  useEffect(() => {
    salvarCarrinho(state.key, state.itens);
  }, [state]);

  const update = useCallback((fn: (itens: ItemCarrinho[]) => ItemCarrinho[]) => {
    setState((prev) => ({ key: prev.key, itens: fn(prev.itens) }));
  }, []);

  const adicionar = useCallback(
    (produto: Produto, quantidade: number) => {
      const existe = state.itens.some((i) => i.produtoId === produto.id);
      if (!existe && state.itens.length >= ITENS_MAX) return false;
      update((prev) => {
        const item = prev.find((i) => i.produtoId === produto.id);
        if (item) {
          return prev.map((i) =>
            i.produtoId === produto.id
              ? { ...i, quantidade: limita(i.quantidade + quantidade) }
              : i,
          );
        }
        return [
          ...prev,
          {
            produtoId: produto.id,
            sku: produto.sku,
            nome: produto.nome,
            precoUnitario: { ...produto.preco },
            quantidade: limita(quantidade),
          },
        ];
      });
      return true;
    },
    [state.itens, update],
  );

  const definirQuantidade = useCallback(
    (produtoId: string, quantidade: number) => {
      update((prev) =>
        prev.map((i) => (i.produtoId === produtoId ? { ...i, quantidade: limita(quantidade) } : i)),
      );
    },
    [update],
  );

  const remover = useCallback(
    (produtoId: string) => update((prev) => prev.filter((i) => i.produtoId !== produtoId)),
    [update],
  );

  const esvaziar = useCallback(() => update(() => []), [update]);

  const unidades = itens.reduce((soma, i) => soma + i.quantidade, 0);
  const moeda = itens[0]?.precoUnitario.moeda ?? MOEDA_PADRAO;
  // Somar centavos de moedas diferentes daria um número sem sentido: sem total nesse caso.
  const moedasDiferentes = itens.some((i) => i.precoUnitario.moeda !== moeda);
  const totalEstimado: Dinheiro | null = moedasDiferentes
    ? null
    : {
        centavos: itens.reduce((soma, i) => soma + i.precoUnitario.centavos * i.quantidade, 0),
        moeda,
      };

  return {
    itens,
    unidades,
    totalEstimado,
    moedasDiferentes,
    adicionar,
    definirQuantidade,
    remover,
    esvaziar,
  };
}
