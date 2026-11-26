# ADR-0005: Multi-tenancy com níveis Pool, Bridge e Silo, tenant resolvido no gateway

- **Status:** Aceito; claim do tenant alterada pelo ADR-0009
- **Data:** 2026-11-26

## Contexto

A plataforma atende de 10 a 20 tenants simulados com necessidades diferentes de isolamento e custo.
Isolar demais é caro; isolar de menos arrisca vazamento de dados entre tenants, o pior defeito
possível aqui.

## Decisão

- **Três níveis**, escolhidos por tenant e guardados no Tenant Service:
  - **Pool:** coleções e tópicos compartilhados, com `tenantId` obrigatório em todo documento e
    índice; a maioria dos tenants.
  - **Bridge:** database e namespace Pulsar dedicados na mesma infraestrutura.
  - **Silo:** instância MongoDB e namespace Kubernetes próprios; um tenant, para demonstração.
- **Resolução única:** o gateway valida o JWT do Keycloak, lê a claim `tenant_id` e injeta
  `X-Tenant-Id`. Os serviços confiam só nesse cabeçalho, nunca no corpo.
- **Cabeçalhos de identidade vindos de fora são descartados:** o gateway remove qualquer
  `X-Tenant-Id` ou `X-Cliente-Id` que chegue do cliente antes de injetar os seus. Os serviços só são
  alcançáveis pelo gateway (rede interna no Compose; NetworkPolicy no Kubernetes, Dia 11).
- **Plano administrativo:** a API do Tenant Service é a única exceção à regra do cabeçalho: ela
  opera sobre o catálogo de tenants, então o tenant aparece na URL e o id no corpo de criação. Só o
  papel `plataforma-admin` a acessa, e o gateway a expõe em rota separada.
- **Catálogo de tenants em cache:** o gateway e os serviços consomem `tenant.criado` e
  `tenant.alterado` para manter plano, nível e situação de cada tenant.
- **Contexto obrigatório:** a biblioteca comum (Dia 3) guarda o tenant da requisição e aplica o
  filtro `tenantId` em toda consulta; uma consulta sem tenant falha em vez de devolver tudo.
- **Identificador:** `TenantId` (slug de 3 a 40 caracteres) em `libs/platform-core`, porque o valor
  vira nome de database e de namespace.
- **Vizinho barulhento:** rate limit por tenant no gateway, quotas por namespace no Pulsar.

## Consequências

- Um teste automatizado de acesso cruzado por endpoint (Dia 15) é requisito de go/no-go.
- O roteamento de dados depende do catálogo de tenants; os serviços fazem cache local dele.
- Promover um tenant de Pool para Bridge é um job de migração (exercício do Dia 9).

## Alternativas consideradas

- **Só Pool:** mais simples, mas não ensina os trade-offs, que são o objetivo do estudo.
- **Tenant no corpo ou na URL:** mais explícito, mas fácil de falsificar e de esquecer de validar.
