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

# Produtos de demonstração, cadastrados pela gestora ana (acme e globex).
ANA=$(token ana senha123)

produto() { # tenant sku nome centavos
  for tentativa in $(seq 1 20); do
    code=$(curl -sS -o /tmp/seed-resp.json -w '%{http_code}' -X POST "$GATEWAY/api/v1/produtos" \
      -H "Authorization: Bearer $ANA" -H "X-Tenant-Id: $1" -H 'Content-Type: application/json' \
      -d "{\"sku\":\"$2\",\"nome\":\"$3\",\"preco\":{\"centavos\":$4}}")
    case "$code" in
      201) echo "produto $2 criado em $1"; return ;;
      409) echo "produto $2 já existe em $1"; return ;;
      # O gateway aprende tenants novos pelo evento tenant.criado: espera um instante. Outro 403
      # (papel, tenant suspenso) é erro de verdade.
      503) sleep 1 ;;
      403) grep -q 'não cadastrado' /tmp/seed-resp.json || {
          echo "acesso negado ao criar $2 em $1" >&2; cat /tmp/seed-resp.json >&2; exit 1; }
        sleep 1 ;;
      *) echo "falha ao criar $2 em $1: HTTP $code" >&2; cat /tmp/seed-resp.json >&2; exit 1 ;;
    esac
  done
  echo "tenant $1 não ficou disponível no gateway" >&2
  exit 1
}

produto acme PARAF-M6 "Parafuso sextavado M6 (caixa com 100)" 3490
produto acme LUVA-NIT "Luva nitrílica (caixa com 50 pares)" 8990
produto acme FITA-ISO "Fita isolante 19 mm x 20 m" 790
produto globex CAFE-1KG "Café torrado em grãos 1 kg" 5490
produto globex ACUCAR-5 "Açúcar cristal 5 kg" 2690
