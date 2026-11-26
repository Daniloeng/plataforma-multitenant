import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from '../App';
import { apiUrl } from '../api/http';
import { pedidoHash } from '../hooks/useHashRoute';
import { POLL_INTERVALO_MS, POLL_TENTATIVAS } from './PedidosPage';
import type { Pedido } from '../api/pedidos';
import { createDemoAuthClient } from '../auth/demo';
import { RECONEXAO_BASE_MS, RECONEXAO_FINAL_MS } from '../hooks/usePedidoAoVivo';
import { COBRANCA_ATRASO_MS } from '../mocks/pagamentos';
import {
  LINHA_DO_TEMPO_VERIFICACAO_MS,
  MOTIVO_RECUSA_LIMITE,
  linhasDoTempoAbertas,
  mensagemPedido,
  pedidosSnapshot,
  resetPedidosStore,
} from '../mocks/pedidos';
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

  it('comprador sem cliente no token vê o aviso do cliente B2B', async () => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({
          usuario: 'bruno',
          nome: 'X',
          papeis: ['comprador'],
          clienteId: null,
          tenants: [
            {
              id: FARMA,
              nome: 'Farmacêutica Boa Saúde',
              plano: 'PROFISSIONAL',
              nivelIsolamento: 'POOL',
              ativo: true,
            },
          ],
        }),
      ),
    );
    await abrir('Bruno Lima');
    expect(
      await screen.findByText('Pedidos exigem o papel comprador ou gestor-tenant.'),
    ).toBeVisible();
    expect(screen.getByText(/o token não traz o cliente B2B/)).toBeVisible();
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
    await waitFor(() => expect(linhas()[0]).toHaveAccessibleName('ped-farmaceutica-0003'));
    expect(linhas()).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('Status'), 'PENDENTE');
    await waitFor(() => expect(linhas()[0]).toHaveAccessibleName('ped-farmaceutica-0008'));
    resetPedidosStore({ [FARMA]: [] });
    await user.click(screen.getByRole('button', { name: 'Atualizar lista' }));
    expect(await screen.findByText('Nenhum pedido pendente.')).toBeVisible();
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

  it('pedido já cancelado no servidor (409 pedido-ja-cancelado) conta como sucesso: recarrega o pedido', async () => {
    const pedidos: string[] = [];
    server.events.on('request:start', ({ request }) => {
      pedidos.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    const user = await abrir('Bruno Lima');
    await tabela();
    // Enquanto isso, o gestor cancelou o pedido em outra tela.
    resetPedidosStore({
      [FARMA]: pedidosSnapshot(FARMA).map((p) =>
        p.id === 'ped-farmaceutica-0008'
          ? { ...p, status: 'CANCELADO', motivoCancelamento: 'CANCELADO_PELO_TENANT' }
          : p,
      ),
    });
    const row = linha('ped-farmaceutica-0008');
    await user.click(within(row).getByRole('button', { name: /Cancelar pedido/ }));
    await user.click(within(row).getByRole('button', { name: 'Sim, cancelar' }));
    expect(await within(row).findByText('Cancelado')).toHaveClass('pill--down');
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument();
    expect(pedidos).toEqual(
      expect.arrayContaining([
        'POST /api/v1/pedidos/ped-farmaceutica-0008/cancelamento',
        'GET /api/v1/pedidos/ped-farmaceutica-0008',
      ]),
    );
  });

  it('com filtro Confirmado, o pedido cancelado sai da lista', async () => {
    const user = await abrir('Bruno Lima');
    await tabela();
    await user.selectOptions(screen.getByLabelText('Status'), 'CONFIRMADO');
    await waitFor(() => expect(linhas()).toHaveLength(1));
    const row = linha('ped-farmaceutica-0003');
    await user.click(within(row).getByRole('button', { name: /Cancelar pedido/ }));
    await user.click(within(row).getByRole('button', { name: 'Sim, cancelar' }));
    expect(await screen.findByText('Nenhum pedido confirmado.')).toBeVisible();
  });

  it('erro ao cancelar mostra o detail do Problem Details', async () => {
    server.use(
      http.post('*/api/v1/pedidos/:id/cancelamento', () =>
        HttpResponse.json(
          {
            type: 'https://plataforma.dev.br/problemas/nao-encontrado',
            title: 'Pedido não encontrado',
            status: 404,
            detail: "O pedido 'ped-farmaceutica-0008' não foi encontrado.",
          },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const user = await abrir('Bruno Lima');
    await tabela();
    const row = linha('ped-farmaceutica-0008');
    await user.click(within(row).getByRole('button', { name: /Cancelar pedido/ }));
    await user.click(within(row).getByRole('button', { name: 'Sim, cancelar' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      "O pedido 'ped-farmaceutica-0008' não foi encontrado.",
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
    expect(linhas()).toHaveLength(4);
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

describe('PedidosPage — pagamento e linha do tempo no detalhe', () => {
  /** Cria um pedido como bruno direto no pedidos-service simulado. */
  async function criarComoBruno(quantidade: number): Promise<Pedido> {
    const response = await fetch(apiUrl('api/v1/pedidos'), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo-bruno',
        'X-Tenant-Id': FARMA,
        'Content-Type': 'application/json',
        'Idempotency-Key': `chave-${quantidade}-poll`,
      },
      body: JSON.stringify({
        itens: [{ produtoId: 'prd-farmaceutica-boa-saude-001', quantidade }],
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Pedido;
  }

  /** Requisições da tela a um caminho (GET do pedido ou a linha do tempo). */
  function conta(caminho: string): () => number {
    let n = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && new URL(request.url).pathname === caminho) n += 1;
    });
    return () => n;
  }
  const contaGets = (id: string) => conta(`/api/v1/pedidos/${id}`);
  const contaFluxos = (id: string) => conta(`/api/v1/pedidos/${id}/linha-do-tempo`);

  /** Backend sem a linha do tempo (anterior ao Dia 8): a tela volta ao poll. */
  function semSse(resposta: () => Response = () => new HttpResponse(null, { status: 404 })) {
    server.use(http.get('*/api/v1/pedidos/:id/linha-do-tempo', resposta));
  }

  /** Avança o relógio falso (setTimeout e Date) e deixa as respostas chegarem. */
  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function situacao() {
    return within(screen.getByRole('article')).getAllByRole('status')[0]!;
  }

  /** Rótulos da linha do tempo, na ordem. */
  function marcos() {
    const linha = screen.getByRole('region', { name: 'Linha do tempo' });
    return within(linha)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.marco__rotulo')!.textContent);
  }

  /** Abre o detalhe e espera o fluxo SSE abrir ("Ao vivo"). */
  async function abrirAoVivo(nome: string, id: string, tenant?: string) {
    const user = await abrir(nome, tenant, pedidoHash(id));
    await screen.findByRole('heading', { name: `Pedido ${id}` });
    expect(await screen.findByText('Ao vivo')).toBeVisible();
    return user;
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('depois de criar, a linha do tempo ao vivo mostra "Pedido criado" e, sozinha, "Pagamento aprovado" (sem poll)', async () => {
    const novo = await criarComoBruno(2);
    const gets = contaGets(novo.id);
    const fluxos = contaFluxos(novo.id);
    await abrirAoVivo('Bruno Lima', novo.id);
    expect(situacao()).toHaveTextContent('Aguardando o pagamento.');
    expect(situacao()).toHaveTextContent('a confirmação aparece aqui sozinha');
    expect(within(screen.getByRole('article')).getByText('Pendente')).toBeVisible();
    expect(marcos()).toEqual(['Pedido criado']);

    await avancar(COBRANCA_ATRASO_MS + LINHA_DO_TEMPO_VERIFICACAO_MS);
    expect(await within(screen.getByRole('article')).findByText('Confirmado')).toHaveClass(
      'pill--up',
    );
    expect(situacao()).toHaveTextContent(
      'Pago. Pagamento aprovado pag-n00001; o pedido está confirmado.',
    );
    expect(marcos()).toEqual(['Pedido criado', 'Pagamento aprovado']);
    const linha = screen.getByRole('region', { name: 'Linha do tempo' });
    expect(within(linha).getByText('pag-n00001')).toBeVisible();

    // Nada de poll: um GET (a carga) e um fluxo aberto, que continua aberto.
    await avancar(POLL_INTERVALO_MS * 3);
    expect(gets()).toBe(1);
    expect(fluxos()).toBe(1);
    expect(screen.getByText('Ao vivo')).toBeVisible();
    expect(linhasDoTempoAbertas()).toBe(1);
  });

  it('cancelamento feito em outra tela (o gestor) chega pelo fluxo: "Cancelado pelo tenant" e "Valor estornado"', async () => {
    await abrirAoVivo('Bruno Lima', 'ped-farmaceutica-0003');
    expect(marcos()).toEqual(['Pedido criado', 'Pagamento aprovado']);
    const response = await fetch(apiUrl('api/v1/pedidos/ped-farmaceutica-0003/cancelamento'), {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-admin', 'X-Tenant-Id': FARMA },
    });
    expect(response.status).toBe(200);
    await avancar(LINHA_DO_TEMPO_VERIFICACAO_MS);
    expect(await screen.findByText('Valor estornado')).toBeVisible();
    expect(marcos()).toEqual([
      'Pedido criado',
      'Pagamento aprovado',
      'Cancelado pelo tenant',
      'Valor estornado',
    ]);
    expect(situacao()).toHaveTextContent(
      'Estornado. O pedido foi pago (pag-farmaceutica-0003) e cancelado depois: o valor foi devolvido ao cliente.',
    );
    expect(within(screen.getByRole('article')).getByText('Cancelado')).toHaveClass('pill--down');
  });

  it('cancelar no detalhe mostra "Cancelado pelo cliente" e "Valor estornado"; um evento atrasado não desfaz', async () => {
    await abrirAoVivo('Bruno Lima', 'ped-farmaceutica-0003');
    const antigo = pedidosSnapshot(FARMA).find((p) => p.id === 'ped-farmaceutica-0003')!;
    act(() => {
      screen.getByRole('button', { name: /Cancelar pedido/ }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'Sim, cancelar' }).click();
    });
    expect(await screen.findByText('Cancelado pelo cliente')).toBeVisible();
    expect(marcos()).toEqual([
      'Pedido criado',
      'Pagamento aprovado',
      'Cancelado pelo cliente',
      'Valor estornado',
    ]);
    // Uma mensagem velha (versão menor) que chegasse agora não volta o pedido para CONFIRMADO.
    resetPedidosStore({
      [FARMA]: pedidosSnapshot(FARMA).map((p) => (p.id === antigo.id ? antigo : p)),
    });
    // O reset fechou o fluxo; com o pedido em estado final, a reconexão espera 10 s.
    await avancar(RECONEXAO_FINAL_MS + LINHA_DO_TEMPO_VERIFICACAO_MS);
    await screen.findByText('Ao vivo');
    expect(marcos()).toHaveLength(4);
    expect(within(screen.getByRole('article')).getByText('Cancelado')).toBeVisible();
  });

  it('acima do limite, o fluxo mostra a recusa; o comprador não vê o motivo do gateway', async () => {
    const novo = await criarComoBruno(50);
    await abrirAoVivo('Bruno Lima', novo.id);
    await avancar(COBRANCA_ATRASO_MS + LINHA_DO_TEMPO_VERIFICACAO_MS);
    await waitFor(() =>
      expect(situacao()).toHaveTextContent(
        'Pagamento recusado. O gateway de pagamento recusou a cobrança e o pedido foi cancelado; nada foi cobrado.',
      ),
    );
    expect(screen.getByText('Pagamento recusado', { selector: 'dd' })).toBeVisible();
    expect(marcos()).toEqual(['Pedido criado', 'Pagamento recusado', 'Pagamento recusado']);
    const linha = screen.getByRole('region', { name: 'Linha do tempo' });
    // O motivo exato é só do gestor: o fluxo manda o RECUSADO com detalhe null para o comprador,
    // e a linha do tempo mostra a explicação genérica.
    expect(within(linha).queryByText(MOTIVO_RECUSA_LIMITE)).not.toBeInTheDocument();
    expect(within(linha).getAllByRole('listitem')[1]).toHaveTextContent(
      'O gateway de pagamento recusou a cobrança e o pedido foi cancelado; nada foi cobrado.',
    );
    expect(within(linha).getByText('Pedido cancelado pela recusa.')).toBeVisible();
    // O comprador não consulta pagamentos (403): a situação não traz o "Motivo:".
    expect(situacao()).not.toHaveTextContent('Motivo:');
  });

  it('o servidor encerra o fluxo: "Reconectando…" e, depois de 1 s, "Ao vivo" de novo', async () => {
    const fluxos = contaFluxos('ped-farmaceutica-0008');
    // A primeira conexão entrega o estado e termina (como o timeout de 5 min do servidor).
    server.use(
      http.get(
        '*/api/v1/pedidos/:id/linha-do-tempo',
        () =>
          new HttpResponse(mensagemPedido(pedidosSnapshot(FARMA)[0]!), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        { once: true },
      ),
    );
    await abrir('Bruno Lima', undefined, '#/pedidos/ped-farmaceutica-0008');
    expect(await screen.findByText('Reconectando…')).toBeVisible();
    expect(situacao()).toHaveTextContent('Aguardando o pagamento.');
    await avancar(RECONEXAO_BASE_MS);
    expect(await screen.findByText('Ao vivo')).toBeVisible();
    expect(fluxos()).toBe(2);
  });

  it('ao sair da tela, o fluxo é abortado', async () => {
    await abrirAoVivo('Bruno Lima', 'ped-farmaceutica-0008');
    expect(linhasDoTempoAbertas()).toBe(1);
    act(() => {
      window.location.hash = '#/pedidos';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await tabela();
    await waitFor(() => expect(linhasDoTempoAbertas()).toBe(0));
  });

  it('sem SSE (404), volta ao poll: consulta de novo a cada 1,5 s até a confirmação chegar', async () => {
    semSse();
    const novo = await criarComoBruno(2);
    const gets = contaGets(novo.id);
    await abrir('Bruno Lima', undefined, pedidoHash(novo.id));
    await screen.findByRole('heading', { name: `Pedido ${novo.id}` });
    await waitFor(() =>
      expect(situacao()).toHaveTextContent('esta tela consulta de novo a cada 1,5 s'),
    );
    expect(situacao()).toHaveTextContent('Aguardando o pagamento.');
    expect(screen.queryByText('Ao vivo')).not.toBeInTheDocument();
    expect(gets()).toBe(1);

    await avancar(POLL_INTERVALO_MS);
    expect(gets()).toBe(2);
    expect(within(screen.getByRole('article')).getByText('Confirmado')).toHaveClass('pill--up');
    expect(situacao()).toHaveTextContent(
      'Pago. Pagamento aprovado pag-n00001; o pedido está confirmado.',
    );
    expect(marcos()).toEqual(['Pedido criado', 'Pagamento aprovado']);

    // Confirmado: o poll para.
    await avancar(POLL_INTERVALO_MS * 3);
    expect(gets()).toBe(2);
  });

  it('sem SSE (endpoint ausente): para depois de 10 consultas sem resposta; "Consultar de novo" recomeça; falha de rede conta como tentativa', async () => {
    semSse(() => new HttpResponse(null, { status: 404 }));
    const gets = contaGets('ped-farmaceutica-0008');
    await abrir('Bruno Lima', undefined, '#/pedidos/ped-farmaceutica-0008');
    await screen.findByRole('heading', { name: 'Pedido ped-farmaceutica-0008' });
    await waitFor(() =>
      expect(situacao()).toHaveTextContent('esta tela consulta de novo a cada 1,5 s'),
    );
    server.use(http.get('*/api/v1/pedidos/:id', () => HttpResponse.error(), { once: true }));
    for (let i = 0; i < POLL_TENTATIVAS; i++) await avancar(POLL_INTERVALO_MS);
    expect(gets()).toBe(1 + POLL_TENTATIVAS);
    expect(situacao()).toHaveTextContent('Aguardando o pagamento. A confirmação ainda não chegou.');
    // A falha de uma consulta não tirou o pedido da tela.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await avancar(POLL_INTERVALO_MS * 2);
    expect(gets()).toBe(1 + POLL_TENTATIVAS);

    act(() => {
      screen.getByRole('button', { name: 'Consultar de novo' }).click();
    });
    await avancar(POLL_INTERVALO_MS);
    expect(gets()).toBe(2 + POLL_TENTATIVAS);
    expect(screen.queryByRole('button', { name: 'Consultar de novo' })).not.toBeInTheDocument();
  });

  it('sem SSE, para de consultar ao sair da tela', async () => {
    semSse();
    const gets = contaGets('ped-farmaceutica-0008');
    await abrir('Bruno Lima', undefined, '#/pedidos/ped-farmaceutica-0008');
    await screen.findByRole('heading', { name: 'Pedido ped-farmaceutica-0008' });
    await waitFor(() =>
      expect(situacao()).toHaveTextContent('esta tela consulta de novo a cada 1,5 s'),
    );
    await avancar(POLL_INTERVALO_MS);
    expect(gets()).toBe(2);
    act(() => {
      window.location.hash = '#/pedidos';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await tabela();
    await avancar(POLL_INTERVALO_MS * 4);
    expect(gets()).toBe(2);
  });

  it('pedido pago e depois cancelado mostra o estorno; cancelado antes da cobrança, "Sem cobrança"', async () => {
    await abrirAoVivo('Administradora', 'ped-farmaceutica-0005', FARMA);
    expect(situacao()).toHaveTextContent(
      'Estornado. O pedido foi pago (pag-farmaceutica-0005) e cancelado depois: o valor foi devolvido ao cliente.',
    );
    expect(marcos()).toEqual([
      'Pedido criado',
      'Pagamento aprovado',
      'Cancelado pelo cliente',
      'Valor estornado',
    ]);
    act(() => {
      window.location.hash = '#/pedidos/ped-farmaceutica-0002';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByRole('heading', { name: 'Pedido ped-farmaceutica-0002' });
    await screen.findByText('Ao vivo');
    expect(situacao()).toHaveTextContent(
      'Sem cobrança. O pedido foi cancelado antes do pagamento.',
    );
    expect(marcos()).toEqual(['Pedido criado', 'Cancelado pelo cliente']);
  });

  it('pago e cancelado, com o estorno ainda a caminho', async () => {
    const [base] = pedidosSnapshot(FARMA);
    resetPedidosStore({
      [FARMA]: [
        {
          ...base!,
          status: 'CANCELADO',
          motivoCancelamento: 'CANCELADO_PELO_TENANT',
          pagamentoId: 'pag-z',
          historico: [
            { tipo: 'CRIADO', em: base!.criadoEm },
            { tipo: 'PAGO', em: base!.criadoEm, detalhe: 'pag-z' },
            { tipo: 'CANCELADO', em: base!.criadoEm, detalhe: 'CANCELADO_PELO_TENANT' },
          ],
        },
      ],
    });
    await abrirAoVivo('Administradora', base!.id, FARMA);
    expect(situacao()).toHaveTextContent(
      'Estorno a caminho. O pedido foi pago (pag-z) e cancelado depois: o valor será devolvido ao cliente.',
    );
  });

  it('o gestor vê o motivo da recusa pelo histórico ou, sem ele, pelo pagamentos-service (ou que ele está indisponível)', async () => {
    await abrirAoVivo('Administradora', 'ped-farmaceutica-0004', FARMA);
    expect(situacao()).toHaveTextContent(
      'Motivo: Valor acima do limite de aprovação do gateway simulado (R$ 10.000,00).',
    );
    const linha = screen.getByRole('region', { name: 'Linha do tempo' });
    expect(within(linha).getByText(MOTIVO_RECUSA_LIMITE)).toBeVisible();

    // Resposta antiga, sem histórico: o motivo vem do pagamentos-service.
    resetPedidosStore({
      [FARMA]: pedidosSnapshot(FARMA).map((p) => ({ ...p, historico: undefined })),
    });
    server.use(http.get('*/api/v1/pagamentos', () => HttpResponse.error(), { once: true }));
    act(() => {
      window.location.hash = '#/pedidos/ped-distribuidora-x';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByRole('alert');
    act(() => {
      window.location.hash = '#/pedidos/ped-farmaceutica-0004';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByRole('heading', { name: 'Pedido ped-farmaceutica-0004' });
    await waitFor(() =>
      expect(situacao()).toHaveTextContent(
        'Motivo: Motivo indisponível: Não foi possível conectar ao pagamentos-service.',
      ),
    );
    await screen.findByText('Ao vivo');
    // A linha do tempo é reconstruída a partir do status.
    expect(marcos()).toEqual(['Pedido criado', 'Pagamento recusado', 'Pagamento recusado']);
  });

  it('recusa sem pagamento no serviço e pedido confirmado sem pagamentoId', async () => {
    resetPedidosStore({
      [FARMA]: [
        {
          id: 'ped-r',
          clienteId: 'cli-x',
          status: 'CANCELADO',
          motivoCancelamento: 'PAGAMENTO_RECUSADO',
          itens: [],
          total: { centavos: 0, moeda: 'BRL' },
          criadoEm: '2026-11-20T12:00:00Z',
        },
        {
          id: 'ped-c',
          clienteId: 'cli-x',
          status: 'CONFIRMADO',
          itens: [],
          total: { centavos: 0, moeda: 'BRL' },
          criadoEm: '2026-11-20T12:00:00Z',
        },
      ],
    });
    server.use(
      http.get('*/api/v1/pagamentos', () => HttpResponse.json({ itens: [], proximoCursor: null })),
    );
    await abrirAoVivo('Administradora', 'ped-r', FARMA);
    await waitFor(() =>
      expect(situacao()).toHaveTextContent('Motivo: O gateway não informou o motivo.'),
    );
    act(() => {
      window.location.hash = '#/pedidos/ped-c';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByRole('heading', { name: 'Pedido ped-c' });
    await screen.findByText('Ao vivo');
    expect(situacao()).toHaveTextContent('Pago. Pagamento aprovado; o pedido está confirmado.');
    expect(marcos()).toEqual(['Pedido criado', 'Pagamento aprovado']);
  });
});
