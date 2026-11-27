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
    responsibility:
      'Recebe pedidos B2B com Idempotency-Key, calcula o total com os preços do catálogo e publica pedido.criado e pedido.cancelado pelo outbox.',
    situation: 'Ativo',
  },
  {
    name: 'Pagamentos',
    day: 7,
    responsibility:
      'Cobra cada pedido num gateway simulado a partir de pedido.criado, registra captura e estorno num ledger de partidas dobradas e publica pagamento.aprovado, pagamento.recusado e pagamento.estornado.',
    situation: 'Ativo',
  },
  {
    name: 'Saga do pedido',
    day: 8,
    responsibility:
      'Fecha a saga coreografada de ponta a ponta e mostra a linha do tempo de cada pedido em tempo real (SSE).',
    situation: 'Ativo',
  },
  {
    name: 'Níveis de isolamento',
    day: 9,
    responsibility:
      'Isola cada tenant no nível do plano (Pool, Bridge ou Silo) e promove o tenant de nível sem perder dados.',
    situation: 'Ativo',
  },
  {
    name: 'Observabilidade',
    day: 10,
    responsibility:
      'Mede cada serviço com OpenTelemetry, Prometheus e Grafana e mostra a saúde por serviço com traces de ponta a ponta.',
    situation: 'Ativo',
  },
  {
    name: 'Kubernetes e MVP1',
    day: 11,
    responsibility:
      'Empacota a plataforma num chart Helm testado num cluster kind no CI, escala o pagamentos-service com KEDA pelo backlog do Pulsar e entrega por GitOps com o Argo CD, fechando o MVP1 na versão v0.1.0-mvp1.',
    situation: 'Ativo',
  },
];

export const CURRENT_DAY = 11;
export const TOTAL_DAYS = 22;
export const REPOSITORY_URL = 'https://github.com/Daniloeng/plataforma-multitenant';
