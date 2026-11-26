# Frontend — Status, Tenants e Arquitetura da plataforma

Frontend da plataforma multi-tenant (pedidos B2B + pagamentos), com três páginas em abas:

- **Status** (`#/`): status do `status-service` (`GET /api/status`, atualizado a cada 10 s), o
  roadmap dos microsserviços e o progresso do estudo.
- **Tenants** (`#/tenants`): administração do catálogo de tenants — cria, lista, suspende e
  reativa tenants pelo Tenant Service (`/api/v1/tenants`).
- **Arquitetura** (`#/arquitetura`): diagramas do event storming, catálogo de eventos, matriz
  produtor × consumidor e lista de ADRs — tudo lido **em build time** do próprio repositório.

O roteamento é por hash (`#/`, `#/tenants` e `#/arquitetura`), sem biblioteca de rotas, para funcionar no
GitHub Pages (que não reescreve rotas para o `index.html`).

Stack: React 19 + Vite 7 + TypeScript, testes com Vitest + Testing Library + MSW. Requer Node 22+.

## Como rodar

```bash
npm install
npm run dev          # http://localhost:5173
```

O proxy do Vite (`vite.config.ts`) encaminha cada API para o seu serviço; a primeira regra que
casar vence, por isso a específica vem antes da genérica:

| Caminho           | Destino                 | Serviço          |
| ----------------- | ----------------------- | ---------------- |
| `/api/v1/tenants` | `http://localhost:8081` | `tenant-service` |
| `/api`            | `http://localhost:8090` | `status-service` |

Para dados reais, suba antes o ambiente na raiz do repositório:

```bash
docker compose -f infra/docker-compose.yml up -d --build --wait
```

## Modo demo (sem backend)

Com `VITE_DEMO=true`, o [MSW](https://mswjs.io) intercepta as APIs no navegador e devolve dados
simulados. A página exibe o selo "Modo demo (API simulada)".

- `/api/status` (`src/mocks/handlers.ts`): MongoDB x4, Pulsar e `tenant-service` (type `SERVICE`,
  "readiness UP") no ar, latências variando.
- `/api/v1/tenants` e `/api/v1/tenants/:id` (`src/mocks/tenants.ts`): store em memória
  pré-populado com 5 tenants fictícios (Pool, Bridge e Silo), com as mesmas regras do contrato —
  400 em Problem Details (`application/problem+json`) para dados inválidos, 409 para id repetido,
  404 para tenant inexistente e paginação por cursor real (ordem: mais recentes primeiro; cursor =
  id do último item da página). O store vive só na aba do navegador: recarregar a página volta ao
  estado inicial. Nos testes, `resetTenantStore()` roda depois de cada teste (`src/test/setup.ts`).

```bash
VITE_DEMO=true npm run dev
# build do GitHub Pages (base /plataforma-multitenant/):
VITE_DEMO=true VITE_BASE=/plataforma-multitenant/ npm run build
```

O service worker (`public/mockServiceWorker.js`) é gerado por `npx msw init public --save`.

## Página Tenants

Consome o contrato `libs/contracts/src/main/resources/openapi/tenants.yaml` (cliente e tipos em
`src/api/tenants.ts`; URLs absolutas a partir do `BASE_URL`, como em `src/api/status.ts`).

| Ação               | Chamada                                                | Na tela                                          |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Listar             | `GET api/v1/tenants?limite=20&cursor=…`                | tabela (cartões no celular) + "Carregar mais"    |
| Criar              | `POST api/v1/tenants` → 201                            | formulário "Novo tenant"; entra no topo da lista |
| Suspender/reativar | `PATCH api/v1/tenants/{id}` com `{ "ativo": … }` → 200 | botão em cada linha                              |

- O formulário valida no cliente com as mesmas regras do contrato e do `TenantId` de
  `libs/platform-core`: id com `^[a-z][a-z0-9-]{1,38}[a-z0-9]$` e sem `--`; nome de 2 a 120
  caracteres. Erros ficam ligados aos campos (`aria-invalid` + `aria-describedby`) e o foco vai
  para o primeiro campo inválido.
- Erros do servidor (400, 409, 404) mostram o `detail` do Problem Details; sem `detail`, o `title`;
  sem corpo, o código HTTP.
- Datas em pt-BR no fuso `America/Sao_Paulo`, como na página Status.
- Se a API estiver inacessível, a página explica como subir o tenant-service ou usar o modo demo.

## Página Arquitetura

O conteúdo vem de arquivos fora de `frontend/`, lidos com `import.meta.glob(..., { query: '?raw',
eager: true })` em `src/architecture/sources.ts` (por isso o `vite.config.ts` libera a raiz do
repositório em `server.fs.allow`). Nada é buscado em tempo de execução.

| Seção                        | Fonte                                                                                                         | Parse (funções puras)         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Event storming               | `docs/arquitetura/event-storming.md` (blocos ` ```mermaid `, título = heading `##`/`###` anterior)            | `src/architecture/docs.ts`    |
| Catálogo de eventos          | `libs/contracts/src/main/avro/**/*.avsc` (records com `x-evento`, `x-topico`, `x-produtor`, `x-consumidores`) | `src/architecture/catalog.ts` |
| Matriz produtor × consumidor | os mesmos schemas                                                                                             | `src/architecture/catalog.ts` |
| ADRs                         | `docs/adr/*.md` (`# ADR-0001: Título`, `- **Status:**`, `- **Data:**`)                                        | `src/architecture/docs.ts`    |

- O catálogo mostra tipos legíveis (`uuid`, `timestamp-millis`, `string?`, `ItemPedido[]`,
  `enum Plano (GRATUITO | PROFISSIONAL | EMPRESARIAL)`), agrupa os metadados (`eventId`,
  `tenantId`, `occurredAt`, `traceparent`) num bloco recolhido e filtra por serviço (eventos que o
  serviço publica ou consome). Enums em arquivo próprio (ex.: `tenants/Plano.avsc`) não viram
  eventos, mas fornecem os símbolos dos campos que os referenciam.
- Os diagramas usam o [Mermaid](https://mermaid.js.org) 11, carregado por `import('mermaid')`
  só quando a página Arquitetura abre: ele fica em chunks separados e não pesa a página Status.
  Tema conforme `prefers-color-scheme` e `securityLevel: 'strict'`. Se um diagrama falhar, a
  página mostra o erro e o código-fonte.
- Novo evento, diagrama ou ADR aparece na página no próximo build, sem mudar o frontend.

## Testes e qualidade

```bash
npm test               # Vitest (jsdom + msw/node)
npm run test:coverage  # cobertura v8; falha abaixo de 80% (lines/statements/functions/branches)
npm run typecheck
npm run format:check   # ou npm run format para corrigir
```

Relatórios de cobertura ficam em `coverage/` (HTML, lcov e `coverage-summary.json`).

Nos testes o módulo `mermaid` é sempre mockado (em `src/test/setup.ts`), porque o jsdom não faz
layout de SVG; cada teste pode forçar um erro com `vi.mocked(mermaid.render).mockRejectedValueOnce`.
As funções de parse são testadas com fixtures (`src/test/architecture-fixtures.ts`), e há testes
que leem os schemas e documentos reais do repositório.
