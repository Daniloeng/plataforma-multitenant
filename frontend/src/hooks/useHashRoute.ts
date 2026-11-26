import { useEffect, useState } from 'react';

// Roteamento por hash (#/ e #/arquitetura), sem biblioteca: funciona no GitHub Pages, que não
// reescreve rotas para o index.html.

export type Route = 'status' | 'arquitetura';

export const ROUTE_HASH: Record<Route, string> = {
  status: '#/',
  arquitetura: '#/arquitetura',
};

/** Converte o hash em rota; qualquer hash desconhecido cai em "status". */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  return path === 'arquitetura' ? 'arquitetura' : 'status';
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
