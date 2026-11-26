#!/usr/bin/env bash
# Cria a hierarquia Pulsar do plano: tenant "plataforma" e um namespace por domínio.
# Idempotente: pode rodar várias vezes.
set -euo pipefail

ADMIN="bin/pulsar-admin --admin-url ${PULSAR_ADMIN_URL:-http://localhost:8080}"
cd /pulsar

if ! $ADMIN tenants get plataforma >/dev/null 2>&1; then
  $ADMIN tenants create plataforma --allowed-clusters standalone
  echo "tenant plataforma criado"
fi

for ns in tenants catalogo pedidos pagamentos; do
  if ! $ADMIN namespaces policies "plataforma/$ns" >/dev/null 2>&1; then
    $ADMIN namespaces create "plataforma/$ns"
    # Retenção de 3 dias, como no plano (cabe no disco gratuito).
    $ADMIN namespaces set-retention "plataforma/$ns" --time 3d --size 1G
    echo "namespace plataforma/$ns criado"
  fi
done

$ADMIN namespaces list plataforma
