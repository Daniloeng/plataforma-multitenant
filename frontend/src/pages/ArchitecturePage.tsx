import type { Catalog } from '../architecture/catalog';
import type { Adr, MermaidBlock } from '../architecture/docs';
import { ADRS, CATALOG, DIAGRAMS } from '../architecture/sources';
import { AdrSection } from '../components/architecture/AdrSection';
import { DiagramsSection } from '../components/architecture/DiagramsSection';
import { EventCatalog } from '../components/architecture/EventCatalog';
import { EventMatrix } from '../components/architecture/EventMatrix';

interface Props {
  catalog?: Catalog;
  diagrams?: readonly MermaidBlock[];
  adrs?: readonly Adr[];
}

/** Página Arquitetura: tudo é lido em build time de libs/contracts e docs/. */
export function ArchitecturePage({ catalog = CATALOG, diagrams = DIAGRAMS, adrs = ADRS }: Props) {
  return (
    <>
      {catalog.problems.length > 0 ? (
        <div className="alert" role="alert">
          <strong>Schemas ignorados:</strong>
          <ul>
            {catalog.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <DiagramsSection diagrams={diagrams} />
      <EventCatalog events={catalog.events} />
      <EventMatrix events={catalog.events} />
      <AdrSection adrs={adrs} />
    </>
  );
}
