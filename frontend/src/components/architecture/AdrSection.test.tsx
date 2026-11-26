import { render, screen, within } from '@testing-library/react';
import { parseAdrs } from '../../architecture/docs';
import { ADR_FILES } from '../../test/architecture-fixtures';
import { AdrSection } from './AdrSection';

describe('AdrSection', () => {
  it('lista número, título, status e data com link para o GitHub', () => {
    render(<AdrSection adrs={parseAdrs(ADR_FILES)} />);
    const items = within(screen.getByRole('list', { name: 'ADRs' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = screen.getByRole('listitem', { name: 'ADR-0001' });
    expect(first).toHaveTextContent('Aceito');
    expect(within(first).getByText('2026-11-26')).toHaveAttribute('datetime', '2026-11-26');
    expect(
      within(first).getByRole('link', { name: 'ADR-0001: Modelo de isolamento multi-tenant' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/Daniloeng/plataforma-multitenant/blob/main/docs/adr/0001-multi-tenant.md',
    );
    expect(screen.getByRole('listitem', { name: 'ADR-0002' })).toHaveTextContent('Proposto');
  });

  it('não define datetime quando a data falta', () => {
    render(<AdrSection adrs={parseAdrs({ '0003-x.md': '# ADR-0003: X' })} />);
    expect(screen.getAllByText('—').find((e) => e.tagName === 'TIME')).not.toHaveAttribute(
      'datetime',
    );
  });

  it('mostra trechos entre crases como código', () => {
    render(
      <AdrSection adrs={parseAdrs({ '0004-c.md': '# ADR-0004: Contratos em `libs/contracts`' })} />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('ADR-0004: Contratos em libs/contracts');
    expect(link.querySelector('code')).toHaveTextContent('libs/contracts');
  });

  it('mostra mensagem sem ADRs', () => {
    render(<AdrSection adrs={[]} />);
    expect(screen.getByText('Nenhum ADR encontrado.')).toBeVisible();
  });
});
