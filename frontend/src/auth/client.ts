// Contrato comum dos clientes de autenticação: Keycloak (OIDC) e modo demo.

export interface AuthSession {
  /** Login do usuário (preferred_username no Keycloak). */
  usuario: string;
  accessToken: string;
}

export interface AuthClient {
  readonly kind: 'oidc' | 'demo';
  /**
   * Restaura a sessão ao carregar o app. No OIDC também conclui o callback do login
   * (`?code=...&state=...`) e limpa a URL. Lança erro se o callback falhar.
   */
  init(): Promise<AuthSession | null>;
  /** OIDC: redireciona ao Keycloak (resolve null). Demo: entra como `usuario`. */
  login(usuario?: string): Promise<AuthSession | null>;
  /** Encerra a sessão (no OIDC, também no Keycloak). */
  logout(): Promise<void>;
  /** Esquece a sessão só neste navegador (ex.: token expirado), sem redirecionar. */
  clear(): Promise<void>;
  getAccessToken(): string | null;
  /** Avisa quando o access token expira; devolve a função que cancela a inscrição. */
  onExpired(listener: () => void): () => void;
}

/** sessionStorage pode falhar (modo privado, bloqueado): as leituras e escritas nunca lançam. */
export const safeSession = {
  get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      // sem storage: a escolha vale só até recarregar a página
    }
  },
};
