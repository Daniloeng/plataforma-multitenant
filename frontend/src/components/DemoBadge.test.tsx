import { render, screen } from '@testing-library/react';
import { DemoBadge } from './DemoBadge';

describe('DemoBadge', () => {
  it('aparece quando ativo', () => {
    render(<DemoBadge active />);
    expect(screen.getByText('Modo demo (API simulada)')).toHaveClass('badge--demo');
  });

  it('não renderiza nada quando inativo', () => {
    const { container } = render(<DemoBadge active={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
