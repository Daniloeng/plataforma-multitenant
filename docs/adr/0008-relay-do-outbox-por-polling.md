# ADR-0008: Relay do outbox por polling, com uma réplica publicando

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

O ADR-0006 definiu o outbox transacional: o serviço grava o estado e o evento (coleção `outbox`)
na mesma transação MongoDB, e um relay publica no Pulsar. Faltava decidir **como o relay descobre
os eventos novos** e **o que garante a ordem** por agregado.

Há duas formas comuns:

1. **Change stream** do MongoDB: o banco empurra cada inserção para o relay em tempo real.
2. **Polling**: o relay consulta, a cada intervalo curto, os itens com `publishedAt` nulo, em
   ordem de `occurredAt`.

## Decisão

- **Polling a cada 200 ms** (`plataforma.outbox.interval`), lotes de até 100 itens
  (`plataforma.outbox.batch-size`), pelo índice `ix_pending` (`publishedAt`, `occurredAt`). O relay está na biblioteca comum `libs/platform-spring` e todo serviço o
  ganha por autoconfiguração.
- **Ordem:** o lote é publicado em sequência e **para na primeira falha**, que incrementa
  `attempts` e guarda `lastError`. O item que falhou volta no ciclo seguinte antes dos que vieram
  depois dele, então um consumidor nunca vê `tenant.alterado` antes do `tenant.criado` do mesmo
  tenant.
- **Entrega pelo menos uma vez:** se o processo cair entre publicar e marcar `publishedAt`, o item
  sai de novo. Por isso todo consumidor deduplica pelo `eventId` (`IdempotentConsumer`, ADR-0006).
- **Uma réplica publicando:** enquanto cada serviço rodar com uma réplica (até o Dia 10), não há
  disputa. Com mais réplicas (Kubernetes, Dia 10), só uma pode rodar o relay: será resolvido com
  lease no próprio MongoDB (documento com dono e validade) e registrado em novo ADR.
- **Limpeza:** itens publicados expiram por TTL (`ttl_published`, 7 dias), como os registros de
  eventos processados.
- **Bytes Avro prontos:** o outbox guarda o evento já serializado (Avro binário) e o relay publica
  esses bytes com o schema do contrato declarado ao Schema Registry do tópico, que confere a
  compatibilidade FULL do namespace.

## Alternativas consideradas

- **Change stream:** latência menor (milissegundos), mas exige guardar o *resume token*, tratar a
  perda dele (oplog rotacionado) e voltar ao polling para itens que falharam. Para o volume do
  projeto, 200 ms de atraso no pior caso cabem na meta de p99 < 3 s com folga, e o polling é mais
  simples de testar. Pode voltar a ser avaliado no Dia 14 (testes de carga), se o atraso pesar.
- **Debezium/Kafka Connect:** mais uma peça para operar e fora do Pulsar puro; descartado.
- **Publicar direto no Pulsar dentro da requisição:** perde a atomicidade entre estado e evento
  (o problema que o outbox resolve).

## Consequências

- Até 200 ms (mais o tempo de publicação) entre o commit e o evento no Pulsar.
- Uma consulta indexada a cada 200 ms por serviço, mesmo ocioso: custo desprezível em escala de
  estudo.
- Um item que falha sempre (ex.: tópico apagado) segura a fila daquele serviço. O `attempts` e o
  `lastError` deixam isso visível; alerta e fila de mensagens mortas entram com a observabilidade
  (Dia 9).
