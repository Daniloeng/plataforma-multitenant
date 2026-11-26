# ADR-0007: Cliente comprador identificado pelo token, não pelo corpo

- **Status:** Aceito; claim do tenant alterada pelo ADR-0009
- **Data:** 2026-11-26

## Contexto

Dentro de um tenant há várias empresas compradoras (clientes B2B). Se o pedido trouxesse
`clienteId` no corpo, um usuário de um cliente poderia fazer pedidos em nome de outro cliente do
mesmo tenant, e nenhum serviço é dono do cadastro de clientes para validar isso.

## Decisão

- O **Keycloak é o dono da identidade do cliente**: cada usuário comprador tem o atributo
  `cliente_id`, emitido no JWT junto com `tenant_id`.
- O gateway injeta `X-Cliente-Id` a partir dessa claim, do mesmo jeito que `X-Tenant-Id`
  (ADR-0005), e descarta o cabeçalho se ele vier de fora.
- A API de Pedidos não aceita `clienteId` no corpo; o pedido grava o cliente do cabeçalho.
  Compradores só leem os próprios pedidos; o papel `gestor-tenant` lê todos os do tenant.
- Um contexto próprio de Clientes (limite de crédito, condições comerciais) fica fora do MVP1. Se
  surgir, ele passa a ser o dono do cadastro, e o Keycloak continua só com a identidade.

## Consequências

- Usuários e clientes de teste são criados no Keycloak (Dia 4), com `tenant_id` e `cliente_id`.
- A suíte de isolamento (Dia 15) testa também o acesso cruzado entre clientes do mesmo tenant.

## Alternativas consideradas

- **`clienteId` no corpo, validado contra um cadastro:** exigiria um serviço de Clientes já no
  MVP1 e uma consulta síncrona no caminho do pedido.
- **Um usuário por tenant, sem clientes:** simplifica, mas perde o caráter B2B do domínio.
