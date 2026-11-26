import { descreverMarco, type MarcoPedido, type TipoMarco } from '../../api/pedidos';
import { formatDateTime } from '../../utils/format';

/** Ícone de cada tipo de marco (decorativo: o rótulo diz o que aconteceu). */
const ICONE: Record<TipoMarco, string> = {
  CRIADO: '+',
  PAGO: '✓',
  RECUSADO: '✕',
  CANCELADO: '⊘',
  ESTORNADO: '↺',
};

/**
 * Linha do tempo do pedido: os marcos da saga, do mais antigo ao mais recente, numa lista ordenada
 * com marcador colorido por tipo, rótulo em português, data e hora e o detalhe traduzido.
 */
export function LinhaDoTempo({
  marcos,
  gestor = false,
}: {
  marcos: readonly MarcoPedido[];
  /** Gestor e admin veem o motivo exato da recusa; o comprador, a explicação genérica. */
  gestor?: boolean;
}) {
  return (
    <section className="linha-do-tempo" aria-labelledby="linha-do-tempo-title">
      <h3 id="linha-do-tempo-title" className="linha-do-tempo__titulo">
        Linha do tempo
      </h3>
      {marcos.length === 0 ? (
        <p className="muted">Nenhum marco registrado ainda.</p>
      ) : (
        <ol className="linha-do-tempo__lista">
          {marcos.map((marco, i) => {
            const { rotulo, detalhe } = descreverMarco(marco, { motivoRecusa: gestor });
            return (
              <li
                key={`${i}-${marco.tipo}-${marco.em}`}
                className={`marco marco--${marco.tipo.toLowerCase()}`}
              >
                <span className="marco__icone" aria-hidden="true">
                  {ICONE[marco.tipo]}
                </span>
                <div className="marco__corpo">
                  <span className="marco__rotulo">{rotulo}</span>{' '}
                  <time className="marco__quando muted" dateTime={marco.em}>
                    {formatDateTime(marco.em)}
                  </time>
                  {detalhe ? (
                    <span className="marco__detalhe">
                      {detalhe.tipo === 'pagamento' ? (
                        <>
                          Pagamento <code>{detalhe.id}</code>
                        </>
                      ) : (
                        detalhe.texto
                      )}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
