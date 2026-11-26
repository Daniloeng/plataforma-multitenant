import { render, screen, within } from '@testing-library/react';
import { makeStatus } from '../test/fixtures';
import { AlertasPanel } from './AlertasPanel';

describe('AlertasPanel', () => {
  it('diz "Nenhum alerta" e explica onde ficam os alertas completos', () => {
    render(<AlertasPanel components={makeStatus().components} />);
    const painel = screen.getByRole('region', { name: 'Alertas' });
    expect(within(painel).getByText('Nenhum alerta')).toBeVisible();
    expect(within(painel).queryByRole('list')).not.toBeInTheDocument();
    expect(painel).not.toHaveClass('alertas--ativos');
    expect(painel).toHaveTextContent('Prometheus e no Grafana');
    expect(within(painel).getByText('observabilidade')).toBeVisible();
  });

  it('lista os alertas ativos por componente', () => {
    render(
      <AlertasPanel
        components={[
          { name: 'pulsar', type: 'PULSAR', status: 'DOWN', latencyMs: null, details: null },
          {
            name: 'pagamentos-service',
            type: 'SERVICE',
            status: 'UP',
            latencyMs: 6,
            details: null,
            metrics: { requests: 200, errorRate: 0.05, p99Ms: 200 },
          },
        ]}
      />,
    );
    const painel = screen.getByRole('region', { name: 'Alertas' });
    expect(painel).toHaveClass('alertas--ativos');
    expect(within(painel).queryByText('Nenhum alerta')).not.toBeInTheDocument();
    const itens = within(within(painel).getByRole('list', { name: 'Alertas ativos' })).getAllByRole(
      'listitem',
    );
    expect(itens.map((li) => li.textContent)).toEqual([
      'pulsar: componente indisponível',
      'pagamentos-service: 5% de erros 5xx, acima de 1%',
    ]);
  });
});
