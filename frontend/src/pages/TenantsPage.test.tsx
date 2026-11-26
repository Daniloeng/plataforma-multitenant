import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { resetTenantStore, tenantStoreSnapshot } from '../mocks/tenants';
import { makeTenants } from '../test/fixtures';
import { TenantsPage } from './TenantsPage';
import { signInAs } from '../test/session';

// Desde o Dia 4 a API de tenants exige token com o papel plataforma-admin.
beforeEach(() => signInAs('admin'));

function rows() {
  const table = screen.getByRole('table', { name: 'Tenants cadastrados' });
  // A primeira linha é o cabeçalho.
  return within(table).getAllByRole('row').slice(1);
}

async function renderLoaded() {
  const user = userEvent.setup();
  render(<TenantsPage />);
  await screen.findByRole('table', { name: 'Tenants cadastrados' });
  return user;
}

function problem(status: number, detail: string) {
  return HttpResponse.json(
    { type: 'about:blank', title: 'Erro', status, detail },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

describe('TenantsPage — lista', () => {
  it('mostra carregamento e depois os tenants do Tenant Service', async () => {
    render(<TenantsPage />);
    expect(screen.getByText('Carregando tenants…')).toHaveAttribute('role', 'status');
    await screen.findByRole('table', { name: 'Tenants cadastrados' });
    expect(rows()).toHaveLength(5);

    const aurora = screen.getByRole('row', { name: 'distribuidora-aurora' });
    expect(aurora).toHaveTextContent('Distribuidora Aurora de Alimentos Ltda.');
    expect(aurora).toHaveTextContent('Profissional');
    expect(within(aurora).getByText('Pool')).toHaveClass('pill--nivel-pool');
    expect(within(aurora).getByText('Ativo')).toHaveClass('pill--up');
    // 18:42:10Z = 15:42:10 em Brasília.
    expect(within(aurora).getByText('25/11/2026, 15:42:10')).toHaveAttribute(
      'datetime',
      '2026-11-25T18:42:10Z',
    );
    expect(
      within(aurora).getByRole('button', { name: 'Suspender distribuidora-aurora' }),
    ).toBeEnabled();

    const silo = screen.getByRole('row', { name: 'metalurgica-serra-azul' });
    expect(within(silo).getByText('Silo')).toHaveClass('pill--nivel-silo');
    const bridge = screen.getByRole('row', { name: 'atacado-vale-verde' });
    expect(within(bridge).getByText('Bridge')).toHaveClass('pill--nivel-bridge');

    const suspenso = screen.getByRole('row', { name: 'ceramica-paraiba' });
    expect(within(suspenso).getByText('Suspenso')).toHaveClass('pill--down');
    expect(
      within(suspenso).getByRole('button', { name: 'Reativar ceramica-paraiba' }),
    ).toBeVisible();

    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mostra o estado vazio', async () => {
    resetTenantStore([]);
    render(<TenantsPage />);
    expect(await screen.findByText('Nenhum tenant cadastrado ainda.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explica como subir o tenant-service quando a API está inacessível', async () => {
    server.use(http.get('*/api/v1/tenants', () => HttpResponse.error()));
    const user = userEvent.setup();
    render(<TenantsPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('API inacessível.');
    expect(alert).toHaveTextContent('Não foi possível conectar ao tenant-service.');
    expect(alert).toHaveTextContent(
      'docker compose -f infra/docker-compose.yml up -d --build --wait',
    );
    expect(alert).toHaveTextContent('VITE_DEMO=true npm run dev');
    expect(screen.queryByText('Nenhum tenant cadastrado ainda.')).not.toBeInTheDocument();

    // Quando a API volta, "Atualizar lista" recarrega.
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Atualizar lista' }));
    await screen.findByRole('table', { name: 'Tenants cadastrados' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mostra o código HTTP quando a listagem responde 500 sem corpo', async () => {
    server.use(http.get('*/api/v1/tenants', () => new HttpResponse(null, { status: 500 })));
    render(<TenantsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('A API respondeu com HTTP 500.');
  });

  it('pagina com "Carregar mais" usando o proximoCursor', async () => {
    resetTenantStore(makeTenants(45));
    const user = await renderLoaded();
    expect(rows()).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(rows()).toHaveLength(40));
    expect(rows()[20]).toHaveAccessibleName('tenant-21');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(rows()).toHaveLength(45));
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('desabilita "Carregar mais" enquanto busca e não duplica tenants já exibidos', async () => {
    resetTenantStore(makeTenants(21));
    const user = await renderLoaded();

    let release: () => void = () => {};
    server.use(
      http.get('*/api/v1/tenants', async () => {
        await new Promise<void>((r) => (release = r));
        // Simula uma página que repete um tenant já carregado.
        return HttpResponse.json({ itens: makeTenants(21).slice(19), proximoCursor: null });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('button', { name: 'Carregando…' })).toBeDisabled();
    release();
    await waitFor(() => expect(rows()).toHaveLength(21));
  });

  it('mostra erro ao carregar mais e mantém a lista', async () => {
    resetTenantStore(makeTenants(25));
    const user = await renderLoaded();
    server.use(http.get('*/api/v1/tenants', () => HttpResponse.error()));
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar mais tenants: Não foi possível conectar ao tenant-service.',
    );
    expect(rows()).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeEnabled();
  });
});

describe('TenantsPage — recarregar', () => {
  it('mostra "Atualizando…" e descarta a resposta de uma busca substituída', async () => {
    const user = await renderLoaded();
    const releases: (() => void)[] = [];
    let chamadas = 0;
    server.use(
      http.get('*/api/v1/tenants', async () => {
        chamadas += 1;
        const itens = chamadas === 1 ? makeTenants(1) : makeTenants(3);
        await new Promise<void>((r) => releases.push(r));
        return HttpResponse.json({ itens, proximoCursor: null });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Atualizar lista' }));
    expect(await screen.findByRole('button', { name: 'Atualizando…' })).toBeDisabled();
    expect(rows()).toHaveLength(5);
    releases.forEach((r) => r());
    await waitFor(() => expect(rows()).toHaveLength(1));
  });
});

describe('TenantsPage — suspender e reativar', () => {
  it('suspende e reativa via PATCH ativo', async () => {
    const user = await renderLoaded();
    const row = () => screen.getByRole('row', { name: 'distribuidora-aurora' });

    await user.click(within(row()).getByRole('button', { name: 'Suspender distribuidora-aurora' }));
    expect(await within(row()).findByText('Suspenso')).toBeVisible();
    expect(tenantStoreSnapshot().find((t) => t.id === 'distribuidora-aurora')?.ativo).toBe(false);

    await user.click(within(row()).getByRole('button', { name: 'Reativar distribuidora-aurora' }));
    expect(await within(row()).findByText('Ativo')).toBeVisible();
    expect(tenantStoreSnapshot().find((t) => t.id === 'distribuidora-aurora')?.ativo).toBe(true);
  });

  it('desabilita o botão da linha enquanto salva', async () => {
    const user = await renderLoaded();
    let release: () => void = () => {};
    let corpo: unknown;
    server.use(
      http.patch('*/api/v1/tenants/:id', async ({ request }) => {
        corpo = await request.json();
        await new Promise<void>((r) => (release = r));
        const metalurgica = tenantStoreSnapshot().find((t) => t.id === 'metalurgica-serra-azul');
        return HttpResponse.json({ ...metalurgica!, ativo: false });
      }),
    );
    const row = screen.getByRole('row', { name: 'metalurgica-serra-azul' });
    await user.click(within(row).getByRole('button', { name: 'Suspender metalurgica-serra-azul' }));
    expect(await within(row).findByText('Salvando…')).toBeDisabled();
    expect(corpo).toEqual({ ativo: false });
    release();
    expect(await within(row).findByText('Suspenso')).toBeVisible();
  });

  it('mostra o detail quando o PATCH falha', async () => {
    server.use(
      http.patch('*/api/v1/tenants/:id', () =>
        problem(404, "Tenant 'ceramica-paraiba' não encontrado."),
      ),
    );
    const user = await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Reativar ceramica-paraiba' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Não foi possível reativar 'ceramica-paraiba': Tenant 'ceramica-paraiba' não encontrado.",
    );
    const row = screen.getByRole('row', { name: 'ceramica-paraiba' });
    expect(within(row).getByText('Suspenso')).toBeVisible();
    expect(within(row).getByRole('button', { name: 'Reativar ceramica-paraiba' })).toBeEnabled();
  });

  it('mostra erro de rede ao suspender', async () => {
    server.use(http.patch('*/api/v1/tenants/:id', () => HttpResponse.error()));
    const user = await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Suspender atacado-vale-verde' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Não foi possível suspender 'atacado-vale-verde'",
    );
  });
});

describe('TenantsPage — novo tenant', () => {
  it('tem campos rotulados, ajuda no id e explicação do nível (padrão Pool)', async () => {
    const user = await renderLoaded();
    const form = screen.getByRole('form', { name: 'Novo tenant' });
    const id = within(form).getByLabelText('Id');
    expect(id).toHaveAccessibleDescription(
      'Letras minúsculas, números e hífen; vira nome de database e de namespace.',
    );
    expect(id).not.toHaveAttribute('aria-invalid');
    expect(within(form).getByLabelText('Nome')).toBeVisible();
    const plano = within(form).getByLabelText('Plano');
    expect(
      within(plano)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Gratuito', 'Profissional', 'Empresarial']);
    const nivel = within(form).getByLabelText('Nível de isolamento');
    expect(nivel).toHaveValue('POOL');
    expect(nivel).toHaveAccessibleDescription(/^Pool: coleções e tópicos compartilhados/);
    await user.selectOptions(nivel, 'BRIDGE');
    expect(nivel).toHaveAccessibleDescription(/^Bridge: database MongoDB e namespace Pulsar/);
    await user.selectOptions(nivel, 'SILO');
    expect(nivel).toHaveAccessibleDescription(/^Silo: instância MongoDB/);
  });

  it('cria o tenant, mostra aviso, limpa o formulário e insere no topo da lista', async () => {
    const user = await renderLoaded();
    const form = screen.getByRole('form', { name: 'Novo tenant' });
    await user.type(within(form).getByLabelText('Id'), 'industria-horizonte');
    await user.type(within(form).getByLabelText('Nome'), 'Indústria Horizonte Ltda.');
    await user.selectOptions(within(form).getByLabelText('Plano'), 'EMPRESARIAL');
    await user.selectOptions(within(form).getByLabelText('Nível de isolamento'), 'BRIDGE');
    await user.click(within(form).getByRole('button', { name: 'Criar tenant' }));

    expect(await within(form).findByText('Tenant industria-horizonte criado.')).toBeVisible();
    expect(rows()).toHaveLength(6);
    const first = rows()[0]!;
    expect(first).toHaveAccessibleName('industria-horizonte');
    expect(first).toHaveTextContent('Indústria Horizonte Ltda.');
    expect(first).toHaveTextContent('Empresarial');
    expect(first).toHaveTextContent('Bridge');
    expect(first).toHaveTextContent('Ativo');

    expect(within(form).getByLabelText('Id')).toHaveValue('');
    expect(within(form).getByLabelText('Nome')).toHaveValue('');
    expect(within(form).getByLabelText('Plano')).toHaveValue('GRATUITO');
    expect(within(form).getByLabelText('Nível de isolamento')).toHaveValue('POOL');
    expect(tenantStoreSnapshot().find((t) => t.id === 'industria-horizonte')).toMatchObject({
      id: 'industria-horizonte',
      plano: 'EMPRESARIAL',
      nivelIsolamento: 'BRIDGE',
    });
  });

  it('valida no cliente sem chamar a API, com aria-invalid e mensagem associada', async () => {
    let posts = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') posts += 1;
    });
    const user = await renderLoaded();
    const form = screen.getByRole('form', { name: 'Novo tenant' });
    const id = within(form).getByLabelText('Id');
    const nome = within(form).getByLabelText('Nome');

    await user.click(within(form).getByRole('button', { name: 'Criar tenant' }));
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(id).toHaveAccessibleDescription(/Informe o id do tenant\.$/);
    expect(nome).toHaveAttribute('aria-invalid', 'true');
    expect(nome).toHaveAccessibleDescription('Informe o nome do tenant.');
    expect(id).toHaveFocus();

    await user.type(id, 'acme--sa');
    expect(id).toHaveAccessibleDescription(/Hífens consecutivos não são permitidos\.$/);
    await user.clear(id);
    await user.type(id, 'Acme');
    expect(id).toHaveAccessibleDescription(/começando por letra e sem terminar em hífen\.$/);
    await user.clear(id);
    await user.type(id, 'acme-sa');
    expect(id).not.toHaveAttribute('aria-invalid');

    await user.type(nome, 'A');
    await user.click(within(form).getByRole('button', { name: 'Criar tenant' }));
    expect(nome).toHaveAccessibleDescription('O nome deve ter de 2 a 120 caracteres.');
    expect(nome).toHaveFocus();
    expect(posts).toBe(0);
    server.events.removeAllListeners();
  });

  it('mostra o detail do 409 (id já existe) acima do botão e mantém os dados', async () => {
    const user = await renderLoaded();
    const form = screen.getByRole('form', { name: 'Novo tenant' });
    await user.type(within(form).getByLabelText('Id'), 'atacado-vale-verde');
    await user.type(within(form).getByLabelText('Nome'), 'Atacado Repetido');
    await user.click(within(form).getByRole('button', { name: 'Criar tenant' }));

    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível criar o tenant.');
    expect(alert).toHaveTextContent("Já existe um tenant com o id 'atacado-vale-verde'.");
    expect(within(form).getByLabelText('Id')).toHaveValue('atacado-vale-verde');
    expect(rows()).toHaveLength(5);
    // O alerta vem antes do botão no formulário.
    const button = within(form).getByRole('button', { name: 'Criar tenant' });
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('mostra o detail do 400 devolvido pelo servidor', async () => {
    server.use(
      http.post('*/api/v1/tenants', () => problem(400, 'nome: tamanho deve ser entre 2 e 120')),
    );
    const user = await renderLoaded();
    const form = screen.getByRole('form', { name: 'Novo tenant' });
    await user.type(within(form).getByLabelText('Id'), 'empresa-x');
    await user.type(within(form).getByLabelText('Nome'), 'Empresa X');
    await user.click(within(form).getByRole('button', { name: 'Criar tenant' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'nome: tamanho deve ser entre 2 e 120',
    );

    // Um novo envio bem-sucedido limpa o erro.
    server.resetHandlers();
    await user.click(within(form).getByRole('button', { name: 'Criar tenant' }));
    expect(await within(form).findByText('Tenant empresa-x criado.')).toBeVisible();
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('desabilita o botão enquanto envia', async () => {
    const user = await renderLoaded();
    let release: () => void = () => {};
    server.use(
      http.post('*/api/v1/tenants', async () => {
        await new Promise<void>((r) => (release = r));
        return HttpResponse.error();
      }),
    );
    const form = screen.getByRole('form', { name: 'Novo tenant' });
    await user.type(within(form).getByLabelText('Id'), 'empresa-y');
    await user.type(within(form).getByLabelText('Nome'), 'Empresa Y');
    await user.click(within(form).getByRole('button', { name: 'Criar tenant' }));
    expect(await within(form).findByRole('button', { name: 'Criando…' })).toBeDisabled();
    release();
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Não foi possível conectar ao tenant-service.',
    );
    expect(within(form).getByRole('button', { name: 'Criar tenant' })).toBeEnabled();
  });
});
