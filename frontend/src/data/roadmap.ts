// Roadmap estático dos microsserviços e do progresso do estudo.

export type ServiceSituation = 'Ativo' | 'Planejado';

export interface RoadmapService {
  name: string;
  day: number;
  responsibility: string;
  situation: ServiceSituation;
}

export const ROADMAP: readonly RoadmapService[] = [
  {
    name: 'status-service',
    day: 1,
    responsibility:
      'Verifica MongoDB e Pulsar e responde o endpoint /api/status consumido por esta página.',
    situation: 'Ativo',
  },
  {
    name: 'Tenants',
    day: 3,
    responsibility:
      'Cadastra tenants, plano e nível de isolamento; publica tenant.criado e tenant.alterado pelo outbox.',
    situation: 'Ativo',
  },
  {
    name: 'Gateway + Keycloak',
    day: 4,
    responsibility:
      'Porta única das APIs: valida o token do Keycloak, confere o tenant do X-Tenant-Id e limita requisições por plano.',
    situation: 'Ativo',
  },
  {
    name: 'Catálogo',
    day: 5,
    responsibility:
      'Mantém produtos e preços de cada tenant, com limite por plano; publica produto.alterado e preco.alterado pelo outbox.',
    situation: 'Ativo',
  },
  {
    name: 'Pedidos',
    day: 6,
    responsibility: 'Recebe pedidos B2B e publica eventos do ciclo de vida no Pulsar.',
    situation: 'Planejado',
  },
  {
    name: 'Pagamentos',
    day: 7,
    responsibility: 'Processa cobranças dos pedidos e confirma pagamentos por eventos.',
    situation: 'Planejado',
  },
];

export const CURRENT_DAY = 5;
export const TOTAL_DAYS = 22;
export const REPOSITORY_URL = 'https://github.com/Daniloeng/plataforma-multitenant';
