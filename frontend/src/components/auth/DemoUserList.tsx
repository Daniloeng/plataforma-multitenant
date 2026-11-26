import { PAPEL_LABEL } from '../../api/me';
import { DEMO_USERS } from '../../auth/demoUsers';
import { useAuth } from '../../auth/context';

/** Usuários de demonstração (modo demo, sem Keycloak): um clique entra como o usuário. */
export function DemoUserList({ onDone }: { onDone?: () => void }) {
  const auth = useAuth();
  return (
    <ul className="demo-users" aria-label="Usuários de demonstração">
      {DEMO_USERS.map((u) => (
        <li key={u.usuario}>
          <button
            type="button"
            className="demo-user"
            onClick={() => {
              void auth.login(u.usuario);
              onDone?.();
            }}
          >
            <span className="demo-user__name">
              Entrar como {u.nome} <code>{u.usuario}</code>
            </span>
            <span className="demo-user__meta">
              {u.papeis.map((p) => PAPEL_LABEL[p]).join(', ')} · {u.descricao}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
