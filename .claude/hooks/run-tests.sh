#!/usr/bin/env bash
# Hook Stop do Claude Code: antes de o Claude encerrar a vez, roda os testes RÁPIDOS (sem os *IT)
# dos módulos alterados na árvore de trabalho. Se falharem, sai com código 2: o Claude Code
# devolve a saída ao Claude, que continua trabalhando até os testes passarem.
#
# Desligar numa sessão: CLAUDE_SKIP_TEST_HOOK=1.
set -uo pipefail

input=$(cat)
# Evita laço infinito: se o Claude já está continuando por causa deste hook, não roda de novo.
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi
[ "${CLAUDE_SKIP_TEST_HOOK:-}" = "1" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard; } | sort -u)
[ -z "$changed" ] && exit 0

modules=$(printf '%s\n' "$changed" | grep -oE '^(libs|services)/[^/]+' | sort -u | while read -r m; do
  [ -f "$m/pom.xml" ] && echo "$m"
done | paste -sd, -)

failed=0
if [ -n "$modules" ] && command -v mvn >/dev/null; then
  if ! out=$(mvn -B -q test -pl "$modules" -am -Dtest='!*IT' -Dsurefire.failIfNoSpecifiedTests=false \
    -Djacoco.skip=true -Dspotless.check.skip=true 2>&1); then
    echo "Testes Java falharam em: $modules" >&2
    printf '%s\n' "$out" | grep -E 'FAIL|ERROR|expected|but was|Tests run:' | head -40 >&2
    failed=1
  fi
fi

if printf '%s\n' "$changed" | grep -q '^frontend/' && [ -d frontend/node_modules ]; then
  if ! out=$(cd frontend && npx vitest run --changed HEAD 2>&1); then
    echo "Testes do frontend falharam:" >&2
    printf '%s\n' "$out" | grep -E '×|FAIL|AssertionError|Expected|Received' | head -40 >&2
    failed=1
  fi
fi

[ "$failed" = 1 ] && exit 2
exit 0
