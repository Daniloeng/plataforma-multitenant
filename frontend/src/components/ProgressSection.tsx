import { CURRENT_DAY, REPOSITORY_URL, TOTAL_DAYS } from '../data/roadmap';

interface Props {
  current?: number;
  total?: number;
}

export function ProgressSection({ current = CURRENT_DAY, total = TOTAL_DAYS }: Props) {
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0;
  return (
    <section className="section" aria-labelledby="progress-title">
      <h2 id="progress-title">Progresso</h2>
      <div className="card">
        <p className="progress__label">
          <span>
            Dia {current} de {total}
          </span>
          <span className="num muted">{percent}%</span>
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-label="Progresso do estudo"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={current}
        >
          <div className="progress__bar" style={{ width: `${percent}%` }} />
        </div>
        <p>
          Acompanhe o código no{' '}
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            repositório no GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}
