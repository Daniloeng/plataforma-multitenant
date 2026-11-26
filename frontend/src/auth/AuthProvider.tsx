import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setSessionProvider } from '../api/http';
import { describeMeError, fetchMe, type Me, type TenantDoUsuario } from '../api/me';
import { isDemoMode } from '../utils/demo';
import { safeSession, type AuthClient, type AuthSession } from './client';
import { AuthContext, type AuthStatus, type AuthValue } from './context';
import { createDemoAuthClient } from './demo';
import { createOidcAuthClient } from './oidc';

/** Tenant escolhido no seletor (sessionStorage: vale para a aba, como o token). */
export const TENANT_KEY = 'plataforma.tenant';

export const SESSAO_EXPIRADA = 'Sua sessão expirou. Entre novamente para continuar.';

/** Cliente padrão: demo (MSW) no GitHub Pages, Keycloak no resto. */
export function defaultAuthClient(): AuthClient {
  return isDemoMode() ? createDemoAuthClient() : createOidcAuthClient();
}

/**
 * Tenant a usar depois de carregar o /api/v1/me: o salvo, se ainda for do usuário e estiver ativo;
 * senão, o único tenant do usuário (seleção automática); senão, nenhum.
 */
export function pickTenant(
  stored: string | null,
  tenants: readonly TenantDoUsuario[],
): string | null {
  if (stored && tenants.some((t) => t.id === stored && t.ativo)) return stored;
  const [unico] = tenants;
  if (tenants.length === 1 && unico?.ativo) return unico.id;
  return null;
}

function describeLoginError(error: unknown): string {
  const motivo = error instanceof Error && error.message ? ` (${error.message})` : '';
  return `Não foi possível falar com o servidor de login${motivo}. Tente de novo.`;
}

export function AuthProvider({
  client: clientProp,
  children,
}: {
  client?: AuthClient;
  children: ReactNode;
}) {
  const [client] = useState<AuthClient>(() => clientProp ?? defaultAuthClient());
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(() => safeSession.get(TENANT_KEY));
  const tenantRef = useRef(tenantId);
  const meController = useRef<AbortController | null>(null);

  const selectTenant = useCallback((id: string | null) => {
    tenantRef.current = id;
    safeSession.set(TENANT_KEY, id);
    setTenantId(id);
  }, []);

  const signedOut = useCallback(
    (message: string | null) => {
      meController.current?.abort();
      setSession(null);
      setMe(null);
      setMeError(null);
      setMeLoading(false);
      setStatus('anonymous');
      setNotice(message);
      selectTenant(null);
    },
    [selectTenant],
  );

  const expire = useCallback(() => {
    void client.clear();
    signedOut(SESSAO_EXPIRADA);
  }, [client, signedOut]);

  // As chamadas à API (src/api/http.ts) pegam token e tenant daqui.
  const expireRef = useRef(expire);
  expireRef.current = expire;
  useEffect(
    () =>
      setSessionProvider({
        getAccessToken: () => client.getAccessToken(),
        getTenantId: () => tenantRef.current,
        onUnauthorized: () => expireRef.current(),
      }),
    [client],
  );

  useEffect(() => client.onExpired(() => expireRef.current()), [client]);

  useEffect(() => {
    let alive = true;
    client.init().then(
      (restored) => {
        if (!alive) return;
        setSession(restored);
        setStatus(restored ? 'authenticated' : 'anonymous');
      },
      (error: unknown) => {
        if (!alive) return;
        setStatus('anonymous');
        setNotice(`Não foi possível concluir o login. ${describeLoginError(error)}`);
      },
    );
    return () => {
      alive = false;
    };
  }, [client]);

  const reloadMe = useCallback(async () => {
    meController.current?.abort();
    const controller = new AbortController();
    meController.current = controller;
    setMeLoading(true);
    setMeError(null);
    try {
      const loaded = await fetchMe(controller.signal);
      if (controller.signal.aborted) return;
      setMe(loaded);
      selectTenant(pickTenant(tenantRef.current, loaded.tenants));
    } catch (error) {
      if (controller.signal.aborted) return;
      setMeError(describeMeError(error));
    } finally {
      if (!controller.signal.aborted) setMeLoading(false);
    }
  }, [selectTenant]);

  useEffect(() => {
    if (!session) return;
    void reloadMe();
    return () => meController.current?.abort();
  }, [session, reloadMe]);

  const login = useCallback(
    async (usuario?: string) => {
      setNotice(null);
      try {
        const started = await client.login(usuario);
        if (started) {
          setMe(null);
          setSession(started);
          setStatus('authenticated');
        }
      } catch (error) {
        setNotice(describeLoginError(error));
      }
    },
    [client],
  );

  const logout = useCallback(async () => {
    signedOut(null);
    await client.logout();
  }, [client, signedOut]);

  const value = useMemo<AuthValue>(() => {
    const selectedTenant = me?.tenants.find((t) => t.id === tenantId) ?? null;
    return {
      kind: client.kind,
      status,
      usuario: session?.usuario ?? null,
      me,
      meLoading,
      meError,
      notice,
      tenantId,
      selectedTenant,
      isAdmin: me?.papeis.includes('plataforma-admin') ?? false,
      login,
      logout,
      selectTenant,
      reloadMe,
      dismissNotice: () => setNotice(null),
    };
  }, [
    client.kind,
    status,
    session,
    me,
    meLoading,
    meError,
    notice,
    tenantId,
    login,
    logout,
    selectTenant,
    reloadMe,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
