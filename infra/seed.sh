#!/usr/bin/env bash
# Cria os tenants de demonstração (os mesmos grupos do realm do Keycloak) pelo gateway.
# Uso: infra/seed.sh   (com o Compose de pé; pode rodar de novo: tenant existente é mantido)
set -euo pipefail

GATEWAY=${GATEWAY:-http://localhost:8000}
KEYCLOAK=${KEYCLOAK:-http://localhost:8180}

token() { # usuário senha
  curl -fsS "$KEYCLOAK/realms/plataforma/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=plataforma-cli -d "username=$1" -d "password=$2" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}

ADMIN=$(token admin senha123)

criar() { # id nome plano nivel
  code=$(curl -sS -o /tmp/seed-resp.json -w '%{http_code}' -X POST "$GATEWAY/api/v1/tenants" \
    -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$1\",\"nome\":\"$2\",\"plano\":\"$3\",\"nivelIsolamento\":\"$4\"}")
  case "$code" in
    201) echo "tenant $1 criado" ;;
    409) echo "tenant $1 já existe" ;;
    *) echo "falha ao criar $1: HTTP $code" >&2; cat /tmp/seed-resp.json >&2; exit 1 ;;
  esac
}

criar acme "ACME Distribuidora" PROFISSIONAL POOL
criar globex "Globex Atacado" GRATUITO POOL
criar initech "Initech Indústria" EMPRESARIAL POOL
