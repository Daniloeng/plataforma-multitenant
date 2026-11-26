import type { MermaidBlock } from '../../architecture/docs';
import { MermaidDiagram } from './MermaidDiagram';

export function DiagramsSection({ diagrams }: { diagrams: readonly MermaidBlock[] }) {
  return (
    <section className="section" aria-labelledby="diagrams-title">
      <h2 id="diagrams-title">Event storming</h2>
      <p className="muted section__intro">
        Diagramas de <code>docs/arquitetura/event-storming.md</code>.
      </p>
      {diagrams.length === 0 ? (
        <p className="muted">Nenhum diagrama encontrado.</p>
      ) : (
        <div className="diagrams">
          {diagrams.map((d, i) => (
            <MermaidDiagram key={`${i}-${d.title}`} title={d.title} code={d.code} />
          ))}
        </div>
      )}
    </section>
  );
}
