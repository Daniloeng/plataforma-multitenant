import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseContracts } from '../../architecture/catalog';
import { AVRO_FILES } from '../../test/architecture-fixtures';
import { EventCatalog } from './EventCatalog';

const { events } = parseContracts(AVRO_FILES);

describe('EventCatalog', () => {
  it('mostra cada evento com produtor, consumidores, tópico e campos legíveis', () => {
    render(<EventCatalog events={events} />);
    expect(screen.getByText('4 eventos')).toBeVisible();

    const tenant = screen.getByRole('listitem', { name: 'tenant.criado' });
    expect(tenant).toHaveTextContent('Um novo tenant foi cadastrado na plataforma.');
    expect(tenant).toHaveTextContent('Produtortenants');
    expect(tenant).toHaveTextContent('Consumidorescatalogo');
    expect(tenant).toHaveTextContent('persistent://plataforma/tenants/tenant.criado.v1');
    const fields = within(tenant).getByRole('list', { name: 'Campos de tenant.criado' });
    expect(fields).toHaveTextContent('plano enum Plano (GRATUITO | PROFISSIONAL | EMPRESARIAL)');
    expect(fields).toHaveTextContent('Razão social.');
    expect(fields).not.toHaveTextContent('eventId');

    // Metadados ficam num <details> fechado, como informação secundária.
    const meta = within(tenant).getByRole('list', {
      name: 'Metadados de tenant.criado',
      hidden: true,
    });
    expect(meta).toHaveTextContent('eventId uuid');
    expect(meta).toHaveTextContent('traceparent string?');
    expect(meta.closest('details')).not.toHaveAttribute('open');
    expect(within(tenant).getByText('Metadados (4)')).toBeVisible();

    const pedido = screen.getByRole('listitem', { name: 'pedido.criado' });
    expect(pedido).toHaveTextContent('itens ItemPedido[]');
    expect(within(pedido).getByRole('list', { name: 'Campos de itens' })).toHaveTextContent(
      'quantidade int',
    );
    expect(pedido).toHaveTextContent('padrão: BRL');

    const produto = screen.getByRole('listitem', { name: 'produto.alterado' });
    expect(produto).toHaveTextContent('nenhum ainda');
    expect(produto).toHaveTextContent('Só metadados.');
  });

  it('filtra por serviço (publica ou consome)', async () => {
    const user = userEvent.setup();
    render(<EventCatalog events={events} />);
    const group = screen.getByRole('group', { name: 'Filtrar por serviço' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Todos', 'tenants', 'catalogo', 'pedidos', 'pagamentos']);
    expect(within(group).getByRole('button', { name: 'Todos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(group).getByRole('button', { name: 'pedidos' }));
    expect(within(group).getByRole('button', { name: 'pedidos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('2 eventos publicados ou consumidos por pedidos')).toBeVisible();
    const list = screen.getByRole('list', { name: 'Eventos' });
    const items = within(list).getAllByRole('listitem', { name: /\./ });
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([
      'pedido.criado',
      'pagamento.aprovado',
    ]);
    expect(within(items[0]!).getByText('publica')).toHaveClass('pill--publica');
    expect(within(items[1]!).getByText('consome')).toHaveClass('pill--consome');

    await user.click(within(group).getByRole('button', { name: 'catalogo' }));
    expect(screen.getByText('2 eventos publicados ou consumidos por catalogo')).toBeVisible();

    await user.click(within(group).getByRole('button', { name: 'Todos' }));
    expect(screen.getByText('4 eventos')).toBeVisible();
  });

  it('avisa quando o filtro não encontra eventos', async () => {
    const user = userEvent.setup();
    render(<EventCatalog events={events.filter((e) => e.producer === 'pedidos')} />);
    expect(screen.getByText('1 evento')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'tenants' }));
    expect(screen.getByText('Nenhum evento encontrado para tenants.')).toBeVisible();
  });

  it('mostra mensagem quando não há schemas', () => {
    render(<EventCatalog events={[]} />);
    expect(screen.getByText('Nenhum evento encontrado.')).toBeVisible();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
