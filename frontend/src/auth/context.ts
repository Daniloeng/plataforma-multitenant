import { createContext, useContext } from 'react';
import type { Me, TenantDoUsuario } from '../api/me';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthValue {
  kind: 'oidc' | 'demo';
  /** 'loading' enquanto restaura a sessão (ou conclui o callback do Keycloak). */
  status: AuthStatus;
  usuario: string | null;
  /** Resposta de GET /api/v1/me (null até carregar). */
  me: Me | null;
  meLoading: boolean;
  meError: string | null;
  /** Aviso para o usuário: sessão expirada, falha no login. */
  notice: string | null;
  tenantId: string | null;
  selectedTenant: TenantDoUsuario | null;
  isAdmin: boolean;
  /** OIDC: redireciona ao Keycloak. Demo: entra como `usuario`. */
  login: (usuario?: string) => Promise<void>;
  logout: () => Promise<void>;
  selectTenant: (id: string | null) => void;
  reloadMe: () => Promise<void>;
  dismissNotice: () => void;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa de um <AuthProvider>.');
  return value;
}
