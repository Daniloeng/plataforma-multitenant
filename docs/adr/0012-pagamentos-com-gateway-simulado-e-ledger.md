# ADR-0012: Pagamentos com gateway simulado e ledger de partida dobrada

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto
O Dia 7 fecha o primeiro trecho da saga do ADR-0006: `pedido.criado` vira cobrança, e o resultado
volta para Pedidos. Até o Dia 10 não há gasto (nenhum adquirente real, nem sandbox pago), mas o
estudo precisa de regras de dinheiro de verdade: nunca cobrar duas vezes, nunca cobrar um pedido
cancelado, devolver o que foi capturado e explicar cada centavo num extrato.

## Decisão
- **Gateway simulado atrás de uma interface (`GatewayPagamento`).** Autoriza e captura numa só
  chamada, com chave de idempotência `tenantId:pedidoId`. Aprova até
  `plataforma.pagamentos.limite-aprovacao-centavos` (padrão R$ 10.000,00) e recusa acima, com
  motivo legível. É determinístico: o mesmo pedido sempre tem o mesmo resultado. Um adquirente real
  entra depois trocando só a implementação.
- **Um pagamento por pedido.** Índice único `(tenantId, pedidoId)` na coleção de pagamentos; o
  consumidor de `pedido.criado` consulta antes de inserir (regra do ADR-0010) e ignora a reentrega.
  O pagamento nasce já APROVADO ou RECUSADO, porque a cobrança é síncrona dentro da transação do
  consumidor; AUTORIZANDO fica no contrato para um adquirente assíncrono.
- **Marca de cancelamento.** Se `pedido.cancelado` chega antes de `pedido.criado` (o nack do
  ADR-0010 pode inverter a ordem), Pagamentos grava um documento sem status, só com o `pedidoId` e
  a marca. A cobrança que chegar depois vê a marca e não cobra.
- **Estorno automático.** `pedido.cancelado` de um pedido com pagamento APROVADO estorna e publica
  `pagamento.estornado`. Isso cobre o cancelamento pelo cliente ou pelo tenant, a expiração e a
  corrida em que o pedido foi cancelado enquanto a cobrança acontecia.
- **Ledger de partida dobrada, só de inserção.** Cada movimento grava dois lançamentos de mesmo
  valor:
  - captura: débito em `CAIXA_GATEWAY` e crédito em `RECEITA_TENANT`;
  - estorno: débito em `ESTORNOS` e crédito em `CAIXA_GATEWAY`.

  O saldo do tenant é a soma dos créditos em `RECEITA_TENANT` menos os débitos em `ESTORNOS`,
  calculado por agregação no MongoDB. Recusa não gera lançamento. Lançamento nunca é alterado nem
  apagado: correção é um lançamento novo.
- **Pagamento, lançamentos e evento na mesma transação** do consumidor, com o outbox (ADR-0006).
  O agregado dos eventos de pagamento é o pedido (chave da mensagem `tenantId:pedidoId`), para o Key_Shared entregar em ordem
  os eventos de um mesmo pedido ao consumidor de Pedidos.
- **Pedidos reage ao pagamento:** `pagamento.aprovado` confirma um pedido PENDENTE (guarda o
  `pagamentoId` e publica `pedido.confirmado`); `pagamento.recusado` cancela com
  `PAGAMENTO_RECUSADO`. Evento de pagamento para pedido que não está PENDENTE é ignorado.
- **Expiração.** Um job agendado de Pedidos cancela com `EXPIRADO` os pedidos PENDENTE mais velhos
  que `plataforma.pedidos.expiracao` (padrão 15 min). Se o pagamento aprovar depois, o
  `pedido.cancelado` faz Pagamentos estornar.
- **Extrato só para gestor e admin.** `GET /api/v1/pagamentos`, `/{id}` e `/api/v1/ledger/*`
  respondem 403 ao comprador: o financeiro do tenant não é do cliente B2B.

## Consequências
- Reentregas e ordem trocada não geram cobrança dupla nem cobrança de pedido cancelado; os testes
  de integração cobrem os três casos.
- O resultado do gateway é decidido dentro da transação. Se a transação abortar depois da
  chamada, a nova tentativa chama o gateway de novo com a mesma chave: um adquirente real precisa
  honrar a idempotência, e o simulado é determinístico.
- O saldo é calculado a cada consulta. Com volume alto, vira projeção materializada (Dia 10 em
  diante, com métricas).
- Um pedido expirado e depois aprovado gera captura e estorno no extrato: o dinheiro passa pelo
  caixa e volta, o que é rastreável e correto.
- Mais um MongoDB (porta interna 27020) e mais um serviço no Compose e no `status-service`.

## Alternativas consideradas
- **Sandbox de um adquirente real:** exige conta e pode gerar custo, contra a regra de custo zero
  até o Dia 10.
- **Saldo como campo atualizado a cada movimento:** perde o histórico e é sujeito a corrida entre
  transações; o ledger de inserção explica cada valor.
- **Pagamentos perguntar a Pedidos se o pedido foi cancelado:** acopla os serviços por HTTP; a
  marca de cancelamento resolve só com eventos.
- **Agregado `pagamentoId` na chave da mensagem:** espalharia os eventos de um mesmo pedido entre
  consumidores diferentes do Key_Shared.
