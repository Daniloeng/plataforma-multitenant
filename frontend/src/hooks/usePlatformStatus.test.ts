import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { makeStatus } from '../test/fixtures';
import { POLL_INTERVAL_MS, usePlatformStatus } from './usePlatformStatus';

describe('usePlatformStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('começa carregando e depois expõe os dados', async () => {
    server.use(http.get('*/api/status', () => HttpResponse.json(makeStatus())));
    const { result } = renderHook(() => usePlatformStatus());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.version).toBe('0.1.0-dia01');
    expect(result.current.error).toBeNull();
  });

  it('mantém os últimos dados quando uma atualização falha e se recupera depois', async () => {
    server.use(http.get('*/api/status', () => HttpResponse.json(makeStatus())));
    const { result } = renderHook(() => usePlatformStatus());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    server.use(http.get('*/api/status', () => new HttpResponse(null, { status: 500 })));
    await act(() => result.current.refresh());
    expect(result.current.error).toBe('A API respondeu com HTTP 500.');
    expect(result.current.data?.status).toBe('UP');

    server.use(
      http.get('*/api/status', () => HttpResponse.json(makeStatus({ status: 'DEGRADED' }))),
    );
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.data?.status).toBe('DEGRADED');
  });

  it('faz polling a cada 10 segundos e para ao desmontar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get('*/api/status', () => {
        calls += 1;
        return HttpResponse.json(makeStatus({ version: `v${calls}` }));
      }),
    );
    const { result, unmount } = renderHook(() => usePlatformStatus());
    await waitFor(() => expect(result.current.data?.version).toBe('v1'));

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    await waitFor(() => expect(result.current.data?.version).toBe('v2'));

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    await waitFor(() => expect(result.current.data?.version).toBe('v3'));

    unmount();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(calls).toBe(3);
  });

  it('descarta respostas antigas quando uma nova busca começa', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/status', async () => {
        calls += 1;
        const version = `v${calls}`;
        // A primeira resposta demora mais que a segunda.
        if (calls === 1) await new Promise((r) => setTimeout(r, 80));
        return HttpResponse.json(makeStatus({ version }));
      }),
    );
    const { result } = renderHook(() => usePlatformStatus());
    await act(() => result.current.refresh());
    expect(result.current.data?.version).toBe('v2');
    await new Promise((r) => setTimeout(r, 120));
    expect(result.current.data?.version).toBe('v2');
    expect(result.current.error).toBeNull();
  });

  it('ignora a falha de uma busca cancelada', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/status', async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise((r) => setTimeout(r, 80));
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json(makeStatus());
      }),
    );
    const { result } = renderHook(() => usePlatformStatus());
    await act(() => result.current.refresh());
    await new Promise((r) => setTimeout(r, 120));
    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
  });
});
