import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from '../App';
import type { Pedido } from '../api/pedidos';
import { createDemoAuthClient } from '../auth/demo';
import { pedidosSnapshot, resetPedidosStore } from '../mocks/pedidos';
import { server } from '../mocks/server';

type User = ReturnType<typeof userEvent.setup>;

const FARMA = 'farmaceutica-boa-saude';
const nbsp = (s: string | null) => (s ?? '').replace(/ /g, ' ');

afterEach(() => {
  window.location.hash = '';
  server.events.removeAllListeners();
});

/** Abre o hash (padrão #/pedidos) no modo demo e entra pelo convite da página. */
async function abrir(nome: string | null, tenant?: string, hash = '#/pedidos'): Promise<User> {
  window.location.hash = hash;
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

async function tabela() {
  return screen.findByRole('table', { name: 'Pedidos do tenant' });
}

function linhas() {
  const table = screen.getByRole('table', { name: 'Pedidos do tenant' });
  return within(table).getAllByRole('row').slice(1);
}

function linha(id: string) {
  return screen.getByRole('row', { name: id });
}

/** `n` pedidos PENDENTE de clientes alternados, do mais recente para o mais antigo. */
function makePedidos(n: number): Pedido[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `ped-t${String(n - i).padStart(3, '0')}`,
    clienteId: i % 2 === 0 ? 'cli-bruno' : 'cli-outro',
    status: 'PENDENTE',
    itens: [{ produtoId: 'p', sku: 'SKU-1', nome: 'Produto', quantidade: 1 }],
    total: { centavos: 1000, moeda: 'BRL' },
    criadoEm: new Date(Date.UTC(2026, 10, 20) - i * 60_000).toISOString(),
  }));
}

describe('PedidosPage — acesso', () => {
  it('sem login, convida a entrar; a aba Pedidos fica entre Produtos e Arquitetura', async () => {
    await abrir(null);
    expect(screen.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible();
    expect(document.title).toBe('Pedidos');
    expect(screen.getByText(/entre como comprador para ver os seus pedidos/)).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Páginas' });
    const link = within(nav).getByRole('link', { name: 'Pedidos' });
    expect(link).toHaveAttribute('href', '#/pedidos');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Dados do pedidos-service pelo gateway/)).toBeVisible();
  });

  it('gestor sem tenant escolhido: pede o tenant', async () => {
    await abrir('Ana Souza');
    expect(await screen.findByText('Selecione um tenant no cabeçalho.')).toBeVisible();
    expect(screen.getByText(/Os pedidos vêm do tenant escolhido/)).toBeVisible();
  });

  it('mostra o erro do /me', async () => {
    server.use(http.get('*/api/v1/me', () => HttpResponse.error()));
    await abrir('Ana Souza');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar seus dados. Não foi possível conectar ao gateway.',
    );
  });

  it('usuário sem papel de pedidos vê o aviso', async () => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({
          usuario: 'bruno',
          nome: 'X',
          papeis: [],
          clienteId: null,
          tenants: [],
        }),
      ),
    );
    await abrir('Bruno Lima');
    expect(
      await screen.findByText('Pedidos exigem o papel comprador ou gestor-tenant.'),
    ).toBeVisible();
  });
});

