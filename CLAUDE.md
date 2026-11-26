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
libs/platform-spring/     autoconfiguração comum: TenantContext/filtro X-Tenant-Id, TenantGuard, Outbox + relay, IdempotentConsumer
services/tenant-service/  cadastro de tenants, /api/v1/tenants (porta 8081); publica tenant.* pelo outbox
services/status-service/  saúde de MongoDB x4, Pulsar e serviços em GET /api/status (porta 8090)
frontend/                 React + Vite + TS; modo demo com MSW (GitHub Pages)
infra/                    Docker Compose (MongoDB por serviço, Pulsar standalone) e scripts
docs/dias/NN.md           diário detalhado de cada dia
docs/adr/                 decisões de arquitetura (ADRs)
docs/arquitetura/         event storming e diagramas (Mermaid)
.claude/                  hooks (format, run-tests), subagentes (arquiteto, testador) e skills (adr)
```
Novos microsserviços entram em `services/<nome>-service`, como módulo do `pom.xml` raiz, dependem de
`platform-spring` e seguem o `tenant-service` (Dockerfile, `application.yml`, `*IT` com Mongo + Pulsar).

## Comandos
| O quê | Comando |
|---|---|
| Testes + cobertura backend (≥ 80%) | `mvn -B verify` (precisa de Docker: Testcontainers) |
| Um módulo só | `mvn -B verify -pl services/status-service -am` |
| Formatar Java | `mvn spotless:apply` |
| Frontend | `cd frontend && npm ci && npm run test:coverage && npm run typecheck && npm run format:check` |
| Ambiente local | `docker compose -f infra/docker-compose.yml up -d --build --wait` |
| Frontend com API real | `cd frontend && npm run dev` (proxy `/api/v1/tenants` → `localhost:8081`, resto de `/api` → `localhost:8090`) |
| Frontend em modo demo | `cd frontend && VITE_DEMO=true npm run dev` |
| Só testes rápidos (sem `*IT`) | `mvn -B -q test -pl <módulo> -am -Dtest='!*IT' -Dsurefire.failIfNoSpecifiedTests=false -Djacoco.skip=true` |

## Regras do projeto
- **Cobertura mínima de 80%** de linhas por módulo Java (JaCoCo) e no frontend (Vitest, 4 métricas).
  O CI falha abaixo disso. Toda funcionalidade nova chega com testes unitários e, quando tocar
  infraestrutura, teste de integração com Testcontainers (classes `*IT`, rodam no `mvn verify`).
- **Multi-tenant**: o tenant vem só do cabeçalho `X-Tenant-Id` injetado pelo gateway (a partir do
  Dia 4), nunca do corpo da requisição. Use `TenantId` (valida o formato) em vez de `String`.
- **Banco por serviço**: um serviço nunca lê o MongoDB de outro; integração só por eventos Pulsar
  ou API.
- **Publicar evento só pelo outbox**: `Outbox.append(evento, aggregateId)` dentro do mesmo
  `@Transactional` da mudança de estado; nunca chamar o Pulsar direto. Consumidor usa
  `IdempotentConsumer.processOnce` na transação do efeito. Dentro de transação MongoDB, consulte
  antes de inserir: chave duplicada aborta a transação inteira.
- **Documento de negócio implementa `TenantOwned`** e consultas usam `TenantQueries.scoped(...)`.
- **Eventos**: um `.avsc` por evento em `libs/contracts/src/main/avro/<contexto>/`, com
  `eventId`, `tenantId`, `occurredAt`, `traceparent` e as propriedades `x-evento`, `x-topico`,
  `x-produtor`, `x-consumidores`. Tópico `persistent://plataforma/<produtor>/<entidade>.<evento>.v<n>`,
  resolvido pelo `EventCatalog`, nunca por texto solto. Evolução BACKWARD: campo novo precisa de
  default; enum com símbolo default; compatibilidade FULL; mudança incompatível vira tópico `.v2`. Dinheiro em centavos (`long`).
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
