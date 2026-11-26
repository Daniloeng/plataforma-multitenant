import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from './App';
import { TENANT_KEY } from './auth/AuthProvider';
import { createDemoAuthClient } from './auth/demo';
import { createOidcAuthClient, type UserManagerLike } from './auth/oidc';
import { server } from './mocks/server';

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
});

async function renderDemo(hash = '#/') {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App authClient={createDemoAuthClient()} />);
  await screen.findByRole('button', { name: 'Entrar' });
  return user;
}

async function loginAs(user: ReturnType<typeof userEvent.setup>, nome: string) {
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  const dialog = screen.getByRole('dialog', { name: 'Entrar no modo demo' });
  await user.click(within(dialog).getByRole('button', { name: new RegExp(`Entrar como ${nome}`) }));
  await screen.findByRole('button', { name: 'Sair' });
}

function sessionBar() {
  return screen.getByRole('region', { name: 'Sessão' });
}

describe('login de demonstração e troca de tenant', () => {
  it('ana entra, vê nome e papel, escolhe o tenant e o plano aparece com o limite', async () => {
    const user = await renderDemo();
    await loginAs(user, 'Ana Souza');
    const bar = sessionBar();
    expect(await within(bar).findByText('Ana Souza')).toBeVisible();
    expect(within(bar).getByText('Gestor do tenant')).toHaveAttribute('title', 'gestor-tenant');

    const select = await within(bar).findByLabelText('Tenant');
    // Dois tenants: nenhum selecionado automaticamente.
    expect(select).toHaveValue('');
    expect(within(bar).getByText('Nenhum tenant selecionado')).toBeVisible();
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Selecione um tenant',
      'Atacado Vale Verde',
      'Distribuidora Aurora de Alimentos Ltda.',
    ]);

    await user.selectOptions(select, 'atacado-vale-verde');
    expect(within(bar).getByText('Plano Empresarial · 50 req/s')).toBeVisible();
    expect(window.sessionStorage.getItem(TENANT_KEY)).toBe('atacado-vale-verde');
    // Com um tenant escolhido, a opção vazia some.
    expect(within(select).queryByText('Selecione um tenant')).not.toBeInTheDocument();
    await user.selectOptions(select, 'distribuidora-aurora');
    expect(within(bar).getByText('Plano Profissional · 20 req/s')).toBeVisible();
  });

  it('admin vê tenant suspenso desabilitado e com o selo', async () => {
    const user = await renderDemo();
    await loginAs(user, 'Administradora da plataforma');
    const bar = sessionBar();
    const select = await within(bar).findByLabelText('Tenant');
    const suspenso = within(select).getByRole('option', {
      name: 'Cerâmica Paraíba Indústria e Comércio — Suspenso',
    });
    expect(suspenso).toBeDisabled();
    expect(within(bar).getByText('1 suspenso')).toHaveClass('pill--down');
  });

  it('bruno tem um tenant só, selecionado automaticamente', async () => {
    const user = await renderDemo();
    await loginAs(user, 'Bruno Lima');
    const bar = sessionBar();
    expect(await within(bar).findByText('Plano Profissional · 20 req/s')).toBeVisible();
    expect(within(bar).getByLabelText('Tenant')).toHaveValue('farmaceutica-boa-saude');
    expect(window.sessionStorage.getItem(TENANT_KEY)).toBe('farmaceutica-boa-saude');
  });

  it('o seletor de usuários fecha com Cancelar e com Esc', async () => {
    const user = await renderDemo();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('button', { name: 'Entrar' })).toHaveAttribute('aria-expanded', 'true');
    // O foco vai para o primeiro usuário.
    expect(screen.getByRole('button', { name: /Entrar como Administradora/ })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await user.keyboard('a');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('Sair volta ao botão Entrar e esquece o tenant', async () => {
    const user = await renderDemo();
    await loginAs(user, 'Bruno Lima');
    await within(sessionBar()).findByText('Plano Profissional · 20 req/s');
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(screen.queryByLabelText('Tenant')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(TENANT_KEY)).toBeNull();
  });
});

