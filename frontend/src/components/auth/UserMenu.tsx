import { useEffect, useRef, useState } from 'react';
import { PAPEL_LABEL } from '../../api/me';
import { useAuth } from '../../auth/context';
import { DemoUserList } from './DemoUserList';

/** Entrar/Sair no cabeçalho. Logado, mostra o nome e os papéis do usuário. */
export function UserMenu() {
  const auth = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Esc fecha o seletor de usuários de demonstração.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    pickerRef.current?.querySelector('button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  if (auth.status === 'loading') {
    return <p className="user muted">Verificando sessão…</p>;
  }

  if (auth.status === 'anonymous') {
    if (auth.kind === 'oidc') {
      return (
        <div className="user">
          <button type="button" className="button" onClick={() => void auth.login()}>
            Entrar
          </button>
        </div>
      );
    }
    return (
      <div className="user">
        <button
          type="button"
          className="button"
          aria-expanded={pickerOpen}
          aria-controls="demo-login"
          onClick={() => setPickerOpen((open) => !open)}
        >
          Entrar
        </button>
        {pickerOpen ? (
          <div
            id="demo-login"
            ref={pickerRef}
            className="card demo-login"
            role="dialog"
            aria-label="Entrar no modo demo"
          >
            <p className="demo-login__intro muted">
              Modo demo: escolha um usuário (sem Keycloak; o token é{' '}
              <code>demo-&lt;usuario&gt;</code>
              ).
            </p>
            <DemoUserList onDone={() => setPickerOpen(false)} />
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setPickerOpen(false)}
            >
              Cancelar
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const nome = auth.me?.nome ?? auth.usuario;
  return (
    <div className="user">
      <div className="user__info">
        <span className="user__name">{nome}</span>
        {auth.me ? (
          <span className="user__roles" aria-label="Papéis">
            {auth.me.papeis.map((p) => (
              <span key={p} className="pill pill--papel" title={p}>
                {PAPEL_LABEL[p]}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() => void auth.logout()}
      >
        Sair
      </button>
    </div>
  );
}
