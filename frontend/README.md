# Frontend — Status, Tenants, Produtos, Arquitetura e Minha conta

Frontend da plataforma multi-tenant (pedidos B2B + pagamentos), com cinco páginas em abas e, no
cabeçalho, login (Keycloak) e troca de tenant:

- **Status** (`#/`): status do `status-service` (`GET /api/status`, atualizado a cada 10 s), o
  roadmap dos microsserviços e o progresso do estudo.
- **Tenants** (`#/tenants`): administração do catálogo de tenants — cria, lista, suspende e
  reativa tenants pelo Tenant Service (`/api/v1/tenants`). Só para o papel `plataforma-admin`.
- **Produtos** (`#/produtos`): catálogo do tenant escolhido no cabeçalho (`/api/v1/produtos`).
  Gestores cadastram, mudam preço, renomeiam e ativam/desativam; compradores só consultam.
- **Arquitetura** (`#/arquitetura`): diagramas do event storming, catálogo de eventos, matriz
  produtor × consumidor e lista de ADRs — tudo lido **em build time** do próprio repositório.

- **Minha conta** (`#/conta`): o que o gateway sabe do usuário (`GET /api/v1/me`) — papéis,
  tenants, plano e limite de cada um — e o botão "Testar limite".

O roteamento é por hash (`#/`, `#/tenants`, `#/produtos`, `#/arquitetura` e `#/conta`), sem biblioteca de rotas,
para funcionar no GitHub Pages (que não reescreve rotas para o `index.html`).

Stack: React 19 + Vite 7 + TypeScript, testes com Vitest + Testing Library + MSW. Requer Node 22+.

## Como rodar

```bash
npm install
npm run dev          # http://localhost:5173
```

Desde o Dia 4 toda API passa pelo **gateway**: o proxy do Vite (`vite.config.ts`) tem uma regra
só, `/api` → `http://localhost:8000`. O gateway roteia `/api/status` para o `status-service` e
`/api/v1/tenants` para o `tenant-service`, valida o token, confere o tenant e aplica o limite.

Para dados reais, suba antes o ambiente na raiz do repositório:

```bash
docker compose -f infra/docker-compose.yml up -d --build --wait
```

## Login e troca de tenant

