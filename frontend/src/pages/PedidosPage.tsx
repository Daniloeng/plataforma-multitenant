import { useCallback, useEffect, useId, useState } from 'react';
import { formatDinheiro } from '../api/catalogo';
import { ApiError } from '../api/http';
import type { TenantDoUsuario } from '../api/me';
import {
  MOTIVO_CANCELAMENTO_LABEL,
  RECUSA_GENERICA,
  STATUS_PEDIDO,
  STATUS_PEDIDO_LABEL,
  describePedidoError,
  getPedido,
  historicoDe,
  podeComprar,
  resumoItens,
  subtotal,
  veTodosOsPedidos,
  type Pedido,
  type StatusPedido,
  type TipoMarco,
} from '../api/pedidos';
import { useAuth } from '../auth/context';
import { LoginPrompt } from '../components/auth/LoginPrompt';
import { ErroDeCarga } from '../components/ErroDeCarga';
import { IsolamentoPedidos } from '../components/isolamento/IsolamentoPedidos';
import { LinhaDoTempo } from '../components/pedidos/LinhaDoTempo';
import { CancelarPedido, StatusPedidoPill } from '../components/pedidos/PedidoParts';
import { ROUTE_HASH, parsePedidoId, pedidoHash, useHash } from '../hooks/useHashRoute';
import { usePedidoAoVivo, type ModoAoVivo } from '../hooks/usePedidoAoVivo';
import { usePedidos } from '../hooks/usePedidos';
import { describePagamentoError, listPagamentos } from '../api/pagamentos';
import { formatDateTime } from '../utils/format';

const COMPOSE_COMMAND = 'docker compose -f infra/docker-compose.yml up -d --build --wait';

/**
 * Poll do detalhe enquanto o pedido está PENDENTE (só quando a linha do tempo em SSE não abre):
 * a cada 1,5 s, até 10 consultas.
 */
export const POLL_INTERVALO_MS = 1500;
export const POLL_TENTATIVAS = 10;

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
  // Gestor e admin consultam o isolamento (Dia 9): a lista espera a primeira resposta e, se os
  // dados estiverem migrando de nível, espera a migração terminar (em vez de receber o 503).
  const [aguardandoMigracao, setAguardandoMigracao] = useState(gestor);
  const pedidos = usePedidos(tenant.id, status || undefined, !aguardandoMigracao);
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
          {gestor ? (
            <IsolamentoPedidos tenantId={tenant.id} onSituacao={setAguardandoMigracao} />
          ) : null}
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
          <ErroDeCarga
            titulo="Não foi possível carregar os pedidos."
            mensagem={error}
            onTentarDeNovo={() => void pedidos.reload()}
          >
            Para dados reais, suba o ambiente com <code>{COMPOSE_COMMAND}</code>. Sem Docker, use o
            modo demo: <code>VITE_DEMO=true npm run dev</code>.
          </ErroDeCarga>
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

/** Como a tela acompanha o pedido agora (mostrado na situação do pagamento). */
type Acompanhamento = 'ao-vivo' | 'conectando' | 'poll' | 'parado';

/**
 * Pedido mais novo entre o da tela e o que chegou: uma mensagem SSE em trânsito não desfaz uma
 * mudança que a tela já mostra (ex.: a resposta do cancelamento).
 */
function maisNovo(atual: Pedido, recebido: Pedido): Pedido {
  if (atual.id !== recebido.id) return recebido;
  const marcos = (p: Pedido) => p.historico?.length ?? 0;
  if (marcos(recebido) !== marcos(atual))
    return marcos(recebido) > marcos(atual) ? recebido : atual;
  // Date.parse: o texto ISO pode vir com ou sem fração de segundo ("…:01Z" e "…:01.500Z").
  if (
    atual.atualizadoEm &&
    recebido.atualizadoEm &&
    Date.parse(recebido.atualizadoEm) < Date.parse(atual.atualizadoEm)
  ) {
    return atual;
  }
  return recebido;
}

