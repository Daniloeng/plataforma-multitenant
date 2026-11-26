import { useCallback, useId, useState } from 'react';
import type { TenantDoUsuario } from '../api/me';
import {
  STATUS_PAGAMENTO,
  STATUS_PAGAMENTO_LABEL,
  describePagamentoError,
  formatDinheiro,
  listLancamentos,
  listPagamentos,
  veFinanceiro,
  type Lancamento,
  type PaginaLancamentos,
  type PaginaPagamentos,
  type Pagamento,
  type StatusPagamento,
} from '../api/pagamentos';
import { useAuth } from '../auth/context';
import { LoginPrompt } from '../components/auth/LoginPrompt';
import {
  ContaLabel,
  NaturezaPill,
  StatusPagamentoPill,
} from '../components/pagamentos/PagamentoParts';
import { useCursorList } from '../hooks/useCursorList';
import { ROUTE_HASH, pedidoHash } from '../hooks/useHashRoute';
import { formatDateTime } from '../utils/format';

const COMPOSE_COMMAND = 'docker compose -f infra/docker-compose.yml up -d --build --wait';

/** Página Pagamentos (#/pagamentos): pagamentos e extrato do ledger do tenant, só para o financeiro. */
export function PagamentosPage() {
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
        Pagamentos e o extrato são do financeiro de cada tenant: entre como gestora (Ana) ou como
        administradora.
      </LoginPrompt>
    );
  }
  if (!auth.me) {
    return auth.meError ? (
      <div className="section alert" role="alert">
        <strong>Não foi possível carregar seus dados.</strong> {auth.meError}
      </div>
    ) : (
      <p className="section muted" role="status">
        Carregando seus dados…
      </p>
    );
  }
  if (!veFinanceiro(auth.me.papeis)) {
    return (
      <div className="section card empty">
        <strong>Só o gestor do tenant vê o financeiro.</strong>{' '}
        <span className="muted">
          Pagamentos e o extrato do ledger exigem o papel <code>gestor-tenant</code> (ou{' '}
          <code>plataforma-admin</code>). A situação do pagamento de cada pedido seu aparece na aba{' '}
          <a href={ROUTE_HASH.pedidos}>Pedidos</a>.
        </span>
      </div>
    );
  }
  if (!auth.selectedTenant) {
    return (
      <div className="section card empty">
        <strong>Selecione um tenant no cabeçalho.</strong>{' '}
        <span className="muted">
          Pagamentos e lançamentos vêm do tenant escolhido, enviado no <code>X-Tenant-Id</code>.
        </span>
      </div>
    );
  }
  // key: trocar de tenant monta a página do zero (listas e filtro).
  return <Financeiro key={auth.selectedTenant.id} tenant={auth.selectedTenant} />;
}

function ErroCarga({ titulo, mensagem }: { titulo: string; mensagem: string }) {
  return (
    <div className="alert" role="alert">
      <strong>{titulo}</strong> {mensagem}
      <p>
        Para dados reais, suba o ambiente com <code>{COMPOSE_COMMAND}</code>. Sem Docker, use o modo
        demo: <code>VITE_DEMO=true npm run dev</code>.
      </p>
    </div>
  );
}

