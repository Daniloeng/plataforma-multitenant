# Frontend — Status, Tenants, Produtos, Pedidos, Pagamentos, Arquitetura e Minha conta

Frontend da plataforma multi-tenant (pedidos B2B + pagamentos), com sete páginas em abas e, no
cabeçalho, login (Keycloak) e troca de tenant:

- **Status** (`#/`): status do `status-service` (`GET /api/status`, atualizado a cada 10 s), o
  roadmap dos microsserviços e o progresso do estudo.
- **Tenants** (`#/tenants`): administração do catálogo de tenants — cria, lista, suspende e
  reativa tenants pelo Tenant Service (`/api/v1/tenants`). Só para o papel `plataforma-admin`.
- **Produtos** (`#/produtos`): catálogo do tenant escolhido no cabeçalho (`/api/v1/produtos`).
  Gestores cadastram, mudam preço, renomeiam e ativam/desativam; compradores montam o carrinho.
- **Pedidos** (`#/pedidos` e `#/pedidos/<id>`): pedidos do tenant (`/api/v1/pedidos`) — o comprador
  vê os do próprio cliente, o gestor vê os de todos; detalhe (com a situação do pagamento) e
  cancelamento.
- **Pagamentos** (`#/pagamentos`): o financeiro do tenant — saldo (receita líquida), pagamentos e o
  extrato do ledger (`/api/v1/pagamentos` e `/api/v1/ledger/lancamentos`). Só para `gestor-tenant` e
  `plataforma-admin`.
- **Arquitetura** (`#/arquitetura`): diagramas do event storming, catálogo de eventos, matriz
  produtor × consumidor e lista de ADRs — tudo lido **em build time** do próprio repositório.

- **Minha conta** (`#/conta`): o que o gateway sabe do usuário (`GET /api/v1/me`) — papéis,
  tenants, plano e limite de cada um — e o botão "Testar limite".

O roteamento é por hash (`#/`, `#/tenants`, `#/produtos`, `#/pedidos`, `#/pagamentos`, `#/arquitetura` e `#/conta`), sem biblioteca de rotas,
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
  `catalogo-service`, `pedidos-service`, `pagamentos-service`, `gateway` e `keycloak` (type `SERVICE`) no ar, latências
  variando.
