# ADR-0006: Saga coreografada com outbox transacional

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

Confirmar um pedido envolve dois serviços com bancos separados (Pedidos e Pagamentos). Não existe
transação distribuída entre eles, e gravar no banco e publicar no Pulsar em dois passos pode perder
o evento se o serviço cair entre um e outro.

## Decisão

- **Saga coreografada:** cada serviço reage aos eventos do outro (ver o diagrama em
  `docs/arquitetura/event-storming.md`). Não há orquestrador central.
- **Ações compensatórias:**
  - pagamento recusado → Pedidos cancela o pedido (`PAGAMENTO_RECUSADO`);
  - pedido cancelado depois da captura → Pagamentos estorna;
  - pedido PENDENTE há mais de 15 minutos → um job de Pedidos cancela (`EXPIRADO`).
- **Eventos fora de ordem entre tópicos** (não há ordem entre `pedido.criado`, `pedido.cancelado`
  e `pagamento.*`, ADR-0003). Toda a decisão sobre dinheiro fica em Pagamentos:
  - Pagamentos guarda, por `(tenantId, pedidoId)`, se o pedido já foi cancelado. Se
    `pedido.cancelado` chega antes de `pedido.criado`, a marca é gravada e a cobrança nunca é feita.
  - Se o cancelamento chega durante a captura, Pagamentos confere a marca logo após capturar e
    estorna na hora.
  - Pedidos ignora `pagamento.aprovado` ou `pagamento.recusado` de um pedido que já está em estado
    terminal (CANCELADO): o estorno, quando necessário, é responsabilidade de Pagamentos.
- **Outbox transacional:** a mudança de estado e o evento são gravados na mesma transação MongoDB
  (coleção `outbox`). Um relay lê a outbox (por polling, ver ADR-0008) e publica no Pulsar, marcando cada
  item como publicado. O evento sai pelo menos uma vez.
- **Consumo idempotente:** cada consumidor registra o `eventId` processado (índice único com TTL);
  uma reentrega é descartada.
- **Idempotência:** chaves sempre com escopo de tenant e índices começando por `tenantId`:
  cobrança única por `(tenantId, pedidoId)` em Pagamentos; criação de pedido única por
  `(tenantId, Idempotency-Key)` em Pedidos; evento processado único por `(tenantId, eventId)`.

## Consequências

- Entre a criação e a confirmação, o pedido fica PENDENTE; a UI mostra a linha do tempo (Dia 8).
- O fluxo fica distribuído pelos serviços: a observabilidade com trace propagado pelo `traceparent`
  (Dia 10) é o que permite seguir um pedido de ponta a ponta.
- A conciliação vira um critério de go/no-go: para cada tenant, valor capturado − valor estornado
  = valor dos pedidos confirmados e não cancelados, e nenhum pedido cancelado com saldo capturado.

## Alternativas consideradas

- **Saga orquestrada:** fluxo explícito num só lugar, mas cria um serviço a mais e acopla os
  participantes ao orquestrador. Com só dois participantes, a coreografia é mais simples.
- **Publicar direto do request:** mais simples, mas perde eventos em falhas parciais.
- **Two-phase commit:** não disponível entre MongoDB e Pulsar, e bloquearia recursos.
