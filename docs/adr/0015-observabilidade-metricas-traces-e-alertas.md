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
  com histograma de latência (`http_server_requests_seconds`) em baldes fixos (50 ms, 100 ms,
  250 ms, 500 ms, 1 s, 3 s, 5 s, 10 s; o limite da meta é exato) e a tag `tenant` (do `X-Tenant-Id`
  validado; fora do formato vira `invalido`). Streams SSE (a linha do tempo, ADR-0013) ficam fora
  dessa métrica: uma conexão aberta por minutos destruiria o p99. A biblioteca comum registra as métricas da
  plataforma: `plataforma_outbox_pendentes`, `plataforma_outbox_atraso_seconds`,
  `plataforma_outbox_relay_lider`, `plataforma_outbox_publicados_total`,
  `plataforma_outbox_falhas_total`, `plataforma_isolamento_migrando`,
  `plataforma_isolamento_tentativas`, `plataforma_isolamento_falhas_total`.
- **Consumo de eventos como observação.** O `EventSubscriber` envolve cada mensagem numa observação
  `plataforma.eventos.consumo` (timer com `assinatura`, `evento` e `resultado`: processado,
  duplicado, falha, dead-letter).
- **Traces OpenTelemetry que atravessam o Pulsar.** Micrometer Tracing com a ponte OTel e
  exportação OTLP. Quando o evento não traz `traceparent`, o `Outbox` pede ao propagador do tracing
  o do span atual e grava o mesmo valor no campo Avro (ADR-0003) e na propriedade da mensagem; o
  consumidor usa a propriedade como pai do span do consumo, e quem lê o payload depois (dead
  letter, reprocessamento) também tem o trace. Um pedido
  vira um trace só: gateway → pedidos → (Pulsar) → pagamentos. Exportação desligada por padrão
  (`TRACING_EXPORT`), amostragem de 100% no ambiente de estudo.
- **Lease do relay do outbox no MongoDB** (o que o ADR-0008 previu): documento
  `outbox_relay_lease` com dona e validade de 10 s, gravada e comparada com o relógio do MongoDB
  (`$$NOW`), renovada na metade do prazo; só a dona publica, qualquer réplica assume quando vence.
  Na primeira metade do prazo a dona publica sem consultar o banco, por isso
  `plataforma.outbox.send-timeout` precisa ser menor que metade do lease (validado na subida;
  padrão 4 s). No desligamento, o scheduler espera o ciclo em andamento e o lease é solto; depois
  disso a réplica nunca mais assume. O documento nasce já vencido e é tomado por um update
  condicional, sem upsert (o MongoDB não aceita `$expr` no filtro de um upsert); soltar é marcar
  vencido, não apagar.
- **Prometheus, Grafana e Tempo num perfil do Compose** (`observabilidade`), com datasources e um
  painel provisionados por arquivo, portas só em `127.0.0.1`. O Prometheus acha as réplicas de
  cada serviço por DNS (registro A), para os alertas do relay somarem por réplica. Sem Loki: os logs
  já levam `traceId-spanId` e o Tempo acha o resto.
- **Alertas como código, com teste.** As regras ficam em `infra/observabilidade/prometheus/`
  (`alertas.yml`), cada uma com `runbook_url` para `docs/runbooks/`, e `promtool test rules` roda
  casos que disparam e que não disparam no CI.
- **Métricas do actuator fora da porta pública.** O gateway serve o actuator na 8001 (interna); a
  8000 nega `/actuator/prometheus`. Os demais serviços não publicam porta.
- **A página de saúde mostra métricas por serviço.** O status-service lê o `/actuator/prometheus` de
  cada serviço pronto e devolve, em cada componente, `metrics` (requisições, taxa de 5xx, p99,
  outbox e eventos) acumuladas desde a subida, sem nomes de tenants. O formato agora tem contrato
  (`openapi/status.yaml`) e continua público, como a página inicial. Valor não finito vira `null`, e
  o frontend descarta só a métrica malformada, não a resposta.

## Consequências
- Alerta novo só entra com teste no `alertas.test.yml`; métrica nova da plataforma entra com o nome
  em português no prefixo `plataforma_`, como os eventos.
- Orçamento de séries: cada combinação de uri, método, status e tenant que acontece gera 9 baldes
  mais soma e contagem (11 séries). Um serviço com 15 rotas, 2 métodos e 3 status comuns, usados
  por 10 tenants, fica em torno de 10 mil séries no pior caso, e na prática bem menos (nem toda
  rota tem todo status para todo tenant). Cabe nos 256 MB do Prometheus local; com centenas de
  tenants, a tag vira o plano em vez do tenant (dívida).
- O alerta de dead letter precisa pegar a série que acabou de nascer (o `increase` dela dá 0); um
  Prometheus recém-reiniciado avisa uma vez de dead letters antigos.
- As métricas da página de saúde são acumuladas desde a subida, não uma janela: servem para a
  vitrine; a análise de verdade é no Prometheus.
- Sem fencing token, uma pausa longa da dona (GC, failover do MongoDB) ainda pode deixar duas
  réplicas publicando por um instante. Não se perde evento (consumidores deduplicam), mas a ordem
  de um agregado pode inverter em uma mensagem; o alerta `RelayComDoisLideres` avisa.
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