function CarregarMais({
  visivel,
  carregando,
  onClick,
  rotulo,
}: {
  visivel: boolean;
  carregando: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  if (!visivel) return null;
  return (
    <div className="load-more">
      <button
        type="button"
        className="button button--secondary"
        onClick={onClick}
        disabled={carregando}
        aria-label={carregando ? undefined : rotulo}
      >
        {carregando ? 'Carregando…' : 'Carregar mais'}
      </button>
    </div>
  );
}

function Financeiro({ tenant }: { tenant: TenantDoUsuario }) {
  const uid = useId();
  const [status, setStatus] = useState<StatusPagamento | ''>('');

  const carregarPagamentos = useCallback(
    (cursor: string | null, signal?: AbortSignal) =>
      listPagamentos({ cursor, status: status || undefined, signal }),
    // tenant.id: o apiFetch lê o tenant da sessão; a dependência faz a troca recarregar.
    [tenant.id, status],
  );
  const carregarExtrato = useCallback(
    (cursor: string | null, signal?: AbortSignal) => listLancamentos({ cursor, signal }),
    [tenant.id],
  );
  const pagamentos = useCursorList<Pagamento, PaginaPagamentos>(
    carregarPagamentos,
    describePagamentoError,
    'Não foi possível carregar mais pagamentos',
  );
  const extrato = useCursorList<Lancamento, PaginaLancamentos>(
    carregarExtrato,
    describePagamentoError,
    'Não foi possível carregar mais lançamentos',
  );
  const saldo = extrato.lastPage?.saldo ?? null;
  const atualizando = pagamentos.loading || extrato.loading;

  return (
    <>
      <section className="section card financeiro-resumo" aria-label="Resumo financeiro">
        <div>
          <p className="summary__label">Tenant atual</p>
          <p className="catalogo-tenant__nome">
            {tenant.nome} <code>{tenant.id}</code>
          </p>
        </div>
        <dl className="financeiro-saldo">
          <dt className="summary__label">Saldo (receita líquida)</dt>
          <dd className="financeiro-saldo__valor num" data-testid="saldo">
            {saldo ? formatDinheiro(saldo) : extrato.error ? '—' : '…'}
          </dd>
          <dd className="muted financeiro-saldo__ajuda">
            O que o tenant recebeu pelos pedidos pagos menos o que devolveu em estornos.
          </dd>
        </dl>
        <p className="financeiro-resumo__acoes">
          <button
            type="button"
            className="button button--secondary"
            disabled={atualizando}
            onClick={() => {
              void pagamentos.reload();
              void extrato.reload();
            }}
          >
            {atualizando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </p>
      </section>

      <section className="section" aria-labelledby="pagamentos-title">
        <div className="section__head">
          <h2 id="pagamentos-title">Pagamentos</h2>
        </div>
        <p className="muted section__intro">
          Cada pedido é cobrado uma vez, logo depois de criado, no gateway de pagamento simulado:
          aprovado confirma o pedido; recusado cancela o pedido; pedido pago e depois cancelado é
          estornado.
        </p>
        <div className="filters produtos__filtros" role="search" aria-label="Filtrar pagamentos">
          <div className="field-group">
            <label htmlFor={`${uid}-status`}>Status do pagamento</label>
            <select
              id={`${uid}-status`}
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusPagamento | '')}
            >
              <option value="">Todos</option>
              {STATUS_PAGAMENTO.map((s) => (
                <option key={s} value={s}>
                  {STATUS_PAGAMENTO_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {pagamentos.error ? (
          <ErroCarga
            titulo="Não foi possível carregar os pagamentos."
            mensagem={pagamentos.error}
          />
        ) : null}
        {pagamentos.actionError ? (
          <div className="alert" role="alert">
            {pagamentos.actionError}
          </div>
        ) : null}
        {pagamentos.loading && pagamentos.items.length === 0 && !pagamentos.error ? (
          <p className="muted" role="status">
            Carregando pagamentos…
          </p>
        ) : null}
        {!pagamentos.loading && !pagamentos.error && pagamentos.items.length === 0 ? (
          <p className="card muted empty">
            {status
              ? `Nenhum pagamento ${STATUS_PAGAMENTO_LABEL[status].toLowerCase()}.`
              : 'Nenhum pagamento ainda.'}
          </p>
        ) : null}

        {pagamentos.items.length > 0 ? (
          <div className="card table-wrap">
            <table className="tenants pagamentos">
              <caption className="sr-only">Pagamentos do tenant</caption>
              <thead>
                <tr>
                  <th scope="col">Pagamento</th>
                  <th scope="col">Data</th>
                  <th scope="col">Pedido</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Status</th>
                  <th scope="col">Motivo da recusa</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.items.map((p) => (
                  <tr key={p.id} aria-label={p.id}>
                    <th scope="row" data-label="Pagamento">
                      <code>{p.id}</code>
                    </th>
                    <td data-label="Data">
                      <time dateTime={p.criadoEm}>{formatDateTime(p.criadoEm)}</time>
                    </td>
                    <td data-label="Pedido">
                      <a href={pedidoHash(p.pedidoId)}>
                        <code>{p.pedidoId}</code>
                      </a>
                    </td>
                    <td data-label="Cliente">{p.clienteId ? <code>{p.clienteId}</code> : '—'}</td>
                    <td data-label="Valor" className="produtos__preco">
                      <span className="num">{formatDinheiro(p.valor)}</span>
                    </td>
                    <td data-label="Status">
                      <StatusPagamentoPill status={p.status} />
                    </td>
                    <td data-label="Motivo da recusa" className="tenants__nome pagamentos__motivo">
                      {p.motivoRecusa ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <CarregarMais
          visivel={Boolean(pagamentos.nextCursor) && pagamentos.items.length > 0}
          carregando={pagamentos.loadingMore}
          onClick={() => void pagamentos.loadMore()}
          rotulo="Carregar mais pagamentos"
        />
      </section>

      <section className="section" aria-labelledby="extrato-title">
        <div className="section__head">
          <h2 id="extrato-title">Extrato</h2>
        </div>
        <div className="card extrato__legenda" aria-label="Como ler o extrato">
          <p>
            <strong>Partidas dobradas:</strong> todo movimento aparece em duas linhas de mesmo
            valor, um <em>débito</em> numa conta e um <em>crédito</em> em outra, e por isso o
            extrato sempre fecha. Os lançamentos nunca mudam: uma devolução é um movimento novo.
          </p>
          <ul>
            <li>
              <strong>Pagamento aprovado:</strong> débito em Caixa no gateway (o dinheiro entrou) e
              crédito em Receita do tenant (a venda).
            </li>
            <li>
              <strong>Estorno:</strong> débito em Estornos (a devolução) e crédito em Caixa no
              gateway (o dinheiro saiu).
            </li>
            <li>
              <strong>Saldo:</strong> créditos em Receita do tenant menos débitos em Estornos.
            </li>
          </ul>
        </div>

        {extrato.error ? (
          <ErroCarga titulo="Não foi possível carregar o extrato." mensagem={extrato.error} />
        ) : null}
        {extrato.actionError ? (
          <div className="alert" role="alert">
            {extrato.actionError}
          </div>
        ) : null}
        {extrato.loading && extrato.items.length === 0 && !extrato.error ? (
          <p className="muted" role="status">
            Carregando extrato…
          </p>
        ) : null}
        {!extrato.loading && !extrato.error && extrato.items.length === 0 ? (
          <p className="card muted empty">Nenhum lançamento ainda.</p>
        ) : null}

        {extrato.items.length > 0 ? (
          <div className="card table-wrap">
            <table className="tenants extrato">
              <caption className="sr-only">Lançamentos do ledger</caption>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Conta</th>
                  <th scope="col">Natureza</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Pedido</th>
                </tr>
              </thead>
              <tbody>
                {extrato.items.map((l) => (
                  <tr key={l.id} aria-label={l.id}>
                    <th scope="row" data-label="Data">
                      <time dateTime={l.ocorridoEm}>{formatDateTime(l.ocorridoEm)}</time>
                    </th>
                    <td data-label="Conta" className="tenants__nome">
                      <ContaLabel conta={l.conta} />
                    </td>
                    <td data-label="Natureza">
                      <NaturezaPill natureza={l.natureza} />
                    </td>
                    <td data-label="Valor" className="produtos__preco">
                      <span className="num">{formatDinheiro(l.valor)}</span>
                    </td>
                    <td data-label="Pedido">
                      {l.pedidoId ? (
                        <a href={pedidoHash(l.pedidoId)}>
                          <code>{l.pedidoId}</code>
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <CarregarMais
          visivel={Boolean(extrato.nextCursor) && extrato.items.length > 0}
          carregando={extrato.loadingMore}
          onClick={() => void extrato.loadMore()}
          rotulo="Carregar mais lançamentos"
        />
      </section>
    </>
  );
}
