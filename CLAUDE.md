# CLAUDE.md

Guia para o Claude Code (e para quem chega ao repositório). Projeto de **estudo**: plataforma
multi-tenant de pedidos B2B + pagamentos em microsserviços. O plano de 22 dias está no
[README](README.md#plano-de-22-dias).

## Idioma e estilo
- Textos para pessoas (README, docs, mensagens de commit, PRs, UI) em **português do Brasil**.
- Código de produção (classes, métodos, campos, variáveis) em inglês; comentários e Javadoc em
  português. Nos testes, nomes de métodos e variáveis locais podem ficar em português, para o
  teste ler como uma especificação (`rejeitaFormatosInvalidos`).
- Linguagem do negócio em português nos contratos: eventos (`pedido.criado`), campos de eventos e
  recursos da API (`/api/v1/pedidos`), como no event storming (ADR-0004).
- Commits no formato Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).

## Estrutura
```
libs/platform-core/       tipos compartilhados (TenantId, IsolationLevel), sem Spring
libs/contracts/           contratos: eventos Avro (gera classes Java) e OpenAPI; EventCatalog
libs/platform-spring/     autoconfiguração comum: TenantContext/filtro X-Tenant-Id, TenantGuard, Outbox + relay, IdempotentConsumer, EventDecoder, EventSubscriber, Caller, database por tenant (isolation), métricas e tracing (observability)
services/gateway/         Spring Cloud Gateway (porta 8000): JWT do Keycloak, tenant do token, rate limit por plano, /api/v1/me
services/tenant-service/  cadastro de tenants, /api/v1/tenants (porta 8081, só plataforma-admin); publica tenant.* pelo outbox; promoção de nível e namespace Pulsar plataforma/t-<id>
services/catalogo-service/ produtos por tenant, /api/v1/produtos (porta 8082); publica produto.alterado e preco.alterado; consome tenant.*
services/pedidos-service/ pedidos, /api/v1/pedidos (porta 8083); preço da cópia local do catálogo, Idempotency-Key; publica pedido.criado, pedido.confirmado e pedido.cancelado; consome pagamento.*; expira PENDENTE após 15 min; histórico e linha do tempo ao vivo (SSE, change stream); Bridge/Silo em pedidos_t_<tenant>
services/pagamentos-service/ cobrança simulada, estorno e ledger, /api/v1/pagamentos e /api/v1/ledger (porta 8084, só gestor/admin); consome pedido.*; publica pagamento.*
services/status-service/  saúde de MongoDB x4, Pulsar e serviços em GET /api/status (porta 8090), com métricas lidas do /actuator/prometheus de cada serviço
frontend/                 React + Vite + TS; modo demo com MSW (GitHub Pages)
infra/                    Docker Compose (MongoDB por serviço, Pulsar, Keycloak), keycloak/realm-plataforma.json, seed.sh; observabilidade/ (Prometheus + alertas testados, Grafana, Tempo; perfil observabilidade)
deploy/helm/plataforma/   chart Helm da plataforma inteira (values-kind para o CI, values-homolog para o Argo CD)
deploy/argocd/            Argo CD: AppProject e app of apps (KEDA e plataforma)
docs/runbooks/            um runbook por alerta (skill runbook)
docs/dias/NN.md           diário detalhado de cada dia
docs/adr/                 decisões de arquitetura (ADRs)
docs/arquitetura/         event storming e diagramas (Mermaid)
.claude/                  hooks (format, run-tests), subagentes (arquiteto, testador) e skills (adr, runbook)
```
Novos microsserviços entram em `services/<nome>-service` (o `services/gateway` é a exceção: é
infraestrutura de borda, não um serviço de negócio), como módulo do `pom.xml` raiz, dependem de
`platform-spring` e seguem o `tenant-service` (Dockerfile, `application.yml`, `*IT` com Mongo + Pulsar).
As dependências web, data-mongodb e pulsar do `platform-spring` são opcionais: o serviço declara as
que usa. Todo serviço novo ganha uma rota em `services/gateway/.../Routes.java`, não publica porta
no host no Compose, entra no `status-service` e no chart (`services:` do `values.yaml`, mais a
variável `<NOME>_URL` do gateway e do status-service).

