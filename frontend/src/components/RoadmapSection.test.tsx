import { render, screen, within } from '@testing-library/react';
import { ROADMAP } from '../data/roadmap';
import { RoadmapSection } from './RoadmapSection';

describe('RoadmapSection', () => {
  it('lista status-service, Tenants, Gateway e Catálogo ativos e os dois serviços planejados', () => {
    render(<RoadmapSection />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);

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

    const gateway = screen.getByRole('listitem', { name: 'Gateway + Keycloak' });
    expect(gateway).toHaveTextContent('Dia 4');
    expect(within(gateway).getByText('Ativo')).toHaveClass('pill--up');
    expect(gateway).toHaveTextContent('X-Tenant-Id');

    const catalogo = screen.getByRole('listitem', { name: 'Catálogo' });
    expect(catalogo).toHaveTextContent('Dia 5');
    expect(within(catalogo).getByText('Ativo')).toHaveClass('pill--up');
    expect(catalogo).toHaveTextContent('produto.alterado e preco.alterado');

    for (const [name, day] of [
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
