import { descreveLocal } from '../../api/isolamento';
import { useIsolamentoPedidos } from '../../hooks/useIsolamentoPedidos';
import { formatDateTime } from '../../utils/format';

/**
 * Onde o pedidos-service guarda os pedidos do tenant (GET /api/v1/isolamento/pedidos), para gestor
 * e admin: database compartilhada `pedidos` (Pool) ou dedicada `pedidos_t_<tenant>` (Bridge e
 * Silo). Durante a migração de nível mostra "Migrando dados…" e consulta de novo a cada 1 s.
 */
export function IsolamentoPedidos({
  tenantId,
  onSituacao,
}: {
  tenantId: string;
  /** Chamado a cada resposta: true enquanto os dados migram. */
  onSituacao?: (migrando: boolean) => void;
}) {
  const { isolamento, migrando, error, loading } = useIsolamentoPedidos(tenantId, onSituacao);

  if (migrando) {
    return (
      <p
        className="isolamento isolamento--migrando"
        role="status"
        aria-label="Isolamento dos pedidos"
      >
        <span className="isolamento__spinner" aria-hidden="true" />
        Migrando dados…{' '}
        <span className="muted">
          {isolamento
            ? `os pedidos estão indo para a database ${isolamento.database}.`
            : 'os pedidos estão mudando de nível de isolamento.'}
        </span>
      </p>
    );
  }
  if (error) {
    return (
      <p className="isolamento muted" role="status" aria-label="Isolamento dos pedidos">
        Não foi possível saber onde ficam os pedidos: {error}
      </p>
    );
  }
  if (loading || !isolamento) {
    return (
      <p className="isolamento muted" role="status" aria-label="Isolamento dos pedidos">
        Consultando o isolamento dos pedidos…
      </p>
    );
  }
  const local = descreveLocal(isolamento);
  return (
    <p className="isolamento" role="status" aria-label="Isolamento dos pedidos">
      <span>
        {local.antes} <code>{local.database}</code> {local.depois}
      </span>
      {isolamento.migradoEm ? (
        <span className="muted">
          migrado em{' '}
          <time dateTime={isolamento.migradoEm}>{formatDateTime(isolamento.migradoEm)}</time>
        </span>
      ) : null}
    </p>
  );
}
