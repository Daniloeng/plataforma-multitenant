import { setSessionProvider } from '../api/http';
import { demoToken } from '../auth/demoUsers';

/**
 * Registra uma sessão de demonstração para testes que usam os clientes da API sem o
 * <AuthProvider> (ex.: TenantsPage direto). O setup remove o provider depois de cada teste.
 */
export function signInAs(
  usuario: string,
  tenantId: string | null = null,
  onUnauthorized: () => void = () => {},
): void {
  setSessionProvider({
    getAccessToken: () => demoToken(usuario),
    getTenantId: () => tenantId,
    onUnauthorized,
  });
}
