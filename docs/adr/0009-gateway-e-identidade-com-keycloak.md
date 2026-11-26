# ADR-0009: Gateway como única porta de entrada, identidade no Keycloak

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

Até o Dia 3 qualquer um podia chamar o tenant-service e escolher o tenant no cabeçalho
`X-Tenant-Id`. O ADR-0005 e o ADR-0007 dizem que o tenant e o cliente B2B vêm do **token**, e o
ADR-0008 deixou a dívida "serviços só via gateway". Precisamos de login, papéis, um jeito de um
usuário trabalhar em mais de um tenant e um limite de requisições por plano, sem custo (Dia ≤ 10)
e sem que cada serviço reimplemente segurança.

## Decisão

- **Keycloak** (realm `plataforma`, importado de `infra/keycloak/realm-plataforma.json`) é o
  provedor de identidade. Papéis de realm: `plataforma-admin`, `gestor-tenant`, `comprador`.
  **Tenants são grupos** `/tenants/<id>`; um mapper põe os grupos do usuário na claim `tenants`
  com o caminho completo, e o gateway só aceita os que começam com `/tenants/`. Isso substitui a
  claim única `tenant_id` dos ADRs 0005 e 0007.
  O atributo `cliente_id` vira a claim `cliente_id` (ADR-0007). Frontend usa o client público
  `plataforma-frontend` (Authorization Code + PKCE); scripts e CI usam `plataforma-cli`.
- **Spring Cloud Gateway (WebFlux) na porta 8000 é a única entrada.** Ele valida o JWT (emissor,
  assinatura pelo JWKS interno e audiência `plataforma-gateway`), **descarta** os cabeçalhos de
  identidade vindos de fora e escreve os verificados: `X-Tenant-Id`, `X-Cliente-Id`, `X-Usuario`,
  `X-Papeis`. Os serviços confiam nesses cabeçalhos e não ficam expostos fora da rede interna.
- **Troca de tenant:** o cliente manda o tenant escolhido em `X-Tenant-Id`; o gateway confere que
  está na claim `tenants` (admin acessa todos), que existe e que está ativo (suspenso → 403
  `tenant-suspenso`). Com um só tenant, o cabeçalho pode ser omitido.
- **Catálogo de tenants no gateway:** carga inicial paginada de `GET /api/v1/tenants` e, depois,
  os eventos `tenant.criado`/`tenant.alterado` (assinatura não durável). Vence a maior `versao`.
- **Rate limit por tenant**, balde de fichas em memória, com taxa e rajada por plano
  (GRATUITO 5/10, PROFISSIONAL 20/40, EMPRESARIAL 50/100 req/s). Chamadas sem tenant
  (administração e `/me`) usam um balde por usuário (20/40). Excesso → 429 com `Retry-After`.
- `GET /api/v1/me` é servido pelo próprio gateway (contrato em `openapi/gateway.yaml`).

## Consequências

- Serviços novos não lidam com JWT: leem os cabeçalhos com o `TenantContext` de sempre.
- O limite é **por réplica**: com N réplicas do gateway, o teto real é N vezes o do plano. Basta
  para estudo; um limite global (Redis) fica para quando houver mais de uma réplica (Dia 13+).
- Um tenant recém-criado leva alguns milissegundos até o gateway aprender (evento); enquanto a
  carga inicial não termina, o gateway responde 503.
- Mudança de grupos no Keycloak só vale no próximo token (expira em 15 min).
- **Papéis e `cliente_id` são do usuário, não do tenant.** Um `gestor-tenant` é gestor em todos os
  seus tenants, e um comprador manda o mesmo `X-Cliente-Id` em qualquer tenant. Hoje cada comprador
  pertence a um tenant só; papéis por tenant (mapa tenant → papéis/cliente no token) viram ADR
  quando um caso precisar.
- **A fronteira de confiança dos serviços é a rede.** Os serviços confiam nos cabeçalhos porque só
  o gateway os alcança de fora; dentro da rede do Compose não há token entre serviços (a carga
  inicial do gateway chama o tenant-service sem identidade). Isso vale até o Dia 11, quando
  NetworkPolicy no Kubernetes restringe quem fala com quem.
- Um evento de tenant ilegível é descartado com log de erro para não travar os seguintes.
- O emissor é sempre `http://localhost:8180`; em outro ambiente, `KC_HOSTNAME` e
  `KEYCLOAK_ISSUER` mudam juntos.

## Alternativas consideradas

- **Tenant como claim única (um token por tenant):** obriga novo login a cada troca de tenant.
- **Validar JWT em cada serviço:** duplica configuração e deixa a regra de tenant espalhada.
- **Rate limit com Redis (`RequestRateLimiter` do Gateway):** mais um componente na memória do
  notebook sem ganho com uma réplica só.
- **Auth0/Cognito:** pagos ou com limites no plano gratuito; Keycloak roda local e de graça.
