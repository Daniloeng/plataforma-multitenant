import { render, screen, within } from '@testing-library/react';
import { ROADMAP } from '../data/roadmap';
import { RoadmapSection } from './RoadmapSection';

describe('RoadmapSection', () => {
  it('lista status-service, Tenants, Gateway, Catálogo, Pedidos e Pagamentos ativos e a Saga planejada', () => {
    render(<RoadmapSection />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(7);

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

    const pedidos = screen.getByRole('listitem', { name: 'Pedidos' });
    expect(pedidos).toHaveTextContent('Dia 6');
    expect(within(pedidos).getByText('Ativo')).toHaveClass('pill--up');
    expect(pedidos).toHaveTextContent('Idempotency-Key');
    expect(pedidos).toHaveTextContent('pedido.criado e pedido.cancelado');

    const pagamentos = screen.getByRole('listitem', { name: 'Pagamentos' });
    expect(pagamentos).toHaveTextContent('Dia 7');
    expect(within(pagamentos).getByText('Ativo')).toHaveClass('pill--up');
    expect(pagamentos).toHaveTextContent('ledger de partidas dobradas');
    expect(pagamentos).toHaveTextContent(
      'pagamento.aprovado, pagamento.recusado e pagamento.estornado',
    );

    const saga = screen.getByRole('listitem', { name: 'Saga do pedido' });
    expect(saga).toHaveTextContent('Dia 8');
    expect(within(saga).getByText('Planejado')).toHaveClass('pill--planned');
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
