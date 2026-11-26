import mermaid from 'mermaid';
import { preferredTheme, renderMermaid, svgNaturalWidth, toDiagramId } from './mermaid';

function stubScheme(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: dark && query.includes('dark'), media: query })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('mermaid', () => {
  it('escolhe o tema pela preferência de cor', () => {
    expect(preferredTheme()).toBe('default'); // jsdom não tem matchMedia
    stubScheme(true);
    expect(preferredTheme()).toBe('dark');
    stubScheme(false);
    expect(preferredTheme()).toBe('default');
  });

  it('gera ids válidos como seletor CSS', () => {
    expect(toDiagramId(':r1:')).toBe('mermaid-r1');
    expect(toDiagramId('«r2»')).toBe('mermaid-r2');
  });

  it('lê a largura natural do viewBox', () => {
    expect(svgNaturalWidth('<svg viewBox="-50 -10 1697 1081">')).toBe(1697);
    expect(svgNaturalWidth('<svg viewBox="0,0,576.5,460">')).toBe(576.5);
    expect(svgNaturalWidth('<svg viewBox="0 0 0 10">')).toBeUndefined();
    expect(svgNaturalWidth('<svg>')).toBeUndefined();
  });

  it('inicializa com securityLevel strict e devolve o SVG', async () => {
    stubScheme(true);
    await expect(renderMermaid('mermaid-x', 'graph TD')).resolves.toContain('id="mermaid-x"');
    expect(mermaid.initialize).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    });
    expect(mermaid.render).toHaveBeenLastCalledWith('mermaid-x', 'graph TD');
  });
});
