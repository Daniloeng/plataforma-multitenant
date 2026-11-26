#!/usr/bin/env bash
# Hook PostToolUse do Claude Code: formata o arquivo que o Claude acabou de editar.
#   *.java                      -> google-java-format (via Spotless, só o arquivo)
#   frontend/**/*.{ts,tsx,...}  -> Prettier
# Falhas de formatação não bloqueiam o Claude: o CI confere a formatação de qualquer forma.
set -uo pipefail

input=$(cat)
file=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[ -z "$file" ] || [ ! -f "$file" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

case "$file" in
  *.java)
    (cd "$root" && mvn -q -B spotless:apply -DspotlessFiles="$(printf '%s' "$file" | sed 's/[.[\*^$()+?{|]/\\&/g')" >/dev/null 2>&1) || true
    ;;
  "$root"/frontend/*.ts|"$root"/frontend/*.tsx|"$root"/frontend/*.css|"$root"/frontend/*.json|"$root"/frontend/*.md)
    if [ -x "$root/frontend/node_modules/.bin/prettier" ]; then
      (cd "$root/frontend" && ./node_modules/.bin/prettier --write --log-level silent "$file") || true
    fi
    ;;
esac
exit 0
