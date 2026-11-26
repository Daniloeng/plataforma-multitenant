---
name: runbook
description: Investiga um alerta ou incidente da plataforma seguindo os runbooks de docs/runbooks/. Use quando um alerta do Prometheus disparar, quando a página de saúde mostrar algo fora do normal, ou quando pedirem para investigar lentidão, erros, outbox parado, dead letter ou migração de nível.
---

# Investigar um alerta

1. **Identifique o alerta.** Pelo nome (`ServicoFora`, `LatenciaP99Alta`, `TaxaDeErrosAlta`,
   `OutboxAtrasado`, `OutboxIlegivel`, `RelaySemLider`, `RelayComDoisLideres`, `EventoNoDeadLetter`,
   `MigracaoDeNivelFalhando`, `MigracaoDeNivelDemorada`) ou pelo sintoma. Se o ambiente estiver no
   ar, liste os ativos: `curl -s localhost:9090/api/v1/alerts | jq '.data.alerts[] | {nome: .labels.alertname, job: .labels.job, estado: .state}'`.
2. **Abra o runbook** correspondente em `docs/runbooks/` (o índice está em `docs/runbooks/README.md`)
   e siga o Diagnóstico na ordem. Rode os comandos de leitura sem pedir licença; eles não mudam nada.
3. **Junte evidência**, não palpite: o valor da métrica (PromQL em `localhost:9090/api/v1/query`), a
   linha de log com o `traceId` e, se houver, o trace no Tempo
   (`curl -s localhost:3200/api/traces/<traceId>`).
4. **Antes de uma Ação que muda estado** (reiniciar serviço, mexer no MongoDB, republicar evento),
   descreva o que vai fazer e peça confirmação. Nunca apague item do outbox nem edite
   `tenant_niveis` à mão.
5. **Feche o ciclo:** diga a causa, a evidência e o que foi feito. Se faltou métrica, alerta ou
   passo no runbook, proponha a mudança (alerta novo entra com teste em
   `infra/observabilidade/prometheus/alertas.test.yml`).
