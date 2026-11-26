import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import { acompanharPedido, pedidoFinal, type Pedido } from '../api/pedidos';

/**
 * Situação da assinatura da linha do tempo:
 * - `desligado`: nada a acompanhar (o pedido ainda não carregou);
 * - `conectando`: primeira conexão em andamento;
 * - `ao-vivo`: fluxo SSE aberto;
 * - `reconectando`: o fluxo caiu ou terminou e a próxima tentativa espera o backoff;
 * - `indisponivel`: a primeira conexão nem abriu (404 de um backend sem SSE, rede fora): a tela
 *   volta ao poll.
 */
export type ModoAoVivo = 'desligado' | 'conectando' | 'ao-vivo' | 'reconectando' | 'indisponivel';

/** Backoff da reconexão: 1 s, 2 s, 4 s… até 30 s. */
export const RECONEXAO_BASE_MS = 1000;
export const RECONEXAO_MAX_MS = 30_000;
/** Pedido em estado final: nada urgente a esperar, reconecta sem pressa. */
export const RECONEXAO_FINAL_MS = 10_000;

/** Espera antes da tentativa `tentativa` (0 = a primeira depois de uma queda). */
export function atrasoReconexao(tentativa: number, final = false): number {
  if (final) return RECONEXAO_FINAL_MS;
  return Math.min(RECONEXAO_BASE_MS * 2 ** Math.max(0, tentativa), RECONEXAO_MAX_MS);
}

/** setTimeout que o `signal` cancela (resolve na hora, sem erro). */
function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const acordar = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', acordar);
      resolve();
    };
    const timer = setTimeout(acordar, ms);
    signal.addEventListener('abort', acordar);
  });
}

/**
 * Assina a linha do tempo do pedido (GET /api/v1/pedidos/{id}/linha-do-tempo, SSE) enquanto
 * `ativo` e a tela estiver montada: cada evento chama `onPedido`. Se o fluxo cair ou terminar (o
 * servidor encerra depois de 5 min), reconecta com backoff — inclusive com o pedido em estado
 * final, porque um CONFIRMADO ainda pode ser cancelado e estornado. Se a primeira conexão nem abrir,
 * desiste e devolve `indisponivel` (a tela volta ao poll). Desmontar ou trocar de pedido aborta.
 */
export function usePedidoAoVivo(
  id: string,
  ativo: boolean,
  onPedido: (pedido: Pedido) => void,
): ModoAoVivo {
  const [modo, setModo] = useState<ModoAoVivo>('conectando');
  const onPedidoRef = useRef(onPedido);
  useEffect(() => {
    onPedidoRef.current = onPedido;
  });

  useEffect(() => {
    if (!ativo) return;
    const controller = new AbortController();
    const { signal } = controller;
    setModo('conectando');

    void (async () => {
      let abriu = false;
      let tentativa = 0;
      // Objeto (e não `let`): o TypeScript não acompanha atribuições feitas dentro dos callbacks.
      const visto: { ultimo: Pedido | null } = { ultimo: null };
      while (!signal.aborted) {
        try {
          await acompanharPedido(id, {
            signal,
            onAberto: () => {
              if (signal.aborted) return;
              abriu = true;
              tentativa = 0;
              setModo('ao-vivo');
            },
            onPedido: (pedido) => {
              if (signal.aborted) return;
              visto.ultimo = pedido;
              onPedidoRef.current(pedido);
            },
          });
        } catch (erro) {
          if (signal.aborted) return;
          // Antes de abrir, desiste (e a tela volta ao poll) só quando o SSE não existe ou não é
          // permitido; 429, 503 (réplica subindo ou desligando) e falha de rede tentam de novo.
          if (!abriu && !valeTentarDeNovo(erro)) {
            setModo('indisponivel');
            return;
          }
        }
        if (signal.aborted) return;
        setModo('reconectando');
        const final = visto.ultimo !== null && pedidoFinal(visto.ultimo);
        await esperar(atrasoReconexao(tentativa, final), signal);
        tentativa += 1;
      }
    })();

    return () => controller.abort();
  }, [id, ativo]);

  return ativo ? modo : 'desligado';
}

/** Erro passageiro: rede, limite (429) ou servidor indisponível (5xx, menos 501). */
export function valeTentarDeNovo(erro: unknown): boolean {
  if (!(erro instanceof ApiError) || erro.httpStatus === null) return true;
  const status = erro.httpStatus;
  return status === 429 || (status >= 500 && status !== 501);
}
