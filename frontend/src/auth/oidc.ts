// Login no Keycloak (realm "plataforma", client público "plataforma-frontend") com Authorization
// Code + PKCE S256, pela biblioteca oidc-client-ts. O token fica no sessionStorage (some ao fechar
// a aba) e só sai do navegador no cabeçalho Authorization das chamadas ao gateway.

import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from 'oidc-client-ts';
import type { AuthClient, AuthSession } from './client';

export const KEYCLOAK_URL_PADRAO = 'http://localhost:8180';
export const REALM = 'plataforma';
export const CLIENT_ID = 'plataforma-frontend';

/** Configuração do UserManager. PKCE (S256) é sempre usado pelo oidc-client-ts no fluxo code. */
export function oidcSettings(
  keycloakUrl: string = import.meta.env.VITE_KEYCLOAK_URL ?? KEYCLOAK_URL_PADRAO,
  baseUrl: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin,
  storage: Storage = window.sessionStorage,
): UserManagerSettings {
  const redirectUri = `${origin}${baseUrl}`;
  return {
    authority: `${keycloakUrl.replace(/\/+$/, '')}/realms/${REALM}`,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    userStore: new WebStorageStateStore({ store: storage }),
    stateStore: new WebStorageStateStore({ store: storage }),
  };
}

/** O que o cliente usa do UserManager (os testes passam um dublê). */
export type UserManagerLike = Pick<
  UserManager,
  'getUser' | 'signinRedirect' | 'signinRedirectCallback' | 'signoutRedirect' | 'removeUser'
> & {
  events: Pick<
    UserManager['events'],
    'addAccessTokenExpired' | 'addUserLoaded' | 'addUserUnloaded'
  >;
};

/** A URL atual é a volta do Keycloak (code + state, ou error + state)? */
export function isCallbackUrl(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('state') && (params.has('code') || params.has('error'));
}

function toSession(user: User | null): AuthSession | null {
  if (!user || user.expired || !user.access_token) return null;
  const usuario = user.profile.preferred_username ?? user.profile.sub;
  return { usuario, accessToken: user.access_token };
}

/** Hash (rota) guardado no state do login, para voltar à mesma página depois do Keycloak. */
function hashFromState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const hash = (state as { hash?: unknown }).hash;
  return typeof hash === 'string' && hash.startsWith('#') ? hash : null;
}

export function createOidcAuthClient(
  manager: UserManagerLike = new UserManager(oidcSettings()),
): AuthClient {
  let current: AuthSession | null = null;
  let initPromise: Promise<AuthSession | null> | null = null;
  // Renovação silenciosa (refresh token) troca o token; logout em outra aba o remove.
  manager.events.addUserLoaded((user) => {
    current = toSession(user);
  });
  manager.events.addUserUnloaded(() => {
    current = null;
  });

  async function restore(): Promise<AuthSession | null> {
    const { pathname, search, hash } = window.location;
    if (!isCallbackUrl(search)) {
      current = toSession(await manager.getUser());
      return current;
    }
    let targetHash = hash;
    try {
      const user = await manager.signinRedirectCallback(window.location.href);
      targetHash = hashFromState(user.state) ?? hash;
      current = toSession(user);
      return current;
    } finally {
      // Tira code/state da barra de endereço (o code é de uso único) e volta para a rota.
      window.history.replaceState(window.history.state, '', `${pathname}${targetHash}`);
    }
  }

  return {
    kind: 'oidc',
    // Memoizado: o StrictMode monta duas vezes, e o callback só pode ser trocado por token uma vez.
    init: () => (initPromise ??= restore()),
    login: async () => {
      await manager.signinRedirect({ state: { hash: window.location.hash } });
      return null;
    },
    logout: async () => {
      current = null;
      try {
        await manager.signoutRedirect();
      } catch {
        await manager.removeUser();
      }
    },
    clear: async () => {
      current = null;
      await manager.removeUser();
    },
    getAccessToken: () => current?.accessToken ?? null,
    onExpired: (listener) =>
      manager.events.addAccessTokenExpired(() => {
        current = null;
        listener();
      }),
  };
}
