import { useEffect, useId, useState, type CSSProperties } from 'react';
import {
  MOBILE_MAX_DIAGRAM_WIDTH,
  renderMermaid,
  svgNaturalWidth,
  toDiagramId,
} from '../../architecture/mermaid';

function minWidthStyle(svg: string): CSSProperties | undefined {
  const width = svgNaturalWidth(svg);
  if (width === undefined) return undefined;
  const min = Math.round(Math.min(width, MOBILE_MAX_DIAGRAM_WIDTH));
  return { '--diagram-min-width': `${min}px` } as CSSProperties;
}

type State =
  { kind: 'loading' } | { kind: 'ready'; svg: string } | { kind: 'error'; message: string };

export function MermaidDiagram({ title, code }: { title: string; code: string }) {
  const id = toDiagramId(useId());
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    renderMermaid(id, code).then(
      (svg) => active && setState({ kind: 'ready', svg }),
      (err: unknown) =>
        active &&
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      active = false;
    };
  }, [id, code]);

  return (
    <figure className="card diagram" aria-label={title}>
      <figcaption className="diagram__title">{title}</figcaption>
      {state.kind === 'loading' ? (
        <p className="muted" role="status">
          Carregando diagrama…
        </p>
      ) : null}
      {state.kind === 'ready' ? (
        // SVG gerado pelo Mermaid com securityLevel 'strict' (sanitizado pelo DOMPurify).
        <div
          className="diagram__svg"
          style={minWidthStyle(state.svg)}
          tabIndex={0}
          role="group"
          aria-label={`Diagrama: ${title}`}
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : null}
      {state.kind === 'error' ? (
        <>
          <p className="alert" role="alert">
            Não foi possível renderizar o diagrama: {state.message}
          </p>
          <pre className="diagram__source">
            <code>{code}</code>
          </pre>
        </>
      ) : null}
    </figure>
  );
}
