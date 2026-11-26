import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setSessionProvider } from '../api/http';
import { server } from '../mocks/server';
import { resetRateLimits } from '../mocks/gateway';
import { resetTenantStore } from '../mocks/tenants';
import { resetCatalogoStore } from '../mocks/catalogo';
import { resetPedidosStore } from '../mocks/pedidos';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  // Cada teste começa com os tenants iniciais do modo demo.
  resetTenantStore();
  // ... e o catálogo de produtos de cada tenant.
  resetCatalogoStore();
  // ... e os pedidos (com as chaves de idempotência).
  resetPedidosStore();
  // Sessão (token de demo, tenant escolhido) e baldes do rate limit também recomeçam.
  resetRateLimits();
  window.sessionStorage.clear();
  setSessionProvider(null);
});
afterAll(() => server.close());

// O Mermaid real não roda no jsdom (precisa de layout/SVG): nos testes ele é sempre mockado.
// Cada teste pode trocar o comportamento com vi.mocked(mermaid.render).mockRejectedValueOnce(...).
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, code: string) => ({
      svg: `<svg id="${id}" data-testid="mermaid-svg"><text>${code.length}</text></svg>`,
    })),
  },
}));
