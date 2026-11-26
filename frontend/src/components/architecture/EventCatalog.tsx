import { useState } from 'react';
import {
  filterByService,
  listServices,
  roleOf,
  type EventDefinition,
  type EventField,
} from '../../architecture/catalog';

function FieldList({ fields, label }: { fields: readonly EventField[]; label: string }) {
  return (
    <ul className="fields" aria-label={label}>
      {fields.map((f) => (
        <li key={f.name} className="field">
          <code className="field__name">{f.name}</code>{' '}
          <code className="field__type">{f.type}</code>
          {f.defaultValue !== undefined ? (
            <span className="field__default muted"> padrão: {f.defaultValue}</span>
          ) : null}
          {f.doc ? <p className="field__doc muted">{f.doc}</p> : null}
          {f.children ? <FieldList fields={f.children} label={`Campos de ${f.name}`} /> : null}
        </li>
      ))}
    </ul>
  );
}

function EventCard({ event, service }: { event: EventDefinition; service: string }) {
  const role = service === 'todos' ? undefined : roleOf(event, service);
  return (
    <li className="card event" aria-label={event.event}>
      <div className="component__head">
        <code className="event__name">{event.event}</code>
        {role ? <span className={`pill pill--${role}`}>{role}</span> : null}
      </div>
      <p className="service__text">{event.doc}</p>
      <dl className="event__meta">
        <div>
          <dt>Produtor</dt>
          <dd>{event.producer}</dd>
        </div>
        <div>
          <dt>Consumidores</dt>
          <dd>{event.consumers.length > 0 ? event.consumers.join(', ') : 'nenhum ainda'}</dd>
        </div>
        <div className="event__wide">
          <dt>Tópico</dt>
          <dd>
            <code>{event.topic}</code>
          </dd>
        </div>
        <div className="event__wide">
          <dt>Schema</dt>
          <dd>
            <code>{event.name}</code>
          </dd>
        </div>
      </dl>
      <h4 className="event__subtitle">Campos</h4>
      {event.fields.length > 0 ? (
        <FieldList fields={event.fields} label={`Campos de ${event.event}`} />
      ) : (
        <p className="muted">Só metadados.</p>
      )}
      {event.metadata.length > 0 ? (
        <details className="event__metadata">
          <summary>Metadados ({event.metadata.length})</summary>
          <FieldList fields={event.metadata} label={`Metadados de ${event.event}`} />
        </details>
      ) : null}
    </li>
  );
}

export function EventCatalog({ events }: { events: readonly EventDefinition[] }) {
  const [service, setService] = useState('todos');
  const visible = filterByService(events, service);
  const options = ['todos', ...listServices(events)];

  return (
    <section className="section" aria-labelledby="catalog-title">
      <h2 id="catalog-title">Catálogo de eventos</h2>
      <p className="muted section__intro">
        Lido dos schemas Avro em <code>libs/contracts</code>. Todo evento carrega os metadados{' '}
        <code>eventId</code>, <code>tenantId</code>, <code>occurredAt</code> e{' '}
        <code>traceparent</code>.
      </p>
      {events.length === 0 ? (
        <p className="muted">Nenhum evento encontrado.</p>
      ) : (
        <>
          <div className="filters" role="group" aria-label="Filtrar por serviço">
            {options.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={service === s}
                onClick={() => setService(s)}
              >
                {s === 'todos' ? 'Todos' : s}
              </button>
            ))}
          </div>
          <p className="muted num" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'evento' : 'eventos'}
            {service === 'todos' ? '' : ` publicados ou consumidos por ${service}`}
          </p>
          {visible.length === 0 ? (
            <p className="muted">Nenhum evento encontrado para {service}.</p>
          ) : (
            <ul className="events" aria-label="Eventos">
              {visible.map((e) => (
                <EventCard key={e.file} event={e} service={service} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
