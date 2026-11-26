import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import {
  createPedido,
  describePedidoError,
  isNetworkError,
  novaIdempotencyKey,
  type NovoItemPedido,
  type PedidoCriado,
} from '../api/pedidos';

export interface ErroEnvio {
  message: string;
  /** `type` do Problem Details (ex.: …/produto-indisponivel), ou null em falha de rede. */
  problemType: string | null;
  /** A falha foi de rede: repetir reaproveita a mesma Idempotency-Key. */
  rede: boolean;
}

export interface UseEnviarPedido {
  enviando: boolean;
  erro: ErroEnvio | null;
  /** Envia o pedido; devolve o resultado ou null se falhou (o erro fica em `erro`). */
  enviar: (itens: readonly NovoItemPedido[]) => Promise<PedidoCriado | null>;
  limparErro: () => void;
}

/** Corpo canônico, para saber se a nova tentativa é a repetição da anterior. */
function corpoDe(itens: readonly NovoItemPedido[]): string {
  return JSON.stringify(itens.map(({ produtoId, quantidade }) => [produtoId, quantidade]));
}

/**
 * Envio do pedido com Idempotency-Key. Cada pedido ganha uma chave nova (crypto.randomUUID);
 * repetir o mesmo corpo depois de uma falha reaproveita a chave da tentativa anterior, então um
 * pedido que chegou ao servidor (e só a resposta se perdeu) não é criado duas vezes: o servidor
 * devolve o mesmo pedido (200, Idempotent-Replayed). Corpo diferente = pedido diferente = chave nova.
 */
export function useEnviarPedido(gerarChave: () => string = novaIdempotencyKey): UseEnviarPedido {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroEnvio | null>(null);
  const tentativa = useRef<{ chave: string; corpo: string } | null>(null);
  const emAndamento = useRef(false);

  const enviar = useCallback(
    async (itens: readonly NovoItemPedido[]) => {
      if (emAndamento.current) return null;
      emAndamento.current = true;
      const corpo = corpoDe(itens);
      if (tentativa.current?.corpo !== corpo) {
        tentativa.current = { chave: gerarChave(), corpo };
      }
      setEnviando(true);
      setErro(null);
      try {
        const resultado = await createPedido({ itens: [...itens] }, tentativa.current.chave);
        tentativa.current = null;
        return resultado;
      } catch (err) {
        setErro({
          message: describePedidoError(err),
          problemType: err instanceof ApiError ? err.problemType : null,
          rede: isNetworkError(err),
        });
        return null;
      } finally {
        emAndamento.current = false;
        setEnviando(false);
      }
    },
    [gerarChave],
  );

  const limparErro = useCallback(() => setErro(null), []);

  return { enviando, erro, enviar, limparErro };
}
