// Usuários do modo demo (GitHub Pages, sem Keycloak). O gateway simulado (src/mocks/gateway.ts)
// usa a mesma lista para responder /api/v1/me e aplicar papéis e tenants.

import type { Papel } from '../api/me';

export interface DemoUser {
  usuario: string;
  nome: string;
  papeis: Papel[];
  clienteId: string | null;
  /** Ids dos tenants do usuário; 'todos' = todos os tenants do cadastro. */
  tenants: readonly string[] | 'todos';
  /** Frase curta para o seletor de usuários. */
  descricao: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    usuario: 'admin',
    nome: 'Administradora da plataforma',
    papeis: ['plataforma-admin'],
    clienteId: null,
    tenants: 'todos',
    descricao: 'Administra o cadastro de tenants; acessa todos os tenants.',
  },
  {
    usuario: 'ana',
    nome: 'Ana Souza',
    papeis: ['gestor-tenant'],
    clienteId: null,
    tenants: ['distribuidora-aurora', 'atacado-vale-verde'],
    descricao: 'Gestora de dois tenants (Profissional e Empresarial).',
  },
  {
    usuario: 'bruno',
    nome: 'Bruno Lima',
    papeis: ['comprador'],
    clienteId: 'cli-bruno',
    tenants: ['farmaceutica-boa-saude'],
    descricao: 'Comprador de um único tenant.',
  },
];

/** Prefixo do token do modo demo: `demo-<usuario>`. */
export const DEMO_TOKEN_PREFIX = 'demo-';

export function demoToken(usuario: string): string {
  return `${DEMO_TOKEN_PREFIX}${usuario}`;
}

export function findDemoUser(usuario: string | null | undefined): DemoUser | null {
  return DEMO_USERS.find((u) => u.usuario === usuario) ?? null;
}
