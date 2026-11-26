import { useEffect } from 'react';
import { DemoBadge } from './components/DemoBadge';
import { ROUTE_HASH, useHashRoute, type Route } from './hooks/useHashRoute';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { StatusPage } from './pages/StatusPage';
import { TenantsPage } from './pages/TenantsPage';
import { isDemoMode } from './utils/demo';

const PAGES: Record<Route, { tab: string; title: string; footer: string }> = {
  status: {
    tab: 'Status',
    title: 'Status da plataforma',
    footer: 'Atualização automática a cada 10 segundos.',
  },
  tenants: {
    tab: 'Tenants',
    title: 'Tenants',
    footer: 'Dados do tenant-service (GET, POST e PATCH em /api/v1/tenants).',
  },
  arquitetura: {
    tab: 'Arquitetura',
    title: 'Arquitetura',
    footer: 'Conteúdo gerado em build time a partir de libs/contracts e docs/.',
  },
};

function CurrentPage({ route }: { route: Route }) {
  if (route === 'arquitetura') return <ArchitecturePage />;
  if (route === 'tenants') return <TenantsPage />;
  return <StatusPage />;
}

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
      <main>
        <CurrentPage route={route} />
      </main>
      <footer className="footer muted">{page.footer}</footer>
    </div>
  );
}
