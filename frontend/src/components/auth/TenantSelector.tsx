import { describePlano } from '../../api/me';
import { useAuth } from '../../auth/context';
import { NivelSelo } from '../isolamento/NivelSelo';

/** Troca de tenant: o escolhido vai no cabeçalho X-Tenant-Id de cada chamada. */
export function TenantSelector() {
  const auth = useAuth();
  const tenants = auth.me?.tenants ?? [];
  if (auth.status !== 'authenticated' || tenants.length === 0) return null;
  const selected = auth.selectedTenant;
  const suspensos = tenants.filter((t) => !t.ativo).length;
  return (
    <div className="tenant-selector">
      <label htmlFor="tenant-select">Tenant</label>
      <select
        id="tenant-select"
        className="input tenant-selector__select"
        value={auth.tenantId ?? ''}
        onChange={(e) => auth.selectTenant(e.target.value || null)}
        aria-describedby="tenant-plano"
      >
        {selected === null ? <option value="">Selecione um tenant</option> : null}
        {tenants.map((t) => (
          <option key={t.id} value={t.id} disabled={!t.ativo}>
            {t.nome}
            {t.ativo ? '' : ' — Suspenso'}
          </option>
        ))}
      </select>
      <span id="tenant-plano" className="tenant-selector__plano muted">
        {selected ? describePlano(selected.plano) : 'Nenhum tenant selecionado'}
        {selected ? <NivelSelo nivel={selected.nivelIsolamento} /> : null}
        {suspensos > 0 ? (
          <span className="pill pill--down" title="Tenants suspensos não podem ser selecionados">
            {suspensos === 1 ? '1 suspenso' : `${suspensos} suspensos`}
          </span>
        ) : null}
      </span>
    </div>
  );
}
