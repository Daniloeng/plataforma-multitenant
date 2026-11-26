import { useId, useRef, useState, type FormEvent } from 'react';
import {
  NIVEIS_ISOLAMENTO,
  NOME_MAX,
  PLANOS,
  createTenant,
  describeTenantError,
  validateNome,
  validateTenantId,
  type NivelIsolamento,
  type Plano,
  type Tenant,
} from '../../api/tenants';
import {
  NIVEL_ISOLAMENTO_DESCRICAO,
  NIVEL_ISOLAMENTO_LABEL,
  PLANO_LABEL,
} from '../../utils/format';

interface Props {
  /** Chamado com o tenant devolvido pela API (201). */
  onCreated: (tenant: Tenant) => void;
}

interface Errors {
  id?: string;
  nome?: string;
}

function validate(id: string, nome: string): Errors {
  const errors: Errors = {};
  const idError = validateTenantId(id);
  if (idError) errors.id = idError;
  const nomeError = validateNome(nome);
  if (nomeError) errors.nome = nomeError;
  return errors;
}

/** Formulário "Novo tenant": valida no cliente com as regras do contrato e faz o POST. */
export function NewTenantForm({ onCreated }: Props) {
  const uid = useId();
  const ids = {
    id: `${uid}-id`,
    idHelp: `${uid}-id-help`,
    idError: `${uid}-id-error`,
    nome: `${uid}-nome`,
    nomeError: `${uid}-nome-error`,
    plano: `${uid}-plano`,
    nivel: `${uid}-nivel`,
    nivelHelp: `${uid}-nivel-help`,
  };

  const idRef = useRef<HTMLInputElement>(null);
  const nomeRef = useRef<HTMLInputElement>(null);
  const [id, setId] = useState('');
  const [nome, setNome] = useState('');
  const [plano, setPlano] = useState<Plano>('GRATUITO');
  const [nivel, setNivel] = useState<NivelIsolamento>('POOL');
  // Erros só aparecem depois da primeira tentativa de envio; daí em diante, ao digitar.
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const errors = touched ? validate(id, nome) : {};

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setSuccess(null);
    setServerError(null);
    const found = validate(id, nome);
    if (found.id || found.nome) {
      // Leva o foco ao primeiro campo com erro (acessibilidade).
      (found.id ? idRef : nomeRef).current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const tenant = await createTenant({ id, nome: nome.trim(), plano, nivelIsolamento: nivel });
      onCreated(tenant);
      setSuccess(`Tenant ${tenant.id} criado.`);
      setId('');
      setNome('');
      setPlano('GRATUITO');
      setNivel('POOL');
      setTouched(false);
    } catch (err) {
      setServerError(describeTenantError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="card form"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      aria-labelledby="novo-tenant-title"
    >
      <h2 id="novo-tenant-title">Novo tenant</h2>

      <div className="form__grid">
        <div className="field-group">
          <label htmlFor={ids.id}>Id</label>
          <input
            ref={idRef}
            id={ids.id}
            name="id"
            type="text"
            className="input"
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="ex.: distribuidora-aurora"
            maxLength={40}
            aria-invalid={errors.id ? true : undefined}
            aria-describedby={errors.id ? `${ids.idHelp} ${ids.idError}` : ids.idHelp}
          />
          <p id={ids.idHelp} className="field-help">
            Letras minúsculas, números e hífen; vira nome de database e de namespace.
          </p>
          {errors.id ? (
            <p id={ids.idError} className="field-error">
              {errors.id}
            </p>
          ) : null}
        </div>

        <div className="field-group">
          <label htmlFor={ids.nome}>Nome</label>
          <input
            ref={nomeRef}
            id={ids.nome}
            name="nome"
            type="text"
            className="input"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoComplete="organization"
            placeholder="ex.: Distribuidora Aurora Ltda."
            maxLength={NOME_MAX}
            aria-invalid={errors.nome ? true : undefined}
            aria-describedby={errors.nome ? ids.nomeError : undefined}
          />
          {errors.nome ? (
            <p id={ids.nomeError} className="field-error">
              {errors.nome}
            </p>
          ) : null}
        </div>

        <div className="field-group">
          <label htmlFor={ids.plano}>Plano</label>
          <select
            id={ids.plano}
            name="plano"
            className="input"
            value={plano}
            onChange={(e) => setPlano(e.target.value as Plano)}
          >
            {PLANOS.map((p) => (
              <option key={p} value={p}>
                {PLANO_LABEL[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor={ids.nivel}>Nível de isolamento</label>
          <select
            id={ids.nivel}
            name="nivelIsolamento"
            className="input"
            value={nivel}
            onChange={(e) => setNivel(e.target.value as NivelIsolamento)}
            aria-describedby={ids.nivelHelp}
          >
            {NIVEIS_ISOLAMENTO.map((n) => (
              <option key={n} value={n}>
                {NIVEL_ISOLAMENTO_LABEL[n]}
              </option>
            ))}
          </select>
          <p id={ids.nivelHelp} className="field-help">
            <strong>{NIVEL_ISOLAMENTO_LABEL[nivel]}:</strong> {NIVEL_ISOLAMENTO_DESCRICAO[nivel]}
          </p>
        </div>
      </div>

      {serverError ? (
        <div className="alert" role="alert">
          <strong>Não foi possível criar o tenant.</strong> {serverError}
        </div>
      ) : null}

      <div className="form__actions">
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Criando…' : 'Criar tenant'}
        </button>
        <p className="form__success" role="status">
          {success}
        </p>
      </div>
    </form>
  );
}
