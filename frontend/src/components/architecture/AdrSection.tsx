import type { Adr } from '../../architecture/docs';

/** Mostra trechos entre crases (`libs/contracts`) como código, como no Markdown. */
function InlineCode({ text }: { text: string }) {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

export function AdrSection({ adrs }: { adrs: readonly Adr[] }) {
  return (
    <section className="section" aria-labelledby="adr-title">
      <h2 id="adr-title">Decisões de arquitetura (ADRs)</h2>
      {adrs.length === 0 ? (
        <p className="muted">Nenhum ADR encontrado.</p>
      ) : (
        <ul className="adrs card" aria-label="ADRs">
          {adrs.map((a) => (
            <li key={a.file} className="adr" aria-label={`ADR-${a.number}`}>
              <a href={a.url} target="_blank" rel="noreferrer" className="adr__title">
                <InlineCode text={`ADR-${a.number}: ${a.title}`} />
              </a>
              <span className="adr__meta">
                <span className="pill pill--planned">{a.status}</span>
                <time className="num muted" dateTime={a.date === '—' ? undefined : a.date}>
                  {a.date}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
