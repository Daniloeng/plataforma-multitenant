import type { ReactNode } from 'react';
import { useAuth } from '../../auth/context';
import { LoginPrompt } from './LoginPrompt';

/** Só mostra o conteúdo para quem tem o papel plataforma-admin. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading' || (auth.status === 'authenticated' && !auth.me && !auth.meError)) {
    return (
      <p className="section muted" role="status">
        Verificando permissões…
      </p>
    );
  }
  if (auth.status === 'anonymous') {
    return (
      <LoginPrompt>
        A administração de tenants exige login com o papel <code>plataforma-admin</code>.
      </LoginPrompt>
    );
  }
  if (!auth.me) {
    return (
      <div className="section alert" role="alert">
        <strong>Não foi possível carregar seus dados.</strong> {auth.meError}
      </div>
    );
  }
  if (!auth.isAdmin) {
    return (
      <div className="section alert" role="alert">
        <strong>Somente administradores da plataforma.</strong> A administração de tenants exige o
        papel <code>plataforma-admin</code>; o gateway responde 403 para os demais usuários.
      </div>
    );
  }
  return <>{children}</>;
}
