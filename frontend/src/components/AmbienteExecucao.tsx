import { useId } from 'react';
import type { RuntimeInfo } from '../api/status';

const PLATFORM_LABEL: Record<string, string> = {
  kubernetes: 'Kubernetes',
  compose: 'Docker Compose',
  local: 'Local',
};

/** Partes do texto: nome da plataforma, namespace (se houver) e instância (pod ou contêiner). */
export function partesAmbiente(runtime: RuntimeInfo): string[] {
  const platform = runtime.platform.trim();
  const chave = platform.toLowerCase();
  const partes = [PLATFORM_LABEL[chave] ?? platform];
  if (runtime.namespace) partes.push(`namespace ${runtime.namespace}`);
  if (runtime.instance) {
    const tipo = chave === 'kubernetes' ? 'pod' : chave === 'compose' ? 'contêiner' : 'instância';
    partes.push(`${tipo} ${runtime.instance}`);
  }
  return partes;
}

/**
 * Mostra onde a plataforma está rodando (Dia 11): Kubernetes com namespace e pod, Docker Compose
 * ou local. Não renderiza nada quando a API não informa o ambiente (versões anteriores).
 */
export function AmbienteExecucao({ runtime }: { runtime?: RuntimeInfo | null }) {
  const labelId = useId();
  if (!runtime) return null;
  const partes = partesAmbiente(runtime);
  return (
    <div role="group" aria-labelledby={labelId} className="ambiente">
      <span className="summary__label" id={labelId}>
        Ambiente de execução
      </span>
      {/* O "·" vira pausa (vírgula) para leitores de tela, que leriam "ponto médio". */}
      <span className="ambiente__valor" aria-hidden="true">
        {partes.join(' · ')}
      </span>
      <span className="sr-only">{partes.join(', ')}</span>
    </div>
  );
}
