import type { User } from 'oidc-client-ts';
import {
  CLIENT_ID,
  createOidcAuthClient,
  isCallbackUrl,
  oidcSettings,
  type UserManagerLike,
} from './oidc';

type Listener = (user?: User) => void;

/** Dublê do UserManager: nenhum teste fala com um Keycloak real. */
function fakeManager(overrides: Partial<UserManagerLike> = {}) {
  const listeners: Record<'loaded' | 'unloaded' | 'expired', Listener[]> = {
    loaded: [],
    unloaded: [],
    expired: [],
  };
  const on = (kind: keyof typeof listeners) => (cb: Listener) => {
    listeners[kind].push(cb);
    return () => {
      listeners[kind] = listeners[kind].filter((l) => l !== cb);
    };
  };
  const manager = {
    getUser: vi.fn(async () => null),
    signinRedirect: vi.fn(async () => {}),
    signinRedirectCallback: vi.fn(),
    signoutRedirect: vi.fn(async () => {}),
    removeUser: vi.fn(async () => {}),
    events: {
      addUserLoaded: on('loaded'),
      addUserUnloaded: on('unloaded'),
      addAccessTokenExpired: on('expired'),
    },
    ...overrides,
  } as unknown as UserManagerLike & {
    [
      K in
        'getUser' | 'signinRedirect' | 'signinRedirectCallback' | 'signoutRedirect' | 'removeUser'
    ]: ReturnType<typeof vi.fn>;
  };
  const emit = (kind: keyof typeof listeners, user?: User) =>
    listeners[kind].forEach((l) => l(user));
  return { manager, emit };
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    access_token: 'tok-ana',
    expired: false,
    profile: { sub: 'uuid-ana', preferred_username: 'ana' },
    state: undefined,
    ...overrides,
  } as unknown as User;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('oidcSettings', () => {
  it('aponta para o realm plataforma, client público, code + PKCE e sessionStorage', () => {
    const settings = oidcSettings('http://kc:8180/', '/plataforma-multitenant/', 'https://x.io');
    expect(settings).toMatchObject({
      authority: 'http://kc:8180/realms/plataforma',
      client_id: CLIENT_ID,
      redirect_uri: 'https://x.io/plataforma-multitenant/',
      post_logout_redirect_uri: 'https://x.io/plataforma-multitenant/',
      response_type: 'code',
      scope: 'openid profile',
    });
    expect(CLIENT_ID).toBe('plataforma-frontend');
    expect(settings.userStore).toBeDefined();
  });

  it('usa localhost:8180 por padrão', () => {
    expect(oidcSettings().authority).toBe('http://localhost:8180/realms/plataforma');
    expect(oidcSettings().redirect_uri).toBe(`${window.location.origin}/`);
  });
});

describe('isCallbackUrl', () => {
  it.each([
    ['?code=abc&state=xyz', true],
    ['?error=access_denied&state=xyz', true],
    ['?code=abc', false],
    ['', false],
  ])('%s → %s', (search, esperado) => {
    expect(isCallbackUrl(search)).toBe(esperado);
  });
});

