import type { StatusComponent } from '../api/status';
import { COMPONENT_STATUS_LABEL, formatLatency } from '../utils/format';

export function ComponentCard({ component }: { component: StatusComponent }) {
  const statusClass = component.status === 'UP' ? 'up' : 'down';
  return (
    <li className={`card component component--${statusClass}`} aria-label={component.name}>
      <div className="component__head">
        <span className="component__name">{component.name}</span>
        <span className={`pill pill--${statusClass}`}>
          <span className="dot" aria-hidden="true" />
          {COMPONENT_STATUS_LABEL[component.status] ?? component.status}
        </span>
      </div>
      <dl className="component__meta">
        <div>
          <dt>Tipo</dt>
          <dd>{component.type}</dd>
        </div>
        <div>
          <dt>Latência</dt>
          <dd className="num">{formatLatency(component.latencyMs)}</dd>
        </div>
      </dl>
      {component.details ? <p className="component__details">{component.details}</p> : null}
    </li>
  );
}
