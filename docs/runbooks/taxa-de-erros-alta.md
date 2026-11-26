# TaxaDeErrosAlta

**Dispara quando:** mais de 1% das respostas de um serviço são 5xx por 5 min.

## Diagnóstico
1. Qual status? `sum by (status, uri) (rate(http_server_requests_seconds_count{job="<serviço>",status=~"5.."}[5m]))`
2. `503 tenant-em-migracao` é esperado durante uma promoção de nível (ADR-0014). Se durar, veja
   [migracao-de-nivel.md](migracao-de-nivel.md).
3. `500`: `docker compose -f infra/docker-compose.yml logs <serviço> | grep -A20 ERROR`; o traceId da linha leva ao trace no Tempo.
4. Dependência: MongoDB ou Pulsar fora aparecem no `/api/status`.

## Ação
- Erro de código: reproduza com o trace, escreva o teste que falha e corrija.
- Dependência: restabeleça; as escritas que falharam não publicaram evento (outbox na mesma
  transação), então não há estado pela metade.
