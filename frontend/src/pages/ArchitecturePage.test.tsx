import { render, screen, waitFor } from '@testing-library/react';
import { parseContracts } from '../architecture/catalog';
import { extractMermaidBlocks, parseAdrs } from '../architecture/docs';
import { ADR_FILES, AVRO_FILES, EVENT_STORMING_MD } from '../test/architecture-fixtures';
import { ArchitecturePage } from './ArchitecturePage';

describe('ArchitecturePage', () => {
  it('reúne diagramas, catálogo, matriz e ADRs', async () => {
    render(
      <ArchitecturePage
        catalog={parseContracts(AVRO_FILES)}
        diagrams={extractMermaidBlocks(EVENT_STORMING_MD)}
        adrs={parseAdrs(ADR_FILES)}
      />,
    );
    for (const name of [
      'Event storming',
      'Catálogo de eventos',
      'Quem publica e quem consome',
      'Decisões de arquitetura (ADRs)',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await waitFor(() => expect(screen.getAllByTestId('mermaid-svg')).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('avisa sobre schemas ignorados e mostra estados vazios', () => {
    render(
      <ArchitecturePage
        catalog={parseContracts({ 'x/Quebrado.avsc': '{' })}
        diagrams={[]}
        adrs={[]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('x/Quebrado.avsc: JSON inválido');
    expect(screen.getByText('Nenhum diagrama encontrado.')).toBeVisible();
    expect(screen.getAllByText('Nenhum evento encontrado.')).toHaveLength(2);
    expect(screen.getByText('Nenhum ADR encontrado.')).toBeVisible();
  });
});
