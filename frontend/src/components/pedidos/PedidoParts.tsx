import { useState } from 'react';
import { ApiError } from '../../api/http';
import {
  PROBLEMA_PEDIDO_JA_CANCELADO,
  STATUS_PEDIDO_LABEL,
  cancelarPedido,
  describePedidoError,
  getPedido,
  type Pedido,
  type StatusPedido,
} from '../../api/pedidos';

const STATUS_CLASS: Record<StatusPedido, string> = {
  PENDENTE: 'pill--pendente',
  CONFIRMADO: 'pill--up',
  CANCELADO: 'pill--down',
};

/** Selo do status do pedido. */
export function StatusPedidoPill({ status }: { status: StatusPedido }) {
  return (
    <span className={`pill ${STATUS_CLASS[status]}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_PEDIDO_LABEL[status]}
    </span>
  );
}

/**
 * "Cancelar" com confirmação na própria tela (sem window.confirm): o primeiro clique pede
 * confirmação; "Sim, cancelar" chama POST /cancelamento.
 */
export function CancelarPedido({
  pedido,
  onCancelado,
}: {
  pedido: Pedido;
  onCancelado: (pedido: Pedido) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (pedido.status === 'CANCELADO') return null;

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      const atualizado = await cancelarPedido(pedido.id).catch((err: unknown) => {
        // Já estava cancelado (outra aba, o gestor, uma repetição): o contrato permite tratar o
        // 409 como sucesso; recarrega o pedido para mostrar o status e o motivo do servidor.
        if (err instanceof ApiError && err.problemType === PROBLEMA_PEDIDO_JA_CANCELADO) {
          return getPedido(pedido.id);
        }
        throw err;
      });
      setConfirmando(false);
      setEnviando(false);
      onCancelado(atualizado);
    } catch (err) {
      setErro(describePedidoError(err));
      setEnviando(false);
    }
  }

  if (!confirmando) {
    return (
      <button
        type="button"
        className="button button--small button--secondary"
        aria-label={`Cancelar pedido ${pedido.id}`}
        onClick={() => setConfirmando(true)}
      >
        Cancelar
      </button>
    );
  }
  return (
    <div className="cancelar" role="group" aria-label={`Confirmar cancelamento de ${pedido.id}`}>
      <span className="cancelar__pergunta">Cancelar este pedido?</span>
      <button
        type="button"
        className="button button--small button--perigo"
        disabled={enviando}
        onClick={() => void confirmar()}
      >
        {enviando ? 'Cancelando…' : 'Sim, cancelar'}
      </button>
      <button
        type="button"
        className="button button--small button--secondary"
        disabled={enviando}
        onClick={() => {
          setConfirmando(false);
          setErro(null);
        }}
      >
        Não
      </button>
      {erro ? (
        <p className="field-error cancelar__erro" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
