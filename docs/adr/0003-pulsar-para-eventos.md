# ADR-0003: Apache Pulsar para integração por eventos

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

Os serviços se integram por eventos (ADR-0002). O requisito do projeto pede Apache Pulsar, e o
domínio multi-tenant se beneficia de recursos nativos dele: tenants e namespaces com quotas, schema
registry e assinatura `Key_Shared`.

## Decisão

- **Hierarquia:** tenant Pulsar `plataforma`, um namespace por contexto
  (`plataforma/tenants`, `plataforma/catalogo`, `plataforma/pedidos`, `plataforma/pagamentos`),
  com retenção de 3 dias. Tenants de nível Bridge ou Silo ganham namespace próprio
  `plataforma/t-<tenantId>` (Dia 9).
- **Tópicos:** `persistent://plataforma/<contexto>/<entidade>.<evento>.v<versão>`, sempre no
  namespace do **produtor**. O nome e a versão estão no schema (`x-topico`) e o código resolve o
  tópico pelo `EventCatalog`, nunca por texto solto.
- **Chave da mensagem:** `tenantId:aggregateId`. Com assinatura `Key_Shared`, eventos do mesmo
  agregado **no mesmo tópico** chegam em ordem e agregados diferentes são processados em paralelo.
  Não há ordem entre tópicos diferentes: `pedido.cancelado` pode chegar antes de `pedido.criado`.
  Os consumidores tratam isso explicitamente (ADR-0006).
- **Entrega:** pelo menos uma vez. Todo consumidor é idempotente pelo `eventId` (coleção de eventos
  processados com índice único e TTL, Dia 3).
- **Schemas:** cada namespace usa compatibilidade `FULL` no Schema Registry (ADR-0004).
- **Consumidores fora dos serviços:** o gateway consome `tenant.criado` e `tenant.alterado` para
  manter em cache plano, nível e situação de cada tenant (ADR-0005).
- **Falhas:** retry topic com backoff (1 s, 10 s, 1 min) e DLQ por assinatura.
- **Publicação:** pelo outbox transacional (ADR-0006), nunca direto do request.
- **Local e CI:** Pulsar 4.0 standalone (um container), sem functions worker.

## Consequências

- O produtor nunca sabe quem consome; adicionar um consumidor não muda o produtor.
- Ordem só é garantida por agregado dentro de um tópico; os consumidores não podem supor ordem
  entre pedidos diferentes nem entre tópicos diferentes.
- O Pulsar é mais pesado que outros brokers (~660 MB no standalone, medido no Dia 1).

## Alternativas consideradas

- **Kafka:** mais difundido, mas sem multi-tenancy nativa; seria preciso simular namespaces com
  prefixos e ACLs.
- **RabbitMQ:** ótimo para filas de trabalho, mas sem retenção e reprocessamento como log.
