import type { UseTenants } from '../../hooks/useTenants';
import { formatDateTime, NIVEL_ISOLAMENTO_LABEL, PLANO_LABEL } from '../../utils/format';

const COMPOSE_COMMAND = 'docker compose -f infra/docker-compose.yml up -d --build --wait';

type Props = Pick<
  UseTenants,
  | 'items'
  | 'nextCursor'
  | 'loading'
  | 'loadingMore'
  | 'error'
  | 'actionError'
  | 'pendingIds'
  | 'reload'
  | 'loadMore'
  | 'setActive'
>;

/** Lista de tenants: tabela no desktop, cartões no celular (via CSS), com paginação por cursor. */
export function TenantList({
  items,
  nextCursor,
  loading,
  loadingMore,
  error,
  actionError,
  pendingIds,
  reload,
  loadMore,
  setActive,
}: Props) {
  return (
    <section className="section" aria-labelledby="tenants-title">
      <div className="section__head">
        <h2 id="tenants-title">Tenants cadastrados</h2>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void reload()}
          disabled={loading}
        >
          {loading && items.length > 0 ? 'Atualizando…' : 'Atualizar lista'}
        </button>
      </div>

      {error ? (
        <div className="alert" role="alert">
          <strong>API inacessível.</strong> {error}
          <p>
            Para dados reais, suba o tenant-service com <code>{COMPOSE_COMMAND}</code> na raiz do
            repositório e rode o frontend com <code>npm run dev</code> (o proxy envia{' '}
            <code>/api/v1/tenants</code> para <code>localhost:8081</code>). Sem Docker, use o modo
            demo: <code>VITE_DEMO=true npm run dev</code>.
          </p>
        </div>
      ) : null}

      {actionError ? (
        <div className="alert" role="alert">
          {actionError}
        </div>
      ) : null}

      {loading && items.length === 0 && !error ? (
        <p className="muted" role="status">
          Carregando tenants…
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="card muted empty">Nenhum tenant cadastrado ainda.</p>
      ) : null}

      {items.length > 0 ? (
        <div className="card table-wrap">
          <table className="tenants">
            <caption className="sr-only">Tenants cadastrados</caption>
            <thead>
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Nome</th>
                <th scope="col">Plano</th>
                <th scope="col">Nível</th>
                <th scope="col">Situação</th>
                <th scope="col">Criado em</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const pending = pendingIds.has(t.id);
                return (
                  <tr key={t.id} aria-label={t.id}>
                    <th scope="row" data-label="Id">
                      <code>{t.id}</code>
                    </th>
                    <td data-label="Nome" className="tenants__nome">
                      {t.nome}
                    </td>
                    <td data-label="Plano">{PLANO_LABEL[t.plano]}</td>
                    <td data-label="Nível">
                      <span className={`pill pill--nivel-${t.nivelIsolamento.toLowerCase()}`}>
                        {NIVEL_ISOLAMENTO_LABEL[t.nivelIsolamento]}
                      </span>
                    </td>
                    <td data-label="Situação">
                      <span className={`pill ${t.ativo ? 'pill--up' : 'pill--down'}`}>
                        <span className="dot" aria-hidden="true" />
                        {t.ativo ? 'Ativo' : 'Suspenso'}
                      </span>
                    </td>
                    <td data-label="Criado em">
                      <time dateTime={t.criadoEm} className="num">
                        {formatDateTime(t.criadoEm)}
                      </time>
                    </td>
                    <td className="tenants__acoes">
                      <button
                        type="button"
                        className="button button--small button--secondary"
                        disabled={pending}
                        aria-label={`${t.ativo ? 'Suspender' : 'Reativar'} ${t.id}`}
                        onClick={() => void setActive(t.id, !t.ativo)}
                      >
                        {pending ? 'Salvando…' : t.ativo ? 'Suspender' : 'Reativar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {nextCursor && items.length > 0 ? (
        <div className="load-more">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
