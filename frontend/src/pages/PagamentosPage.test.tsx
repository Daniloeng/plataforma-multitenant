import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from '../App';
import type { Pedido } from '../api/pedidos';
import { createDemoAuthClient } from '../auth/demo';
import { pagamentosSnapshot } from '../mocks/pagamentos';
import { resetPedidosStore } from '../mocks/pedidos';
import { server } from '../mocks/server';

type User = ReturnType<typeof userEvent.setup>;

const FARMA = 'farmaceutica-boa-saude';
const AURORA = 'distribuidora-aurora';
const nbsp = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

afterEach(() => {
  window.location.hash = '';
});

/** Abre #/pagamentos no modo demo e entra pelo convite da página. */
async function abrir(nome: string | null, tenant?: string): Promise<User> {
  window.location.hash = '#/pagamentos';
  const user = userEvent.setup();
  render(<App authClient={createDemoAuthClient()} />);
  await screen.findByRole('heading', { name: 'Entre para continuar' });
  if (nome === null) return user;
  await user.click(screen.getByRole('button', { name: new RegExp(`Entrar como ${nome}`) }));
  if (tenant) {
    const sessao = screen.getByRole('region', { name: 'Sessão' });
    await user.selectOptions(await within(sessao).findByLabelText('Tenant'), tenant);
  }
  return user;
}

const tabelaPagamentos = () => screen.findByRole('table', { name: 'Pagamentos do tenant' });
const tabelaExtrato = () => screen.findByRole('table', { name: 'Lançamentos do ledger' });

function linhas(nome: string) {
  return within(screen.getByRole('table', { name: nome }))
    .getAllByRole('row')
    .slice(1);
}

/** `n` pedidos CONFIRMADO (cada um com pagamento aprovado e dois lançamentos). */
function pedidosPagos(n: number): Pedido[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `ped-t${String(n - i).padStart(3, '0')}`,
    clienteId: 'cli-x',
    status: 'CONFIRMADO',
    itens: [{ produtoId: 'p', quantidade: 1 }],
    total: { centavos: 1000, moeda: 'BRL' },
    pagamentoId: `pag-t${String(n - i).padStart(3, '0')}`,
    criadoEm: new Date(Date.UTC(2026, 10, 20) - i * 60_000).toISOString(),
  }));
}

describe('PagamentosPage — acesso', () => {
  it('sem login, convida a entrar; a aba fica entre Pedidos e Arquitetura', async () => {
    await abrir(null);
    expect(screen.getByRole('heading', { level: 1, name: 'Pagamentos' })).toBeVisible();
    expect(document.title).toBe('Pagamentos');
    expect(screen.getByText(/são do financeiro de cada tenant/)).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Páginas' });
    const link = within(nav).getByRole('link', { name: 'Pagamentos' });
    expect(link).toHaveAttribute('href', '#/pagamentos');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Dados do pagamentos-service pelo gateway/)).toBeVisible();
  });

  it('comprador vê o aviso de que só o gestor vê o financeiro, com o caminho para Pedidos', async () => {
    const pedidos: string[] = [];
    server.events.on('request:start', ({ request }) => pedidos.push(request.url));
    await abrir('Bruno Lima');
    const titulo = await screen.findByText('Só o gestor do tenant vê o financeiro.');
    expect(titulo).toBeVisible();
    const aviso = titulo.closest('div')!;
    expect(aviso).toHaveTextContent('gestor-tenant');
    expect(within(aviso).getByRole('link', { name: 'Pedidos' })).toHaveAttribute(
      'href',
      '#/pedidos',
    );
    expect(pedidos.some((u) => u.includes('/api/v1/pagamentos'))).toBe(false);
    server.events.removeAllListeners();
  });

  it('gestora sem tenant escolhido: pede o tenant', async () => {
    await abrir('Ana Souza');
    expect(await screen.findByText('Selecione um tenant no cabeçalho.')).toBeVisible();
    expect(screen.getByText(/Pagamentos e lançamentos vêm do tenant escolhido/)).toBeVisible();
  });

  it('mostra o erro do /me', async () => {
    server.use(http.get('*/api/v1/me', () => HttpResponse.error()));
    await abrir('Ana Souza');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar seus dados.',
    );
  });
});

