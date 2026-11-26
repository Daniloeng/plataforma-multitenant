import { render, screen, waitFor, within } from '@testing-library/react';
import mermaid from 'mermaid';
import { extractMermaidBlocks } from '../../architecture/docs';
import { EVENT_STORMING_MD } from '../../test/architecture-fixtures';
import { DiagramsSection } from './DiagramsSection';
import { MermaidDiagram } from './MermaidDiagram';

const diagrams = extractMermaidBlocks(EVENT_STORMING_MD);

describe('DiagramsSection', () => {
  it('mostra carregamento e depois o SVG de cada diagrama', async () => {
    render(<DiagramsSection diagrams={diagrams} />);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Carregando diagrama…');

    await waitFor(() => expect(screen.getAllByTestId('mermaid-svg')).toHaveLength(2));
    const fluxo = screen.getByRole('figure', { name: 'Fluxo do pedido' });
    expect(within(fluxo).getByTestId('mermaid-svg').id).toMatch(/^mermaid-[\w-]+$/);
    expect(screen.getByRole('figure', { name: 'Mapa de contextos' })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), diagrams[0]!.code);
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', theme: 'default' }),
    );
  });

  it('em erro, mostra a mensagem e o código-fonte do diagrama', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error on line 2'));
    render(<MermaidDiagram title="Quebrado" code={'graph TD\n  A --'} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível renderizar o diagrama: Parse error on line 2',
    );
    const pre = screen.getByText(/A --/).closest('pre');
    expect(pre).toHaveTextContent('graph TD A --');
    expect(screen.queryByTestId('mermaid-svg')).not.toBeInTheDocument();
  });

  it('define a largura mínima pelo viewBox, limitada a 720 px', async () => {
    vi.mocked(mermaid.render)
      .mockResolvedValueOnce({ svg: '<svg viewBox="0 0 1697 1081"></svg>' } as never)
      .mockResolvedValueOnce({ svg: '<svg viewBox="0 0 576.2 460"></svg>' } as never);
    render(<DiagramsSection diagrams={diagrams} />);
    const largo = await screen.findByRole('group', { name: 'Diagrama: Fluxo do pedido' });
    expect(largo.style.getPropertyValue('--diagram-min-width')).toBe('720px');
    const estreito = await screen.findByRole('group', { name: 'Diagrama: Mapa de contextos' });
    expect(estreito.style.getPropertyValue('--diagram-min-width')).toBe('576px');
  });

  it('aceita rejeições que não são Error', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce('falhou');
    render(<MermaidDiagram title="X" code="graph" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('diagrama: falhou');
  });

  it('ignora o resultado se o componente sair da tela antes', async () => {
    let resolve: (v: { svg: string }) => void = () => {};
    vi.mocked(mermaid.render).mockImplementationOnce(
      () => new Promise((r) => (resolve = r as typeof resolve)) as never,
    );
    const { unmount } = render(<MermaidDiagram title="X" code="graph" />);
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    unmount();
    resolve({ svg: '<svg></svg>' });
    await Promise.resolve();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('mostra mensagem sem diagramas', () => {
    render(<DiagramsSection diagrams={[]} />);
    expect(screen.getByText('Nenhum diagrama encontrado.')).toBeVisible();
  });
});
