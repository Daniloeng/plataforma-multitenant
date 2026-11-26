import { render, screen, within } from '@testing-library/react';
import { parseContracts } from '../../architecture/catalog';
import { AVRO_FILES } from '../../test/architecture-fixtures';
import { EventMatrix } from './EventMatrix';

const { events } = parseContracts(AVRO_FILES);

describe('EventMatrix', () => {
  it('marca publica/consome com eventos nas linhas e serviços nas colunas', () => {
    render(<EventMatrix events={events} />);
    const region = screen.getByRole('region', { name: 'Matriz produtor × consumidor' });
    expect(region).toHaveAttribute('tabindex', '0');
    const table = within(region).getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Evento', 'tenants', 'catalogo', 'pedidos', 'pagamentos']);

    const row = within(table).getByRole('row', { name: /pedido\.criado/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.dataset.role)).toEqual(['nenhum', 'nenhum', 'publica', 'consome']);
    expect(within(cells[2]!).getByText('publica')).toHaveClass('pill--publica');
    expect(within(cells[3]!).getByText('consome')).toHaveClass('pill--consome');
    expect(within(cells[0]!).getByLabelText('nenhum')).toHaveTextContent('—');
    expect(within(table).getAllByRole('row')).toHaveLength(events.length + 1);
  });

  it('mostra mensagem sem eventos', () => {
    render(<EventMatrix events={[]} />);
    expect(screen.getByText('Nenhum evento encontrado.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