describe('PagamentosPage — gestor', () => {
  it('ana vê o saldo, os pagamentos (selo, valor, pedido, cliente, motivo) e o extrato explicado', async () => {
    await abrir('Ana Souza', AURORA);
    await tabelaPagamentos();
    await tabelaExtrato();

    const { lancamentos } = pagamentosSnapshot(AURORA);
    const receita = lancamentos
      .filter((l) => l.conta === 'RECEITA_TENANT')
      .reduce((s, l) => s + l.valor.centavos, 0);
    const estornos = lancamentos
      .filter((l) => l.conta === 'ESTORNOS')
      .reduce((s, l) => s + l.valor.centavos, 0);
    const esperado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      (receita - estornos) / 100,
    );
    expect(nbsp(screen.getByTestId('saldo').textContent)).toBe(nbsp(esperado));
    expect(screen.getByText('Saldo (receita líquida)')).toBeVisible();

    const pags = linhas('Pagamentos do tenant');
    expect(pags.map((r) => r.getAttribute('aria-label'))).toEqual([
      'pag-distribuidora-0004',
      'pag-distribuidora-0003',
      'pag-distribuidora-0002',
      'pag-distribuidora-0001',
    ]);
    const aprovado = screen.getByRole('row', { name: 'pag-distribuidora-0004' });
    expect(within(aprovado).getByText('Aprovado')).toHaveClass('pill--up');
    expect(within(aprovado).getByRole('link', { name: 'ped-distribuidora-0004' })).toHaveAttribute(
      'href',
      '#/pedidos/ped-distribuidora-0004',
    );
    expect(aprovado).toHaveTextContent('cli-mercado-bom-preco');
    expect(nbsp(aprovado.textContent)).toContain('R$ 2.318,20');
    expect(
      within(screen.getByRole('row', { name: 'pag-distribuidora-0002' })).getByText('Estornado'),
    ).toHaveClass('pill--planned');
    const recusado = screen.getByRole('row', { name: 'pag-distribuidora-0001' });
    expect(within(recusado).getByText('Recusado')).toHaveClass('pill--down');
    expect(recusado).toHaveTextContent(
      'Valor acima do limite de aprovação do gateway simulado (R$ 10.000,00).',
    );

    expect(screen.getByText(/Partidas dobradas:/)).toBeVisible();
    expect(
      screen.getByText(/créditos em Receita do tenant menos débitos em Estornos/),
    ).toBeVisible();
    const lans = linhas('Lançamentos do ledger');
    expect(lans).toHaveLength(lancamentos.length);
    const primeiro = lans[0]!;
    expect(primeiro).toHaveTextContent('Caixa no gateway');
    expect(primeiro).toHaveTextContent('Dinheiro que passa pelo gateway de pagamento.');
    expect(within(primeiro).getByText('Débito')).toHaveClass('pill--debito');
    expect(within(lans[1]!).getByText('Crédito')).toHaveClass('pill--credito');
    expect(lans[1]).toHaveTextContent('Receita do tenant');
    expect(within(primeiro).getByRole('link', { name: 'ped-distribuidora-0004' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Carregar mais/ })).not.toBeInTheDocument();
  });

  it('filtra por status (e mostra a lista vazia do filtro)', async () => {
    const user = await abrir('Ana Souza', AURORA);
    await tabelaPagamentos();
    await user.selectOptions(screen.getByLabelText('Status do pagamento'), 'RECUSADO');
    await waitFor(() => expect(linhas('Pagamentos do tenant')).toHaveLength(1));
    await user.selectOptions(screen.getByLabelText('Status do pagamento'), 'AUTORIZANDO');
    expect(await screen.findByText('Nenhum pagamento autorizando.')).toBeVisible();
  });

  it('pagina pagamentos e extrato com "Carregar mais" (20 por página) e mostra o erro ao falhar', async () => {
    resetPedidosStore({ [FARMA]: pedidosPagos(25) });
    const user = await abrir('Administradora', FARMA);
    await tabelaPagamentos();
    await tabelaExtrato();
    expect(linhas('Pagamentos do tenant')).toHaveLength(20);
    expect(linhas('Lançamentos do ledger')).toHaveLength(20);

    await user.click(screen.getByRole('button', { name: 'Carregar mais pagamentos' }));
    await waitFor(() => expect(linhas('Pagamentos do tenant')).toHaveLength(25));
    expect(
      screen.queryByRole('button', { name: 'Carregar mais pagamentos' }),
    ).not.toBeInTheDocument();

    server.use(http.get('*/api/v1/ledger/lancamentos', () => HttpResponse.error(), { once: true }));
    await user.click(screen.getByRole('button', { name: 'Carregar mais lançamentos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar mais lançamentos: Não foi possível conectar ao pagamentos-service.',
    );
    await user.click(screen.getByRole('button', { name: 'Carregar mais lançamentos' }));
    await waitFor(() => expect(linhas('Lançamentos do ledger')).toHaveLength(40));
    await user.click(screen.getByRole('button', { name: 'Carregar mais lançamentos' }));
    await waitFor(() => expect(linhas('Lançamentos do ledger')).toHaveLength(50));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(nbsp(screen.getByTestId('saldo').textContent)).toBe('R$ 250,00');
  });

  it('"Carregar mais" que volta depois de trocar o filtro é descartado', async () => {
    resetPedidosStore({ [FARMA]: pedidosPagos(25) });
    let release!: () => void;
    const segura = new Promise<void>((r) => (release = r));
    const user = await abrir('Administradora', FARMA);
    await tabelaPagamentos();
    server.use(
      http.get('*/api/v1/pagamentos', async ({ request }) => {
        if (!new URL(request.url).searchParams.has('cursor')) return undefined;
        await segura;
        return HttpResponse.error();
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Carregar mais pagamentos' }));
    expect(screen.getAllByRole('button', { name: 'Carregando…' })[0]).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Status do pagamento'), 'RECUSADO');
    await screen.findByText('Nenhum pagamento recusado.');
    release();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Carregando…' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Carregar mais" bem-sucedido depois de trocar o filtro também é descartado', async () => {
    resetPedidosStore({ [FARMA]: pedidosPagos(25) });
    let release!: () => void;
    const segura = new Promise<void>((r) => (release = r));
    const user = await abrir('Administradora', FARMA);
    await tabelaPagamentos();
    server.use(
      http.get('*/api/v1/pagamentos', async ({ request }) => {
        if (!new URL(request.url).searchParams.has('cursor')) return undefined;
        await segura;
        return undefined;
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Carregar mais pagamentos' }));
    await user.selectOptions(screen.getByLabelText('Status do pagamento'), 'APROVADO');
    await waitFor(() => expect(linhas('Pagamentos do tenant')).toHaveLength(20));
    release();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Carregando…' })).not.toBeInTheDocument(),
    );
    expect(linhas('Pagamentos do tenant')).toHaveLength(20);
  });

  it('tenant sem movimento: listas vazias e saldo R$ 0,00', async () => {
    resetPedidosStore({ [FARMA]: [] });
    await abrir('Administradora', FARMA);
    expect(await screen.findByText('Nenhum pagamento ainda.')).toBeVisible();
    expect(await screen.findByText('Nenhum lançamento ainda.')).toBeVisible();
    expect(nbsp(screen.getByTestId('saldo').textContent)).toBe('R$ 0,00');
  });

  it('falha ao carregar mostra o erro e como subir o ambiente; "Atualizar" tenta de novo', async () => {
    server.use(
      http.get('*/api/v1/pagamentos', () => HttpResponse.error(), { once: true }),
      http.get('*/api/v1/ledger/lancamentos', () => HttpResponse.error(), { once: true }),
    );
    const user = await abrir('Administradora', FARMA);
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    const [pag, ext] = screen.getAllByRole('alert');
    expect(pag).toHaveTextContent(
      'Não foi possível carregar os pagamentos. Não foi possível conectar ao pagamentos-service.',
    );
    expect(ext).toHaveTextContent('Não foi possível carregar o extrato.');
    expect(ext).toHaveTextContent('VITE_DEMO=true npm run dev');
    expect(screen.getByTestId('saldo')).toHaveTextContent('—');

    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    await tabelaPagamentos();
    await tabelaExtrato();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('saldo')).not.toHaveTextContent('—');
  });

  it('troca de tenant recarrega as listas', async () => {
    const user = await abrir('Ana Souza', AURORA);
    await tabelaPagamentos();
    const sessao = screen.getByRole('region', { name: 'Sessão' });
    await user.selectOptions(within(sessao).getByLabelText('Tenant'), 'atacado-vale-verde');
    await waitFor(() =>
      expect(linhas('Pagamentos do tenant').map((r) => r.getAttribute('aria-label'))).toEqual([
        'pag-atacado-0001',
      ]),
    );
  });
});
