# EventoNoDeadLetter

**Dispara quando:** um evento falhou em todas as tentativas (10, ADR-0010) e foi para o tópico de
dead letter da assinatura: `persistent://plataforma/<serviço>/dlq.<assinatura>`.

**Impacto:** o efeito daquele evento não aconteceu (ex.: pedido sem cobrança). Os eventos seguintes
continuam sendo processados.

## Diagnóstico
1. Por que falhou: `docker compose -f infra/docker-compose.yml logs <serviço> | grep "Falha ao processar"` mostra a exceção de cada
   tentativa. `WriteConflict` isolado é transitório e não chega ao dead letter.
2. Ver a mensagem: a assinatura `<serviço>-<assinatura>-reprocessar` retém o dead letter:
   `docker compose -f infra/docker-compose.yml exec pulsar bin/pulsar-client consume -s espiar -p Earliest -n 1 persistent://plataforma/<serviço>/dlq.<assinatura>`

## Ação
- Corrija a causa (código ou dado) e reprocesse: publique a mensagem de volta no tópico original. O
  consumidor é idempotente pelo eventId, então reprocessar é seguro.
- Registre o caso: evento em dead letter é sempre bug ou dado inesperado.