- **Login** pelo Keycloak (`http://localhost:8180`, realm `plataforma`, client público
  `plataforma-frontend`), com Authorization Code + PKCE (S256) pela biblioteca
  [oidc-client-ts](https://github.com/authts/oidc-client-ts) (`src/auth/oidc.ts`). "Entrar" redireciona
  ao Keycloak guardando a rota atual; na volta (`?code=…&state=…`) o app troca o code por token,
  limpa a URL e volta para a mesma aba. O token fica no `sessionStorage` (vale para a aba). Outra
  URL do Keycloak: `VITE_KEYCLOAK_URL=http://… npm run dev`.
- Logado, o cabeçalho mostra o nome, os papéis (`plataforma-admin`, `gestor-tenant`, `comprador`)
  e "Sair" (logout também no Keycloak). A página **Status continua pública**.
- **Seletor de tenant**: lista os `tenants` de `GET /api/v1/me`; o escolhido fica no
  `sessionStorage` e vai no `X-Tenant-Id`. Tenant suspenso aparece desabilitado ("— Suspenso"); se
  o usuário só tem um tenant, ele é selecionado sozinho. Abaixo, o plano e o limite do gateway:
  Gratuito 5 req/s, Profissional 20 req/s, Empresarial 50 req/s (rajada = 2x).
- **Cabeçalhos**: `src/api/http.ts` (`apiFetch`) injeta `Authorization: Bearer <token>` e
  `X-Tenant-Id` a partir do _session provider_ que o `AuthProvider` registra. `GET /api/status`
  não leva token; `/api/v1/me` (que define os tenants) e `/api/v1/tenants` (administrativa) não
  levam `X-Tenant-Id`.
- **Erros do gateway** (Problem Details): 401 encerra a sessão e pede login de novo ("Sua sessão
  expirou"); 403 e 429 mostram o `detail` (ex.: "Esta operação exige o papel plataforma-admin.").
- **Testar limite** (Minha conta): dispara a rajada do plano + 20 requisições simultâneas (mínimo 30) a `GET /api/v1/me` com o `X-Tenant-Id` selecionado e mostra quantas deram 200 e quantas 429
  (e o `Retry-After`).

## Modo demo (sem backend)

Com `VITE_DEMO=true`, o [MSW](https://mswjs.io) intercepta as APIs no navegador e devolve dados
simulados. A página exibe o selo "Modo demo (API simulada)".

- **Login sem Keycloak**: "Entrar" abre um seletor de usuários de demonstração
  (`src/auth/demoUsers.ts`); o token é `demo-<usuario>`.

  | Usuário | Nome                         | Papel              | Tenants                                                 |
  | ------- | ---------------------------- | ------------------ | ------------------------------------------------------- |
  | `admin` | Administradora da plataforma | `plataforma-admin` | todos (inclusive o suspenso `ceramica-paraiba`)         |
  | `ana`   | Ana Souza                    | `gestor-tenant`    | `distribuidora-aurora` e `atacado-vale-verde`           |
  | `bruno` | Bruno Lima                   | `comprador`        | `farmaceutica-boa-saude` (cliente `cli-bruno`), sozinho |

- **Gateway simulado** (`src/mocks/gateway.ts`): 401 sem `Authorization: Bearer demo-<usuario>`;
  `/api/v1/me` montado a partir do usuário e do store de tenants; 403 (`acesso-negado`) em
  `/api/v1/tenants` para quem não é `plataforma-admin` e para `X-Tenant-Id` de outro tenant; 403
  (`tenant-suspenso`) para tenant suspenso; rate limit por tenant em `/api/v1/me` (token bucket em
  memória, conforme o plano) com 429 + `Retry-After`.
- `/api/status` (`src/mocks/handlers.ts`), público: MongoDB x4, Pulsar, `tenant-service`,
  `catalogo-service`, `gateway` e `keycloak` (type `SERVICE`) no ar, latências variando.
- `/api/v1/produtos` (`src/mocks/catalogo.ts`): catálogo em memória por tenant, atrás do gateway
  simulado (token e `X-Tenant-Id` obrigatórios; 403 para comprador escrevendo). Veja
  [Página Produtos](#página-produtos).
- `/api/v1/tenants` e `/api/v1/tenants/:id` (`src/mocks/tenants.ts`): store em memória
  pré-populado com 5 tenants fictícios (Pool, Bridge e Silo), com as mesmas regras do contrato —
  400 em Problem Details (`application/problem+json`) para dados inválidos, 409 para id repetido,
  404 para tenant inexistente e paginação por cursor real (ordem: mais recentes primeiro; cursor =
  id do último item da página). O store vive só na aba do navegador: recarregar a página volta ao
  estado inicial. Nos testes, `resetTenantStore()`, `resetRateLimits()` e a limpeza do
  `sessionStorage` rodam depois de cada teste (`src/test/setup.ts`).

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

## Página Produtos

Consome `libs/contracts/src/main/resources/openapi/catalogo.yaml` (cliente, tipos e validação em
`src/api/catalogo.ts`). Exige login e um tenant selecionado; trocar de tenant remonta a página e
recarrega a lista.

| Ação               | Chamada                                                        | Quem           |
| ------------------ | -------------------------------------------------------------- | -------------- |
| Listar             | `GET api/v1/produtos?limite=20&cursor=…&busca=…&ativo=…`       | todos          |
| Criar              | `POST api/v1/produtos` → 201                                   | gestor / admin |
| Renomear, situação | `PATCH api/v1/produtos/{id}` com `{ "nome" }` ou `{ "ativo" }` | gestor / admin |
| Preço              | `PUT api/v1/produtos/{id}/preco` com `{ "centavos", "moeda" }` | gestor / admin |

- **Lista**: "Carregar mais" pelo `proximoCursor`, busca por nome ou SKU com debounce de 300 ms,
  filtro de situação (Todos/Ativos/Inativos) só para gestores, preço em R$ com
  `Intl.NumberFormat('pt-BR')` a partir dos centavos e a barra "usados de limitePlano produtos do
  plano" (vermelha no limite).
- **Preço digitado em reais** (`reaisParaCentavos`): "12,90", "R$ 1.234,5", "12.9" e "1.234"
  (milhar) viram centavos só com inteiros, sem ponto flutuante; mais de duas casas, negativo ou
  texto inválido mostram erro no campo.
- **Erros** em Problem Details mostram o `detail`. `sku-duplicado` (409) marca o campo SKU;
  `limite-do-plano` (409) explica que o limite conta ativos e inativos.
- **Comprador** (`bruno`): só leitura, sem formulário, filtro ou ações; vê só os ativos.
- **Modo demo**: 8 a 12 produtos B2B por tenant (alimentos, limpeza, farmácia, metalurgia),
  ordenados por SKU (cursor = id do último item), limite por plano (Gratuito 20, Profissional 500,
  Empresarial 10.000, lido do plano atual do tenant), 409 para SKU repetido no tenant e no limite.
  A `ceramica-paraiba` (Gratuito, suspensa) tem 19 produtos: reative-a como admin, entre de novo e
  cadastre dois produtos para ver o `limite-do-plano`.

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

O login é testado sem Keycloak: `src/auth/oidc.test.ts` usa um dublê do `UserManager`; os testes de
tela usam o cliente de demo (`<App authClient={createDemoAuthClient()} />`), e os que chamam a API
direto registram uma sessão com `signInAs('admin')` (`src/test/session.ts`).

Nos testes o módulo `mermaid` é sempre mockado (em `src/test/setup.ts`), porque o jsdom não faz
layout de SVG; cada teste pode forçar um erro com `vi.mocked(mermaid.render).mockRejectedValueOnce`.
As funções de parse são testadas com fixtures (`src/test/architecture-fixtures.ts`), e há testes
que leem os schemas e documentos reais do repositório.
