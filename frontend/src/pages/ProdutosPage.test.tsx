import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from '../App';
import { createDemoAuthClient } from '../auth/demo';
import { catalogoSnapshot, resetCatalogoStore } from '../mocks/catalogo';
import { server } from '../mocks/server';
import { SEED_TENANTS, resetTenantStore } from '../mocks/tenants';
import { makeProdutos } from '../test/fixtures';

type User = ReturnType<typeof userEvent.setup>;

afterEach(() => {
  window.location.hash = '';
  server.events.removeAllListeners();
});

const nbsp = (s: string | null) => (s ?? '').replace(/ /g, ' ');

/** Abre #/produtos no modo demo e entra pelo convite da própria página. */
async function abrir(nome: string | null, tenant?: string): Promise<User> {
  window.location.hash = '#/produtos';
  const user = userEvent.setup();
  render(<App authClient={createDemoAuthClient()} />);
  await screen.findByRole('heading', { name: 'Entre para continuar' });
  if (nome === null) return user;
  await user.click(screen.getByRole('button', { name: new RegExp(`Entrar como ${nome}`) }));
  if (tenant) {
    const select = await within(sessao()).findByLabelText('Tenant');
    await user.selectOptions(select, tenant);
  }
  return user;
}

function sessao() {
  return screen.getByRole('region', { name: 'Sessão' });
}

async function tabela() {
  return screen.findByRole('table', { name: 'Produtos do tenant' });
}

function linhas() {
  const table = screen.getByRole('table', { name: 'Produtos do tenant' });
  return within(table).getAllByRole('row').slice(1);
}

function linha(sku: string) {
  return screen.getByRole('row', { name: sku });
}

function formulario() {
  return screen.getByRole('form', { name: 'Novo produto' });
}

/** Registra as URLs de GET /api/v1/produtos que chegaram ao mock. */
function espiaListagens(): URL[] {
  const urls: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/api/v1/produtos')) urls.push(url);
  });
  return urls;
}