## Comandos
| O quê | Comando |
|---|---|
| Testes + cobertura backend (≥ 80%) | `mvn -B verify` (precisa de Docker: Testcontainers) |
| Um módulo só | `mvn -B verify -pl services/status-service -am` |
| Formatar Java | `mvn spotless:apply` |
| Frontend | `cd frontend && npm ci && npm run test:coverage && npm run typecheck && npm run format:check` |
| Ambiente local | `docker compose -f infra/docker-compose.yml up -d --build --wait` |
| Com Prometheus, Grafana e Tempo | `TRACING_EXPORT=true docker compose -f infra/docker-compose.yml --profile observabilidade up -d --build --wait` |
| Testar os alertas | `docker run --rm -v "$PWD/infra/observabilidade/prometheus:/p" -w /p --entrypoint promtool prom/prometheus:v3.4.2 test rules alertas.test.yml` |
| Kubernetes local (kind) | `kind create cluster --name plataforma && docker compose -f infra/docker-compose.yml build && for s in gateway status-service tenant-service catalogo-service pedidos-service pagamentos-service; do kind load docker-image plataforma/$s:dev --name plataforma; done && helm install plataforma deploy/helm/plataforma -n plataforma --create-namespace -f deploy/helm/plataforma/values-kind.yaml --wait --timeout 15m && helm test plataforma -n plataforma` |
| Validar o chart | `helm lint deploy/helm/plataforma -f deploy/helm/plataforma/values-kind.yaml --strict` |
| Frontend com API real | `cd frontend && npm run dev` (proxy `/api` → gateway em `localhost:8000`; login no Keycloak em `localhost:8180`) |
| Tenants de demonstração | `infra/seed.sh` (Compose de pé) |
| Token para curl | `curl -s localhost:8180/realms/plataforma/protocol/openid-connect/token -d grant_type=password -d client_id=plataforma-cli -d username=ana -d password=senha123` |
| Frontend em modo demo | `cd frontend && VITE_DEMO=true npm run dev` |
| Só testes rápidos (sem `*IT`) | `mvn -B -q test -pl <módulo> -am -Dtest='!*IT' -Dsurefire.failIfNoSpecifiedTests=false -Djacoco.skip=true` |

## Regras do projeto
- **Cobertura mínima de 80%** de linhas por módulo Java (JaCoCo) e no frontend (Vitest, 4 métricas).
  O CI falha abaixo disso. Toda funcionalidade nova chega com testes unitários e, quando tocar
  infraestrutura, teste de integração com Testcontainers (classes `*IT`, rodam no `mvn verify`).
- **Multi-tenant**: o tenant vem só do cabeçalho `X-Tenant-Id` verificado pelo gateway contra a
  claim `tenants` do token (ADR-0009), nunca do corpo da requisição. O cliente B2B vem de
  `X-Cliente-Id`, o usuário de `X-Usuario` e os papéis de `X-Papeis`, todos escritos pelo gateway.
  Use `TenantId` (valida o formato) em vez de `String`. Nos controllers, receba um `Caller`
  (usuário e papéis) e chame `caller.requireAnyRole(...)` antes de escrever; `ForbiddenException`
  vira 403 `acesso-negado` no `ApiErrors` do serviço.
- **Banco por serviço**: um serviço nunca lê o MongoDB de outro; integração só por eventos Pulsar
  ou API.
- **Publicar evento só pelo outbox**: `Outbox.append(evento, aggregateId)` dentro do mesmo
  `@Transactional` da mudança de estado; nunca chamar o Pulsar direto. Consumidor se registra no
  `EventSubscriber.on(Evento.class, "nome", efeito)` (ADR-0010), que já faz assinatura durável
  Key_Shared, schema do escritor, transação, `IdempotentConsumer` e dead letter. Dado de outro
  serviço vira cópia local mínima com `versao` (ignore versão menor ou igual). Dentro de transação MongoDB, consulte
  antes de inserir: chave duplicada aborta a transação inteira. Coleção que um consumidor grava
  nasce na subida do serviço (junto dos índices), nunca dentro da transação do primeiro evento.
- **Documento de negócio implementa `TenantOwned`** e consultas usam `TenantQueries.scoped(...)`.
- **Eventos**: um `.avsc` por evento em `libs/contracts/src/main/avro/<contexto>/`, com
  `eventId`, `tenantId`, `occurredAt`, `traceparent` e as propriedades `x-evento`, `x-topico`,
  `x-produtor`, `x-consumidores`. Tópico `persistent://plataforma/<produtor>/<entidade>.<evento>.v<n>`,
  resolvido pelo `EventCatalog`, nunca por texto solto. Evolução BACKWARD: campo novo precisa de
  default; enum com símbolo default; compatibilidade FULL; mudança incompatível vira tópico `.v2`. Dinheiro em centavos (`long`).
