import { listServices, roleOf, type EventDefinition } from '../../architecture/catalog';

/** Matriz produtor × consumidor: eventos nas linhas (legível em 375 px), serviços nas colunas. */
export function EventMatrix({ events }: { events: readonly EventDefinition[] }) {
  const services = listServices(events);
  return (
    <section className="section" aria-labelledby="matrix-title">
      <h2 id="matrix-title">Quem publica e quem consome</h2>
      {events.length === 0 ? (
        <p className="muted">Nenhum evento encontrado.</p>
      ) : (
        <div
          className="table-scroll card"
          role="region"
          aria-label="Matriz produtor × consumidor"
          tabIndex={0}
        >
          <table className="matrix">
            <caption className="sr-only">
              Eventos nas linhas e serviços nas colunas, marcando publica ou consome
            </caption>
            <thead>
              <tr>
                <th scope="col">Evento</th>
                {services.map((s) => (
                  <th key={s} scope="col">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.file}>
                  <th scope="row">
                    <code>{e.event}</code>
                  </th>
                  {services.map((s) => {
                    const role = roleOf(e, s);
                    return (
                      <td key={s} data-role={role ?? 'nenhum'}>
                        {role ? (
                          <span className={`pill pill--${role}`}>{role}</span>
                        ) : (
                          <span className="muted" aria-label="nenhum">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
