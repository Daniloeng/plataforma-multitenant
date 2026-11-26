import { useEffect, useState } from 'react';

// Roteamento por hash (#/, #/tenants, #/produtos, #/pedidos, #/pedidos/<id>, #/pagamentos,
// #/arquitetura e #/conta), sem biblioteca: funciona no GitHub Pages, que não reescreve rotas para
// o index.html.

export type Route =
  'status' | 'tenants' | 'produtos' | 'pedidos' | 'pagamentos' | 'arquitetura' | 'conta';

export const ROUTE_HASH: Record<Route, string> = {
  status: '#/',
  tenants: '#/tenants',
  produtos: '#/produtos',
  pedidos: '#/pedidos',
  pagamentos: '#/pagamentos',
  arquitetura: '#/arquitetura',
  conta: '#/conta',
};

/** Converte o hash em rota; qualquer hash desconhecido cai em "status". */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  if (
    path === 'arquitetura' ||
    path === 'tenants' ||
    path === 'produtos' ||
    path === 'pedidos' ||
    path === 'pagamentos' ||
    path === 'conta'
  ) {
    return path;
  }
  if (path.startsWith('pedidos/')) return 'pedidos';
  return 'status';
}

/** Id do pedido em #/pedidos/<id> (sem mudar maiúsculas), ou null. */
export function parsePedidoId(hash: string): string | null {
  const match = /^#?\/?pedidos\/([^/?#]+)\/?$/i.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/** Hash do detalhe de um pedido. */
export function pedidoHash(id: string): string {
  return `#/pedidos/${encodeURIComponent(id)}`;
}

/** Hash atual da URL, atualizado a cada `hashchange`. */
export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
