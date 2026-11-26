import { ProgressSection } from '../components/ProgressSection';
import { RoadmapSection } from '../components/RoadmapSection';
import { StatusPanel } from '../components/StatusPanel';
import { usePlatformStatus } from '../hooks/usePlatformStatus';

/** Página Status: o polling do /api/status só roda enquanto ela está aberta. */
export function StatusPage() {
  const status = usePlatformStatus();
  return (
    <>
      <StatusPanel {...status} />
      <RoadmapSection />
      <ProgressSection />
    </>
  );
}
