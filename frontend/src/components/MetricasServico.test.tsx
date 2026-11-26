import { render, screen, within } from '@testing-library/react';
import type { ServiceMetrics } from '../api/status';
import { ComponentCard } from './ComponentCard';
import { MetricasServico } from './MetricasServico';

function metricas(overrides: Partial<ServiceMetrics> = {}): ServiceMetrics {
  return {
    requests: 1234,
    errorRate: 0.004,
    p99Ms: 180,
    outboxPending: 2,
    outboxLagSeconds: 1.2,
    eventsConsumed: 50,
    eventsFailed: 0,
    ...overrides,
  };
}

/** Lê o par dt/dd de um rótulo dentro da lista de métricas. */
function valor(rotulo: string): HTMLElement {
  const dt = screen.getByText(rotulo, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

describe('MetricasServico', () => {
  it('mostra requisições, p99, erros, outbox e eventos sem destaque quando tudo está bem', () => {
    render(<MetricasServico nome="pedidos-service" metrics={metricas()} />);
    const lista = document.querySelector('dl') as HTMLElement;
    expect(lista).toHaveAttribute('aria-label', 'Métricas de pedidos-service');
    expect(
      within(lista)
        .getAllByRole('term')
        .map((dt) => dt.textContent),
    ).toEqual(['Requisições', 'p99', 'Erros', 'Outbox', 'Eventos']);
    expect(valor('Requisições')).toHaveTextContent('1.234');
    expect(valor('p99')).toHaveTextContent('180 ms');
    expect(valor('Erros')).toHaveTextContent('0,4%');
    expect(valor('Outbox')).toHaveTextContent('2 pendentes · atraso 1 s');
    expect(valor('Eventos')).toHaveTextContent('50 consumidos · 0 falhas');
    expect(screen.getByText('desde a subida do serviço')).toBeVisible();
    expect(document.querySelector('.metrica--alerta, .metrica--atencao')).toBeNull();
  });

  it('esconde os itens nulos (gateway sem outbox nem consumo, sem requisições ainda)', () => {
    render(
      <MetricasServico
        nome="gateway"
        metrics={{
          requests: 0,
          errorRate: 0,
          p99Ms: null,
          outboxPending: null,
          outboxLagSeconds: null,
          eventsConsumed: null,
          eventsFailed: null,
        }}
      />,
    );
    expect(screen.getAllByRole('term').map((dt) => dt.textContent)).toEqual([
      'Requisições',
      'Erros',
    ]);
    expect(valor('Requisições')).toHaveTextContent('0');
  });

  it('mostra só a parte presente do outbox e dos eventos', () => {
    render(
      <MetricasServico
        nome="x"
        metrics={metricas({
          outboxPending: 1,
          outboxLagSeconds: undefined,
          eventsConsumed: null,
          eventsFailed: 1,
        })}
      />,
    );
    expect(valor('Outbox')).toHaveTextContent(/^1 pendente$/);
    expect(valor('Eventos')).toHaveTextContent('1 falha');
    expect(valor('Eventos')).not.toHaveTextContent('consumido');
  });

  it('mostra o atraso do outbox sem o total pendente e o consumo sem falhas', () => {
    render(
      <MetricasServico
        nome="x"
        metrics={metricas({ outboxPending: null, eventsConsumed: 1, eventsFailed: null })}
      />,
    );
    expect(valor('Outbox')).toHaveTextContent(/^atraso 1 s$/);
    expect(valor('Eventos')).toHaveTextContent(/^1 consumido$/);
  });

  it('destaca p99 acima de 3 s, erros acima de 1%, atraso acima de 60 s e falhas de consumo', () => {
    render(
      <MetricasServico
        nome="pagamentos-service"
        metrics={metricas({
          p99Ms: 3500,
          errorRate: 0.02,
          outboxLagSeconds: 125,
          eventsFailed: 3,
        })}
      />,
    );
    const p99 = valor('p99');
    expect(p99).toHaveTextContent('3,5 s (alerta: acima da meta de 3 s)');
    expect(p99.parentElement).toHaveClass('metrica--alerta');
    expect(p99.parentElement).toHaveAttribute('title', 'acima da meta de 3 s');

    expect(valor('Erros')).toHaveTextContent('2% (alerta: acima de 1%)');
    expect(valor('Erros').parentElement).toHaveClass('metrica--alerta');

    expect(valor('Outbox')).toHaveTextContent(
      '2 pendentes · atraso 2 min 5 s (alerta: atraso acima de 60 s)',
    );
    expect(valor('Outbox').parentElement).toHaveClass('metrica--alerta');

    expect(valor('Eventos')).toHaveTextContent(
      '50 consumidos · 3 falhas (atenção: houve falhas de consumo)',
    );
    expect(valor('Eventos').parentElement).toHaveClass('metrica--atencao');
    expect(valor('Requisições').parentElement).not.toHaveAttribute('title');
  });
});

describe('ComponentCard', () => {
  it('mostra as métricas só quando o componente as tem', () => {
    const { rerender } = render(
      <ul>
        <ComponentCard
          component={{
            name: 'pedidos-service',
            type: 'SERVICE',
            status: 'UP',
            latencyMs: 5,
            details: 'readiness UP',
            metrics: metricas(),
          }}
        />
      </ul>,
    );
    const card = screen.getByRole('listitem', { name: 'pedidos-service' });
    expect(within(card).getByText('Requisições')).toBeVisible();
    expect(within(card).getByText('desde a subida do serviço')).toBeVisible();

    rerender(
      <ul>
        <ComponentCard
          component={{
            name: 'pulsar',
            type: 'PULSAR',
            status: 'UP',
            latencyMs: 10,
            details: null,
            metrics: null,
          }}
        />
      </ul>,
    );
    expect(screen.queryByText('Requisições')).not.toBeInTheDocument();
    expect(screen.queryByText('desde a subida do serviço')).not.toBeInTheDocument();
  });
});
