import type { StatusComponent } from '../api/status';
import { avaliarAlertas } from '../utils/metricas';

/**
 * Alertas que o frontend consegue avaliar com o próprio /api/status (Dia 10). Não usa role="alert":
 * a lista é recalculada a cada polling e não deve interromper o leitor de tela.
 */
export function AlertasPanel({ components }: { components: readonly StatusComponent[] }) {
  const alertas = avaliarAlertas(components);
  return (
    <section
      className={`card alertas${alertas.length > 0 ? ' alertas--ativos' : ''}`}
      aria-labelledby="alertas-title"
    >
      <h3 id="alertas-title">Alertas</h3>
      {alertas.length === 0 ? (
        <p className="alertas__vazio">Nenhum alerta</p>
      ) : (
        <ul className="alertas__lista" aria-label="Alertas ativos">
          {alertas.map((a) => (
            <li key={`${a.componente}-${a.regra}`}>
              <strong>{a.componente}</strong>: {a.mensagem}
            </li>
          ))}
        </ul>
      )}
      <p className="alertas__nota">
        Regras avaliadas aqui: p99 acima de 3 s, erros 5xx acima de 1%, atraso do outbox acima de 60
        s e componente fora do ar. Os alertas completos, com histórico, ficam no Prometheus e no
        Grafana (perfil <code>observabilidade</code> do Compose:{' '}
        <code>docker compose --profile observabilidade up -d</code>).
      </p>
    </section>
  );
}