describe('createOidcAuthClient', () => {
  it('restaura o usuário do sessionStorage (e ignora token expirado)', async () => {
    const { manager } = fakeManager({ getUser: vi.fn(async () => fakeUser()) });
    const client = createOidcAuthClient(manager);
    expect(client.kind).toBe('oidc');
    expect(await client.init()).toEqual({ usuario: 'ana', accessToken: 'tok-ana' });
    expect(client.getAccessToken()).toBe('tok-ana');

    const expirado = fakeManager({ getUser: vi.fn(async () => fakeUser({ expired: true })) });
    expect(await createOidcAuthClient(expirado.manager).init()).toBeNull();
  });

  it('usa o sub quando não há preferred_username', async () => {
    const { manager } = fakeManager({
      getUser: vi.fn(async () => fakeUser({ profile: { sub: 'uuid-1' } as User['profile'] })),
    });
    expect((await createOidcAuthClient(manager).init())?.usuario).toBe('uuid-1');
  });

  it('conclui o callback uma vez só, limpa a URL e volta para a rota do login', async () => {
    window.history.replaceState(null, '', '/?code=abc&state=xyz&session_state=s#/');
    const signinRedirectCallback = vi.fn(async () => fakeUser({ state: { hash: '#/conta' } }));
    const { manager } = fakeManager({ signinRedirectCallback });
    const client = createOidcAuthClient(manager);
    const [a, b] = await Promise.all([client.init(), client.init()]);
    expect(a).toEqual({ usuario: 'ana', accessToken: 'tok-ana' });
    expect(b).toBe(a);
    expect(signinRedirectCallback).toHaveBeenCalledTimes(1);
    expect(signinRedirectCallback).toHaveBeenCalledWith(
      `${window.location.origin}/?code=abc&state=xyz&session_state=s#/`,
    );
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/conta');
    expect(manager.getUser).not.toHaveBeenCalled();
  });

  it('mantém o hash atual quando o state não traz rota', async () => {
    window.history.replaceState(null, '', '/?code=abc&state=xyz#/tenants');
    const { manager } = fakeManager({
      signinRedirectCallback: vi.fn(async () => fakeUser({ state: 'outro' })),
    });
    await createOidcAuthClient(manager).init();
    expect(window.location.hash).toBe('#/tenants');
  });

  it('limpa a URL também quando o callback falha', async () => {
    window.history.replaceState(null, '', '/?error=access_denied&state=xyz');
    const { manager } = fakeManager({
      signinRedirectCallback: vi.fn(async () => {
        throw new Error('No matching state found in storage');
      }),
    });
    await expect(createOidcAuthClient(manager).init()).rejects.toThrow('No matching state');
    expect(window.location.search).toBe('');
  });

  it('login redireciona ao Keycloak guardando a rota atual', async () => {
    window.location.hash = '#/conta';
    const { manager } = fakeManager();
    expect(await createOidcAuthClient(manager).login()).toBeNull();
    expect(manager.signinRedirect).toHaveBeenCalledWith({ state: { hash: '#/conta' } });
  });

  it('logout encerra no Keycloak; se falhar, esquece o usuário localmente', async () => {
    const { manager } = fakeManager({ getUser: vi.fn(async () => fakeUser()) });
    const client = createOidcAuthClient(manager);
    await client.init();
    await client.logout();
    expect(manager.signoutRedirect).toHaveBeenCalled();
    expect(client.getAccessToken()).toBeNull();

    const falha = fakeManager({
      signoutRedirect: vi.fn(async () => {
        throw new Error('sem rede');
      }),
    });
    await createOidcAuthClient(falha.manager).logout();
    expect(falha.manager.removeUser).toHaveBeenCalled();
  });

  it('clear remove o usuário sem redirecionar', async () => {
    const { manager } = fakeManager({ getUser: vi.fn(async () => fakeUser()) });
    const client = createOidcAuthClient(manager);
    await client.init();
    await client.clear();
    expect(manager.removeUser).toHaveBeenCalled();
    expect(manager.signoutRedirect).not.toHaveBeenCalled();
    expect(client.getAccessToken()).toBeNull();
  });

  it('acompanha renovação, remoção e expiração do token', async () => {
    const { manager, emit } = fakeManager();
    const client = createOidcAuthClient(manager);
    await client.init();
    expect(client.getAccessToken()).toBeNull();
    emit('loaded', fakeUser({ access_token: 'renovado' }));
    expect(client.getAccessToken()).toBe('renovado');
    emit('unloaded');
    expect(client.getAccessToken()).toBeNull();

    emit('loaded', fakeUser());
    const listener = vi.fn();
    const unsubscribe = client.onExpired(listener);
    emit('expired');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken()).toBeNull();
    unsubscribe();
    emit('expired');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cria um UserManager real por padrão, sem falar com o Keycloak até o login', async () => {
    const client = createOidcAuthClient();
    expect(await client.init()).toBeNull();
  });
});
