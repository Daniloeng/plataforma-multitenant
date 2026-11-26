import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from '../App';
import { createDemoAuthClient } from '../auth/demo';
import { carrinhoKey } from '../hooks/useCarrinho';
import { catalogoSnapshot, resetCatalogoStore } from '../mocks/catalogo';
import { pedidosSnapshot } from '../mocks/pedidos';
import { server } from '../mocks/server';
import { makeProdutos } from '../test/fixtures';

type User = ReturnType<typeof userEvent.setup>;

const FARMA = 'farmaceutica-boa-saude';
const KEY = carrinhoKey('bruno', FARMA);
const nbsp = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

afterEach(() => {
  window.location.hash = '';
  server.events.removeAllListeners();
});

async function abrir(nome = 'Bruno Lima', tenant?: string): Promise<User> {
  window.location.hash = '#/produtos';
  const user = userEvent.setup();
  render(<App authClient={createDemoAuthClient()} />);
  await screen.findByRole('heading', { name: 'Entre para continuar' });
  await user.click(screen.getByRole('button', { name: new RegExp(`Entrar como ${nome}`) }));
  if (tenant) {
    const sessao = screen.getByRole('region', { name: 'Sessão' });
    await user.selectOptions(await within(sessao).findByLabelText('Tenant'), tenant);
  }
  await screen.findByRole('table', { name: 'Produtos do tenant' });
  return user;
}

function carrinho() {
  return screen.getByRole('region', { name: 'Carrinho' });
}

async function adicionar(user: User, sku: string, quantidade?: number) {
  if (quantidade !== undefined) {
    const campo = screen.getByLabelText(`Quantidade de ${sku} para adicionar`);
    await user.clear(campo);
    await user.type(campo, String(quantidade));
  }
  await user.click(screen.getByRole('button', { name: `Adicionar ${sku} ao carrinho` }));
}

function item(sku: string) {
  return within(carrinho()).getByRole('listitem', { name: sku });
}

/** Registra a Idempotency-Key de cada POST /api/v1/pedidos. */
function espiaChaves(): string[] {
  const chaves: string[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST') chaves.push(request.headers.get('Idempotency-Key') ?? '');
  });
  return chaves;
}