- `/api/v1/produtos` (`src/mocks/catalogo.ts`): catálogo em memória por tenant, atrás do gateway
  simulado (token e `X-Tenant-Id` obrigatórios; 403 para comprador escrevendo). Veja
  [Página Produtos](#página-produtos).
- `/api/v1/pedidos` (`src/mocks/pedidos.ts`): pedidos em memória por tenant, atrás do gateway
  simulado; o `X-Cliente-Id` vem do usuário do token (`clienteIdOf` em `src/mocks/gateway.ts`). Veja
  [Carrinho e página Pedidos](#carrinho-e-página-pedidos).
- `/api/v1/pagamentos`, `/api/v1/pagamentos/:id` e `/api/v1/ledger/lancamentos`
  (`src/mocks/pagamentos.ts`): pagamentos-service simulado, atrás do gateway simulado (403
  `acesso-negado` para quem não é gestor ou admin). Veja [Página Pagamentos](#página-pagamentos-e-extrato).
- `/api/v1/tenants` e `/api/v1/tenants/:id` (`src/mocks/tenants.ts`): store em memória
  pré-populado com 5 tenants fictícios (Pool, Bridge e Silo), com as mesmas regras do contrato —
  400 em Problem Details (`application/problem+json`) para dados inválidos, 409 para id repetido,
  404 para tenant inexistente e paginação por cursor real (ordem: mais recentes primeiro; cursor =
  id do último item da página). O store vive só na aba do navegador: recarregar a página volta ao
  estado inicial. Nos testes, `resetTenantStore()`, `resetCatalogoStore()`, `resetPedidosStore()`, `resetPagamentosStore()`, `resetRateLimits()` e a limpeza do
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

## Carrinho e página Pedidos

Consome `libs/contracts/src/main/resources/openapi/pedidos.yaml` (cliente e tipos em
`src/api/pedidos.ts`).

| Ação     | Chamada                                                            | Quem                                |
| -------- | ------------------------------------------------------------------ | ----------------------------------- |
| Criar    | `POST api/v1/pedidos` com `Idempotency-Key` → 201 (ou 200 repete)  | comprador                           |
| Listar   | `GET api/v1/pedidos?limite=20&cursor=…&status=…`                   | comprador (os seus), gestor (todos) |
| Detalhe  | `GET api/v1/pedidos/{id}`                                          | comprador (os seus), gestor         |
| Cancelar | `POST api/v1/pedidos/{id}/cancelamento` → 200; 409 se já cancelado | comprador (os seus), gestor         |

- **Carrinho** (só para `comprador`, na aba Produtos): cada produto ativo tem quantidade e
  "Adicionar ao carrinho". O resumo mostra os itens com quantidade editável (1 a 10.000), subtotal,
  remover, esvaziar e o **total estimado** com o preço do catálogo — o preço final é o do servidor,
  porque o corpo do pedido só leva `produtoId` e `quantidade`. Até 200 produtos. O carrinho fica no
  `sessionStorage` por usuário e tenant (`plataforma.carrinho.<usuario>.<tenant>`, `src/hooks/useCarrinho.ts`);
  sem storage, vale até recarregar a página. Gestores não veem o carrinho.
- **Fazer pedido** (`src/hooks/useEnviarPedido.ts`): cada pedido ganha uma `Idempotency-Key`
  (`crypto.randomUUID`). Se a tentativa falha e o usuário repete com o mesmo carrinho, a mesma chave
  vai de novo: se a primeira chegou ao servidor e só a resposta se perdeu, ele devolve o mesmo
  pedido (200, `Idempotent-Replayed: true`) em vez de criar outro. Carrinho diferente = chave nova
  (evita `chave-reutilizada`). Ao criar, o carrinho esvazia e a página abre `#/pedidos/<id>`.
- **Erros** mostram o `detail` do Problem Details; `produto-indisponivel` (409) destaca o item citado
  no carrinho.
- **Lista**: data, cliente (só gestor), resumo dos itens, total em R$, selo de status (Pendente,
  Confirmado, Cancelado), filtro de status e "Carregar mais" pelo `proximoCursor`, do mais recente
  para o mais antigo. **Detalhe**: itens com SKU, nome e preço unitário gravados no pedido,
  subtotal, total, o motivo do cancelamento e a **situação do pagamento**: "Aguardando o pagamento"
  (`PENDENTE`), "Pago" com o `pagamentoId` (`CONFIRMADO`), "Pagamento recusado" (`CANCELADO` por
  `PAGAMENTO_RECUSADO`; o gestor vê também o motivo do gateway), "Estornado" (pago e depois
  cancelado) ou "Sem cobrança". Enquanto o pedido está `PENDENTE`, o detalhe consulta
  `GET api/v1/pedidos/{id}` de novo a cada 1,5 s, até 10 vezes, e para ao sair da tela; depois
  disso, "Consultar de novo" recomeça. É assim que, logo depois de "Fazer pedido", a confirmação
  aparece sozinha. **Cancelar** pede confirmação na própria linha (sem
  `window.confirm`).
- **Modo demo**: pedidos de exemplo no tenant de `bruno` (dele e de outros três clientes, visíveis
  para a `admin`) e nos tenants da `ana`. Preço, SKU e nome vêm do catálogo simulado; produto
  inativo ou de outro tenant responde 409 `produto-indisponivel`. Idempotência por (tenant, cliente,
  chave) com hash do corpo. Todo pedido novo nasce `PENDENTE` e o pagamentos-service simulado o
  cobra 1,2 s depois (veja [Página Pagamentos](#página-pagamentos-e-extrato)); o cancelamento pelo
  comprador usa o motivo `SOLICITADO_PELO_CLIENTE` e pelo gestor `CANCELADO_PELO_TENANT`. Comprador lendo ou cancelando pedido de
  outro cliente recebe 404.

## Página Pagamentos e extrato

Consome `libs/contracts/src/main/resources/openapi/pagamentos.yaml` (cliente, tipos e guardas em
`src/api/pagamentos.ts`). Só leitura: a cobrança é assíncrona, a partir de `pedido.criado`.

| Ação       | Chamada                                                          | Quem           |
| ---------- | ---------------------------------------------------------------- | -------------- |
| Pagamentos | `GET api/v1/pagamentos?limite=20&cursor=…&status=…&pedidoId=…`   | gestor / admin |
| Pagamento  | `GET api/v1/pagamentos/{id}`                                     | gestor / admin |
| Extrato    | `GET api/v1/ledger/lancamentos?limite=20&cursor=…` (com `saldo`) | gestor / admin |

- **Resumo**: o saldo (receita líquida = créditos em Receita do tenant − débitos em Estornos) e
  "Atualizar". **Pagamentos**: data, pedido (link para o detalhe), cliente, valor em R$, selo
  (Autorizando, Aprovado, Recusado, Estornado), motivo da recusa, filtro de status e "Carregar mais".
- **Extrato**: lançamentos do mais recente para o mais antigo, com a conta (Caixa no gateway,
  Receita do tenant, Estornos, cada uma com uma frase do que representa), a natureza (Débito ou
  Crédito), o valor e o pedido, paginado com "Carregar mais". Uma legenda curta explica as partidas
  dobradas: cada movimento gera um débito e um crédito de mesmo valor; captura = débito em Caixa no
  gateway + crédito em Receita do tenant; estorno = débito em Estornos + crédito em Caixa no gateway.
- **Comprador** (`bruno`): vê o aviso "Só o gestor do tenant vê o financeiro." e acompanha o
  pagamento de cada pedido na aba Pedidos (a API responde 403 para ele).
- **Modo demo** (`src/mocks/pagamentos.ts`): o pedidos simulado avisa os assinantes de
  `pedido.criado` e `pedido.cancelado` (`assinarPedidos`); o pagamentos simulado agenda a cobrança
  para 1,2 s depois. Não há `setTimeout`: as cobranças vencidas são processadas no começo de cada
  requisição aos pedidos e aos pagamentos (`processarCobrancas`), então o poll do detalhe vê a
  confirmação chegar, nada fica rodando entre testes, e os testes controlam o tempo com os timers
  falsos do Vitest (que também falsificam o `Date`). O gateway simulado aprova até R$ 10.000,00
  (pedido `CONFIRMADO` com `pagamentoId`, lançamentos de captura) e recusa acima ("Valor acima do
  limite de aprovação do gateway simulado (R$ 10.000,00)."; pedido `CANCELADO` por
  `PAGAMENTO_RECUSADO`, sem lançamentos). Pedido cancelado antes da cobrança nunca é cobrado;
  cancelar um pedido `CONFIRMADO` gera o estorno (pagamento `ESTORNADO`). Os pedidos de exemplo têm
  pagamentos coerentes: na `farmaceutica-boa-saude` e na `distribuidora-aurora` há aprovados, um
  estornado e um recusado (o pedido mais recente de `bruno` segue pendente, do Dia 6).

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
