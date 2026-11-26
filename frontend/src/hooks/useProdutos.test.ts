import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { resetCatalogoStore } from '../mocks/catalogo';
import { server } from '../mocks/server';
import { makeProdutos } from '../test/fixtures';
import { signInAs } from '../test/session';
import { matchesFilter, useProdutos } from './useProdutos';

beforeEach(() => signInAs('ana', 'distribuidora-aurora'));

describe('matchesFilter', () => {
  const p = makeProdutos(1)[0]!;

  it('confere situação e busca por nome ou SKU, sem diferenciar maiúsculas', () => {
    expect(matchesFilter(p, {})).toBe(true);
    expect(matchesFilter(p, { ativo: true })).toBe(true);
    expect(matchesFilter(p, { ativo: false })).toBe(false);
    expect(matchesFilter(p, { busca: 'prd-0' })).toBe(true);
    expect(matchesFilter(p, { busca: ' PRODUTO ' })).toBe(true);
    expect(matchesFilter(p, { busca: 'café' })).toBe(false);
    expect(matchesFilter(p, { busca: '  ' })).toBe(true);
  });
});

describe('useProdutos', () => {
  it('descarta a página de "Carregar mais" quando um reload chega no meio (sucesso ou erro)', async () => {
    resetCatalogoStore({ 'distribuidora-aurora': makeProdutos(45) });
    const { result } = renderHook(() => useProdutos('distribuidora-aurora', {}));
    await waitFor(() => expect(result.current.items).toHaveLength(20));

    for (const resposta of ['ok', 'erro'] as const) {
      let release: () => void = () => {};
      server.use(
        http.get(
          '*/api/v1/produtos',
          async () => {
            await new Promise<void>((r) => (release = r));
            if (resposta === 'erro') return HttpResponse.error();
            return HttpResponse.json({
              itens: makeProdutos(1, 'VELHO'),
              proximoCursor: null,
              total: 1,
              limitePlano: 500,
              usados: 1,
            });
          },
          { once: true },
        ),
      );
      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.loadMore();
      });
      await waitFor(() => expect(result.current.loadingMore).toBe(true));
      await act(() => result.current.reload());
      await act(async () => {
        release();
        await pending;
      });
      expect(result.current.loadingMore).toBe(false);
      expect(result.current.items).toHaveLength(20);
      expect(result.current.items.some((p) => p.sku.startsWith('VELHO'))).toBe(false);
      expect(result.current.actionError).toBeNull();
      expect(result.current.usados).toBe(45);
    }
  });

  it('loadMore não faz nada sem próximo cursor', async () => {
    const { result } = renderHook(() => useProdutos('distribuidora-aurora', {}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nextCursor).toBeNull();
    await act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(12);
  });
});
