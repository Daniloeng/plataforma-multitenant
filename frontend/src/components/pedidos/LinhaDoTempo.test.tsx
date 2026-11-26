import { render, screen, within } from '@testing-library/react';
import { LinhaDoTempo } from './LinhaDoTempo';

describe('LinhaDoTempo', () => {
  it('lista ordenada com marcador por tipo, rótulo, data e hora e detalhe traduzido', () => {
    render(
      <LinhaDoTempo
        marcos={[
          { tipo: 'CRIADO', em: '2026-11-26T12:00:00Z' },
          { tipo: 'PAGO', em: '2026-11-26T12:00:01Z', detalhe: 'pag-1' },
          { tipo: 'CANCELADO', em: '2026-11-26T13:00:00Z', detalhe: 'SOLICITADO_PELO_CLIENTE' },
          { tipo: 'ESTORNADO', em: '2026-11-26T13:00:00Z', detalhe: 'pag-1' },
        ]}
      />,
    );
    const secao = screen.getByRole('region', { name: 'Linha do tempo' });
    const lista = within(secao).getByRole('list');
    expect(lista.tagName).toBe('OL');
    const itens = within(lista).getAllByRole('listitem');
    expect(itens.map((li) => li.className)).toEqual([
      'marco marco--criado',
      'marco marco--pago',
      'marco marco--cancelado',
      'marco marco--estornado',
    ]);
    expect(itens[0]).toHaveTextContent('Pedido criado 26/11/2026, 09:00:00');
    expect(itens[1]).toHaveTextContent('Pagamento aprovado 26/11/2026, 09:00:01Pagamento pag-1');
    expect(within(itens[1]!).getByText('pag-1').tagName).toBe('CODE');
    expect(itens[2]).toHaveTextContent('Cancelado pelo cliente 26/11/2026, 10:00:00');
    expect(itens[3]).toHaveTextContent('Valor estornado');
    expect(within(itens[3]!).getByText('pag-1')).toBeVisible();
    // O ícone é decorativo.
    expect(itens[1]!.querySelector('.marco__icone')).toHaveAttribute('aria-hidden', 'true');
    expect(itens[2]!.querySelector('time')).toHaveAttribute('dateTime', '2026-11-26T13:00:00Z');
  });

  it('o gestor vê o motivo do gateway na recusa; cancelamentos por tenant e por expiração', () => {
    render(
      <LinhaDoTempo
        gestor
        marcos={[
          { tipo: 'RECUSADO', em: '2026-11-26T12:00:01Z', detalhe: 'Saldo insuficiente.' },
          { tipo: 'CANCELADO', em: '2026-11-26T12:00:01Z', detalhe: 'PAGAMENTO_RECUSADO' },
          { tipo: 'CANCELADO', em: '2026-11-26T12:15:00Z', detalhe: 'EXPIRADO' },
          { tipo: 'CANCELADO', em: '2026-11-26T12:20:00Z', detalhe: 'CANCELADO_PELO_TENANT' },
        ]}
      />,
    );
    const itens = screen.getAllByRole('listitem');
    expect(itens[0]).toHaveTextContent('Pagamento recusado');
    expect(itens[0]).toHaveTextContent('Saldo insuficiente.');
    expect(itens[1]).toHaveTextContent('Pagamento recusado');
    expect(itens[1]).toHaveTextContent('Pedido cancelado pela recusa.');
    expect(itens[2]).toHaveTextContent('Expirado (sem resposta do pagamento em 15 min)');
    expect(itens[3]).toHaveTextContent('Cancelado pelo tenant');
  });

  it('o comprador vê a explicação genérica da recusa (o detalhe vem null; mesmo vindo, não aparece)', () => {
    render(
      <LinhaDoTempo
        marcos={[
          { tipo: 'RECUSADO', em: '2026-11-26T12:00:01Z', detalhe: null },
          { tipo: 'RECUSADO', em: '2026-11-26T12:00:02Z', detalhe: 'Saldo insuficiente.' },
        ]}
      />,
    );
    const itens = screen.getAllByRole('listitem');
    for (const item of itens) {
      expect(item).toHaveTextContent(
        'O gateway de pagamento recusou a cobrança e o pedido foi cancelado; nada foi cobrado.',
      );
    }
    expect(screen.queryByText('Saldo insuficiente.')).not.toBeInTheDocument();
  });

  it('sem marcos, avisa que não há registro', () => {
    render(<LinhaDoTempo marcos={[]} />);
    expect(screen.getByText('Nenhum marco registrado ainda.')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
