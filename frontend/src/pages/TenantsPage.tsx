import { useCallback, useContext } from 'react';
import type { NivelIsolamento } from '../api/tenants';
import { AuthContext } from '../auth/context';
import { NewTenantForm } from '../components/tenants/NewTenantForm';
import { TenantList } from '../components/tenants/TenantList';
import { useTenants } from '../hooks/useTenants';

/** Página Tenants: administração do catálogo de tenants (Tenant Service, /api/v1/tenants). */
export function TenantsPage() {
  const tenants = useTenants();
  // Fora do <AuthProvider> (testes da página isolada) não há /me para recarregar.
  const auth = useContext(AuthContext);
  const reloadMe = auth?.reloadMe;
  const { promote } = tenants;
  const promoteAndRefresh = useCallback(
    async (id: string, nivel: NivelIsolamento) => {
      const ok = await promote(id, nivel);
      // O selo do cabeçalho vem do /api/v1/me: recarrega para mostrar o nível novo.
      if (ok && reloadMe) void reloadMe();
      return ok;
    },
    [promote, reloadMe],
  );
  return (
    <>
      <p className="section__intro muted page-intro">
        Cadastro administrativo (papel <code>plataforma-admin</code>). Cada tenant criado, alterado
        ou promovido de nível publica <code>tenant.criado</code> ou <code>tenant.alterado</code>{' '}
        pelo outbox; ao receber a promoção, os serviços migram os dados do tenant para o nível novo.
      </p>
      <NewTenantForm onCreated={tenants.prepend} />
      <TenantList {...tenants} promote={promoteAndRefresh} />
    </>
  );
}
