# ADR-0015: Observabilidade com métricas, traces e alertas testados

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto
Até o Dia 9 a plataforma só dizia se cada peça estava de pé (`/api/status`). Não havia como ver
latência, erros, outbox atrasado, evento perdido no dead letter ou migração de nível travada, e os
ADRs 0008 e 0014 deixaram alertas e o lease do relay para este dia. A meta é p99 < 3 s, o custo
continua zero e a fase seguinte do projeto é QA: alerta sem teste não serve para certificar nada.

## Decisão
- **Métricas com Micrometer, no formato do Prometheus.** Todo serviço expõe `/actuator/prometheus`
  com histograma de latência (`http_server_requests_seconds`) e a tag `tenant` (do `X-Tenant-Id`
  validado; fora do formato vira `invalido`). A biblioteca comum registra as métricas da
  plataforma: `plataforma_outbox_pendentes`, `plataforma_outbox_atraso_seconds`,
  `plataforma_outbox_relay_lider`, `plataforma_outbox_publicados_total`,
  `plataforma_outbox_falhas_total`, `plataforma_isolamento_migrando`,
  `plataforma_isolamento_tentativas`, `plataforma_isolamento_falhas_total`.
- **Consumo de eventos como observação.** O `EventSubscriber` envolve cada mensagem numa observação
  `plataforma.eventos.consumo` (timer com `assinatura`, `evento` e `resultado`: processado,
  duplicado, falha, dead-letter).
- **Traces OpenTelemetry que atravessam o Pulsar.** Micrometer Tracing com a ponte OTel e
  exportação OTLP. O `Outbox` grava o `traceparent` do span atual na mensagem (quando o evento não
  traz o seu); o consumidor usa a propriedade `traceparent` como pai do span do consumo. Um pedido
  vira um trace só: gateway → pedidos → (Pulsar) → pagamentos. Exportação desligada por padrão
  (`TRACING_EXPORT`), amostragem de 100% no ambiente de estudo.
- **Lease do relay do outbox no MongoDB** (o que o ADR-0008 previu): documento
  `outbox_relay_lease` com dona e validade de 10 s, renovado na metade do prazo; só a dona publica,
  qualquer réplica assume quando vence, e o desligamento solta na hora.
- **Prometheus, Grafana e Tempo num perfil do Compose** (`observabilidade`), com datasources e um
  painel provisionados por arquivo. Sem Loki: os logs já levam `traceId-spanId` e o Tempo acha o
  resto.
- **Alertas como código, com teste.** As regras ficam em `infra/observabilidade/prometheus/`
  (`alertas.yml`), cada uma com `runbook_url` para `docs/runbooks/`, e `promtool test rules` roda
  casos que disparam e que não disparam no CI.
- **Métricas do actuator fora da porta pública.** O gateway serve o actuator na 8001 (interna); a
  8000 nega `/actuator/prometheus`. Os demais serviços não publicam porta.
- **A página de saúde mostra métricas por serviço.** O status-service lê o `/actuator/prometheus` de
  cada serviço pronto e devolve, em cada componente, `metrics` (requisições, taxa de 5xx, p99,
  outbox e eventos) acumuladas desde a subida.

## Consequências
- Alerta novo só entra com teste no `alertas.test.yml`; métrica nova da plataforma entra com o nome
  em português no prefixo `plataforma_`, como os eventos.
- A tag `tenant` multiplica as séries do histograma pelo número de tenants. Para dezenas de
  tenants, cabe; com milhares, vira agregação por plano ou amostragem (dívida).
- As métricas da página de saúde são acumuladas desde a subida, não uma janela: servem para a
  vitrine; a análise de verdade é no Prometheus.
- A validade do lease depende do relógio das réplicas; diferença de relógio precisa ser bem menor
  que 10 s. Dois líderes por um instante não perdem evento (consumidores deduplicam), mas podem
  inverter a ordem de um agregado; o alerta `RelayComDoisLideres` avisa.
- O status-service raspa os serviços a cada chamada de `/api/status` (5 a mais por chamada). Com
  muitos acessos, vira cache curto.

## Alternativas consideradas
- **Agente OpenTelemetry (javaagent):** instrumenta mais sem código, mas não leva o trace pelo
  outbox (o relay publica depois, em outra thread). A propagação explícita pelo `traceparent` é o
  que liga as pontas.
- **Kube-prometheus / Grafana Cloud:** o primeiro só faz sentido com Kubernetes (Dia 11); o segundo
  é serviço externo, fora da regra de custo zero até o Dia 10.
- **Alertmanager e notificação:** fica para quando houver para quem notificar; por ora os alertas
  ficam no Prometheus e no Grafana.
- **Lease do relay pelo Pulsar (assinatura Exclusive) ou pelo Kubernetes (Lease):** o primeiro não
  protege o polling do MongoDB, o segundo amarra a biblioteca ao Kubernetes.
