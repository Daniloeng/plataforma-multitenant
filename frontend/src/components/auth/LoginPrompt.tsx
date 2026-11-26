import type { ReactNode } from 'react';
import { useAuth } from '../../auth/context';
import { DemoUserList } from './DemoUserList';

/** Convite para entrar, usado pelas páginas que exigem login. */
export function LoginPrompt({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return (
    <section className="section card login-prompt" aria-labelledby="login-prompt-title">
      <h2 id="login-prompt-title">Entre para continuar</h2>
      <p>{children}</p>
      {auth.kind === 'demo' ? (
        <DemoUserList />
      ) : (
        <button type="button" className="button" onClick={() => void auth.login()}>
          Entrar com o Keycloak
        </button>
      )}
    </section>
  );
}
