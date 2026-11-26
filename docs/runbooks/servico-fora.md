# ServicoFora

**Dispara quando:** o Prometheus não consegue raspar `/actuator/prometheus` de um serviço por 1 min
(`up == 0`).

**Impacto:** as APIs daquele serviço falham pelo gateway (502/503) e os eventos que ele consome se
acumulam no Pulsar, sem perda (assinatura durável).

## Diagnóstico
1. `docker compose -f infra/docker-compose.yml ps`: o container está `Restarting` ou `unhealthy`?
2. `docker compose -f infra/docker-compose.yml logs --tail 200 <serviço>`: procure `APPLICATION FAILED TO START`, `Caused by` ou
   `OutOfMemoryError`.
3. Dependências: `curl -s localhost:8000/api/status | jq '.components[] | select(.status != "UP")'`
   mostra se o MongoDB do serviço ou o Pulsar caíram antes.
4. Memória: `docker stats --no-stream`. O Compose limita cada serviço a 384 MB.

## Ação
- Dependência fora: resolva a dependência; o serviço volta sozinho (restart `unless-stopped`).
- Erro de configuração ou de código: corrija e suba de novo (`docker compose -f infra/docker-compose.yml up -d --build <serviço>`).
- OOM: aumente o limite no Compose só depois de olhar o heap no painel "Memória JVM".
