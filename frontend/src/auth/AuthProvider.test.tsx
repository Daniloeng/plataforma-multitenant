import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { TenantDoUsuario } from '../api/me';
import { server } from '../mocks/server';
import {
  AuthProvider,
  SESSAO_EXPIRADA,
  TENANT_KEY,
  defaultAuthClient,
  pickTenant,
} from './AuthProvider';
import type { AuthClient } from './client';
import { useAuth } from './context';
import { createDemoAuthClient } from './demo';

function tenant(id: string, ativo = true): TenantDoUsuario {
  return { id, nome: id, plano: 'GRATUITO', nivelIsolamento: 'POOL', ativo };
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <p data-testid="usuario">{auth.usuario ?? '-'}</p>
      <p data-testid="tenant">{auth.tenantId ?? '-'}</p>
      <p data-testid="notice">{auth.notice ?? '-'}</p>
      <p data-testid="me-error">{auth.meError ?? '-'}</p>
      <p data-testid="admin">{String(auth.isAdmin)}</p>
      <button onClick={() => void auth.login('ana')}>login ana</button>
      <button onClick={() => void auth.login('zeca')}>login zeca</button>
      <button onClick={() => void auth.logout()}>logout</button>
      <button onClick={() => auth.dismissNotice()}>fechar</button>
    </div>
  );
}

function fakeClient(overrides: Partial<AuthClient> = {}): AuthClient & { expire: () => void } {
  let expiredListener: () => void = () => {};
  return {
    kind: 'oidc',
    init: async () => ({ usuario: 'ana', accessToken: 'demo-ana' }),
    login: async () => null,
    logout: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    getAccessToken: () => 'demo-ana',
    onExpired: (l) => {
      expiredListener = l;
      return () => {};
    },
    expire: () => expiredListener(),
    ...overrides,
  };
}

describe('pickTenant', () => {
  it('mantém o salvo se ainda for do usuário e ativo', () => {
    expect(pickTenant('b', [tenant('a'), tenant('b')])).toBe('b');
    expect(pickTenant('b', [tenant('a'), tenant('b', false)])).toBeNull();
    expect(pickTenant('x', [tenant('a'), tenant('b')])).toBeNull();
  });

  it('seleciona automaticamente o único tenant (se ativo)', () => {
    expect(pickTenant(null, [tenant('a')])).toBe('a');
    expect(pickTenant('x', [tenant('a')])).toBe('a');
    expect(pickTenant(null, [tenant('a', false)])).toBeNull();
    expect(pickTenant(null, [])).toBeNull();
  });
});

describe('AuthProvider', () => {
  it('useAuth fora do provider é erro de programação', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('AuthProvider');
    vi.restoreAllMocks();
  });

  it('defaultAuthClient usa o demo com VITE_DEMO=true e o Keycloak sem ele', () => {
    expect(defaultAuthClient().kind).toBe('oidc');
    vi.stubEnv('VITE_DEMO', 'true');
    expect(defaultAuthClient().kind).toBe('demo');
    vi.unstubAllEnvs();
  });

  it('restaura a sessão, carrega o /me e descarta tenant salvo que não é do usuário', async () => {
    window.sessionStorage.setItem(TENANT_KEY, 'metalurgica-serra-azul');
    render(
      <AuthProvider client={fakeClient()}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await waitFor(() => expect(screen.getByTestId('tenant')).toHaveTextContent('-'));
    expect(window.sessionStorage.getItem(TENANT_KEY)).toBeNull();
    expect(screen.getByTestId('admin')).toHaveTextContent('false');
  });

  it('avisa quando o callback do login falha', async () => {
    render(
      <AuthProvider
        client={fakeClient({
          init: async () => {
            throw new Error('No matching state');
          },
        })}
      >
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('notice')).toHaveTextContent(
      'Não foi possível concluir o login. Não foi possível falar com o servidor de login (No matching state).',
    );
  });

  it('avisa quando o login não consegue começar e permite fechar o aviso', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider client={createDemoAuthClient()}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    await user.click(screen.getByText('login zeca'));
    expect(screen.getByTestId('notice')).toHaveTextContent('servidor de login');
    await user.click(screen.getByText('fechar'));
    expect(screen.getByTestId('notice')).toHaveTextContent('-');

    const semMotivo = fakeClient({
      init: async () => null,
      login: async () => {
        throw 'falhou';
      },
    });
    render(
      <AuthProvider client={semMotivo}>
        <Probe />
      </AuthProvider>,
    );
    await user.click(screen.getAllByText('login ana')[1]!);
    expect(screen.getAllByTestId('notice')[1]).toHaveTextContent(
      'Não foi possível falar com o servidor de login. Tente de novo.',
    );
  });

  it('token expirado (evento do cliente) encerra a sessão com aviso', async () => {
    const client = fakeClient();
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('usuario')).toHaveTextContent('ana'));
    act(() => client.expire());
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    expect(screen.getByTestId('notice')).toHaveTextContent(SESSAO_EXPIRADA);
    expect(client.clear).toHaveBeenCalled();
  });

  it('erro do /me fica em meError', async () => {
    server.use(http.get('*/api/v1/me', () => new HttpResponse(null, { status: 503 })));
    render(
      <AuthProvider client={fakeClient()}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('me-error')).toHaveTextContent('A API respondeu com HTTP 503.'),
    );
  });

  it('logout limpa sessão e tenant', async () => {
    const user = userEvent.setup();
    const client = fakeClient({ init: async () => null });
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    await user.click(screen.getByText('logout'));
    expect(client.logout).toHaveBeenCalled();
    expect(screen.getByTestId('usuario')).toHaveTextContent('-');
  });
});
