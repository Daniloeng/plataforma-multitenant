# LatenciaP99Alta

**Dispara quando:** o p99 das requisições de um serviço (sem o Actuator) passa de 3 s por 5 min.
A meta do projeto é p99 < 3 s, idealmente perto de 200 ms.

## Diagnóstico
1. Grafana, painel "p99 por serviço" e "Requisições por tenant": é um serviço só? Um tenant só
   (vizinho barulhento)?
2. PromQL por rota e tenant:
   `histogram_quantile(0.99, sum by (uri, tenant, le) (rate(http_server_requests_seconds_bucket{job="<serviço>"}[5m])))`
3. Tempo (Explore → Tempo → Search, `duration > 3s`): abra um trace lento e veja qual span demora
   (consulta ao MongoDB, chamada ao Pulsar, espera de migração).
4. MongoDB: `mongodb_driver_commands_seconds` por comando; consulta sem índice aparece como
   `find` lento.

## Ação
- Um tenant: confira o limite do plano no gateway (rate limit) e se ele está em migração de nível.
- Consulta lenta: crie o índice (as consultas de negócio começam por `tenantId`, ADR-0005).
- Carga geral: suba réplicas (Dia 11, Kubernetes) e registre o caso para os testes de carga.
