# MigracaoDeNivelFalhando / MigracaoDeNivelDemorada

**Dispara quando:** a migração de um tenant para a database dedicada (promoção para Bridge ou Silo,
ADR-0014) já falhou 3 vezes, ou está em andamento há mais de 10 min.

**Impacto:** as APIs do tenant respondem 503 `tenant-em-migracao` enquanto durar; os outros tenants
não sentem. Os eventos do tenant esperam, sem ir para o dead letter.

## Diagnóstico
1. Estado: `curl -s localhost:8000/api/v1/isolamento/pedidos -H "Authorization: Bearer $TOKEN" -H 'X-Tenant-Id: <tenant>'`
   e, no MongoDB, `db.tenant_niveis.find({_id: "<tenant>"})` (`attempts`, `owner`,
   `migrationStartedAt`).
2. Erro: `docker compose -f infra/docker-compose.yml logs pedidos-service | grep "Migração do tenant"`. A próxima tentativa espera 10 s,
   20 s, 40 s... até 5 min.
3. "ainda recebe gravações ... depois de 5 passadas": alguma réplica continua gravando na database
   antiga (mapa de níveis velho). Confira se todas releem o mapa (`plataforma_isolamento_migrando`
   igual em todas).

## Ação
- Causa resolvida: a próxima tentativa conclui sozinha; não edite `tenant_niveis` à mão.
- Réplica com mapa velho: reinicie essa réplica.
- Documentos que a varredura deixou na database antiga aparecem como erro no log com o `_id`:
  compare com a nova e decida qual vale antes de apagar.
