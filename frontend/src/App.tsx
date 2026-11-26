import { useEffect } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import type { AuthClient } from './auth/client';
import { DemoBadge } from './components/DemoBadge';
import { RequireAdmin } from './components/auth/RequireAdmin';
import { SessionBar } from './components/auth/SessionBar';
import { ROUTE_HASH, useHashRoute, type Route } from './hooks/useHashRoute';
import { AccountPage } from './pages/AccountPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { PedidosPage } from './pages/PedidosPage';
import { ProdutosPage } from './pages/ProdutosPage';
import { StatusPage } from './pages/StatusPage';
import { TenantsPage } from './pages/TenantsPage';
import { isDemoMode } from './utils/demo';

// A ordem das chaves é a ordem das abas.
const PAGES: Record<Route, { tab: string; title: string; footer: string }> = {
  status: {
    tab: 'Status',
    title: 'Status da plataforma',
    footer: 'Atualização automática a cada 10 segundos. Página pública (sem login).',
  },
  tenants: {
    tab: 'Tenants',
    title: 'Tenants',
    footer:
      'Dados do tenant-service pelo gateway (GET, POST e PATCH em /api/v1/tenants, papel plataforma-admin).',
  },
  produtos: {
    tab: 'Produtos',
    title: 'Produtos',
    footer:
      'Dados do catalogo-service pelo gateway (/api/v1/produtos com X-Tenant-Id; escrita para gestor-tenant e plataforma-admin).',
  },
  pedidos: {
    tab: 'Pedidos',
    title: 'Pedidos',
    footer:
      'Dados do pedidos-service pelo gateway (/api/v1/pedidos com X-Tenant-Id; o gateway põe o X-Cliente-Id do token; criação com Idempotency-Key).',
  },
  arquitetura: {
    tab: 'Arquitetura',
    title: 'Arquitetura',
    footer: 'Conteúdo gerado em build time a partir de libs/contracts e docs/.',
  },
  conta: {
    tab: 'Minha conta',
    title: 'Minha conta',
    footer: 'Dados do gateway (GET /api/v1/me): usuário e tenants vêm do token do Keycloak.',
  },
};

function CurrentPage({ route }: { route: Route }) {
  if (route === 'arquitetura') return <ArchitecturePage />;
  if (route === 'conta') return <AccountPage />;
  if (route === 'produtos') return <ProdutosPage />;
  if (route === 'pedidos') return <PedidosPage />;
  if (route === 'tenants') {
    return (
      <RequireAdmin>
        <TenantsPage />
      </RequireAdmin>
    );
  }
  return <StatusPage />;
}

/** `authClient` existe para os testes; sem ele, Keycloak (ou o login de demo com VITE_DEMO). */
export function App({ authClient }: { authClient?: AuthClient } = {}) {
  const route = useHashRoute();
  const page = PAGES[route];

  useEffect(() => {
    document.title = page.title;
  }, [page.title]);

  return (
    <AuthProvider client={authClient}>
      <div className="page">
        <header className="header">
          <div>
            <p className="eyebrow">Plataforma multi-tenant · pedidos B2B + pagamentos</p>
            <h1>{page.title}</h1>
          </div>
          <DemoBadge active={isDemoMode()} />
        </header>
        <SessionBar />
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
    </AuthProvider>
  );
}
