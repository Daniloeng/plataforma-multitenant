import { useId, useState, type FormEvent } from 'react';
import { niveisAcima, type NivelIsolamento, type Tenant } from '../../api/tenants';
import { NIVEL_ISOLAMENTO_LABEL } from '../../utils/format';

interface Props {
  tenant: Tenant;
  pending: boolean;
  onPromover: (id: string, nivel: NivelIsolamento) => Promise<boolean>;
}

/**
 * Ação "Promover" de uma linha da lista: escolhe um dos níveis acima do atual e chama
 * POST /api/v1/tenants/{id}/promocao. Tenant em SILO não tem para onde subir.
 */
export function PromoverTenant({ tenant, pending, onPromover }: Props) {
  const uid = useId();
  const opcoes = niveisAcima(tenant.nivelIsolamento);
  const [aberto, setAberto] = useState(false);
  const [nivel, setNivel] = useState<NivelIsolamento | null>(null);

  if (opcoes.length === 0) {
    return (
      <span className="muted promover__max" title="Silo é o nível máximo de isolamento">
        Nível máximo
      </span>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        className="button button--small button--secondary"
        disabled={pending}
        aria-label={`Promover ${tenant.id}`}
        onClick={() => {
          // Começa no nível logo acima do atual.
          setNivel(null);
          setAberto(true);
        }}
      >
        Promover
      </button>
    );
  }

  const escolhido = nivel ?? opcoes[0]!;
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onPromover(tenant.id, escolhido)) setAberto(false);
  };

  return (
    <form
      className="promover"
      aria-label={`Promover ${tenant.id}`}
      onSubmit={(e) => void onSubmit(e)}
    >
      <label htmlFor={`${uid}-nivel`} className="sr-only">
        Novo nível de {tenant.id}
      </label>
      <select
        id={`${uid}-nivel`}
        className="input input--small"
        value={escolhido}
        disabled={pending}
        onChange={(e) => setNivel(e.target.value as NivelIsolamento)}
      >
        {opcoes.map((n) => (
          <option key={n} value={n}>
            {NIVEL_ISOLAMENTO_LABEL[n]}
          </option>
        ))}
      </select>
      <button type="submit" className="button button--small" disabled={pending}>
        {pending ? 'Promovendo…' : 'Confirmar'}
      </button>
      <button
        type="button"
        className="button button--small button--secondary"
        disabled={pending}
        onClick={() => setAberto(false)}
      >
        Cancelar
      </button>
    </form>
  );
}
