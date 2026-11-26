import { useAuth } from '../../auth/context';
import { TenantSelector } from './TenantSelector';
import { UserMenu } from './UserMenu';

/** Faixa abaixo do título: seletor de tenant, usuário logado e avisos da sessão. */
export function SessionBar() {
  const auth = useAuth();
  return (
    <>
      <div className="session" aria-label="Sessão" role="region">
        <TenantSelector />
        <UserMenu />
      </div>
      {auth.notice ? (
        <div className="alert session__notice" role="alert">
          <span>{auth.notice}</span>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={auth.dismissNotice}
          >
            Fechar aviso
          </button>
        </div>
      ) : null}
    </>
  );
}
