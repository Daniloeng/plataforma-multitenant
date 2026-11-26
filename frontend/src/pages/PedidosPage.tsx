import { useCallback, useEffect, useId, useState } from 'react';
import { formatDinheiro } from '../api/catalogo';
import { ApiError } from '../api/http';
import type { TenantDoUsuario } from '../api/me';
import {
  MOTIVO_CANCELAMENTO_LABEL,
  STATUS_PEDIDO,
  STATUS_PEDIDO_LABEL,
  describePedidoError,
  getPedido,
  podeComprar,
  resumoItens,
  subtotal,
  veTodosOsPedidos,
  type Pedido,
  type StatusPedido,
} from '../api/pedidos';
import { useAuth } from '../auth/context';
import { LoginPrompt } from '../components/auth/LoginPrompt';
import { CancelarPedido, StatusPedidoPill } from '../components/pedidos/PedidoParts';
import { ROUTE_HASH, parsePedidoId, pedidoHash, useHash } from '../hooks/useHashRoute';
import { usePedidos } from '../hooks/usePedidos';
import { formatDateTime } from '../utils/format';

const COMPOSE_COMMAND = 'docker compose -f infra/docker-compose.yml up -d --build --wait';

/** Página Pedidos: lista (#/pedidos) e detalhe (#/pedidos/<id>) do pedidos-service. */
export function PedidosPage() {
  const auth = useAuth();
  const hash = useHash();

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
        Pedidos são de cada tenant: entre como comprador para ver os seus pedidos, ou como gestor
        para ver os de todos os clientes.
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
  const comprador = podeComprar(auth.me.papeis, auth.me.clienteId);
  const gestor = veTodosOsPedidos(auth.me.papeis);
  if (!comprador && !gestor) {
    return (
      <div className="section card empty">
        <strong>Pedidos exigem o papel comprador ou gestor-tenant.</strong>
        {auth.me.papeis.includes('comprador') ? (
          <>
            {' '}
            <span className="muted">
              Seu usuário é comprador, mas o token não traz o cliente B2B (claim{' '}
              <code>cliente_id</code>).
            </span>
          </>
        ) : null}
      </div>
    );
  }
  if (!auth.selectedTenant) {
    return (
      <div className="section card empty">
        <strong>Selecione um tenant no cabeçalho.</strong>{' '}
        <span className="muted">
          Os pedidos vêm do tenant escolhido, enviado no <code>X-Tenant-Id</code>.
        </span>
      </div>
    );
  }
  const pedidoId = parsePedidoId(hash);
  // key: trocar de tenant monta a página do zero (lista e filtro).
  return pedidoId ? (
    <DetalhePedido key={`${auth.selectedTenant.id}/${pedidoId}`} id={pedidoId} gestor={gestor} />
  ) : (
    <ListaPedidos
      key={auth.selectedTenant.id}
      tenant={auth.selectedTenant}
      gestor={gestor}
      comprador={comprador}
    />
  );
}