describe('ProdutosPage — acesso', () => {
  it('sem login, convida a entrar; a aba aparece na navegação', async () => {
    await abrir(null);
    expect(screen.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible();
    expect(document.title).toBe('Produtos');
    expect(screen.getByText(/O catálogo é de cada tenant/)).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Páginas' });
    expect(within(nav).getByRole('link', { name: 'Produtos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText(/Dados do catalogo-service pelo gateway/)).toBeVisible();
  });

  it('pede um tenant e, ao escolher, mostra o tenant atual e o uso do plano', async () => {
    const user = await abrir('Ana Souza');
    expect(await screen.findByText('Selecione um tenant no cabeçalho.')).toBeVisible();

    await user.selectOptions(within(sessao()).getByLabelText('Tenant'), 'distribuidora-aurora');
    await tabela();
    expect(linhas()).toHaveLength(12);
    const atual = screen.getByRole('region', { name: 'Tenant atual' });
    expect(atual).toHaveTextContent('Distribuidora Aurora de Alimentos Ltda.');
    expect(atual).toHaveTextContent('distribuidora-aurora');
    expect(atual).toHaveTextContent('12 de 500 produtos do plano Profissional');
    expect(atual).toHaveTextContent('2%');
    const barra = within(atual).getByRole('progressbar', { name: 'Uso do plano' });
    expect(barra).toHaveAttribute('aria-valuenow', '12');
    expect(barra).toHaveAttribute('aria-valuemax', '500');

    const arroz = linha('ARZ-T1-5KG');
    expect(nbsp(arroz.textContent)).toContain('R$ 159,90');
    expect(within(arroz).getByText('Ativo')).toHaveClass('pill--up');
    expect(within(linha('SAL-REF-1KG')).getByText('Inativo')).toHaveClass('pill--down');
    expect(screen.getByText('12 produtos')).toBeVisible();
  });

  it('trocar de tenant recarrega a lista (e limpa a busca)', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    await user.type(screen.getByLabelText('Buscar por nome ou SKU'), 'café');
    await waitFor(() => expect(linhas()).toHaveLength(1));

    await user.selectOptions(within(sessao()).getByLabelText('Tenant'), 'atacado-vale-verde');
    await waitFor(() => expect(linhas()).toHaveLength(10));
    expect(screen.getByLabelText('Buscar por nome ou SKU')).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Tenant atual' })).toHaveTextContent(
      '10 de 10.000 produtos do plano Empresarial',
    );
    expect(screen.getByRole('row', { name: 'DET-LIQ-500' })).toBeVisible();
  });

  it('mostra o erro do /me no lugar da página', async () => {
    server.use(http.get('*/api/v1/me', () => HttpResponse.error()));
    await abrir('Ana Souza');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar seus dados. Não foi possível conectar ao gateway.',
    );
  });
});

describe('ProdutosPage — comprador', () => {
  it('bruno vê só os ativos, sem formulário, sem filtro de situação e sem ações de gestor', async () => {
    await abrir('Bruno Lima');
    await tabela();
    expect(linhas()).toHaveLength(9);
    for (const row of linhas()) expect(within(row).getByText('Ativo')).toBeVisible();
    expect(screen.queryByRole('row', { name: 'ESP-ALG-500' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Compradores veem só os produtos ativos e montam o pedido no carrinho/),
    ).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Novo produto' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Situação')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desativar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument();
    // usados conta ativos e inativos.
    expect(screen.getByRole('region', { name: 'Tenant atual' })).toHaveTextContent(
      '10 de 500 produtos do plano Profissional',
    );
  });
});

describe('ProdutosPage — gestor: novo produto', () => {
  it('valida no cliente, deixa o SKU maiúsculo e converte reais em centavos', async () => {
    const corpos: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST')
        void request
          .clone()
          .json()
          .then((b) => corpos.push(b));
    });
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    const form = formulario();
    await user.click(within(form).getByRole('button', { name: 'Criar produto' }));
    const sku = within(form).getByLabelText('SKU');
    expect(sku).toHaveFocus();
    expect(sku).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByText('Informe o SKU.')).toBeVisible();
    expect(within(form).getByText('Informe o nome do produto.')).toBeVisible();
    expect(within(form).getByText('Informe o preço.')).toBeVisible();

    await user.type(sku, 'caf-grao-1kg');
    expect(sku).toHaveValue('CAF-GRAO-1KG');
    await user.type(within(form).getByLabelText('Nome'), 'Café em grão 1 kg — caixa com 10');
    const preco = within(form).getByLabelText('Preço (R$)');
    await user.type(preco, '12,345');
    expect(within(form).getByText('Use no máximo duas casas decimais.')).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Criar produto' }));
    expect(preco).toHaveFocus();

    await user.clear(preco);
    await user.type(preco, '1.234,5');
    await user.click(within(form).getByRole('button', { name: 'Criar produto' }));
    expect(nbsp((await within(form).findByText(/Produto CAF-GRAO-1KG criado/)).textContent)).toBe(
      'Produto CAF-GRAO-1KG criado por R$ 1.234,50.',
    );
    expect(corpos).toEqual([
      {
        sku: 'CAF-GRAO-1KG',
        nome: 'Café em grão 1 kg — caixa com 10',
        preco: { centavos: 123450, moeda: 'BRL' },
      },
    ]);
    expect(sku).toHaveValue('');
    // Entra no topo e conta no plano.
    expect(linhas()[0]).toHaveAccessibleName('CAF-GRAO-1KG');
    expect(screen.getByRole('region', { name: 'Tenant atual' })).toHaveTextContent(
      '13 de 500 produtos',
    );
    expect(screen.getByText('13 produtos')).toBeVisible();
  });

  it('com busca ativa, o produto criado fora do filtro conta no plano mas não entra na lista', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    await user.type(screen.getByLabelText('Buscar por nome ou SKU'), 'café');
    await waitFor(() => expect(linhas()).toHaveLength(1));
    const form = formulario();
    await user.type(within(form).getByLabelText('SKU'), 'ARZ-INT-1KG');
    await user.type(within(form).getByLabelText('Nome'), 'Arroz integral 1 kg');
    await user.type(within(form).getByLabelText('Preço (R$)'), '8');
    await user.click(within(form).getByRole('button', { name: 'Criar produto' }));
    await within(form).findByText(/Produto ARZ-INT-1KG criado/);
    expect(linhas()).toHaveLength(1);
    expect(screen.getByText('1 produto encontrado com o filtro')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Tenant atual' })).toHaveTextContent(
      '13 de 500 produtos',
    );
  });

  it('destaca o SKU duplicado (409 sku-duplicado) no campo', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    const form = formulario();
    const sku = within(form).getByLabelText('SKU');
    await user.type(sku, 'CAF-TOR-500');
    await user.type(within(form).getByLabelText('Nome'), 'Café de novo');
    await user.type(within(form).getByLabelText('Preço (R$)'), '10');
    await user.click(within(form).getByRole('button', { name: 'Criar produto' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(
      "SKU duplicado. Já existe um produto com o SKU 'CAF-TOR-500' neste tenant.",
    );
    expect(sku).toHaveAttribute('aria-invalid', 'true');
    expect(sku).toHaveFocus();
    expect(sku).toHaveAccessibleDescription(/Já existe um produto com o SKU 'CAF-TOR-500'/);

    // Trocar o SKU tira o destaque.
    await user.type(sku, 'X');
    expect(sku).not.toHaveAttribute('aria-invalid');
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('destaca o limite do plano (409 limite-do-plano) e avisa quando o plano está cheio', async () => {
    resetTenantStore(
      SEED_TENANTS.map((t) => (t.id === 'distribuidora-aurora' ? { ...t, plano: 'GRATUITO' } : t)),
    );
    resetCatalogoStore({ 'distribuidora-aurora': makeProdutos(20) });
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    const atual = screen.getByRole('region', { name: 'Tenant atual' });
    expect(atual).toHaveTextContent('20 de 20 produtos do plano Gratuito');
    expect(atual).toHaveTextContent('100%');
    expect(within(atual).getByRole('progressbar').firstElementChild).toHaveClass(
      'progress__bar--cheio',
    );
    const form = formulario();
    expect(form).toHaveTextContent('O tenant já usa todos os produtos do plano');

    await user.type(within(form).getByLabelText('SKU'), 'NOVO-21');
    await user.type(within(form).getByLabelText('Nome'), 'Produto 21');
    await user.type(within(form).getByLabelText('Preço (R$)'), '1,00');
    await user.click(within(form).getByRole('button', { name: 'Criar produto' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Limite do plano atingido. O plano GRATUITO permite 20 produtos e o tenant já tem 20.',
    );
    expect(within(form).getByLabelText('SKU')).not.toHaveAttribute('aria-invalid');
  });

  it('outros erros do POST mostram o detail; sem conexão, a mensagem do serviço', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    server.use(http.post('*/api/v1/produtos', () => HttpResponse.error()));
    const form = formulario();
    await user.type(within(form).getByLabelText('SKU'), 'ABC');
    await user.type(within(form).getByLabelText('Nome'), 'Abc');
    await user.type(within(form).getByLabelText('Preço (R$)'), '1');
    await user.click(within(form).getByRole('button', { name: 'Criar produto' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Não foi possível criar o produto. Não foi possível conectar ao catalogo-service.',
    );
    expect(within(form).getByRole('button', { name: 'Criar produto' })).toBeEnabled();
  });
});

describe('ProdutosPage — gestor: preço, nome e situação', () => {
  it('altera o preço digitado em reais (PUT /preco em centavos)', async () => {
    const corpos: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT')
        void request
          .clone()
          .json()
          .then((b) => corpos.push(b));
    });
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    const arroz = linha('ARZ-T1-5KG');
    await user.click(within(arroz).getByRole('button', { name: 'Alterar preço de ARZ-T1-5KG' }));
    const input = within(arroz).getByLabelText('Novo preço de ARZ-T1-5KG');
    expect(input).toHaveValue('159,90');
    expect(input).toHaveFocus();
    expect(within(arroz).getByRole('button', { name: 'Renomear ARZ-T1-5KG' })).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'abc');
    await user.click(within(arroz).getByRole('button', { name: 'Salvar' }));
    expect(within(arroz).getByRole('alert')).toHaveTextContent(
      'Digite o preço em reais, ex.: 12,90.',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.clear(input);
    await user.type(input, '149,9{Enter}');
    await waitFor(() => expect(nbsp(linha('ARZ-T1-5KG').textContent)).toContain('R$ 149,90'));
    expect(corpos).toEqual([{ centavos: 14990, moeda: 'BRL' }]);
    expect(
      catalogoSnapshot('distribuidora-aurora').find((p) => p.sku === 'ARZ-T1-5KG')!.preco.centavos,
    ).toBe(14990);
  });

  it('erro do servidor fica no editor; Cancelar e Esc fecham sem salvar', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    server.use(
      http.put('*/api/v1/produtos/:id/preco', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Erro', status: 400, detail: 'Preço recusado.' },
          { status: 400 },
        ),
      ),
    );
    const arroz = linha('ARZ-T1-5KG');
    await user.click(within(arroz).getByRole('button', { name: 'Alterar preço de ARZ-T1-5KG' }));
    await user.click(within(arroz).getByRole('button', { name: 'Salvar' }));
    expect(await within(arroz).findByRole('alert')).toHaveTextContent('Preço recusado.');
    expect(within(arroz).getByRole('button', { name: 'Salvar' })).toBeEnabled();
    await user.click(within(arroz).getByRole('button', { name: 'Cancelar' }));
    expect(within(arroz).queryByRole('textbox')).not.toBeInTheDocument();
    expect(nbsp(arroz.textContent)).toContain('R$ 159,90');

    await user.click(within(arroz).getByRole('button', { name: 'Renomear ARZ-T1-5KG' }));
    await user.keyboard('{Escape}');
    expect(within(arroz).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renomeia (PATCH { nome }) validando de 2 a 200 caracteres', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    const cafe = linha('CAF-TOR-500');
    await user.click(within(cafe).getByRole('button', { name: 'Renomear CAF-TOR-500' }));
    const input = within(cafe).getByLabelText('Novo nome de CAF-TOR-500');
    expect(input).toHaveValue('Café torrado e moído 500 g — caixa com 20');
    await user.clear(input);
    await user.type(input, 'x');
    await user.click(within(cafe).getByRole('button', { name: 'Salvar' }));
    expect(within(cafe).getByRole('alert')).toHaveTextContent(
      'O nome deve ter de 2 a 200 caracteres.',
    );
    await user.clear(input);
    await user.type(input, '  Café extraforte 500 g  ');
    await user.click(within(cafe).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(linha('CAF-TOR-500')).toHaveTextContent('Café extraforte 500 g'));
    expect(within(linha('CAF-TOR-500')).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('desativa e ativa (PATCH { ativo }); erro aparece acima da lista', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    await user.click(screen.getByRole('button', { name: 'Desativar CAF-TOR-500' }));
    await waitFor(() =>
      expect(within(linha('CAF-TOR-500')).getByText('Inativo')).toHaveClass('pill--down'),
    );
    expect(linha('CAF-TOR-500')).toHaveClass('produtos__inativo');

    let release: () => void = () => {};
    server.use(
      http.patch('*/api/v1/produtos/:id', async () => {
        await new Promise<void>((r) => (release = r));
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Ativar CAF-TOR-500' }));
    const ativar = screen.getByRole('button', { name: 'Ativar CAF-TOR-500' });
    await waitFor(() => expect(ativar).toBeDisabled());
    expect(ativar).toHaveTextContent('Salvando…');
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível ativar o produto: A API respondeu com HTTP 500.',
    );
    expect(within(linha('CAF-TOR-500')).getByText('Inativo')).toBeVisible();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Desativar ARZ-T1-5KG' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('ProdutosPage — filtro de situação e plano do catálogo', () => {
  it('com o filtro "Ativos", desativar tira o produto da lista e do total', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    await user.selectOptions(screen.getByLabelText('Situação'), 'ativos');
    await waitFor(() => expect(linha('CAF-TOR-500')).toBeInTheDocument());
    const antes = screen.getByText(/com o filtro/).textContent ?? '';
    const n = Number(antes.match(/\d+/)?.[0]);
    await user.click(screen.getByRole('button', { name: 'Desativar CAF-TOR-500' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Desativar CAF-TOR-500' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/com o filtro/).textContent).toContain(String(n - 1));
  });

  it('mostra o plano que o catálogo usou para o limite', async () => {
    server.use(
      http.get('*/api/v1/produtos', () =>
        HttpResponse.json({
          itens: [],
          proximoCursor: null,
          total: 0,
          limitePlano: 20,
          plano: 'GRATUITO',
          usados: 0,
        }),
      ),
    );
    await abrir('Ana Souza', 'distribuidora-aurora');
    expect(await screen.findByText(/0 de 20 produtos do plano Gratuito/)).toBeInTheDocument();
  });
});

describe('ProdutosPage — busca, filtro e paginação', () => {
  it('busca por nome ou SKU com debounce (uma requisição só por termo)', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    const urls = espiaListagens();
    await user.type(screen.getByLabelText('Buscar por nome ou SKU'), 'fej-');
    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(linhas()[0]).toHaveAccessibleName('FEJ-CAR-1KG');
    expect(urls.map((u) => u.searchParams.get('busca'))).toEqual(['fej-']);
    expect(screen.getByText('1 produto encontrado com o filtro')).toBeVisible();

    await user.clear(screen.getByLabelText('Buscar por nome ou SKU'));
    await user.type(screen.getByLabelText('Buscar por nome ou SKU'), 'zzz');
    expect(await screen.findByText('Nenhum produto encontrado.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('filtra por situação (Inativos, Ativos, Todos)', async () => {
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    const urls = espiaListagens();
    const situacao = screen.getByLabelText('Situação');
    await user.selectOptions(situacao, 'inativos');
    await waitFor(() => expect(linhas()).toHaveLength(2));
    expect(urls.at(-1)!.searchParams.get('ativo')).toBe('false');
    expect(screen.getByText('2 produtos encontrados com o filtro')).toBeVisible();
    await user.selectOptions(situacao, 'ativos');
    await waitFor(() => expect(linhas()).toHaveLength(10));
    expect(urls.at(-1)!.searchParams.get('ativo')).toBe('true');
    await user.selectOptions(situacao, 'todos');
    await waitFor(() => expect(linhas()).toHaveLength(12));
    expect(urls.at(-1)!.searchParams.has('ativo')).toBe(false);
  });

  it('pagina com "Carregar mais" pelo proximoCursor', async () => {
    resetCatalogoStore({ 'distribuidora-aurora': makeProdutos(45) });
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    expect(linhas()).toHaveLength(20);
    expect(screen.getByText('45 produtos · mostrando 20')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(linhas()).toHaveLength(40));
    expect(linhas()[20]).toHaveAccessibleName('PRD-021');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(linhas()).toHaveLength(45));
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
    expect(screen.getByText('45 produtos')).toBeVisible();
  });

  it('erro ao carregar mais mantém a lista; "Carregando…" enquanto busca', async () => {
    resetCatalogoStore({ 'distribuidora-aurora': makeProdutos(25) });
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    await tabela();
    let release: () => void = () => {};
    server.use(
      http.get('*/api/v1/produtos', async () => {
        await new Promise<void>((r) => (release = r));
        return HttpResponse.error();
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('button', { name: 'Carregando…' })).toBeDisabled();
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar mais produtos: Não foi possível conectar ao catalogo-service.',
    );
    expect(linhas()).toHaveLength(20);
  });
});

describe('ProdutosPage — erros da listagem', () => {
  it('explica como subir o ambiente e recarrega com "Atualizar lista"', async () => {
    server.use(http.get('*/api/v1/produtos', () => new HttpResponse(null, { status: 500 })));
    const user = await abrir('Ana Souza', 'distribuidora-aurora');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar o catálogo.');
    expect(alert).toHaveTextContent('A API respondeu com HTTP 500.');
    expect(alert).toHaveTextContent('VITE_DEMO=true npm run dev');
    expect(screen.queryByText('Nenhum produto cadastrado ainda.')).not.toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Atualizar lista' }));
    await tabela();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mostra o estado vazio', async () => {
    resetCatalogoStore({ 'distribuidora-aurora': [] });
    await abrir('Ana Souza', 'distribuidora-aurora');
    expect(await screen.findByText('Nenhum produto cadastrado ainda.')).toBeVisible();
    expect(screen.getByText('0 produtos')).toBeVisible();
  });
});
