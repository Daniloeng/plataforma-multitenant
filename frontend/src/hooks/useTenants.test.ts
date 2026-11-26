import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { makeTenants } from '../test/fixtures';
import { useTenants } from './useTenants';
import { signInAs } from '../test/session';

// Desde o Dia 4 a API de tenants exige token com o papel plataforma-admin.
beforeEach(() => signInAs('admin'));

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

  it.each([
    ['sucesso', false],
    ['erro', true],
  ])('descarta a página de loadMore que volta depois de um reload (%s)', async (_, falha) => {
    let releasePagina2: () => void = () => {};
    server.use(
      http.get('*/api/v1/tenants', async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (!cursor) return HttpResponse.json({ itens: makeTenants(2), proximoCursor: 'c1' });
        await new Promise<void>((r) => (releasePagina2 = r));
        if (falha) return HttpResponse.error();
        return HttpResponse.json({
          itens: [{ ...makeTenants(1)[0]!, id: 'antigo' }],
          proximoCursor: 'c2',
        });
      }),
    );
    const { result } = renderHook(() => useTenants());
    await waitFor(() => expect(result.current.nextCursor).toBe('c1'));

    act(() => void result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    await act(() => result.current.reload());
    await act(async () => releasePagina2());

    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.items.map((t) => t.id)).not.toContain('antigo');
    expect(result.current.nextCursor).toBe('c1');
    expect(result.current.actionError).toBeNull();
  });
});
