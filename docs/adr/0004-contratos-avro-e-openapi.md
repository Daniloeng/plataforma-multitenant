# ADR-0004: Contratos em Avro (eventos) e OpenAPI 3.1 (APIs), no módulo `libs/contracts`

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

Com quatro serviços evoluindo em paralelo, uma mudança de contrato que quebra um consumidor é a
falha mais provável e a mais difícil de achar em produção. Os contratos precisam ser verificados no
PR, antes de qualquer deploy.

## Decisão

**Eventos (Avro):**
- Um arquivo `.avsc` por evento em `libs/contracts/src/main/avro/<contexto>/`. O módulo gera as
  classes Java (avro-maven-plugin), usadas por produtores e consumidores.
- Todo evento tem os metadados `eventId` (uuid), `tenantId`, `occurredAt` (timestamp-millis) e
  `traceparent` (opcional), além das propriedades `x-evento`, `x-topico`, `x-produtor` e
  `x-consumidores`, que formam o catálogo de eventos (`EventCatalog`).
- Compatibilidade **FULL** (BACKWARD + FORWARD), também configurada nos namespaces do Pulsar: o
  consumidor novo lê mensagens antigas e o consumidor antigo lê mensagens novas. Assim produtor e
  consumidor são implantados em qualquer ordem. Na prática: campo novo sempre com default, campo
  removido só se tinha default, e todo enum tem um símbolo default (ex.: `OUTRO`) para o consumidor
  antigo que recebe um símbolo que não conhece. O teste `BaselineCompatibilityTest` compara cada
  schema com a cópia publicada em `libs/contracts/baseline/`. Mudança incompatível = novo tópico `.v2`.
- Valores monetários em centavos (`long`) com a moeda ISO 4217 ao lado; nunca `double`.

**APIs (OpenAPI 3.1):**
- Um arquivo por serviço em `libs/contracts/src/main/resources/openapi/`, com componentes comuns
  em `_comum.yaml` (Problem Details RFC 9457, dinheiro, paginação por cursor, JWT).
- Rotas versionadas em `/api/v1/`. Toda API declara o esquema `jwt` e quem pode usá-la
  (`x-autorizacao`). Toda operação de negócio exige o cabeçalho `X-Tenant-Id`, e nenhum corpo de
  requisição, nem em objetos aninhados, aceita `tenantId` ou `clienteId`. Criação de pedido exige
  `Idempotency-Key` e `X-Cliente-Id` (ADR-0007).
- O teste `OpenApiContractsTest` valida essas regras; os serviços implementam a API a partir do
  contrato (contract-first).

**Linguagem:** eventos, campos de eventos e recursos da API usam a linguagem do negócio em
português (`pedido.criado`, `valorCentavos`, `/pedidos`), a mesma do event storming. O código de
infraestrutura continua em inglês (ver CLAUDE.md).

## Consequências

- Uma quebra de contrato aparece como teste vermelho no PR, com a lista de incompatibilidades.
- Desserializar com Avro 1.12 exige confiar no pacote gerado
  (`org.apache.avro.SERIALIZABLE_PACKAGES=br.dev.plataforma.contracts`); os serviços configuram isso.
- Testes de contrato entre consumidor e provedor (Pact) entram no Dia 14.

## Alternativas consideradas

- **JSON Schema para eventos:** mais legível, mas sem verificação de compatibilidade tão madura e
  com mensagens maiores.
- **Protobuf:** ótimo, mas o Schema Registry do Pulsar e o ecossistema Spring têm suporte mais
  direto a Avro.
- **Code-first (gerar OpenAPI do código):** mais rápido no início, mas o contrato passa a ser
  efeito colateral da implementação.
