// Cliente de autenticação do modo demo: sem Keycloak, o token é `demo-<usuario>`.

import { safeSession, type AuthClient, type AuthSession } from './client';
import { demoToken, findDemoUser } from './demoUsers';

export const DEMO_USER_KEY = 'plataforma.demo.usuario';

export function createDemoAuthClient(): AuthClient {
  const session = (): AuthSession | null => {
    const user = findDemoUser(safeSession.get(DEMO_USER_KEY));
    return user ? { usuario: user.usuario, accessToken: demoToken(user.usuario) } : null;
  };
  return {
    kind: 'demo',
    init: async () => session(),
    login: async (usuario) => {
      if (!findDemoUser(usuario)) throw new Error(`Usuário de demonstração desconhecido.`);
      safeSession.set(DEMO_USER_KEY, usuario ?? null);
      return session();
    },
    logout: async () => safeSession.set(DEMO_USER_KEY, null),
    clear: async () => safeSession.set(DEMO_USER_KEY, null),
    getAccessToken: () => session()?.accessToken ?? null,
    // O token de demo não expira.
    onExpired: () => () => {},
  };
}
