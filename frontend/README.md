# Frontend — Status da plataforma

Página inicial da plataforma multi-tenant (pedidos B2B + pagamentos): mostra o status do
`status-service` (`GET /api/status`, atualizado a cada 10 s), o roadmap dos microsserviços e o
progresso do estudo.

Stack: React 19 + Vite 7 + TypeScript, testes com Vitest + Testing Library + MSW. Requer Node 22+.

## Como rodar

```bash
npm install
npm run dev          # http://localhost:5173 — /api é encaminhado para http://localhost:8090
```

Para dados reais, suba antes o ambiente (Docker Compose na raiz do repositório) com o
`status-service` ouvindo na porta 8090.

## Modo demo (sem backend)

Com `VITE_DEMO=true`, o [MSW](https://mswjs.io) intercepta `/api/status` no navegador e devolve
dados simulados (MongoDB e Pulsar no ar, latências variando). A página exibe o selo
"Modo demo (API simulada)".

```bash
VITE_DEMO=true npm run dev
# build do GitHub Pages (base /plataforma-multitenant/):
VITE_DEMO=true VITE_BASE=/plataforma-multitenant/ npm run build
```

O service worker (`public/mockServiceWorker.js`) é gerado por `npx msw init public --save`.

## Testes e qualidade

```bash
npm test               # Vitest (jsdom + msw/node)
npm run test:coverage  # cobertura v8; falha abaixo de 80% (lines/statements/functions/branches)
npm run typecheck
npm run format:check   # ou npm run format para corrigir
```

Relatórios de cobertura ficam em `coverage/` (HTML, lcov e `coverage-summary.json`).
