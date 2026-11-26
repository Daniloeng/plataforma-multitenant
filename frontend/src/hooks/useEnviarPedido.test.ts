import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { PROBLEMA_PRODUTO_INDISPONIVEL } from '../api/pedidos';
import { pedidosSnapshot } from '../mocks/pedidos';
import { server } from '../mocks/server';
import { signInAs } from '../test/session';
import { useEnviarPedido } from './useEnviarPedido';

const FARMA = 'farmaceutica-boa-saude';
const DIP = 'prd-farmaceutica-boa-saude-001';
const SOR = 'prd-farmaceutica-boa-saude-003';

/** Registra a Idempotency-Key de cada POST que chegou ao mock. */
function espiaChaves(): string[] {
  const chaves: string[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST') chaves.push(request.headers.get('Idempotency-Key') ?? '');
  });
  return chaves;
}

function gerador() {
  let n = 0;
  return vi.fn(() => `chave-gerada-${++n}`);
}

beforeEach(() => signInAs('bruno', FARMA));
afterEach(() => server.events.removeAllListeners());

describe('useEnviarPedido', () => {
  it('reutiliza a mesma chave depois de erro de rede; o servidor cria o pedido uma vez só', async () => {
    const chaves = espiaChaves();
    const gerar = gerador();
    // A 1ª tentativa chega ao servidor (cria o pedido), mas a resposta se perde na rede.
    server.use(
      http.post(
        '*/api/v1/pedidos',
        async ({ request }) => {
          const real = await fetch(request.clone());
          expect(real.status).toBe(201);
          return HttpResponse.error();
        },
        { once: true },
      ),
    );
    // O fetch interno passa de novo pelo MSW: o handler `once` já foi usado e ele cai no padrão.
    const { result } = renderHook(() => useEnviarPedido(gerar));
    const itens = [{ produtoId: DIP, quantidade: 2 }];
    const antes = pedidosSnapshot(FARMA).length;

    let primeiro: Awaited<ReturnType<typeof result.current.enviar>> = null;
    await act(async () => {
      primeiro = await result.current.enviar(itens);
    });
    expect(primeiro).toBeNull();
    expect(result.current.erro).toEqual({
      message: 'Não foi possível conectar ao pedidos-service.',
      problemType: null,
      rede: true,
      produtos: null,
    });
    expect(pedidosSnapshot(FARMA)).toHaveLength(antes + 1);

    let segundo: Awaited<ReturnType<typeof result.current.enviar>> = null;
    await act(async () => {
      segundo = await result.current.enviar(itens);
    });
    expect(segundo).toMatchObject({ replayed: true, pedido: { status: 'PENDENTE' } });
    expect(result.current.erro).toBeNull();
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(new Set(chaves)).toEqual(new Set(['chave-gerada-1']));
    expect(pedidosSnapshot(FARMA)).toHaveLength(antes + 1);

    // Depois do sucesso, o próximo pedido ganha uma chave nova.
    await act(async () => {
      await result.current.enviar(itens);
    });
    expect(gerar).toHaveBeenCalledTimes(2);
    expect(pedidosSnapshot(FARMA)).toHaveLength(antes + 2);
  });

  it('corpo diferente depois de uma falha gera chave nova (evita chave-reutilizada)', async () => {
    const gerar = gerador();
    const { result } = renderHook(() => useEnviarPedido(gerar));
    await act(async () => {
      await result.current.enviar([{ produtoId: 'prd-inexistente', quantidade: 1 }]);
    });
    expect(result.current.erro).toMatchObject({
      problemType: PROBLEMA_PRODUTO_INDISPONIVEL,
      rede: false,
    });
    expect(result.current.erro!.message).toMatch(/prd-inexistente/);

    let criado: Awaited<ReturnType<typeof result.current.enviar>> = null;
    await act(async () => {
      criado = await result.current.enviar([{ produtoId: SOR, quantidade: 1 }]);
    });
    expect(criado).toMatchObject({ replayed: false });
    expect(gerar).toHaveBeenCalledTimes(2);

    act(() => result.current.limparErro());
    expect(result.current.erro).toBeNull();
  });

  it('ignora um segundo envio enquanto o primeiro está em andamento', async () => {
    let release!: () => void;
    const segura = new Promise<void>((r) => (release = r));
    server.use(
      http.post('*/api/v1/pedidos', async () => {
        await segura;
        return HttpResponse.error();
      }),
    );
    const { result } = renderHook(() => useEnviarPedido(gerador()));
    let a!: Promise<unknown>;
    let b: unknown;
    await act(async () => {
      a = result.current.enviar([{ produtoId: DIP, quantidade: 1 }]);
      b = await result.current.enviar([{ produtoId: DIP, quantidade: 1 }]);
    });
    expect(b).toBeNull();
    expect(result.current.enviando).toBe(true);
    await act(async () => {
      release();
      await a;
    });
    expect(result.current.enviando).toBe(false);
  });

  it('usa crypto.randomUUID por padrão', async () => {
    const chaves = espiaChaves();
    const { result } = renderHook(() => useEnviarPedido());
    await act(async () => {
      await result.current.enviar([{ produtoId: DIP, quantidade: 1 }]);
    });
    expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
