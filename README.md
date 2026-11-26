# Plataforma Multi-tenant

[![CI](https://github.com/Daniloeng/plataforma-multitenant/actions/workflows/ci.yml/badge.svg)](https://github.com/Daniloeng/plataforma-multitenant/actions/workflows/ci.yml)
[![GitHub Pages](https://github.com/Daniloeng/plataforma-multitenant/actions/workflows/pages.yml/badge.svg)](https://daniloeng.github.io/plataforma-multitenant/)

Aplicação-modelo para **estudo** de negócio, tecnologias e ferramentas: uma plataforma
**multi-tenant de pedidos B2B com pagamentos**, em microsserviços Java 21 + Spring Boot 3, um
MongoDB por serviço, Apache Pulsar como espinha dorsal de eventos e Kubernetes leve. Tudo com
ferramentas gratuitas.

**Demo:** <https://daniloeng.github.io/plataforma-multitenant/> (frontend em modo demo, API simulada)

## Estado atual: Dia 6 de 22

| Componente | Situação |
|---|---|
| `status-service` | ✅ Ativo: saúde de MongoDB x4, Pulsar e serviços em `GET /api/status` |
| Gateway + Keycloak | ✅ Ativo: única entrada (porta 8000), login OIDC, troca de tenant, rate limit por plano |
| Tenants | ✅ Ativo: cadastro em `/api/v1/tenants` (só `plataforma-admin`), publica `tenant.criado` e `tenant.alterado` |
| Biblioteca comum | ✅ `platform-spring`: contexto de tenant, outbox transacional, consumidor padrão de eventos (`EventSubscriber`), identidade do gateway (`Caller`) |
| Catálogo | ✅ Ativo: produtos e preços por tenant em `/api/v1/produtos`, limite de produtos por plano, publica `produto.alterado` e `preco.alterado` |
| Pedidos | ✅ Ativo: `/api/v1/pedidos` com preço da cópia local do catálogo, `Idempotency-Key`, cancelamento; publica `pedido.criado` e `pedido.cancelado` |
| Pagamentos | Dia 7 |
| Contratos | 10 eventos Avro, 5 APIs OpenAPI, 11 ADRs ([arquitetura](docs/arquitetura/event-storming.md)) |
| Cobertura (linhas) | `platform-core` 100% · `contracts` 100% · `platform-spring` 91,1% · `gateway` 91,2% · `catalogo-service` 94,2% · `pedidos-service` 94,1% · `tenant-service` 97,4% · `status-service` 98,7% · frontend 99,9% (mínimo exigido: 80%) |

## Arquitetura (visão alvo)

```
                ┌───────────────┐      JWT (Keycloak) → X-Tenant-Id
  Frontend ───▶ │    Gateway    │──────────────┬──────────────┬──────────────┐
 (React/Vite)   └───────────────┘              ▼              ▼              ▼
                         ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐
                         │ Tenants  │   │ Catálogo │   │ Pedidos  │   │ Pagamentos │
                         └────┬─────┘   └────┬─────┘   └────┬─────┘   └─────┬──────┘
                           MongoDB        MongoDB        MongoDB         MongoDB
                              └──────────────┴── Apache Pulsar (eventos) ──┘
```

- **Multi-tenancy** em três níveis de isolamento (Pool, Bridge, Silo), tenant resolvido uma vez no gateway.
- **Saga coreografada** de pedido e pagamento, com outbox transacional e consumo idempotente.
- **Metas:** p99 < 3 s obrigatório, alvo perto de 200 ms na escrita.

## Como rodar

Pré-requisitos: Java 21, Maven 3.9, Node 22, Docker.

```bash
# Infraestrutura + serviços (4 MongoDB, Pulsar, Keycloak, gateway, tenants, catálogo, pedidos, status)
docker compose -f infra/docker-compose.yml up -d --build --wait
infra/seed.sh                      # cria os tenants acme, globex e initech e produtos de exemplo
curl -s localhost:8000/api/status  # público

# Token de um usuário de demonstração (senha123: admin, ana, bruno) e chamada pelo gateway
TOKEN=$(curl -s localhost:8180/realms/plataforma/protocol/openid-connect/token \
  -d grant_type=password -d client_id=plataforma-cli -d username=ana -d password=senha123 | jq -r .access_token)
curl -s localhost:8000/api/v1/me -H "Authorization: Bearer $TOKEN" -H 'X-Tenant-Id: acme'

# Frontend contra a API real (http://localhost:5173)
cd frontend && npm ci && npm run dev

# Frontend sem backend (modo demo, API simulada com MSW)
cd frontend && VITE_DEMO=true npm run dev
```

| Porta | Serviço |
|---|---|
| 27017 a 27020 | MongoDB de tenants, catálogo, pedidos e pagamentos |
| 6650 / 8080 | Pulsar (binário / admin HTTP) |
| 8000 | gateway (única entrada das APIs; os serviços não ficam expostos) |
| 8180 | Keycloak (console `admin`/`admin`) |
| 5173 | frontend (Vite) |

Memória: o Compose do Dia 1 usava cerca de 1,3 GB (medido com `docker stats`: Pulsar ~660 MB, cada MongoDB ~115 MB, status-service ~170 MB).

## Testes

```bash
mvn -B verify                   # unitários + integração (Testcontainers) + JaCoCo ≥ 80% + formatação
cd frontend && npm run test:coverage   # Vitest, falha abaixo de 80%
```

O CI (GitHub Actions) roda backend, frontend e um teste do **Compose inteiro**: sobe todos os
containers, exige `UP` em `/api/status` pelo gateway, cria tenants com token do Keycloak, confere
o `tenant.criado` no Pulsar, o `/api/v1/me`, os 403 de papel e de tenant, o limite do plano e
uma compra com repetição pela mesma `Idempotency-Key`. Nada entra na `main` com CI vermelho.

## Estrutura

```
libs/platform-core/       tipos compartilhados (TenantId, IsolationLevel)
libs/contracts/           eventos Avro, APIs OpenAPI e catálogo de eventos
libs/platform-spring/     base Spring comum: tenant por requisição, outbox, idempotência
services/gateway/         porta de entrada: JWT, tenant, rate limit e rotas (porta 8000)
services/tenant-service/  cadastro de tenants (porta 8081, só na rede interna)
services/catalogo-service/ produtos e preços por tenant (porta 8082, só na rede interna)
services/pedidos-service/ pedidos B2B com idempotência (porta 8083, só na rede interna)
services/status-service/  saúde da plataforma (porta 8090)
frontend/                 React + Vite + TypeScript, publicado no GitHub Pages
infra/                    Docker Compose, realm do Keycloak, scripts do Pulsar e seed
docs/dias/                diário detalhado de cada dia
docs/adr/                 decisões de arquitetura
docs/arquitetura/         event storming e diagramas
CLAUDE.md                 regras e comandos para o Claude Code
.claude/                  hooks, subagentes (arquiteto, testador) e skill de ADR do Claude Code
```

## Diário de bordo

Cada dia equivale a ~10 h de trabalho executado pelo Claude Code e revisado pelo Danilo, e termina
com PR mergeado, tag `dia-NN`, frontend funcionando e esta seção atualizada.

### Dia 6: pedidos com outbox e idempotência · [detalhes](docs/dias/06.md)

- **Feito:** `pedidos-service` com `/api/v1/pedidos` (criar, listar, detalhar, cancelar); preço
  e nome vindos da cópia local do catálogo, montada pelos eventos `produto.alterado` e
  `preco.alterado`; `Idempotency-Key` obrigatória com hash do corpo; comprador vê só os pedidos do
  próprio cliente; `pedido.criado` e `pedido.cancelado` pelo outbox; ADR-0011. No frontend, o
  **carrinho** na aba Produtos e a aba **Pedidos**.
- **Por quê:** o pedido é o começo da saga com dinheiro. Repetir um POST não pode gerar dois
  pedidos (nem duas cobranças no Dia 7), e o preço não pode vir do navegador.
- **Como testar:** entre como `bruno`, monte o carrinho em acme e faça o pedido; entre como `ana`
  e veja os pedidos de todos os clientes. Os comandos com `curl` estão no diário.
- **Cobertura:** `pedidos-service` 94,1%, frontend 99,87% de linhas.
- **Claude Code:** a assinatura de eventos do PR do Dia 5 trouxe a falha do CI de volta à sessão,
  que corrigiu um conflito de transação real antes do merge; frontend feito por subagente em
  background; revisão do `arquiteto`.

### Dia 5: catálogo de produtos por tenant · [detalhes](docs/dias/05.md)

- **Feito:** `catalogo-service` com `/api/v1/produtos` (cadastro, busca, paginação, preço, ativar
  e desativar), SKU único por tenant, comprador vê só produtos ativos e só gestor altera; limite
  de produtos por plano aprendido pelos eventos de tenant; `EventSubscriber` e `Caller` na
  biblioteca comum; rota no gateway; ADR-0010. No frontend, a aba **Produtos**.
- **Por quê:** é o primeiro serviço que consome eventos de outro, e o padrão de consumo (schema
  do escritor, idempotência, dead letter) serve aos Pedidos e Pagamentos.
- **Como testar:** `infra/seed.sh` cria produtos em acme e globex; entre como `ana` e veja a aba
  Produtos trocando de tenant, ou como `bruno` para ver o catálogo só de leitura.
- **Claude Code:** frontend em subagente de background a partir do contrato, revisão do
  `arquiteto`, `/code-review` e a skill `adr`.
- **Cobertura:** `catalogo-service` 94,2%, `platform-spring` 91,1%, frontend 99,97% de linhas.

### Dia 4: gateway, Keycloak e rate limit por tenant · [detalhes](docs/dias/04.md)

- **Feito:** Keycloak com o realm `plataforma` (papéis, tenants como grupos, usuários de demo);
  `services/gateway` com Spring Cloud Gateway validando o JWT, conferindo o tenant escolhido em
  `X-Tenant-Id`, aplicando o limite do plano (429 + `Retry-After`) e repassando a identidade
  verificada; `GET /api/v1/me`; catálogo de tenants no gateway por eventos; serviços fechados atrás
  do gateway; ADR-0009. No frontend: login (OIDC + PKCE), seletor de tenant, aba **Minha conta**
  com teste do limite e aba Tenants só para admin.
- **Por quê:** o tenant passa a vir do token, não do cliente (ADR-0005 e ADR-0007), e os próximos
  serviços já nascem protegidos sem lidar com JWT.
- **Como testar:** `docker compose ... up`, `infra/seed.sh` e `cd frontend && npm run dev`; entre
  como `ana`/`senha123` e troque entre acme e globex. No Pages, escolha um usuário de demonstração.
- **Claude Code:** subagente `arquiteto` revisando contrato e fronteiras, frontend em subagente de
  background, skill `adr` para o ADR-0009.
- **Cobertura:** `gateway` 91,1%, `platform-spring` 91,8%, frontend 99,9% de linhas.

### Dia 3: tenant-service, outbox e isolamento por tenant · [detalhes](docs/dias/03.md)

- **Feito:** biblioteca `platform-spring` (filtro `X-Tenant-Id`, guarda de gravação por tenant,
  outbox transacional com relay para o Pulsar, consumo idempotente); `tenant-service` com
  `POST/GET/PATCH /api/v1/tenants` publicando `tenant.criado` e `tenant.alterado`; status-service
  verificando o novo serviço; ADR-0008; aba **Tenants** no frontend.
- **Por quê:** é a base que Catálogo, Pedidos e Pagamentos vão reaproveitar. O outbox garante que
  nenhuma mudança fica sem evento, mesmo com o Pulsar fora do ar.
- **Como testar:** suba o Compose, crie um tenant com `curl` (acima) ou pela aba Tenants e confira
  `tenant.criado` em `localhost:8080/admin/v2/persistent/plataforma/tenants/tenant.criado.v1/stats`.
- **Cobertura:** `platform-spring` 91,0%, `tenant-service` 97,3%, frontend 99,9% de linhas.
- **Claude Code:** subagente `testador`, hook `Stop` que roda os testes rápidos antes de o Claude
  encerrar, e o frontend feito por um subagente em background a partir do contrato.

### Dia 2: event storming, contratos e ADRs · [detalhes](docs/dias/02.md)

- **Feito:** event storming do fluxo de pedido e pagamento; 10 eventos em Avro (com tópico, produtor
  e consumidores no próprio schema) e as classes Java geradas; 4 APIs em OpenAPI 3.1; 7 ADRs; página
  **Arquitetura** no frontend com diagramas, catálogo de eventos, matriz publica/consome e ADRs.
- **Por quê:** fixar os contratos antes dos serviços. Com compatibilidade FULL verificada no PR,
  uma mudança que quebraria um consumidor aparece como teste vermelho.
- **Como testar:** abra a aba Arquitetura (no Pages ou com `npm run dev`); para ver a proteção,
  adicione um campo sem default em um `.avsc` e rode `mvn -B verify -pl libs/contracts -am`.
- **Cobertura:** `contracts` 100%, frontend 99,9% de linhas.
- **Claude Code:** subagente de projeto `arquiteto` (achou 10 problemas, incluindo uma corrida
  entre tópicos que cobraria pedidos cancelados) e skill `adr`.

### Dia 1: fundação do monorepo · [detalhes](docs/dias/01.md)

- **Feito:** build Maven multi-módulo (Java 21, Spring Boot 3.5, Spotless, JaCoCo ≥ 80%);
  `platform-core` com `TenantId` e `IsolationLevel`; `status-service` que verifica os 4 MongoDB e o
  Pulsar em paralelo; Docker Compose com MongoDB por serviço (replica set de um nó) e Pulsar
  standalone com os namespaces `plataforma/*`; frontend com a página de status; CI com 3 jobs e
  deploy no GitHub Pages.
- **Por quê:** a página de status precisava de dados reais, e o `status-service` já fixa o padrão
  que os próximos serviços seguem (testes com Testcontainers, cobertura, Dockerfile, healthcheck).
- **Como testar:** `docker compose -f infra/docker-compose.yml up -d --build --wait` e abrir o
  frontend; pare um MongoDB (`docker compose -f infra/docker-compose.yml stop mongo-pedidos`) e
  a página passa para "Degradada".
- **Cobertura:** `platform-core` 100%, `status-service` 98,3%, frontend 100% de linhas.
- **Claude Code:** `CLAUDE.md`, hook `PostToolUse` de formatação e um subagente em background
  que construiu o frontend em paralelo ao backend.

## Plano de 22 dias

| Dia | Entrega | Frontend |
|---|---|---|
| 1 ✅ | Monorepo, CLAUDE.md, Docker Compose, CI, GitHub Pages | Status da plataforma |
| 2 ✅ | Event storming, contratos Avro e OpenAPI, ADRs | Arquitetura e catálogo de eventos |
| 3 ✅ | Biblioteca comum (tenant context, outbox, idempotência) e Tenant Service | Criar e listar tenants |
| 4 ✅ | Keycloak, Spring Cloud Gateway, rate limit por tenant | Login e troca de tenant |
| 5 ✅ | Catálogo | Produtos por tenant |
| 6 ✅ | Pedidos com outbox | Carrinho e pedido |
| 7 | Pagamentos: autorização, captura, ledger | Pagamento e extrato |
| 8 | Saga completa | Linha do tempo do pedido (SSE) |
| 9 | Níveis Pool, Bridge e Silo | Selo e promoção de nível |
| 10 | Observabilidade (OpenTelemetry, Prometheus, Grafana) | Saúde por serviço |
| 11 | Helm, kind, KEDA, Argo CD; **MVP1** | MVP1 completo |
| 12 a 17 | Estratégia de QA, mutação, contratos, isolamento, E2E, consistência de eventos | Painéis de qualidade |
| 18 a 22 | Performance (k6), caos, segurança, pipeline de certificação, **go/no-go v1.0.0** | Painel go/no-go |
