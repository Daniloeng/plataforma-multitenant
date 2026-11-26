# ADR-0002: Quatro microsserviços, cada um com seu MongoDB

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

O requisito é ter pelo menos três microsserviços e MongoDB por serviço. O domínio (pedidos B2B com
pagamentos, multi-tenant) tem quatro contextos com linguagem e ciclo de vida próprios, que o event
storming confirmou: Tenants, Catálogo, Pedidos e Pagamentos.

## Decisão

- Um serviço Spring Boot por contexto, em `services/<contexto>-service`, todos no mesmo monorepo e
  no mesmo build Maven.
- Cada serviço é **dono exclusivo** do seu MongoDB. Nenhum serviço lê ou escreve no banco de outro;
  a integração é por eventos no Pulsar ou pela API REST do dono.
- Cada MongoDB roda como replica set de um nó, com nome próprio (`rs-<contexto>`), porque
  transações e change streams (outbox) exigem replica set.
- Dado que outro serviço precisa (ex.: preço do produto para o pedido) é copiado a partir de
  eventos, como projeção local, e não consultado de forma síncrona no caminho crítico.

## Consequências

- Cada serviço escala, falha e evolui sozinho; um MongoDB fora do ar afeta só o seu contexto.
- Consistência entre serviços é eventual; os fluxos que cruzam serviços são sagas (ADR-0006).
- Consultas que juntam dados de vários contextos exigem projeções, não joins.
- Custo de memória: quatro instâncias MongoDB (~115 MB cada, medido no Dia 1).

## Alternativas consideradas

- **Um MongoDB com um database por serviço:** mais barato, mas mascara o acoplamento (é fácil um
  serviço ler o database do outro) e não permite isolar falha. Fica como opção para homologação se
  faltar memória.
- **Monólito modular:** mais simples de operar, mas o objetivo de estudo é justamente microsserviços.
