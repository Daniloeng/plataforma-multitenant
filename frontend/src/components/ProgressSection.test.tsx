import { render, screen } from '@testing-library/react';
import { ProgressSection } from './ProgressSection';

describe('ProgressSection', () => {
  it('mostra o Dia 1 de 22 com barra e link do repositório', () => {
    render(<ProgressSection />);
    expect(screen.getByText('Dia 1 de 22')).toBeVisible();
    expect(screen.getByText('5%')).toBeVisible();
    const bar = screen.getByRole('progressbar', { name: 'Progresso do estudo' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '22');
    expect(bar.firstElementChild).toHaveStyle({ width: '5%' });
    expect(screen.getByRole('link', { name: 'repositório no GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/Daniloeng/plataforma-multitenant',
    );
  });

  it('limita o percentual entre 0 e 100', () => {
    const { rerender } = render(<ProgressSection current={30} total={22} />);
    expect(screen.getByText('100%')).toBeVisible();
    rerender(<ProgressSection current={-2} total={22} />);
    expect(screen.getByText('0%')).toBeVisible();
    rerender(<ProgressSection current={1} total={0} />);
    expect(screen.getByText('0%')).toBeVisible();
  });
});
