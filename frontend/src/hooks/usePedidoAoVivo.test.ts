import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../api/http';
import type { Pedido } from '../api/pedidos';
import {
  RECONEXAO_BASE_MS,
  RECONEXAO_FINAL_MS,
  RECONEXAO_MAX_MS,
  atrasoReconexao,
  usePedidoAoVivo,
  valeTentarDeNovo,
} from './usePedidoAoVivo';

const pedido: Pedido = {
  id: 'ped-1',
  clienteId: 'cli-1',
  status: 'PENDENTE',
  itens: [],
  total: { centavos: 100, moeda: 'BRL' },
  criadoEm: '2026-11-26T12:00:00Z',
  historico: [{ tipo: 'CRIADO', em: '2026-11-26T12:00:00Z' }],
};

const encoder = new TextEncoder();
const evento = (p: Pedido) => `event: pedido\nid: 1\ndata: ${JSON.stringify(p)}\n\n`;

/** Um fluxo SSE controlado pelo teste: o fetch falso devolve `response`. */
function fluxoSse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    enviar: (texto: string) => controller.enqueue(encoder.encode(texto)),
    fechar: () => controller.close(),
    falhar: () => controller.error(new TypeError('network error')),
  };
}

type Resposta = Response | Error;

/** fetch falso: cada chamada devolve a próxima resposta (ou rejeita com o erro). */
function fetchFalso(...respostas: Resposta[]) {
  const sinais: AbortSignal[] = [];
  const fila = [...respostas];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    if (init?.signal) sinais.push(init.signal);
    const proxima = fila.shift();
    if (proxima === undefined) return new Promise<Response>(() => undefined); // nunca responde
    return proxima instanceof Error ? Promise.reject(proxima) : Promise.resolve(proxima);
  });
  return { spy, sinais, mais: (...r: Resposta[]) => fila.push(...r) };
}

/**
 * Deixa as promessas pendentes andarem (o setImmediate não é falsificado: só setTimeout e
 * clearTimeout são), dentro do act.
 */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('atrasoReconexao', () => {
  it('dobra a cada tentativa até 30 s; pedido em estado final espera 10 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((t) => atrasoReconexao(t))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(atrasoReconexao(-1)).toBe(RECONEXAO_BASE_MS);
    expect(atrasoReconexao(50)).toBe(RECONEXAO_MAX_MS);
    expect(atrasoReconexao(0, true)).toBe(RECONEXAO_FINAL_MS);
  });
});