describe('Carrinho — montar', () => {
  it('comprador adiciona com quantidade, edita, vê subtotal e total estimado, remove e esvazia', async () => {
    const user = await abrir();
    expect(within(carrinho()).getByText(/Seu carrinho está vazio/)).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Carrinho' })).toBeVisible();

    await adicionar(user, 'DIP-500-CX10', 3);
    expect(
      within(screen.getByRole('row', { name: 'DIP-500-CX10' })).getByRole('status'),
    ).toHaveTextContent('3 no carrinho');
    expect(screen.getByLabelText('Quantidade de DIP-500-CX10 para adicionar')).toHaveValue(1);
    await adicionar(user, 'SOR-FIS-500');
    await adicionar(user, 'DIP-500-CX10', 2);

    expect(nbsp(item('DIP-500-CX10').textContent)).toContain('R$ 224,50 cada');
    expect(nbsp(within(carrinho()).getByLabelText('Subtotal de DIP-500-CX10').textContent)).toBe(
      'R$ 1.122,50',
    );
    expect(within(carrinho()).getByLabelText('Quantidade de DIP-500-CX10 no carrinho')).toHaveValue(
      5,
    );
    expect(carrinho()).toHaveTextContent('2 produtos · 6 unidades');
    expect(nbsp(carrinho().textContent)).toContain('Total estimadoR$ 1.216,10');
    expect(carrinho()).toHaveTextContent('O preço final é o do servidor');

    const qtd = within(carrinho()).getByLabelText('Quantidade de SOR-FIS-500 no carrinho');
    await user.clear(qtd);
    expect(within(item('SOR-FIS-500')).getByRole('alert')).toHaveTextContent('Use de 1 a 10.000.');
    expect(qtd).toHaveAttribute('aria-invalid', 'true');
    expect(within(carrinho()).getByRole('button', { name: 'Fazer pedido' })).toBeDisabled();
    await user.type(qtd, '4');
    expect(qtd).not.toHaveAttribute('aria-invalid');
    expect(nbsp(within(carrinho()).getByLabelText('Subtotal de SOR-FIS-500').textContent)).toBe(
      'R$ 374,40',
    );
    expect(within(carrinho()).getByRole('button', { name: 'Fazer pedido' })).toBeEnabled();

    await user.click(
      within(carrinho()).getByRole('button', { name: 'Remover DIP-500-CX10 do carrinho' }),
    );
    expect(carrinho()).toHaveTextContent('1 produto · 4 unidades');
    await user.click(within(carrinho()).getByRole('button', { name: 'Esvaziar carrinho' }));
    expect(within(carrinho()).getByText(/Seu carrinho está vazio/)).toBeVisible();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('quantidade inválida desabilita "Adicionar"', async () => {
    const user = await abrir();
    const campo = screen.getByLabelText('Quantidade de DIP-500-CX10 para adicionar');
    await user.clear(campo);
    await user.type(campo, '0');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByRole('button', { name: 'Adicionar DIP-500-CX10 ao carrinho' }),
    ).toBeDisabled();
  });

  it('o carrinho fica no sessionStorage do tenant e volta depois de recarregar', async () => {
    const user = await abrir();
    await adicionar(user, 'ALC-GEL-70', 2);
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toEqual([
      expect.objectContaining({ sku: 'ALC-GEL-70', quantidade: 2 }),
    ]);
    // "Recarregar": desmonta e monta de novo; a sessão de demo também está no sessionStorage.
    cleanup();
    render(<App authClient={createDemoAuthClient()} />);
    await screen.findByRole('table', { name: 'Produtos do tenant' });
    expect(within(carrinho()).getByLabelText('Quantidade de ALC-GEL-70 no carrinho')).toHaveValue(
      2,
    );
  });

  it('o carrinho aceita até 200 produtos', async () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify(
        makeProdutos(200).map((p) => ({
          produtoId: p.id,
          sku: p.sku,
          nome: p.nome,
          precoUnitario: p.preco,
          quantidade: 1,
        })),
      ),
    );
    const user = await abrir();
    await adicionar(user, 'DIP-500-CX10');
    expect(
      within(screen.getByRole('row', { name: 'DIP-500-CX10' })).getByRole('status'),
    ).toHaveTextContent('O carrinho aceita até 200 produtos.');
  });

  it('quantidade inválida no carrinho e "Adicionar" de novo: o campo volta a valer e "Fazer pedido" também', async () => {
    const user = await abrir();
    await adicionar(user, 'DIP-500-CX10', 2);
    const qtd = within(carrinho()).getByLabelText('Quantidade de DIP-500-CX10 no carrinho');
    await user.clear(qtd);
    expect(within(carrinho()).getByRole('button', { name: 'Fazer pedido' })).toBeDisabled();

    await adicionar(user, 'DIP-500-CX10', 3);
    expect(qtd).toHaveValue(5);
    expect(qtd).not.toHaveAttribute('aria-invalid');
    expect(within(item('DIP-500-CX10')).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(carrinho()).getByRole('button', { name: 'Fazer pedido' })).toBeEnabled();

    // Inválido de novo na nova quantidade: volta a bloquear.
    await user.clear(qtd);
    expect(within(carrinho()).getByRole('button', { name: 'Fazer pedido' })).toBeDisabled();
  });

  it('produtos em moedas diferentes: sem total, com aviso, e "Fazer pedido" desabilitado', async () => {
    const [real, dolar] = makeProdutos(2);
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify(
        [real!, { ...dolar!, preco: { centavos: 990, moeda: 'USD' } }].map((p) => ({
          produtoId: p.id,
          sku: p.sku,
          nome: p.nome,
          precoUnitario: p.preco,
          quantidade: 1,
        })),
      ),
    );
    const user = await abrir();
    expect(within(carrinho()).getByRole('status')).toHaveTextContent(
      'Os produtos têm moedas diferentes; faça um pedido por moeda.',
    );
    expect(carrinho()).not.toHaveTextContent('Total estimado');
    expect(within(carrinho()).getByRole('button', { name: 'Fazer pedido' })).toBeDisabled();

    await user.click(
      within(carrinho()).getByRole('button', { name: `Remover ${dolar!.sku} do carrinho` }),
    );
    expect(within(carrinho()).queryByRole('status')).not.toBeInTheDocument();
    expect(carrinho()).toHaveTextContent('Total estimado');
    expect(within(carrinho()).getByRole('button', { name: 'Fazer pedido' })).toBeEnabled();
  });

  it('comprador sem cliente no token não vê o carrinho', async () => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({
          usuario: 'bruno',
          nome: 'Bruno Lima',
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
    await abrir();
    expect(screen.queryByRole('region', { name: 'Carrinho' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ao carrinho/ })).not.toBeInTheDocument();
  });

  it('gestor não vê o carrinho nem "Adicionar ao carrinho"', async () => {
    await abrir('Ana Souza', 'distribuidora-aurora');
    expect(screen.queryByRole('region', { name: 'Carrinho' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ao carrinho/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Carrinho' })).not.toBeInTheDocument();
  });
});

describe('Carrinho — fazer pedido', () => {
  it('envia só produto e quantidade com Idempotency-Key, esvazia o carrinho e abre o pedido criado', async () => {
    const corpos: unknown[] = [];
    const chaves = espiaChaves();
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST')
        void request
          .clone()
          .json()
          .then((b) => corpos.push(b));
    });
    const user = await abrir();
    await adicionar(user, 'DIP-500-CX10', 2);
    await adicionar(user, 'MAS-TRI-50', 10);
    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible();
    expect(window.location.hash).toBe('#/pedidos/ped-n00001');
    expect(await screen.findByRole('heading', { name: 'Pedido ped-n00001' })).toBeVisible();
    expect(nbsp(screen.getByRole('article').textContent)).toContain('TotalR$ 598,00');
    expect(corpos).toEqual([
      {
        itens: [
          { produtoId: 'prd-farmaceutica-boa-saude-001', quantidade: 2 },
          { produtoId: 'prd-farmaceutica-boa-saude-006', quantidade: 10 },
        ],
      },
    ]);
    expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('erro de rede: "Tentar de novo" repete com a mesma chave e o pedido não é duplicado', async () => {
    const chaves = espiaChaves();
    server.use(http.post('*/api/v1/pedidos', () => HttpResponse.error(), { once: true }));
    const antes = pedidosSnapshot(FARMA).length;
    const user = await abrir();
    await adicionar(user, 'TER-DIG-01', 1);
    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));

    const alerta = await within(carrinho()).findByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível fazer o pedido.');
    expect(alerta).toHaveTextContent('Não foi possível conectar ao pedidos-service.');
    expect(alerta).toHaveTextContent('a repetição usa a mesma chave de idempotência');

    await user.click(within(carrinho()).getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(window.location.hash).toBe('#/pedidos/ped-n00001'));
    expect(chaves).toHaveLength(2);
    expect(chaves[1]).toBe(chaves[0]);
    expect(pedidosSnapshot(FARMA)).toHaveLength(antes + 1);
  });

  it('produto-indisponivel destaca o item citado e mantém o carrinho', async () => {
    const user = await abrir();
    await adicionar(user, 'DIP-500-CX10', 1);
    await adicionar(user, 'SOR-FIS-500', 1);
    // Enquanto isso, o gestor desativou a dipirona.
    resetCatalogoStore({
      [FARMA]: catalogoSnapshot(FARMA).map((p) =>
        p.sku === 'DIP-500-CX10' ? { ...p, ativo: false } : p,
      ),
    });
    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));

    const alerta = await within(carrinho()).findByRole('alert');
    expect(alerta).toHaveClass('alert--indisponivel');
    expect(alerta).toHaveTextContent('Produto indisponível.');
    expect(alerta).toHaveTextContent(
      'Produto indisponível (inexistente, inativo ou sem preço no catálogo): prd-farmaceutica-boa-saude-001.',
    );
    expect(alerta).toHaveTextContent('Remova o item destacado');
    expect(item('DIP-500-CX10')).toHaveClass('carrinho__item--indisponivel');
    expect(item('DIP-500-CX10')).toHaveTextContent('indisponível');
    expect(item('SOR-FIS-500')).not.toHaveClass('carrinho__item--indisponivel');
    expect(window.location.hash).toBe('#/produtos');

    await user.click(
      within(carrinho()).getByRole('button', { name: 'Remover DIP-500-CX10 do carrinho' }),
    );
    expect(within(carrinho()).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/pedidos\/ped-n/));
  });

  it('produto-indisponivel com vários itens: destaca todos os de `produtos`', async () => {
    const user = await abrir();
    await adicionar(user, 'DIP-500-CX10', 1);
    await adicionar(user, 'SOR-FIS-500', 1);
    await adicionar(user, 'LUV-PRO-M', 1);
    resetCatalogoStore({
      [FARMA]: catalogoSnapshot(FARMA).map((p) =>
        p.sku === 'DIP-500-CX10' || p.sku === 'LUV-PRO-M' ? { ...p, ativo: false } : p,
      ),
    });
    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));

    const alerta = await within(carrinho()).findByRole('alert');
    expect(alerta).toHaveTextContent('Remova os itens destacados');
    expect(item('DIP-500-CX10')).toHaveClass('carrinho__item--indisponivel');
    expect(item('LUV-PRO-M')).toHaveClass('carrinho__item--indisponivel');
    expect(item('SOR-FIS-500')).not.toHaveClass('carrinho__item--indisponivel');
  });

  it('com `produtos`, compara ids exatos (o detail não conta); sem `produtos`, procura no detail', async () => {
    const sor = catalogoSnapshot(FARMA).find((p) => p.sku === 'SOR-FIS-500')!;
    const problema = (extras: Record<string, unknown>) =>
      HttpResponse.json(
        {
          type: 'https://plataforma.dev.br/problemas/produto-indisponivel',
          title: 'Produto indisponível',
          status: 409,
          detail: 'O produto DIP-500-CX10 está indisponível.',
          ...extras,
        },
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
      );
    server.use(
      http.post('*/api/v1/pedidos', () => problema({ produtos: [sor.id] }), { once: true }),
      http.post('*/api/v1/pedidos', () => problema({}), { once: true }),
    );
    const user = await abrir();
    await adicionar(user, 'DIP-500-CX10', 1);
    await adicionar(user, 'SOR-FIS-500', 1);

    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));
    await within(carrinho()).findByRole('alert');
    expect(item('SOR-FIS-500')).toHaveClass('carrinho__item--indisponivel');
    expect(item('DIP-500-CX10')).not.toHaveClass('carrinho__item--indisponivel');

    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));
    await waitFor(() => expect(item('DIP-500-CX10')).toHaveClass('carrinho__item--indisponivel'));
    expect(item('SOR-FIS-500')).not.toHaveClass('carrinho__item--indisponivel');
  });

  it('mostra o título de chave reutilizada e limpa o erro ao mudar a quantidade', async () => {
    server.use(
      http.post('*/api/v1/pedidos', () =>
        HttpResponse.json(
          {
            type: 'https://plataforma.dev.br/problemas/chave-reutilizada',
            title: 'Idempotency-Key reutilizada',
            status: 409,
            detail: 'Esta Idempotency-Key já foi usada com outro corpo.',
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const user = await abrir();
    await adicionar(user, 'LUV-PRO-M', 1);
    await user.click(within(carrinho()).getByRole('button', { name: 'Fazer pedido' }));
    const alerta = await within(carrinho()).findByRole('alert');
    expect(alerta).toHaveTextContent('Chave de idempotência reutilizada.');
    expect(alerta).toHaveTextContent('já foi usada com outro corpo');

    await user.type(within(carrinho()).getByLabelText('Quantidade de LUV-PRO-M no carrinho'), '2');
    expect(within(carrinho()).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(within(carrinho()).getByRole('button', { name: 'Esvaziar carrinho' }));
    expect(within(carrinho()).getByText(/Seu carrinho está vazio/)).toBeVisible();
  });
});