function ListaPedidos({
  tenant,
  gestor,
  comprador,
}: {
  tenant: TenantDoUsuario;
  gestor: boolean;
  comprador: boolean;
}) {
  const uid = useId();
  const [status, setStatus] = useState<StatusPedido | ''>('');
  const pedidos = usePedidos(tenant.id, status || undefined);
  const { items, nextCursor, loading, loadingMore, error, actionError } = pedidos;

  return (
    <>
      <section className="section card catalogo-tenant" aria-label="Tenant atual">
        <div>
          <p className="summary__label">Tenant atual</p>
          <p className="catalogo-tenant__nome">
            {tenant.nome} <code>{tenant.id}</code>
          </p>
          <p className="muted catalogo-tenant__papel">
            {gestor
              ? 'Você vê os pedidos de todos os clientes do tenant e pode cancelar qualquer um.'
              : 'Você vê os pedidos do seu cliente. Para comprar, monte o carrinho na aba Produtos.'}
          </p>
        </div>
        {comprador ? (
          <p className="pedidos__comprar">
            <a className="button button--secondary" href={ROUTE_HASH.produtos}>
              Ir para Produtos
            </a>
          </p>
        ) : null}
      </section>

      <div className="filters produtos__filtros" role="search" aria-label="Filtrar pedidos">
        <div className="field-group">
          <label htmlFor={`${uid}-status`}>Status</label>
          <select
            id={`${uid}-status`}
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusPedido | '')}
          >
            <option value="">Todos</option>
            {STATUS_PEDIDO.map((s) => (
              <option key={s} value={s}>
                {STATUS_PEDIDO_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="section" aria-labelledby="pedidos-title">
        <div className="section__head">
          <h2 id="pedidos-title">Pedidos</h2>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void pedidos.reload()}
            disabled={loading}
          >
            {loading && items.length > 0 ? 'Atualizando…' : 'Atualizar lista'}
          </button>
        </div>

        {error ? (
          <div className="alert" role="alert">
            <strong>Não foi possível carregar os pedidos.</strong> {error}
            <p>
              Para dados reais, suba o ambiente com <code>{COMPOSE_COMMAND}</code>. Sem Docker, use
              o modo demo: <code>VITE_DEMO=true npm run dev</code>.
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
            Carregando pedidos…
          </p>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="card muted empty">
            {status
              ? `Nenhum pedido ${STATUS_PEDIDO_LABEL[status].toLowerCase()}.`
              : 'Nenhum pedido ainda.'}
          </p>
        ) : null}

        {items.length > 0 ? (
          <div className="card table-wrap">
            <table className="tenants pedidos">
              <caption className="sr-only">Pedidos do tenant</caption>
              <thead>
                <tr>
                  <th scope="col">Pedido</th>
                  <th scope="col">Data</th>
                  {gestor ? <th scope="col">Cliente</th> : null}
                  <th scope="col">Itens</th>
                  <th scope="col">Total</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} aria-label={p.id}>
                    <th scope="row" data-label="Pedido">
                      <a href={pedidoHash(p.id)}>
                        <code>{p.id}</code>
                      </a>
                    </th>
                    <td data-label="Data">
                      <time dateTime={p.criadoEm}>{formatDateTime(p.criadoEm)}</time>
                    </td>
                    {gestor ? (
                      <td data-label="Cliente">
                        <code>{p.clienteId}</code>
                      </td>
                    ) : null}
                    <td data-label="Itens" className="tenants__nome pedidos__itens">
                      {resumoItens(p.itens)}
                    </td>
                    <td data-label="Total" className="produtos__preco">
                      <span className="num">{formatDinheiro(p.total)}</span>
                    </td>
                    <td data-label="Status">
                      <StatusPedidoPill status={p.status} />
                    </td>
                    <td className="tenants__acoes pedidos__acoes">
                      <a
                        className="button button--small button--secondary"
                        href={pedidoHash(p.id)}
                        aria-label={`Ver pedido ${p.id}`}
                      >
                        Detalhes
                      </a>
                      <CancelarPedido pedido={p} onCancelado={pedidos.replace} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {nextCursor && items.length > 0 ? (
          <div className="load-more">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void pedidos.loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Carregando…' : 'Carregar mais'}
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}

type Detalhe =
  | { estado: 'carregando' }
  | { estado: 'ok'; pedido: Pedido }
  | { estado: 'erro'; mensagem: string; naoEncontrado: boolean };

function DetalhePedido({ id, gestor }: { id: string; gestor: boolean }) {
  const [detalhe, setDetalhe] = useState<Detalhe>({ estado: 'carregando' });

  const carregar = useCallback(
    async (signal?: AbortSignal) => {
      setDetalhe({ estado: 'carregando' });
      try {
        const pedido = await getPedido(id, signal);
        if (!signal?.aborted) setDetalhe({ estado: 'ok', pedido });
      } catch (err) {
        if (signal?.aborted) return;
        setDetalhe({
          estado: 'erro',
          mensagem: describePedidoError(err),
          naoEncontrado: err instanceof ApiError && err.httpStatus === 404,
        });
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar]);

  return (
    <section className="section" aria-label="Detalhe do pedido">
      <p className="pedido__voltar">
        <a href={ROUTE_HASH.pedidos}>← Voltar aos pedidos</a>
      </p>
      {detalhe.estado === 'carregando' ? (
        <p className="muted" role="status">
          Carregando pedido…
        </p>
      ) : null}
      {detalhe.estado === 'erro' ? (
        <div className="alert" role="alert">
          <strong>
            {detalhe.naoEncontrado
              ? 'Pedido não encontrado.'
              : 'Não foi possível carregar o pedido.'}
          </strong>{' '}
          {detalhe.mensagem}
          {detalhe.naoEncontrado ? null : (
            <p>
              <button
                type="button"
                className="button button--small button--secondary"
                onClick={() => void carregar()}
              >
                Tentar de novo
              </button>
            </p>
          )}
        </div>
      ) : null}
      {detalhe.estado === 'ok' ? (
        <PedidoCard
          pedido={detalhe.pedido}
          gestor={gestor}
          onCancelado={(pedido) => setDetalhe({ estado: 'ok', pedido })}
        />
      ) : null}
    </section>
  );
}

function PedidoCard({
  pedido: p,
  gestor,
  onCancelado,
}: {
  pedido: Pedido;
  gestor: boolean;
  onCancelado: (pedido: Pedido) => void;
}) {
  return (
    <article className="card pedido" aria-labelledby="pedido-title">
      <div className="section__head pedido__head">
        <h2 id="pedido-title">
          Pedido <code>{p.id}</code>
        </h2>
        <StatusPedidoPill status={p.status} />
      </div>
      <dl className="summary pedido__resumo">
        <div>
          <dt className="summary__label">Criado em</dt>
          <dd>
            <time dateTime={p.criadoEm}>{formatDateTime(p.criadoEm)}</time>
          </dd>
        </div>
        {p.atualizadoEm ? (
          <div>
            <dt className="summary__label">Atualizado em</dt>
            <dd>
              <time dateTime={p.atualizadoEm}>{formatDateTime(p.atualizadoEm)}</time>
            </dd>
          </div>
        ) : null}
        {gestor ? (
          <div>
            <dt className="summary__label">Cliente</dt>
            <dd>
              <code>{p.clienteId}</code>
            </dd>
          </div>
        ) : null}
        {p.motivoCancelamento ? (
          <div>
            <dt className="summary__label">Motivo do cancelamento</dt>
            <dd>{MOTIVO_CANCELAMENTO_LABEL[p.motivoCancelamento]}</dd>
          </div>
        ) : null}
      </dl>
      {p.status === 'PENDENTE' ? (
        <p className="muted pedido__nota">
          Aguardando o pagamento: a confirmação chega pelos eventos do pagamentos-service.
        </p>
      ) : null}

      <div className="table-wrap pedido__itens">
        <table className="tenants">
          <caption className="sr-only">Itens do pedido</caption>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Produto</th>
              <th scope="col">Quantidade</th>
              <th scope="col">Preço unitário</th>
              <th scope="col">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {p.itens.map((i) => (
              <tr key={i.produtoId} aria-label={i.sku ?? i.produtoId}>
                <th scope="row" data-label="SKU">
                  <code>{i.sku ?? i.produtoId}</code>
                </th>
                <td data-label="Produto" className="tenants__nome">
                  {i.nome ?? '—'}
                </td>
                <td data-label="Quantidade" className="num">
                  {i.quantidade.toLocaleString('pt-BR')}
                </td>
                <td data-label="Preço unitário" className="produtos__preco">
                  {i.precoUnitario ? formatDinheiro(i.precoUnitario) : '—'}
                </td>
                <td data-label="Subtotal" className="produtos__preco">
                  {i.precoUnitario ? formatDinheiro(subtotal(i.precoUnitario, i.quantidade)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="carrinho__total pedido__total">
        <span>Total</span>
        <strong className="num">{formatDinheiro(p.total)}</strong>
      </p>
      <div className="form__actions">
        <CancelarPedido pedido={p} onCancelado={onCancelado} />
      </div>
    </article>
  );
}
