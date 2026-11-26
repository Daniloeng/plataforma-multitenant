// Fontes lidas em build time pelo Vite (import.meta.glob eager + ?raw): os schemas Avro reais de
// libs/contracts e os documentos de docs/. Nada é buscado em tempo de execução, então a página
// funciona no GitHub Pages. Diretório vazio ou inexistente resulta em {}.

import { parseContracts, type Catalog } from './catalog';
import { extractMermaidBlocks, parseAdrs, type Adr, type MermaidBlock } from './docs';

const contractFiles = import.meta.glob<string>('../../../libs/contracts/src/main/avro/**/*.avsc', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const eventStormingFiles = import.meta.glob<string>('../../../docs/arquitetura/event-storming.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const adrFiles = import.meta.glob<string>('../../../docs/adr/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const CATALOG: Catalog = parseContracts(contractFiles);

export const DIAGRAMS: MermaidBlock[] = Object.values(eventStormingFiles).flatMap((md) =>
  extractMermaidBlocks(md),
);

export const ADRS: Adr[] = parseAdrs(adrFiles);
