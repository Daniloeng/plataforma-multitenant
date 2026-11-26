# OutboxAtrasado

**Dispara quando:** o evento pendente mais antigo do outbox de um serviço tem mais de 60 s
(`plataforma_outbox_atraso_seconds`), por 2 min. Normal é abaixo de 1 s (ciclo de 200 ms, ADR-0008).

**Impacto:** a saga para (pedido não é cobrado, preço não chega ao pedidos-service). Nada se perde:
o evento está gravado e sai quando o relay voltar.

## Diagnóstico
1. Há líder do relay? `sum by (job) (plataforma_outbox_relay_lider)` precisa ser 1. Se for 0, veja
   [relay-sem-lider.md](relay-sem-lider.md).
2. O Pulsar responde? `/api/status` e `rate(plataforma_outbox_falhas_total[5m])`.
3. Um item travado segura a fila (a ordem por agregado manda parar no primeiro erro):
   `docker compose -f infra/docker-compose.yml exec mongo-<serviço> mongosh <db> --quiet --eval 'db.outbox.find({publishedAt: null}).sort({occurredAt: 1}).limit(3)'`
   e olhe `attempts` e `lastError`.

## Ação
- Pulsar fora: restabeleça; o relay retoma sozinho.
- `lastError` de schema incompatível ou tópico apagado: corrija o contrato ou recrie o tópico; não
  apague o item do outbox sem decidir o que fazer com o evento (ele é a única cópia).