function DetalhePedido({ id, gestor }: { id: string; gestor: boolean }) {
  const [detalhe, setDetalhe] = useState<Detalhe>({ estado: 'carregando' });
  /** Consultas feitas pelo poll (só sem SSE) desde a última carga. */
  const [tentativas, setTentativas] = useState(0);

  const carregar = useCallback(
    async (signal?: AbortSignal) => {
      setDetalhe({ estado: 'carregando' });
      setTentativas(0);
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

  const mostrar = useCallback((pedido: Pedido) => {
    setDetalhe((atual) =>
      atual.estado === 'ok'
        ? { estado: 'ok', pedido: maisNovo(atual.pedido, pedido) }
        : { estado: 'ok', pedido },
    );
  }, []);

  // Com o pedido na tela, assina a linha do tempo (SSE): cada evento substitui o pedido, e a
  // assinatura dura enquanto a tela estiver aberta (um CONFIRMADO ainda pode ser cancelado e
  // estornado). Sai da tela = aborta.
  const carregado = detalhe.estado === 'ok';
  const modo = usePedidoAoVivo(id, carregado, mostrar);

  // Sem SSE (backend sem a linha do tempo, rede fora na primeira conexão), volta ao poll antigo:
  // enquanto PENDENTE, consulta de novo a cada 1,5 s, até 10 vezes. Para ao sair da tela.
  const pendente = detalhe.estado === 'ok' && detalhe.pedido.status === 'PENDENTE';
  const semSse = modo === 'indisponivel';
  const consultando = semSse && pendente && tentativas < POLL_TENTATIVAS;
  useEffect(() => {
    if (!consultando) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getPedido(id, controller.signal)
        .then((pedido) => {
          if (controller.signal.aborted) return;
          setDetalhe({ estado: 'ok', pedido });
          setTentativas((t) => t + 1);
        })
        .catch(() => {
          // Falha numa consulta do poll não apaga o pedido da tela: conta como tentativa.
          if (!controller.signal.aborted) setTentativas((t) => t + 1);
        });
    }, POLL_INTERVALO_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [consultando, tentativas, id]);

  const acompanhamento: Acompanhamento =
    modo === 'ao-vivo' ? 'ao-vivo' : semSse ? (consultando ? 'poll' : 'parado') : 'conectando';

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
          modo={modo}
          acompanhamento={acompanhamento}
          onConsultar={() => setTentativas(0)}
          onCancelado={mostrar}
        />
      ) : null}
    </section>
  );
}

/**
 * Indicador discreto da conexão SSE: "Ao vivo" com o fluxo aberto, "Reconectando…" na queda. Sem
 * role="status" de propósito: quem anuncia as mudanças é a situação do pagamento.
 */
function IndicadorAoVivo({ modo }: { modo: ModoAoVivo }) {
  if (modo === 'ao-vivo') {
    return (
      <span
        className="ao-vivo"
        title="Conectado à linha do tempo: mudanças do pedido aparecem sozinhas."
      >
        <span className="ao-vivo__ponto" aria-hidden="true" />
        Ao vivo
      </span>
    );
  }
  if (modo === 'reconectando') {
    return (
      <span className="ao-vivo ao-vivo--reconectando">
        <span className="ao-vivo__ponto" aria-hidden="true" />
        Reconectando…
      </span>
    );
  }
  return null;
}

/** Texto do pendente conforme a tela acompanha o pedido (SSE, poll ou parada). */
const AGUARDANDO: Record<Exclude<Acompanhamento, 'parado'>, string> = {
  'ao-vivo':
    'O pagamentos-service cobra o pedido logo depois de criado; a confirmação aparece aqui sozinha.',
  conectando: 'Conectando à linha do tempo do pedido…',
  poll: 'O pagamentos-service cobra o pedido logo depois de criado; esta tela consulta de novo a cada 1,5 s.',
};

