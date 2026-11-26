import { DemoBadge } from './components/DemoBadge';
import { ProgressSection } from './components/ProgressSection';
import { RoadmapSection } from './components/RoadmapSection';
import { StatusPanel } from './components/StatusPanel';
import { usePlatformStatus } from './hooks/usePlatformStatus';
import { isDemoMode } from './utils/demo';

export function App() {
  const status = usePlatformStatus();
  return (
    <div className="page">
      <header className="header">
        <div>
          <p className="eyebrow">Plataforma multi-tenant · pedidos B2B + pagamentos</p>
          <h1>Status da plataforma</h1>
        </div>
        <DemoBadge active={isDemoMode()} />
      </header>
      <main>
        <StatusPanel {...status} />
        <RoadmapSection />
        <ProgressSection />
      </main>
      <footer className="footer muted">Atualização automática a cada 10 segundos.</footer>
    </div>
  );
}
