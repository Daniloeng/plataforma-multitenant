import { useEffect } from 'react';
import { DemoBadge } from './components/DemoBadge';
import { ROUTE_HASH, useHashRoute, type Route } from './hooks/useHashRoute';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { StatusPage } from './pages/StatusPage';
import { isDemoMode } from './utils/demo';

const PAGES: Record<Route, { tab: string; title: string }> = {
  status: { tab: 'Status', title: 'Status da plataforma' },
  arquitetura: { tab: 'Arquitetura', title: 'Arquitetura' },
};

export function App() {
  const route = useHashRoute();
  const page = PAGES[route];

  useEffect(() => {
    document.title = page.title;
  }, [page.title]);

  return (
    <div className="page">
      <header className="header">
        <div>
          <p className="eyebrow">Plataforma multi-tenant · pedidos B2B + pagamentos</p>
          <h1>{page.title}</h1>
        </div>
        <DemoBadge active={isDemoMode()} />
      </header>
      <nav className="tabs" aria-label="Páginas">
        {(Object.keys(PAGES) as Route[]).map((r) => (
          <a
            key={r}
            href={ROUTE_HASH[r]}
            className="tab"
            aria-current={r === route ? 'page' : undefined}
          >
            {PAGES[r].tab}
          </a>
        ))}
      </nav>
      <main>{route === 'arquitetura' ? <ArchitecturePage /> : <StatusPage />}</main>
      <footer className="footer muted">
        {route === 'status'
          ? 'Atualização automática a cada 10 segundos.'
          : 'Conteúdo gerado em build time a partir de libs/contracts e docs/.'}
      </footer>
    </div>
  );
}
