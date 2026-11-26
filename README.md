# Plataforma Multi-tenant

[![CI](https://github.com/Daniloeng/plataforma-multitenant/actions/workflows/ci.yml/badge.svg)](https://github.com/Daniloeng/plataforma-multitenant/actions/workflows/ci.yml)
[![GitHub Pages](https://github.com/Daniloeng/plataforma-multitenant/actions/workflows/pages.yml/badge.svg)](https://daniloeng.github.io/plataforma-multitenant/)

Aplicação-modelo para **estudo** de negócio, tecnologias e ferramentas: uma plataforma
**multi-tenant de pedidos B2B com pagamentos**, em microsserviços Java 21 + Spring Boot 3, um
MongoDB por serviço, Apache Pulsar como espinha dorsal de eventos e Kubernetes leve. Tudo com
ferramentas gratuitas.

**Demo:** <https://daniloeng.github.io/plataforma-multitenant/> (frontend em modo demo, API simulada)

## Estado atual: Dia 1 de 22

| Componente | Situação |
|---|---|
| `status-service` | ✅ Ativo: saúde de MongoDB x4 e Pulsar em `GET /api/status` |
| Tenants | Dia 3 |
| Catálogo | Dia 5 |
| Pedidos | Dia 6 |
| Pagamentos | Dia 7 |
| Gateway + Keycloak | Dia 4 |
| Cobertura (linhas) | `platform-core` 100% · `status-service` 98,3% · frontend 100% (mínimo exigido: 80%) |

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
# Infraestrutura + status-service (4 MongoDB, Pulsar standalone): ~30 s após baixar as imagens
docker compose -f infra/docker-compose.yml up -d --build --wait
curl -s localhost:8090/api/status

# Frontend contra a API real (http://localhost:5173)
cd frontend && npm ci && npm run dev

# Frontend sem backend (modo demo, API simulada com MSW)
cd frontend && VITE_DEMO=true npm run dev
```

| Porta | Serviço |
|---|---|
| 27017 a 27020 | MongoDB de tenants, catálogo, pedidos e pagamentos |
| 6650 / 8080 | Pulsar (binário / admin HTTP) |
| 8090 | status-service |
| 5173 | frontend (Vite) |

Memória: o Compose do Dia 1 usa cerca de 1,3 GB (medido com `docker stats`: Pulsar ~660 MB, cada MongoDB ~115 MB, status-service ~170 MB).

## Testes

```bash
mvn -B verify                   # unitários + integração (Testcontainers) + JaCoCo ≥ 80% + formatação
cd frontend && npm run test:coverage   # Vitest, falha abaixo de 80%
```

O CI (GitHub Actions) roda backend, frontend e um teste do **Compose inteiro**: sobe todos os
containers e exige `UP` em `/api/status`. Nada entra na `main` com CI vermelho.

## Estrutura

```
libs/platform-core/       tipos compartilhados (TenantId, IsolationLevel)
services/status-service/  saúde da infraestrutura (Spring Boot)
frontend/                 React + Vite + TypeScript, publicado no GitHub Pages
infra/                    Docker Compose e scripts do Pulsar
docs/dias/                diário detalhado de cada dia
CLAUDE.md                 regras e comandos para o Claude Code
.claude/                  hooks do Claude Code (formatação automática)
```

## Diário de bordo

Cada dia equivale a ~10 h de trabalho executado pelo Claude Code e revisado pelo Danilo, e termina
com PR mergeado, tag `dia-NN`, frontend funcionando e esta seção atualizada.

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
| 2 | Event storming, contratos Avro e OpenAPI, ADRs | Arquitetura e catálogo de eventos |
| 3 | Biblioteca comum (tenant context, outbox, idempotência) e Tenant Service | Criar e listar tenants |
| 4 | Keycloak, Spring Cloud Gateway, rate limit por tenant | Login e troca de tenant |
| 5 | Catálogo | Produtos por tenant |
| 6 | Pedidos com outbox | Carrinho e pedido |
| 7 | Pagamentos: autorização, captura, ledger | Pagamento e extrato |
| 8 | Saga completa | Linha do tempo do pedido (SSE) |
| 9 | Níveis Pool, Bridge e Silo | Selo e promoção de nível |
| 10 | Observabilidade (OpenTelemetry, Prometheus, Grafana) | Saúde por serviço |
| 11 | Helm, kind, KEDA, Argo CD; **MVP1** | MVP1 completo |
| 12 a 17 | Estratégia de QA, mutação, contratos, isolamento, E2E, consistência de eventos | Painéis de qualidade |
| 18 a 22 | Performance (k6), caos, segurança, pipeline de certificação, **go/no-go v1.0.0** | Painel go/no-go |
