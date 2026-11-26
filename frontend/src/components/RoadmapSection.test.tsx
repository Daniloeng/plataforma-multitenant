import { render, screen, within } from '@testing-library/react';
import { ROADMAP } from '../data/roadmap';
import { RoadmapSection } from './RoadmapSection';

describe('RoadmapSection', () => {
  it('lista status-service e Tenants ativos e os três serviços planejados', () => {
    render(<RoadmapSection />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);

    const status = screen.getByRole('listitem', { name: 'status-service' });
    expect(status).toHaveTextContent('Dia 1');
    expect(status).toHaveTextContent('Ativo');
    expect(status).toHaveTextContent('/api/status');

    const tenants = screen.getByRole('listitem', { name: 'Tenants' });
    expect(tenants).toHaveTextContent('Dia 3');
    expect(within(tenants).getByText('Ativo')).toHaveClass('pill--up');
    expect(tenants).toHaveTextContent(
      'Cadastra tenants, plano e nível de isolamento; publica tenant.criado e tenant.alterado pelo outbox.',
    );

    for (const [name, day] of [
      ['Catálogo', 5],
      ['Pedidos', 6],
      ['Pagamentos', 7],
    ] as const) {
      const item = screen.getByRole('listitem', { name });
      expect(item).toHaveTextContent(`Dia ${day}`);
      expect(within(item).getByText('Planejado')).toHaveClass('pill--planned');
    }
  });

  it('cada serviço tem responsabilidade em uma frase', () => {
    for (const s of ROADMAP) {
      expect(s.responsibility.trim().endsWith('.')).toBe(true);
      expect(s.responsibility.split('. ')).toHaveLength(1);
    }
  });

  it('aceita uma lista customizada', () => {
    render(
      <RoadmapSection
        services={[{ name: 'X', day: 9, responsibility: 'Faz X.', situation: 'Ativo' }]}
      />,
    );
    expect(screen.getByText('Ativo')).toHaveClass('pill--up');
  });
});
