// Renderização de diagramas Mermaid. A biblioteca é carregada por import dinâmico, num chunk
// separado, só quando a página Arquitetura mostra um diagrama.

export type MermaidTheme = 'dark' | 'default';

/** Tema do Mermaid conforme a preferência de cor do sistema. */
export function preferredTheme(): MermaidTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'default';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

/** Id aceito pelo Mermaid (vira seletor CSS): só letras, dígitos, "-" e "_". */
export function toDiagramId(raw: string): string {
  return `mermaid-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Largura natural do SVG (pelo viewBox), para não encolher diagramas largos demais no celular. */
export function svgNaturalWidth(svg: string): number | undefined {
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)/.exec(svg);
  const width = box ? Number(box[1]) : NaN;
  return Number.isFinite(width) && width > 0 ? width : undefined;
}

/** Largura mínima em telas estreitas: a natural, limitada a 720 px (o resto rola na horizontal). */
export const MOBILE_MAX_DIAGRAM_WIDTH = 720;

type MermaidApi = (typeof import('mermaid'))['default'];

let loading: Promise<MermaidApi> | undefined;

/** Carrega o Mermaid uma única vez, mesmo com vários diagramas pedindo ao mesmo tempo. */
export function loadMermaid(): Promise<MermaidApi> {
  loading ??= import('mermaid').then((m) => m.default);
  return loading;
}

/** Renderiza o código Mermaid e devolve o SVG (sanitizado: securityLevel 'strict'). */
export async function renderMermaid(id: string, code: string): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: preferredTheme() });
  const { svg } = await mermaid.render(id, code);
  return svg;
}