describe('usePedidoAoVivo', () => {
  it('desligado enquanto o pedido não carregou: não conecta', () => {
    const { spy } = fetchFalso();
    const { result } = renderHook(() => usePedidoAoVivo('ped-1', false, () => undefined));
    expect(result.current).toBe('desligado');
    expect(spy).not.toHaveBeenCalled();
  });

  it('abre o fluxo ("ao-vivo"), entrega cada evento e aborta ao desmontar', async () => {
    const sse = fluxoSse();
    const { spy, sinais } = fetchFalso(sse.response);
    const recebidos: Pedido[] = [];
    const { result, unmount } = renderHook(() =>
      usePedidoAoVivo('ped-1', true, (p) => recebidos.push(p)),
    );
    expect(result.current).toBe('conectando');
    await flush();
    expect(result.current).toBe('ao-vivo');
    expect(String(spy.mock.calls[0]![0])).toMatch(/\/api\/v1\/pedidos\/ped-1\/linha-do-tempo$/);

    await act(async () => {
      sse.enviar(evento(pedido));
      sse.enviar(': ping\n\n');
      sse.enviar(evento({ ...pedido, status: 'CONFIRMADO' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(recebidos.map((p) => p.status)).toEqual(['PENDENTE', 'CONFIRMADO']);

    unmount();
    expect(sinais[0]!.aborted).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('usa sempre o callback mais recente sem reconectar', async () => {
    const sse = fluxoSse();
    const { spy } = fetchFalso(sse.response);
    const primeiro = vi.fn();
    const segundo = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => usePedidoAoVivo('ped-1', true, cb), {
      initialProps: { cb: primeiro },
    });
    await flush();
    expect(result.current).toBe('ao-vivo');
    rerender({ cb: segundo });
    await act(async () => {
      sse.enviar(evento(pedido));
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(segundo).toHaveBeenCalledWith(pedido);
    expect(primeiro).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('o servidor encerra o fluxo: "reconectando" e, depois de 1 s, conecta de novo', async () => {
    const primeiro = fluxoSse();
    const segundo = fluxoSse();
    const { spy } = fetchFalso(primeiro.response, segundo.response);
    const { result } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
    await flush();
    expect(result.current).toBe('ao-vivo');
    await act(async () => {
      primeiro.enviar(evento(pedido));
      primeiro.fechar();
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(result.current).toBe('reconectando');
    await avancar(RECONEXAO_BASE_MS - 1);
    expect(spy).toHaveBeenCalledTimes(1);
    await avancar(1);
    await flush();
    expect(result.current).toBe('ao-vivo');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('queda de rede depois de aberto: tenta de novo com backoff (1 s, 2 s, 4 s) sem voltar ao poll', async () => {
    const sse = fluxoSse();
    const { spy, mais } = fetchFalso(sse.response);
    const { result } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
    await flush();
    expect(result.current).toBe('ao-vivo');
    mais(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'));
    await act(async () => {
      sse.falhar();
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(result.current).toBe('reconectando');
    await avancar(1000);
    expect(spy).toHaveBeenCalledTimes(2);
    await avancar(1999);
    expect(spy).toHaveBeenCalledTimes(2);
    await avancar(1);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.current).toBe('reconectando');
    // A terceira tentativa (depois de 4 s) fica pendurada: sem resposta, segue "reconectando".
    await avancar(4000);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('evento fora do contrato derruba o fluxo e reconecta', async () => {
    const primeiro = fluxoSse();
    const segundo = fluxoSse();
    const { spy } = fetchFalso(primeiro.response, segundo.response);
    const { result } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
    await flush();
    expect(result.current).toBe('ao-vivo');
    await act(async () => {
      primeiro.enviar('event: pedido\ndata: {"id":1}\n\n');
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(result.current).toBe('reconectando');
    await avancar(RECONEXAO_BASE_MS);
    await flush();
    expect(result.current).toBe('ao-vivo');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('pedido em estado final: reconecta sem pressa (10 s)', async () => {
    const primeiro = fluxoSse();
    const { spy } = fetchFalso(primeiro.response, fluxoSse().response);
    const { result } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
    await flush();
    expect(result.current).toBe('ao-vivo');
    await act(async () => {
      primeiro.enviar(evento({ ...pedido, status: 'CONFIRMADO' }));
      primeiro.fechar();
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(result.current).toBe('reconectando');
    await avancar(RECONEXAO_BASE_MS * 4);
    expect(spy).toHaveBeenCalledTimes(1);
    await avancar(RECONEXAO_FINAL_MS - RECONEXAO_BASE_MS * 4);
    await flush();
    expect(result.current).toBe('ao-vivo');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['404 (backend sem a linha do tempo)', new Response(null, { status: 404 })],
    ['403 (sem permissão)', new Response(null, { status: 403 })],
  ])(
    'a primeira conexão nem abre (%s): "indisponivel", sem novas tentativas',
    async (_, resposta) => {
      const { spy } = fetchFalso(resposta);
      const { result } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
      await flush();
      expect(result.current).toBe('indisponivel');
      await avancar(RECONEXAO_MAX_MS * 2);
      expect(spy).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['rede fora', () => new TypeError('Failed to fetch')],
    ['503 (réplica desligando)', () => new Response(null, { status: 503 })],
    ['429 (muitas conexões)', () => new Response(null, { status: 429 })],
  ])('a primeira conexão falha por um erro passageiro (%s): tenta de novo', async (_, falha) => {
    const { spy } = fetchFalso(falha());
    const { result } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
    await flush();
    expect(result.current).toBe('reconectando');
    await avancar(RECONEXAO_BASE_MS * 2);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
  });

  it('valeTentarDeNovo separa erro passageiro de endpoint ausente', () => {
    expect(valeTentarDeNovo(new TypeError('x'))).toBe(true);
    expect(valeTentarDeNovo(new ApiError('x', 503))).toBe(true);
    expect(valeTentarDeNovo(new ApiError('x', 501))).toBe(false);
    expect(valeTentarDeNovo(new ApiError('x', 404))).toBe(false);
  });

  it('desmontar durante a espera da reconexão cancela a próxima tentativa', async () => {
    const sse = fluxoSse();
    const { spy } = fetchFalso(sse.response);
    const { result, unmount } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
    await flush();
    expect(result.current).toBe('ao-vivo');
    await act(async () => {
      sse.fechar();
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(result.current).toBe('reconectando');
    unmount();
    await vi.advanceTimersByTimeAsync(RECONEXAO_MAX_MS);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('desmontar com a conexão pendente não muda nada depois', async () => {
    const { spy, sinais } = fetchFalso();
    const { unmount } = renderHook(() => usePedidoAoVivo('ped-1', true, () => undefined));
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    expect(sinais[0]!.aborted).toBe(true);
  });
});