- **Pedidos** (ADR-0011): o preço vem da cópia local do catálogo, nunca do corpo; POST exige
  `Idempotency-Key` (mesma chave e corpo devolvem o pedido com `Idempotent-Replayed: true`).
- **Pagamentos** (ADR-0012): um pagamento por pedido (consulte antes de cobrar); `pedido.cancelado`
  antes da cobrança deixa uma marca que a impede; o ledger só recebe inserções, sempre em pares
  débito/crédito de mesmo valor; eventos de pagamento usam o `pedidoId` como agregado.
- **Tempo real** (ADR-0013): a tela acompanha mudanças por SSE (`SseEmitter`) alimentado por change
  stream do MongoDB, nunca por aviso local da réplica; o primeiro evento é sempre o estado atual. No
  navegador, `fetch` com stream (o `EventSource` não manda o `Authorization`).
- **Isolamento** (ADR-0014): com `plataforma.isolation.enabled`, a database vem do tenant do
  contexto (Bridge e Silo em `<padrão>_t_<tenant>`); liste em `plataforma.isolation.collections`
  toda coleção de negócio nova, senão ela não migra. Coleção da plataforma fica na padrão
  (`PlatformDatabase`). Job ou leitura sem tenant no contexto enxerga só a database padrão: percorra
  também `TenantPlacements.dedicated()`. Durante a migração, as APIs do tenant dão 503
  `tenant-em-migracao`.
- **Observabilidade** (ADR-0015): todo serviço novo declara `micrometer-registry-prometheus`,
  `micrometer-tracing-bridge-otel` e `opentelemetry-exporter-otlp`, expõe `health,info,prometheus`
  e entra no `prometheus.yml`. Métrica da plataforma tem prefixo `plataforma_` e nome em português;
  alerta novo entra em `alertas.yml` com `runbook_url`, runbook em `docs/runbooks/` e teste em
  `alertas.test.yml`. Nunca use dado de corpo ou id de pedido como tag (cardinalidade); a tag
  `tenant` já vem do filtro. O relay do outbox tem lease (`outbox_relay_lease`): várias réplicas
  podem subir.
- **Kubernetes** (ADR-0016): o chart é a fonte de verdade da implantação; `files/pulsar-init.sh` e
  `files/realm-plataforma.json` são cópias das de `infra/` (o CI confere). Imagem nova sobe com o
  `appVersion` do chart e o workflow `release.yml`. Consumidor que escala usa assinatura Key_Shared
  (já é o padrão do `EventSubscriber`); nada de estado em memória que precise de réplica única.
- **APIs**: contract-first em `libs/contracts/src/main/resources/openapi/`; rotas `/api/v1/`;
  `X-Tenant-Id` obrigatório nas APIs de negócio; erros em Problem Details (RFC 9457).
- **Decisões**: decisão de arquitetura vira ADR (skill `adr`); peça revisão ao subagente `arquiteto`
  antes de abrir PR que mude contratos ou fronteiras entre serviços.
- **Custo zero até o Dia 10**: só ferramentas gratuitas; nada de serviços pagos.
- **Formatação**: google-java-format (Spotless, conferido no `validate`) e Prettier no frontend.
  O hook `.claude/hooks/format.sh` formata cada arquivo que o Claude edita, e o hook `Stop`
  (`.claude/hooks/run-tests.sh`) roda os testes rápidos dos módulos alterados antes de o Claude
  encerrar (desligue com `CLAUDE_SKIP_TEST_HOOK=1`). Para escrever ou revisar testes, use o
  subagente `testador`.

## Fluxo de cada dia
1. Branch a partir da `main`, PR com testes passando no CI.
2. Code review (`/code-review`) e merge quando o CI estiver verde; tag `dia-NN`.
3. Atualizar o **Diário de bordo** do README e criar `docs/dias/NN.md` (o que foi feito, por quê,
   como testar, recursos do Claude Code usados).
4. O frontend publicado no GitHub Pages precisa mostrar a funcionalidade do dia.
