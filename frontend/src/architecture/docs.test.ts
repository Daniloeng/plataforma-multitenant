import { ADR_FILES, EVENT_STORMING_MD } from '../test/architecture-fixtures';
import { basename, extractMermaidBlocks, parseAdr, parseAdrs } from './docs';
import { ADRS, DIAGRAMS } from './sources';

describe('extractMermaidBlocks', () => {
  it('ignora headings e mermaid aninhado dentro de outros blocos de código', () => {
    const md = [
      '## Diagrama real',
      '```bash',
      '## passo 2',
      'echo oi',
      '```',
      '````markdown',
      '```mermaid',
      'graph TD; X-->Y',
      '```',
      '````',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n');
    expect(extractMermaidBlocks(md)).toEqual([{ title: 'Diagrama real', code: 'graph TD; A-->B' }]);
  });

  it('extrai só os blocos mermaid com o heading anterior', () => {
    expect(extractMermaidBlocks(EVENT_STORMING_MD)).toEqual([
      {
        title: 'Fluxo do pedido',
        code: 'flowchart LR\n  A[Pedido criado] --> B[Pagamento aprovado]',
      },
      { title: 'Mapa de contextos', code: 'graph TD\n  tenants --> catalogo' },
    ]);
  });

  it('usa "Diagrama N" sem heading, aceita ~~~ e CRLF e ignora blocos vazios', () => {
    const md =
      '# Só H1\r\n```mermaid\r\ngraph A\r\n```\r\n~~~ Mermaid\nsequenceDiagram\n~~~\n```mermaid\n\n```\n## Título ##\n````mermaid\npie\n```\n````';
    expect(extractMermaidBlocks(md)).toEqual([
      { title: 'Diagrama 1', code: 'graph A' },
      { title: 'Diagrama 2', code: 'sequenceDiagram' },
      { title: 'Título', code: 'pie\n```' },
    ]);
    expect(extractMermaidBlocks('')).toEqual([]);
  });
});

describe('ADRs', () => {
  it('lê número, título, status, data e link do GitHub', () => {
    expect(
      parseAdr(
        '../../../docs/adr/0001-multi-tenant.md',
        ADR_FILES['../../../docs/adr/0001-multi-tenant.md']!,
      ),
    ).toEqual({
      number: '0001',
      title: 'Modelo de isolamento multi-tenant',
      status: 'Aceito',
      date: '2026-11-26',
      file: '0001-multi-tenant.md',
      url: 'https://github.com/Daniloeng/plataforma-multitenant/blob/main/docs/adr/0001-multi-tenant.md',
    });
  });

  it('tolera ADRs fora do formato', () => {
    expect(parseAdr('0007-sem-titulo.md', 'texto solto')).toMatchObject({
      number: '0007',
      title: '0007-sem-titulo',
      status: '—',
      date: '—',
    });
    expect(parseAdr('leia-me.md', '# Notas\n* **Status**: Rascunho')).toMatchObject({
      number: '—',
      title: 'Notas',
      status: 'Rascunho',
    });
  });

  it('ordena pelo número', () => {
    expect(parseAdrs(ADR_FILES).map((a) => a.number)).toEqual(['0001', '0002']);
    expect(parseAdrs({})).toEqual([]);
    expect(
      parseAdrs({ 'b.md': '# ADR-10: B', 'a.md': '# ADR-10: A', 'c.md': '# ADR-9: C' }).map(
        (a) => a.file,
      ),
    ).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('extrai o nome do arquivo', () => {
    expect(basename('../../../docs/adr/0001-x.md')).toBe('0001-x.md');
    expect(basename('x.md')).toBe('x.md');
  });
});

describe('documentos reais (docs/)', () => {
  it('carregam como listas (vazias enquanto docs/ não existir)', () => {
    expect(Array.isArray(DIAGRAMS)).toBe(true);
    expect(Array.isArray(ADRS)).toBe(true);
    for (const d of DIAGRAMS) expect(d.code.trim()).not.toBe('');
    for (const a of ADRS) expect(a.url).toContain('/blob/main/docs/adr/');
  });
});
