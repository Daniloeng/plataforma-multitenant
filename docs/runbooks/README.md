# Runbooks

Um runbook por alerta do Prometheus (`infra/observabilidade/prometheus/alertas.yml`). Cada alerta
aponta para o seu pela anotação `runbook_url`. No Claude Code, a skill `runbook` segue estes passos.

| Alerta | Gravidade | Runbook |
|---|---|---|
| `ServicoFora` | crítica | [servico-fora.md](servico-fora.md) |
| `LatenciaP99Alta` | crítica | [latencia-p99-alta.md](latencia-p99-alta.md) |
| `TaxaDeErrosAlta` | alta | [taxa-de-erros-alta.md](taxa-de-erros-alta.md) |
| `OutboxAtrasado`, `OutboxIlegivel` | alta | [outbox-atrasado.md](outbox-atrasado.md) |
| `RelaySemLider`, `RelayComDoisLideres` | alta | [relay-sem-lider.md](relay-sem-lider.md) |
| `EventoNoDeadLetter` | alta | [evento-no-dead-letter.md](evento-no-dead-letter.md) |
| `MigracaoDeNivelFalhando`, `MigracaoDeNivelDemorada` | crítica / alta | [migracao-de-nivel.md](migracao-de-nivel.md) |

## Antes de tudo

Os comandos supõem o Compose local com o perfil de observabilidade:

```bash
TRACING_EXPORT=true docker compose -f infra/docker-compose.yml --profile observabilidade up -d --wait
```

- Saúde agregada: `curl -s localhost:8000/api/status | jq` (métricas por serviço em `metrics`).
- Prometheus: <http://localhost:9090/alerts>; Grafana: <http://localhost:3000> (painel "Plataforma
  multi-tenant"); traces no Grafana em Explore → Tempo.
- Logs: `docker compose -f infra/docker-compose.yml logs --tail 200 <serviço>`. Cada linha traz
  `[traceId-spanId]`: copie o traceId e abra no Tempo para ver a requisição inteira.

Ao fechar um incidente, registre o que aconteceu e o que mudou no diário do dia (`docs/dias/`).
