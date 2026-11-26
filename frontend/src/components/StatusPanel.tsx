import type { UsePlatformStatus } from '../hooks/usePlatformStatus';
import { formatDateTime } from '../utils/format';
import { AlertasPanel } from './AlertasPanel';
import { ComponentCard } from './ComponentCard';
import { StatusBadge } from './StatusBadge';

const DEMO_URL = 'https://daniloeng.github.io/plataforma-multitenant/';

export function StatusPanel({ data, error, loading, refresh }: UsePlatformStatus) {
  return (
    <section className="section" aria-labelledby="status-title">
      <div className="section__head">
        <h2 id="status-title">Componentes</h2>
        <button type="button" className="button" onClick={() => void refresh()} disabled={loading}>
          {loading && data ? 'Atualizando…' : 'Atualizar agora'}
        </button>
      </div>

      {error ? (
        <div className="alert" role="alert">
          <strong>API inacessível.</strong> {error}
          <p>
            Para ver dados reais, suba o ambiente com <code>docker compose up -d</code> na raiz do
            repositório e rode o frontend com <code>npm run dev</code>. Sem Docker, abra o modo demo
            (<code>VITE_DEMO=true npm run dev</code>) ou a <a href={DEMO_URL}>versão publicada</a>.
          </p>
          {data ? <p className="muted">Exibindo os últimos dados recebidos.</p> : null}
        </div>
      ) : null}

      {!data && loading ? (
        <p className="muted" role="status">
          Carregando status da plataforma…
        </p>
      ) : null}

      {data ? (
        <>
          <div className="summary card">
            <div>
              <span className="summary__label">Situação geral</span>
              <StatusBadge status={data.status} />
            </div>
            <div>
              <span className="summary__label">Última verificação (horário de Brasília)</span>
              <time dateTime={data.checkedAt} className="num">
                {formatDateTime(data.checkedAt)}
              </time>
            </div>
            <div>
              <span className="summary__label">Versão</span>
              <code>{data.version}</code>
            </div>
          </div>
          <AlertasPanel components={data.components} />
          <ul className="grid" aria-label="Componentes verificados">
            {data.components.map((c, i) => (
              <ComponentCard key={`${i}-${c.name}`} component={c} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
