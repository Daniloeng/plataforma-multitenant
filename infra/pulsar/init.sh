#!/bin/sh
# Cria a hierarquia Pulsar do plano: tenant "plataforma" e um namespace por domínio, com retenção
# de 3 dias (infinita para tenants) e compatibilidade de schema FULL. Usa a API REST de admin (curl), bem mais rápida que
# abrir uma JVM do pulsar-admin por comando. Idempotente: 409 (já existe) conta como sucesso.
set -eu

ADMIN="${PULSAR_ADMIN_URL:-http://localhost:8080}/admin/v2"

call() { # método caminho corpo
  code=$(curl -s -o /tmp/resp -w '%{http_code}' -X "$1" -H 'Content-Type: application/json' \
    "$ADMIN/$2" -d "$3")
  case "$code" in
    2*) echo "ok   $1 $2" ;;
    409) echo "já existe $2" ;;
    *) echo "ERRO $code em $1 $2: $(cat /tmp/resp)" >&2; exit 1 ;;
  esac
}

call PUT tenants/plataforma '{"allowedClusters":["standalone"],"adminRoles":[]}'
for ns in tenants catalogo pedidos pagamentos; do
  call PUT "namespaces/plataforma/$ns" '{}'
  if [ "$ns" = tenants ]; then
    # Retenção infinita: um consumidor novo (ou com o banco recriado) reconstrói a cópia local dos
    # tenants lendo o tópico desde o início (ADR-0010). São poucos eventos, um por mudança de tenant.
    call POST "namespaces/plataforma/$ns/retention" '{"retentionTimeInMinutes":-1,"retentionSizeInMB":-1}'
  else
    call POST "namespaces/plataforma/$ns/retention" '{"retentionTimeInMinutes":4320,"retentionSizeInMB":1024}'
  fi
  # Schemas evoluem com compatibilidade FULL (ADR-0004).
  call PUT "namespaces/plataforma/$ns/schemaCompatibilityStrategy" '"FULL"'
done

echo "namespaces: $(curl -s "$ADMIN/namespaces/plataforma")"
