# Frontend — Status e Arquitetura da plataforma

Frontend da plataforma multi-tenant (pedidos B2B + pagamentos), com duas páginas em abas:

- **Status** (`#/`): status do `status-service` (`GET /api/status`, atualizado a cada 10 s), o
  roadmap dos microsserviços e o progresso do estudo.
- **Arquitetura** (`#/arquitetura`): diagramas do event storming, catálogo de eventos, matriz
  produtor × consumidor e lista de ADRs — tudo lido **em build time** do próprio repositório.

O roteamento é por hash (`#/` e `#/arquitetura`), sem biblioteca de rotas, para funcionar no
GitHub Pages (que não reescreve rotas para o `index.html`).

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

## Página Arquitetura

O conteúdo vem de arquivos fora de `frontend/`, lidos com `import.meta.glob(..., { query: '?raw',
eager: true })` em `src/architecture/sources.ts` (por isso o `vite.config.ts` libera a raiz do
repositório em `server.fs.allow`). Nada é buscado em tempo de execução.

| Seção                        | Fonte                                                                                                         | Parse (funções puras)         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Event storming               | `docs/arquitetura/event-storming.md` (blocos ` ```mermaid `, título = heading `##`/`###` anterior)            | `src/architecture/docs.ts`    |
| Catálogo de eventos          | `libs/contracts/src/main/avro/**/*.avsc` (records com `x-evento`, `x-topico`, `x-produtor`, `x-consumidores`) | `src/architecture/catalog.ts` |
| Matriz produtor × consumidor | os mesmos schemas                                                                                             | `src/architecture/catalog.ts` |
| ADRs                         | `docs/adr/*.md` (`# ADR-0001: Título`, `- **Status:**`, `- **Data:**`)                                        | `src/architecture/docs.ts`    |

- O catálogo mostra tipos legíveis (`uuid`, `timestamp-millis`, `string?`, `ItemPedido[]`,
  `enum Plano (GRATUITO | PROFISSIONAL | EMPRESARIAL)`), agrupa os metadados (`eventId`,
  `tenantId`, `occurredAt`, `traceparent`) num bloco recolhido e filtra por serviço (eventos que o
  serviço publica ou consome). Enums em arquivo próprio (ex.: `tenants/Plano.avsc`) não viram
  eventos, mas fornecem os símbolos dos campos que os referenciam.
- Os diagramas usam o [Mermaid](https://mermaid.js.org) 11, carregado por `import('mermaid')`
  só quando a página Arquitetura abre: ele fica em chunks separados e não pesa a página Status.
  Tema conforme `prefers-color-scheme` e `securityLevel: 'strict'`. Se um diagrama falhar, a
  página mostra o erro e o código-fonte.
- Novo evento, diagrama ou ADR aparece na página no próximo build, sem mudar o frontend.

## Testes e qualidade

```bash
npm test               # Vitest (jsdom + msw/node)
npm run test:coverage  # cobertura v8; falha abaixo de 80% (lines/statements/functions/branches)
npm run typecheck
npm run format:check   # ou npm run format para corrigir
```

Relatórios de cobertura ficam em `coverage/` (HTML, lcov e `coverage-summary.json`).

Nos testes o módulo `mermaid` é sempre mockado (em `src/test/setup.ts`), porque o jsdom não faz
layout de SVG; cada teste pode forçar um erro com `vi.mocked(mermaid.render).mockRejectedValueOnce`.
As funções de parse são testadas com fixtures (`src/test/architecture-fixtures.ts`), e há testes
que leem os schemas e documentos reais do repositório.
