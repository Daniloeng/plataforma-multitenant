#!/bin/sh
# Cria a hierarquia Pulsar do plano: tenant "plataforma" e um namespace por domínio, com retenção
# de 3 dias. Usa a API REST de admin (curl), que é bem mais rápida que abrir uma JVM do
# pulsar-admin por comando. Idempotente: 409 (já existe) conta como sucesso.
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
  call POST "namespaces/plataforma/$ns/retention" '{"retentionTimeInMinutes":4320,"retentionSizeInMB":1024}'
done

echo "namespaces: $(curl -s "$ADMIN/namespaces/plataforma")"