describe('aba Tenants por papel', () => {
  it('ana vê "Somente administradores da plataforma"', async () => {
    const user = await renderDemo('#/tenants');
    expect(screen.getByRole('heading', { name: 'Entre para continuar' })).toBeVisible();
    await loginAs(user, 'Ana Souza');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Somente administradores da plataforma.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('admin vê a lista; erro do /me aparece no lugar da página', async () => {
    const user = await renderDemo('#/tenants');
    await loginAs(user, 'Administradora da plataforma');
    expect(await screen.findByRole('table', { name: 'Tenants cadastrados' })).toBeVisible();
  });

  it('mostra o erro do /me quando não dá para saber os papéis', async () => {
    server.use(http.get('*/api/v1/me', () => HttpResponse.error()));
    const user = await renderDemo('#/tenants');
    await loginAs(user, 'Ana Souza');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar seus dados. Não foi possível conectar ao gateway.',
    );
  });
});

describe('Minha conta', () => {
  it('convida a entrar sem login', async () => {
    await renderDemo('#/conta');
    expect(screen.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
    expect(screen.getByText(/Entre para ver seus papéis/)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Usuários de demonstração' })).toBeVisible();
  });

  it('mostra usuário, papéis e tenants; troca o tenant e testa o limite (200 e 429)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const user = await renderDemo('#/conta');
    await user.click(screen.getByRole('button', { name: /Entrar como Ana Souza/ }));

    expect(await screen.findByText('Ana Souza', { selector: 'dd' })).toBeVisible();
    expect(screen.getByText('ana', { selector: 'code' })).toBeVisible();
    expect(screen.getByText('gestor-tenant', { selector: 'dd code' })).toBeVisible();
    const tenants = screen.getByRole('list', { name: 'Tenants do usuário' });
    const aurora = within(tenants).getByRole('listitem', { name: 'distribuidora-aurora' });
    expect(aurora).toHaveTextContent('Plano Profissional: 20 req/s (rajada 40)');
    expect(aurora).toHaveTextContent('Ativo');
    expect(aurora).toHaveTextContent('Pool');

    const testar = screen.getByRole('button', { name: 'Testar limite' });
    expect(testar).toBeDisabled();
    expect(screen.getByText(/Selecione um tenant no cabeçalho/)).toBeVisible();

    await user.click(within(aurora).getByRole('button', { name: 'Usar este tenant' }));
    expect(aurora).toHaveAttribute('aria-current', 'true');
    expect(within(aurora).getByText('Tenant selecionado')).toBeVisible();
    expect(screen.getByText(/Dispara 60 requisições simultâneas/)).toHaveTextContent(
      'X-Tenant-Id: distribuidora-aurora',
    );

    await user.click(testar);
    const result = await screen.findByRole('status', { name: 'Resultado do teste' });
    expect(within(result).getByText('40 × 200')).toHaveClass('pill--up');
    expect(within(result).getByText('20 × 429')).toHaveClass('pill--down');
    expect(result).toHaveTextContent(
      '60 requisições: 40 aceitas e 20 barradas pelo limite (Retry-After: 1 s).',
    );
  });

  it('mostra outros erros do teste e "Testando…" enquanto roda', async () => {
    const user = await renderDemo('#/conta');
    await user.click(screen.getByRole('button', { name: /Entrar como Bruno Lima/ }));
    const testar = await screen.findByRole('button', { name: 'Testar limite' });
    await waitFor(() => expect(testar).toBeEnabled());
    expect(screen.getByText('cli-bruno')).toBeVisible();

    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get('*/api/v1/me', async ({ request }) => {
        if (!request.headers.get('X-Tenant-Id')) return undefined;
        await gate;
        return HttpResponse.json(
          { type: 'x', title: 'Proibido', status: 403, detail: 'Tenant suspenso.' },
          { status: 403 },
        );
      }),
    );
    await user.click(testar);
    expect(screen.getByRole('button', { name: 'Testando…' })).toBeDisabled();
    release();
    const result = await screen.findByRole('status', { name: 'Resultado do teste' });
    expect(result).toHaveTextContent('60 com outro erro');
    expect(result).toHaveTextContent('Tenant suspenso.');
  });

  it('erro do /me oferece tentar de novo', async () => {
    server.use(
      http.get('*/api/v1/me', () => new HttpResponse(null, { status: 500 }), { once: true }),
    );
    const user = await renderDemo('#/conta');
    await user.click(screen.getByRole('button', { name: /Entrar como Ana Souza/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A API respondeu com HTTP 500.');
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('list', { name: 'Tenants do usuário' })).toBeVisible();
  });

  it('usuário sem tenants e sem papéis', async () => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({ usuario: 'z', nome: null, papeis: [], clienteId: null, tenants: [] }),
      ),
    );
    const user = await renderDemo('#/conta');
    await user.click(screen.getByRole('button', { name: /Entrar como Ana Souza/ }));
    expect(await screen.findByText('Nenhum tenant associado ao seu usuário.')).toBeVisible();
    expect(screen.queryByLabelText('Tenant')).not.toBeInTheDocument();
  });
});

describe('sessão expirada (401)', () => {
  it('uma resposta 401 encerra a sessão e pede login de novo', async () => {
    const user = await renderDemo('#/conta');
    await user.click(screen.getByRole('button', { name: /Entrar como Bruno Lima/ }));
    const testar = await screen.findByRole('button', { name: 'Testar limite' });
    await waitFor(() => expect(testar).toBeEnabled());

    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json(
          { type: 'https://plataforma.dev.br/problemas/nao-autenticado', title: 'x', status: 401 },
          { status: 401 },
        ),
      ),
    );
    await user.click(testar);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sua sessão expirou. Entre novamente para continuar.');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(screen.getByText(/Entre para ver seus papéis/)).toBeVisible();
    await user.click(within(alert).getByRole('button', { name: 'Fechar aviso' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('modo Keycloak', () => {
  it('Entrar redireciona ao Keycloak', async () => {
    const signinRedirect = vi.fn(async () => {});
    const manager = {
      getUser: async () => null,
      signinRedirect,
      signinRedirectCallback: vi.fn(),
      signoutRedirect: vi.fn(),
      removeUser: vi.fn(),
      events: {
        addUserLoaded: () => () => {},
        addUserUnloaded: () => () => {},
        addAccessTokenExpired: () => () => {},
      },
    } as unknown as UserManagerLike;
    const user = userEvent.setup();
    window.location.hash = '#/conta';
    render(<App authClient={createOidcAuthClient(manager)} />);
    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(signinRedirect).toHaveBeenCalledWith({ state: { hash: '#/conta' } });
    await user.click(screen.getByRole('button', { name: 'Entrar com o Keycloak' }));
    expect(signinRedirect).toHaveBeenCalledTimes(2);
  });
});