describe('PedidosPage — comprador', () => {
  it('bruno vê só os pedidos do cliente dele, sem coluna Cliente, com data, itens, total e status', async () => {
    await abrir('Bruno Lima');
    await tabela();
    expect(linhas().map((r) => r.getAttribute('aria-label'))).toEqual([
      'ped-farmaceutica-0008',
      'ped-farmaceutica-0005',
      'ped-farmaceutica-0003',
    ]);
    expect(screen.queryByRole('columnheader', { name: 'Cliente' })).not.toBeInTheDocument();
    const recente = linha('ped-farmaceutica-0008');
    expect(nbsp(recente.textContent)).toContain('R$ 1.834,00');
    expect(recente).toHaveTextContent('25/11/2026, 15:00:00');
    expect(recente).toHaveTextContent('Dipirona 500 mg');
    expect(within(recente).getByText('Pendente')).toHaveClass('pill--pendente');
    expect(within(linha('ped-farmaceutica-0005')).getByText('Cancelado')).toHaveClass('pill--down');
    expect(
      within(linha('ped-farmaceutica-0005')).queryByRole('button', { name: /Cancelar/ }),
    ).not.toBeInTheDocument();
    expect(linha('ped-farmaceutica-0003')).toHaveTextContent('e mais 1');
    expect(screen.getByText(/Você vê os pedidos do seu cliente/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ir para Produtos' })).toHaveAttribute(
      'href',
      '#/produtos',
    );
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('filtra por status (e mostra a lista vazia do filtro)', async () => {
    const user = await abrir('Bruno Lima');
    await tabela();
    await user.selectOptions(screen.getByLabelText('Status'), 'CANCELADO');
    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(linhas()[0]).toHaveAccessibleName('ped-farmaceutica-0005');
    await user.selectOptions(screen.getByLabelText('Status'), 'CONFIRMADO');
    expect(await screen.findByText('Nenhum pedido confirmado.')).toBeVisible();
  });

  it('cancela com confirmação inline: "Não" volta atrás, "Sim, cancelar" muda o selo', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const user = await abrir('Bruno Lima');
    await tabela();
    const row = linha('ped-farmaceutica-0008');
    await user.click(
      within(row).getByRole('button', { name: 'Cancelar pedido ped-farmaceutica-0008' }),
    );
    const grupo = within(row).getByRole('group', {
      name: 'Confirmar cancelamento de ped-farmaceutica-0008',
    });
    expect(grupo).toHaveTextContent('Cancelar este pedido?');
    await user.click(within(grupo).getByRole('button', { name: 'Não' }));
    expect(within(row).queryByRole('group')).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /Cancelar pedido/ }));
    await user.click(within(row).getByRole('button', { name: 'Sim, cancelar' }));
    expect(await within(row).findByText('Cancelado')).toHaveClass('pill--down');
    expect(within(row).queryByRole('button', { name: /Cancelar/ })).not.toBeInTheDocument();
    expect(pedidosSnapshot(FARMA)[0]).toMatchObject({
      status: 'CANCELADO',
      motivoCancelamento: 'SOLICITADO_PELO_CLIENTE',
    });
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('com filtro Pendente, o pedido cancelado sai da lista', async () => {
    const user = await abrir('Bruno Lima');
    await tabela();
    await user.selectOptions(screen.getByLabelText('Status'), 'PENDENTE');
    await waitFor(() => expect(linhas()).toHaveLength(2));
    const row = linha('ped-farmaceutica-0003');
    await user.click(within(row).getByRole('button', { name: /Cancelar pedido/ }));
    await user.click(within(row).getByRole('button', { name: 'Sim, cancelar' }));
    await waitFor(() => expect(linhas()).toHaveLength(1));
  });

  it('erro ao cancelar mostra o detail do Problem Details', async () => {
    server.use(
      http.post('*/api/v1/pedidos/:id/cancelamento', () =>
        HttpResponse.json(
          {
            type: 'https://plataforma.dev.br/problemas/pedido-ja-cancelado',
            title: 'Pedido já cancelado',
            status: 409,
            detail: "O pedido 'ped-farmaceutica-0008' já está cancelado.",
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const user = await abrir('Bruno Lima');
    await tabela();
    const row = linha('ped-farmaceutica-0008');
    await user.click(within(row).getByRole('button', { name: /Cancelar pedido/ }));
    await user.click(within(row).getByRole('button', { name: 'Sim, cancelar' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      "O pedido 'ped-farmaceutica-0008' já está cancelado.",
    );
    expect(within(row).getByRole('button', { name: 'Sim, cancelar' })).toBeEnabled();
  });

  it('falha ao listar mostra o erro e como subir o ambiente; "Atualizar lista" tenta de novo', async () => {
    server.use(http.get('*/api/v1/pedidos', () => HttpResponse.error(), { once: true }));
    const user = await abrir('Bruno Lima');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      'Não foi possível carregar os pedidos. Não foi possível conectar ao pedidos-service.',
    );
    expect(alerta).toHaveTextContent('VITE_DEMO=true npm run dev');
    await user.click(screen.getByRole('button', { name: 'Atualizar lista' }));
    await tabela();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem pedidos: mensagem de lista vazia', async () => {
    resetPedidosStore({ [FARMA]: [] });
    await abrir('Bruno Lima');
    expect(await screen.findByText('Nenhum pedido ainda.')).toBeVisible();
  });
});

describe('PedidosPage — detalhe', () => {
  it('abre pelo link da lista: itens com SKU, preço unitário, subtotal e total; volta à lista', async () => {
    const user = await abrir('Bruno Lima');
    await tabela();
    await user.click(screen.getByRole('link', { name: 'Ver pedido ped-farmaceutica-0008' }));
    expect(window.location.hash).toBe('#/pedidos/ped-farmaceutica-0008');
    expect(
      await screen.findByRole('heading', { name: 'Pedido ped-farmaceutica-0008' }),
    ).toBeVisible();
    const itens = screen.getByRole('table', { name: 'Itens do pedido' });
    const dip = within(itens).getByRole('row', { name: 'DIP-500-CX10' });
    expect(nbsp(dip.textContent)).toContain('4R$ 224,50R$ 898,00');
    expect(nbsp(screen.getByRole('article').textContent)).toContain('TotalR$ 1.834,00');
    expect(screen.getByText(/Aguardando o pagamento/)).toBeVisible();
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '← Voltar aos pedidos' }));
    await tabela();
  });

  it('cancela no detalhe e mostra o motivo', async () => {
    const user = await abrir('Bruno Lima', undefined, '#/pedidos/ped-farmaceutica-0008');
    await screen.findByRole('heading', { name: 'Pedido ped-farmaceutica-0008' });
    await user.click(screen.getByRole('button', { name: /Cancelar pedido/ }));
    await user.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
    expect(await screen.findByText('Solicitado pelo cliente')).toBeVisible();
    expect(within(screen.getByRole('article')).getByText('Cancelado')).toHaveClass('pill--down');
    expect(screen.queryByText(/Aguardando o pagamento/)).not.toBeInTheDocument();
  });

  it('pedido de outro cliente: "Pedido não encontrado"', async () => {
    await abrir('Bruno Lima', undefined, '#/pedidos/ped-farmaceutica-0007');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      "Pedido não encontrado. Pedido 'ped-farmaceutica-0007' não encontrado neste tenant.",
    );
    expect(within(alerta).queryByRole('button')).not.toBeInTheDocument();
  });

  it('erro de rede no detalhe: "Tentar de novo"', async () => {
    server.use(http.get('*/api/v1/pedidos/:id', () => HttpResponse.error(), { once: true }));
    const user = await abrir('Bruno Lima', undefined, '#/pedidos/ped-farmaceutica-0008');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível carregar o pedido.');
    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(
      await screen.findByRole('heading', { name: 'Pedido ped-farmaceutica-0008' }),
    ).toBeVisible();
  });

  it('gestor vê o cliente no detalhe; pedido sem preço nos itens mostra "—"', async () => {
    resetPedidosStore({
      [FARMA]: [
        {
          id: 'ped-x',
          clienteId: 'cli-outro',
          status: 'CONFIRMADO',
          itens: [{ produtoId: 'prd-sem-dados', quantidade: 2 }],
          total: { centavos: 0, moeda: 'BRL' },
          criadoEm: '2026-11-20T12:00:00Z',
        },
      ],
    });
    await abrir('Administradora', FARMA, '#/pedidos/ped-x');
    expect(await screen.findByRole('heading', { name: 'Pedido ped-x' })).toBeVisible();
    const article = screen.getByRole('article');
    expect(article).toHaveTextContent('Clientecli-outro');
    expect(within(article).getByText('Confirmado')).toHaveClass('pill--up');
    expect(within(article).queryByText('Atualizado em')).not.toBeInTheDocument();
    const row = within(article).getByRole('row', { name: 'prd-sem-dados' });
    expect(within(row).getAllByText('—')).toHaveLength(3);
  });
});

describe('PedidosPage — gestor', () => {
  it('admin vê os pedidos de todos os clientes do tenant, com a coluna Cliente', async () => {
    await abrir('Administradora', FARMA);
    await tabela();
    expect(linhas()).toHaveLength(8);
    expect(screen.getByRole('columnheader', { name: 'Cliente' })).toBeVisible();
    expect(linha('ped-farmaceutica-0007')).toHaveTextContent('cli-hospital-sao-lucas');
    expect(screen.getByText(/pedidos de todos os clientes do tenant/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Ir para Produtos' })).not.toBeInTheDocument();
  });

  it('ana vê vários clientes e troca de tenant recarregando a lista', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    expect(linhas()).toHaveLength(3);
    expect(new Set(linhas().map((r) => within(r).getAllByRole('cell')[1]!.textContent))).toEqual(
      new Set(['cli-mercado-bom-preco', 'cli-padaria-trigo-de-ouro']),
    );
    const sessao = screen.getByRole('region', { name: 'Sessão' });
    await user.selectOptions(within(sessao).getByLabelText('Tenant'), 'atacado-vale-verde');
    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(linhas()[0]).toHaveTextContent('cli-hotel-serra-verde');
  });

  it('pagina com "Carregar mais" (20 por página) e mostra erro ao falhar', async () => {
    resetPedidosStore({ [FARMA]: makePedidos(45) });
    const user = await abrir('Administradora', FARMA);
    await tabela();
    expect(linhas()).toHaveLength(20);
    expect(linhas()[0]).toHaveAccessibleName('ped-t045');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(linhas()).toHaveLength(40));
    expect(linhas()[20]).toHaveAccessibleName('ped-t025');

    server.use(http.get('*/api/v1/pedidos', () => HttpResponse.error(), { once: true }));
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar mais pedidos: Não foi possível conectar ao pedidos-service.',
    );
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(linhas()).toHaveLength(45));
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('"Carregar mais" que volta depois de trocar o filtro é descartado', async () => {
    resetPedidosStore({ [FARMA]: makePedidos(25) });
    let release!: () => void;
    const segura = new Promise<void>((r) => (release = r));
    const user = await abrir('Administradora', FARMA);
    await tabela();
    server.use(
      http.get('*/api/v1/pedidos', async ({ request }) => {
        if (!new URL(request.url).searchParams.has('cursor')) return undefined;
        await segura;
        return HttpResponse.error();
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(screen.getByRole('button', { name: 'Carregando…' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Status'), 'CANCELADO');
    await screen.findByText('Nenhum pedido cancelado.');
    release();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Carregando…' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
