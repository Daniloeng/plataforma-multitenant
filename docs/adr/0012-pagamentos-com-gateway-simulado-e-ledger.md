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
- **Marca de cancelamento.** Se `pedido.cancelado` chega antes de `pedido.criado` (tópicos
  diferentes não têm ordem entre si, ADR-0006), Pagamentos grava um documento sem status, só com o `pedidoId` e
  a marca. A cobrança que chegar depois vê a marca e não cobra. Se as duas chegam ao mesmo tempo,
  o índice único `(tenantId, pedidoId)` faz uma transação abortar e o consumidor refaz: se a
  cobrança venceu, o cancelamento refeito estorna; se a marca venceu, a cobrança refeita não
  cobra.
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
  O agregado dos eventos de pagamento é o pedido (chave da mensagem `tenantId:pedidoId`). Com um
  pagamento por pedido isso não muda a distribuição entre consumidores; só facilita correlacionar
  os eventos com o pedido nos logs e no Pulsar.
- **Pedidos reage ao pagamento:** `pagamento.aprovado` confirma um pedido PENDENTE (guarda o
  `pagamentoId` e publica `pedido.confirmado`); `pagamento.recusado` cancela com
  `PAGAMENTO_RECUSADO`. Evento de pagamento para pedido que não está PENDENTE é ignorado.
- **Expiração.** Um job agendado de Pedidos cancela com `EXPIRADO` os pedidos PENDENTE mais velhos
  que `plataforma.pedidos.expiracao` (padrão 15 min). Se o pagamento aprovar depois, o
  `pedido.cancelado` faz Pagamentos estornar. **Exceção ao ADR-0005:** é um job de sistema, então
  lê os PENDENTES de todos os tenants, com o índice parcial `ix_pendentes_expiracao` (`criadoEm`,
  só PENDENTES), que não começa por `tenantId`. Cada pedido é expirado dentro do contexto do seu
  tenant, e um pedido com erro não trava os outros do lote.
- **Saldo por moeda.** O extrato aceita `moeda` (padrão BRL) e o saldo soma só os lançamentos
  dessa moeda; valores de moedas diferentes nunca são somados. O limite do gateway simulado é em
  centavos, qualquer que seja a moeda.
- **Unicidade no ledger.** Índice único `(tenantId, pagamentoId, conta, natureza)`: captura e
  estorno usam pares diferentes, então um lançamento repetido por bug falha na escrita.
- **Extrato só para gestor e admin.** `GET /api/v1/pagamentos`, `/{id}` e `/api/v1/ledger/*`
  respondem 403 ao comprador: o financeiro do tenant não é do cliente B2B.

## Consequências
- Reentregas e ordem trocada não geram cobrança dupla nem cobrança de pedido cancelado; os testes
  de integração cobrem os três casos.
- **Limite do simulado: a captura acontece dentro da transação do consumidor.** Se a transação
  abortar depois da chamada e a nova tentativa encontrar a marca de cancelamento (corrida com
  `pedido.cancelado`), ou se a mensagem for para o dead letter, nada registra a captura feita. Com
  o simulado não há dinheiro de verdade, mas **trocar só a implementação não basta** para um
  adquirente real: antes, o pagamento precisa nascer AUTORIZANDO, com a chave, numa transação
  anterior à chamada, e um reconciliador completa ou estorna pela chave. Fica como dívida para
  quando houver adquirente real.
- O saldo é calculado a cada consulta. Com volume alto, vira projeção materializada (Dia 10 em
  diante, com métricas).
- Um pedido expirado e depois aprovado gera captura e estorno no extrato: o dinheiro passa pelo
  caixa e volta, o que é rastreável e correto.
- Mais um serviço no Compose (porta 8084, só na rede interna) e no `status-service`; o
  `mongo-pagamentos` (27020) já existia desde o Dia 1.

## Alternativas consideradas
- **Sandbox de um adquirente real:** exige conta e pode gerar custo, contra a regra de custo zero
  até o Dia 10.
- **Saldo como campo atualizado a cada movimento:** perde o histórico e é sujeito a corrida entre
  transações; o ledger de inserção explica cada valor.
- **Pagamentos perguntar a Pedidos se o pedido foi cancelado:** acopla os serviços por HTTP; a
  marca de cancelamento resolve só com eventos.
- **Agregado `pagamentoId` na chave da mensagem:** equivalente na distribuição (um pagamento por
  pedido), mas obrigaria quem lê o tópico a buscar o pedido de cada pagamento para correlacionar.
- **Saldo como lista por moeda no contrato:** mais completo, mas o frontend e os tenants de hoje
  só usam BRL; o parâmetro `moeda` resolve sem mudar o formato da resposta.
