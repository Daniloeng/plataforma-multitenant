import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { makeTenants } from '../test/fixtures';
import { useTenants } from './useTenants';

describe('useTenants', () => {
  it('ignora a resposta de uma busca substituída por outra (sucesso ou erro)', async () => {
    const releases: (() => void)[] = [];
    let chamadas = 0;
    server.use(
      http.get('*/api/v1/tenants', async () => {
        chamadas += 1;
        const atual = chamadas;
        await new Promise<void>((r) => releases.push(r));
        if (atual === 2) return HttpResponse.error();
        return HttpResponse.json({ itens: makeTenants(atual), proximoCursor: null });
      }),
    );
    const { result } = renderHook(() => useTenants());
    await waitFor(() => expect(releases).toHaveLength(1));
    // A 2ª busca (que vai falhar) é substituída pela 3ª antes de responder.
    act(() => void result.current.reload());
    await waitFor(() => expect(releases).toHaveLength(2));
    act(() => void result.current.reload());
    await waitFor(() => expect(releases).toHaveLength(3));
    await act(async () => releases.forEach((r) => r()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.error).toBeNull();
  });

  it('loadMore não faz nada sem próximo cursor', async () => {
    const { result } = renderHook(() => useTenants());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nextCursor).toBeNull();
    await act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(5);
    expect(result.current.loadingMore).toBe(false);
  });
});
