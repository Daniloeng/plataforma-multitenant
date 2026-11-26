import { useState } from 'react';
import {
  LIMITE_POR_PLANO,
  PAPEL_LABEL,
  rajada,
  tamanhoDaRajada,
  testarLimite,
  type ResultadoRajada,
} from '../api/me';
import { useAuth } from '../auth/context';
import { LoginPrompt } from '../components/auth/LoginPrompt';
import { NIVEL_ISOLAMENTO_LABEL, PLANO_LABEL } from '../utils/format';

/** Página "Minha conta": o que o gateway sabe do usuário (GET /api/v1/me) e o teste do limite. */
export function AccountPage() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <p className="section muted" role="status">
        Verificando sessão…
      </p>
    );
  }
  if (auth.status === 'anonymous') {
    return (
      <LoginPrompt>
        Entre para ver seus papéis, os tenants a que você tem acesso e o limite de requisições de
        cada plano.
      </LoginPrompt>
    );
  }
  if (!auth.me) {
    return auth.meError ? (
      <div className="section alert" role="alert">
        <strong>Não foi possível carregar seus dados.</strong> {auth.meError}
        <p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void auth.reloadMe()}
          >
            Tentar de novo
          </button>
        </p>
      </div>
    ) : (
      <p className="section muted" role="status">
        Carregando seus dados…
      </p>
    );
  }

  const { me } = auth;
  return (
    <>
      <section className="section" aria-labelledby="conta-usuario">
        <h2 id="conta-usuario">Usuário</h2>
        <dl className="card summary account">
          <div>
            <dt className="summary__label">Nome</dt>
            <dd>{me.nome ?? '—'}</dd>
          </div>
          <div>
            <dt className="summary__label">Usuário</dt>
            <dd>
              <code>{me.usuario}</code>
            </dd>
          </div>
          <div>
            <dt className="summary__label">Papéis</dt>
            <dd className="user__roles">
              {me.papeis.length === 0 ? '—' : null}
              {me.papeis.map((p) => (
                <span key={p} className="pill pill--papel">
                  {PAPEL_LABEL[p]} <code>{p}</code>
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt className="summary__label">Cliente</dt>
            <dd>{me.clienteId ? <code>{me.clienteId}</code> : '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="section" aria-labelledby="conta-tenants">
        <h2 id="conta-tenants">Meus tenants</h2>
        <p className="section__intro muted">
          Vêm do token (Keycloak) com os dados do cadastro. O gateway limita as requisições por
          tenant conforme o plano; a rajada aceita o dobro do limite.
        </p>
        {me.tenants.length === 0 ? (
          <p className="card empty muted">Nenhum tenant associado ao seu usuário.</p>
        ) : (
          <ul className="grid" aria-label="Tenants do usuário">
            {me.tenants.map((t) => {
              const atual = t.id === auth.tenantId;
              return (
                <li
                  key={t.id}
                  className={`card account-tenant${atual ? ' account-tenant--atual' : ''}`}
                  aria-label={t.id}
                  aria-current={atual ? 'true' : undefined}
                >
                  <div className="component__head">
                    <span className="component__name">{t.nome}</span>
                    <span className={`pill ${t.ativo ? 'pill--up' : 'pill--down'}`}>
                      {t.ativo ? 'Ativo' : 'Suspenso'}
                    </span>
                  </div>
                  <p className="service__day">
                    <code>{t.id}</code> · {NIVEL_ISOLAMENTO_LABEL[t.nivelIsolamento]}
                  </p>
                  <p className="service__text">
                    Plano {PLANO_LABEL[t.plano]}: {LIMITE_POR_PLANO[t.plano]} req/s (rajada{' '}
                    {rajada(t.plano)})
                  </p>
                  {t.ativo && !atual ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => auth.selectTenant(t.id)}
                    >
                      Usar este tenant
                    </button>
                  ) : null}
                  {atual ? <p className="account-tenant__atual">Tenant selecionado</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RateLimitTest />
    </>
  );
}

function RateLimitTest() {
  const auth = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResultadoRajada | null>(null);
  const tenant = auth.selectedTenant;
  const total = tenant ? tamanhoDaRajada(tenant.plano) : 0;

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      setResult(await testarLimite(total));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="section" aria-labelledby="conta-limite">
      <h2 id="conta-limite">Testar limite</h2>
      <div className="card">
        {tenant ? (
          <p className="rate__intro">
            Dispara {total} requisições simultâneas a <code>GET /api/v1/me</code> com{' '}
            <code>X-Tenant-Id: {tenant.id}</code>. O plano {PLANO_LABEL[tenant.plano]} aceita{' '}
            {LIMITE_POR_PLANO[tenant.plano]} req/s com rajada de {rajada(tenant.plano)}: o resto
            volta <strong>429</strong>.
          </p>
        ) : (
          <p className="rate__intro muted">
            Selecione um tenant no cabeçalho: o gateway aplica o limite pelo{' '}
            <code>X-Tenant-Id</code>.
          </p>
        )}
        <button
          type="button"
          className="button"
          onClick={() => void run()}
          disabled={!tenant || running}
        >
          {running ? 'Testando…' : 'Testar limite'}
        </button>
        {result ? (
          <div className="rate__result" role="status" aria-label="Resultado do teste">
            <p className="rate__counts">
              <span className="pill pill--up">{result.ok} × 200</span>
              <span className="pill pill--down">{result.limitadas} × 429</span>
              {result.outras > 0 ? (
                <span className="pill pill--planned">{result.outras} com outro erro</span>
              ) : null}
            </p>
            <p className="muted">
              {result.total} requisições: {result.ok} aceitas e {result.limitadas} barradas pelo
              limite
              {result.retryAfterSeconds !== null
                ? ` (Retry-After: ${result.retryAfterSeconds} s)`
                : ''}
              .
            </p>
            {result.primeiroErro ? <p className="field-error">{result.primeiroErro}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
