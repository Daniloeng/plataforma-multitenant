import { ROADMAP, type RoadmapService } from '../data/roadmap';

export function RoadmapSection({ services = ROADMAP }: { services?: readonly RoadmapService[] }) {
  return (
    <section className="section" aria-labelledby="roadmap-title">
      <h2 id="roadmap-title">Microsserviços</h2>
      <ul className="grid">
        {services.map((s) => (
          <li key={s.name} className="card service" aria-label={s.name}>
            <div className="component__head">
              <span className="component__name">{s.name}</span>
              <span className={`pill ${s.situation === 'Ativo' ? 'pill--up' : 'pill--planned'}`}>
                {s.situation}
              </span>
            </div>
            <p className="service__day">Dia {s.day}</p>
            <p className="service__text">{s.responsibility}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