/** Situação do pagamento do pedido, em linguagem do cliente, derivada do histórico. */
function SituacaoPagamento({
  pedido: p,
  gestor,
  acompanhamento,
  onConsultar,
}: {
  pedido: Pedido;
  gestor: boolean;
  acompanhamento: Acompanhamento;
  onConsultar: () => void;
}) {
  const historico = historicoDe(p);
  const marco = (tipo: TipoMarco) => historico.find((m) => m.tipo === tipo);
  const pago = marco('PAGO');
  const pagamentoId = pago?.detalhe ?? p.pagamentoId ?? null;
  const recusa = marco('RECUSADO');

  if (p.status === 'PENDENTE') {
    return (
      <div className="pedido__pagamento pedido__pagamento--pendente" role="status">
        <strong>Aguardando o pagamento.</strong>{' '}
        <span className="muted">
          {acompanhamento === 'parado'
            ? 'A confirmação ainda não chegou.'
            : AGUARDANDO[acompanhamento]}
        </span>{' '}
        {acompanhamento === 'parado' ? (
          <button
            type="button"
            className="button button--small button--secondary"
            onClick={onConsultar}
          >
            Consultar de novo
          </button>
        ) : null}
      </div>
    );
  }
  if (p.status === 'CONFIRMADO') {
    return (
      <div className="pedido__pagamento pedido__pagamento--pago" role="status">
        <strong>Pago.</strong>{' '}
        <span>
          Pagamento aprovado
          {pagamentoId ? (
            <>
              {' '}
              <code>{pagamentoId}</code>
            </>
          ) : null}
          ; o pedido está confirmado.
        </span>
      </div>
    );
  }
  if (recusa || p.motivoCancelamento === 'PAGAMENTO_RECUSADO') {
    return (
      <div className="pedido__pagamento pedido__pagamento--recusado" role="status">
        <strong>Pagamento recusado.</strong> <span>{RECUSA_GENERICA}</span>{' '}
        {gestor ? (
          recusa?.detalhe ? (
            <span className="pedido__motivo-recusa">Motivo: {recusa.detalhe}</span>
          ) : (
            <MotivoRecusa pedidoId={p.id} />
          )
        ) : null}
      </div>
    );
  }
  const estorno = marco('ESTORNADO');
  if (estorno || pagamentoId) {
    const id = estorno?.detalhe ?? pagamentoId;
    return (
      <div className="pedido__pagamento pedido__pagamento--estornado" role="status">
        <strong>{estorno ? 'Estornado.' : 'Estorno a caminho.'}</strong>{' '}
        <span>
          O pedido foi pago
          {id ? (
            <>
              {' '}
              (<code>{id}</code>)
            </>
          ) : null}{' '}
          e cancelado depois:{' '}
          {estorno ? 'o valor foi devolvido ao cliente.' : 'o valor será devolvido ao cliente.'}
        </span>
      </div>
    );
  }
  return (
    <div className="pedido__pagamento" role="status">
      <strong>Sem cobrança.</strong> <span>O pedido foi cancelado antes do pagamento.</span>
    </div>
  );
}

/** Motivo da recusa, do pagamentos-service (só o financeiro consulta pagamentos). */
function MotivoRecusa({ pedidoId }: { pedidoId: string }) {
  const [motivo, setMotivo] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    listPagamentos({ pedidoId, limite: 1, signal: controller.signal })
      .then((pagina) => {
        if (!controller.signal.aborted) {
          setMotivo(pagina.itens[0]?.motivoRecusa ?? 'O gateway não informou o motivo.');
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setMotivo(`Motivo indisponível: ${describePagamentoError(err)}`);
        }
      });
    return () => controller.abort();
  }, [pedidoId]);
  return motivo ? <span className="pedido__motivo-recusa">Motivo: {motivo}</span> : null;
}

function PedidoCard({
  pedido: p,
  gestor,
  modo,
  acompanhamento,
  onConsultar,
  onCancelado,
}: {
  pedido: Pedido;
  gestor: boolean;
  modo: ModoAoVivo;
  acompanhamento: Acompanhamento;
  onConsultar: () => void;
  onCancelado: (pedido: Pedido) => void;
}) {
  return (
    <article className="card pedido" aria-labelledby="pedido-title">
      <div className="section__head pedido__head">
        <div className="pedido__titulo">
          <h2 id="pedido-title">
            Pedido <code>{p.id}</code>
          </h2>
          <IndicadorAoVivo modo={modo} />
        </div>
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
      <SituacaoPagamento
        pedido={p}
        gestor={gestor}
        acompanhamento={acompanhamento}
        onConsultar={onConsultar}
      />
      <LinhaDoTempo marcos={historicoDe(p)} gestor={gestor} />

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
