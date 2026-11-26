import { NewTenantForm } from '../components/tenants/NewTenantForm';
import { TenantList } from '../components/tenants/TenantList';
import { useTenants } from '../hooks/useTenants';

/** Página Tenants: administração do catálogo de tenants (Tenant Service, /api/v1/tenants). */
export function TenantsPage() {
  const tenants = useTenants();
  return (
    <>
      <p className="section__intro muted page-intro">
        Cadastro administrativo (papel <code>plataforma-admin</code>). Cada tenant criado ou
        alterado publica <code>tenant.criado</code> ou <code>tenant.alterado</code> pelo outbox.
      </p>
      <NewTenantForm onCreated={tenants.prepend} />
      <TenantList {...tenants} />
    </>
  );
}
