// Leitura dos documentos de arquitetura (Markdown): diagramas Mermaid e ADRs. Funções puras.

import { REPOSITORY_URL } from '../data/roadmap';

export interface MermaidBlock {
  /** Título do heading (## ou ###) imediatamente anterior ao bloco. */
  title: string;
  code: string;
}

export interface Adr {
  /** Número com zeros à esquerda, como no arquivo: "0001". */
  number: string;
  title: string;
  status: string;
  date: string;
  file: string;
  url: string;
}

const HEADING = /^#{2,3}\s+(.+?)\s*#*\s*$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/i;

/**
 * Extrai os blocos ```mermaid de um Markdown, cada um com o título do heading ## ou ###
 * imediatamente anterior. Sem heading antes, o título vira "Diagrama N".
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: MermaidBlock[] = [];
  let heading: string | undefined;
  let fence: string | undefined;
  let buffer: string[] = [];

  for (const line of lines) {
    if (fence !== undefined) {
      if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') {
        blocks.push({ title: heading ?? `Diagrama ${blocks.length + 1}`, code: buffer.join('\n') });
        fence = undefined;
        buffer = [];
      } else {
        buffer.push(line);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = open[1];
      continue;
    }
    const h = HEADING.exec(line);
    if (h) heading = h[1];
  }
  return blocks.filter((b) => b.code.trim() !== '');
}

/** Nome do arquivo de um caminho do glob: ../../../docs/adr/0001-x.md → 0001-x.md. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function field(markdown: string, label: string): string | undefined {
  const re = new RegExp(`^\\s*[-*]\\s*\\*\\*${label}:?\\*\\*:?\\s*(.+?)\\s*$`, 'mi');
  return re.exec(markdown)?.[1];
}

/**
 * Lê um ADR. Formato esperado: "# ADR-0001: Título" na primeira linha e as linhas
 * "- **Status:** Aceito" e "- **Data:** 2026-11-26". Campos ausentes viram "—".
 */
export function parseAdr(file: string, markdown: string): Adr {
  const name = basename(file);
  const firstHeading = /^#\s+(.+?)\s*$/m.exec(markdown)?.[1] ?? '';
  const titled = /^ADR[-\s]?(\d+)\s*[:—–-]\s*(.+)$/i.exec(firstHeading);
  const number = titled?.[1] ?? /^(\d+)/.exec(name)?.[1] ?? '—';
  const title = titled?.[2] ?? (firstHeading || name.replace(/\.md$/i, ''));
  return {
    number,
    title,
    status: field(markdown, 'Status') ?? '—',
    date: field(markdown, 'Data') ?? '—',
    file: name,
    url: `${REPOSITORY_URL}/blob/main/docs/adr/${encodeURIComponent(name)}`,
  };
}

/** Lê todos os ADRs (caminho → conteúdo) e ordena pelo número, depois pelo arquivo. */
export function parseAdrs(files: Readonly<Record<string, string>>): Adr[] {
  return Object.entries(files)
    .map(([path, md]) => parseAdr(path, md))
    .sort(
      (a, b) =>
        a.number.localeCompare(b.number, 'pt-BR', { numeric: true }) ||
        a.file.localeCompare(b.file),
    );
}
