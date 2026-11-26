import { useId, useState, type FormEvent } from 'react';
import {
  NOME_PRODUTO_MAX,
  centavosParaTexto,
  describeProdutoError,
  formatDinheiro,
  reaisParaCentavos,
  updatePreco,
  updateProduto,
  validateNomeProduto,
  type Produto,
} from '../../api/catalogo';
import { ITENS_MAX, QUANTIDADE_MAX, QUANTIDADE_MIN, quantidadeValida } from '../../api/pedidos';
import type { UseProdutos } from '../../hooks/useProdutos';

const COMPOSE_COMMAND = 'docker compose -f infra/docker-compose.yml up -d --build --wait';

type Props = Pick<
  UseProdutos,
  | 'items'
  | 'nextCursor'
  | 'total'
  | 'loading'
  | 'loadingMore'
  | 'error'
  | 'actionError'
  | 'pendingIds'
  | 'reload'
  | 'loadMore'
  | 'replace'
  | 'setActive'
> & {
  /** Gestores veem as ações (preço, nome e situação). */
  gestor: boolean;
  /** Há busca ou filtro ativo (muda a mensagem de lista vazia). */
  filtrado: boolean;
  /** Compradores: "Adicionar ao carrinho" em cada produto ativo. */
  onAdicionar?: (produto: Produto, quantidade: number) => boolean;
};

/** Lista do catálogo: tabela no desktop, cartões no celular, com paginação por cursor. */
export function ProdutoList({
  items,
  nextCursor,
  total,
  loading,
  loadingMore,
  error,
  actionError,
  pendingIds,
  reload,
  loadMore,
  replace,
  setActive,
  gestor,
  filtrado,
  onAdicionar,
}: Props) {
  return (
    <section className="section" aria-labelledby="produtos-title">
      <div className="section__head">
        <h2 id="produtos-title">Produtos</h2>
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
          <strong>Não foi possível carregar o catálogo.</strong> {error}
          <p>
            Para dados reais, suba o ambiente com <code>{COMPOSE_COMMAND}</code> e rode o frontend
            com <code>npm run dev</code>. Sem Docker, use o modo demo:{' '}
            <code>VITE_DEMO=true npm run dev</code>.
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
          Carregando produtos…
        </p>
      ) : null}

      {!loading && !error && total !== null ? (
        <p className="muted produtos__total" aria-live="polite">
          {total === 1 ? '1 produto' : `${total} produtos`}
          {filtrado ? (total === 1 ? ' encontrado' : ' encontrados') + ' com o filtro' : ''}
          {items.length < total ? ` · mostrando ${items.length}` : ''}
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="card muted empty">
          {filtrado ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="card table-wrap">
          <table className="tenants produtos">
            <caption className="sr-only">Produtos do tenant</caption>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Nome</th>
                <th scope="col">Preço</th>
                <th scope="col">Situação</th>
                {onAdicionar ? <th scope="col">Carrinho</th> : null}
                {gestor ? (
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <ProdutoRow
                  key={p.id}
                  produto={p}
                  gestor={gestor}
                  pending={pendingIds.has(p.id)}
                  onReplace={replace}
                  onSetActive={setActive}
                  onAdicionar={onAdicionar}
                />
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

type Editing = 'preco' | 'nome' | null;

interface RowProps {
  produto: Produto;
  gestor: boolean;
  pending: boolean;
  onReplace: (produto: Produto) => void;
  onSetActive: (id: string, ativo: boolean) => Promise<void>;
  onAdicionar?: (produto: Produto, quantidade: number) => boolean;
}

function ProdutoRow({
  produto: p,
  gestor,
  pending,
  onReplace,
  onSetActive,
  onAdicionar,
}: RowProps) {
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <tr aria-label={p.sku} className={p.ativo ? undefined : 'produtos__inativo'}>
      <th scope="row" data-label="SKU">
        <code>{p.sku}</code>
      </th>
      <td data-label="Nome" className="tenants__nome">
        {editing === 'nome' ? (
          <InlineEditor
            produto={p}
            campo="nome"
            onDone={(updated) => {
              if (updated) onReplace(updated);
              setEditing(null);
            }}
          />
        ) : (
          p.nome
        )}
      </td>
      <td data-label="Preço" className="produtos__preco">
        {editing === 'preco' ? (
          <InlineEditor
            produto={p}
            campo="preco"
            onDone={(updated) => {
              if (updated) onReplace(updated);
              setEditing(null);
            }}
          />
        ) : (
          <span className="num">{formatDinheiro(p.preco)}</span>
        )}
      </td>
      <td data-label="Situação">
        <span className={`pill ${p.ativo ? 'pill--up' : 'pill--down'}`}>
          <span className="dot" aria-hidden="true" />
          {p.ativo ? 'Ativo' : 'Inativo'}
        </span>
      </td>
      {onAdicionar ? (
        <td data-label="Carrinho" className="produtos__carrinho">
          {p.ativo ? <AdicionarAoCarrinho produto={p} onAdicionar={onAdicionar} /> : null}
        </td>
      ) : null}
      {gestor ? (
        <td className="tenants__acoes produtos__acoes">
          <button
            type="button"
            className="button button--small button--secondary"
            aria-label={`Alterar preço de ${p.sku}`}
            disabled={editing !== null}
            onClick={() => setEditing('preco')}
          >
            Preço
          </button>
          <button
            type="button"
            className="button button--small button--secondary"
            aria-label={`Renomear ${p.sku}`}
            disabled={editing !== null}
            onClick={() => setEditing('nome')}
          >
            Renomear
          </button>
          <button
            type="button"
            className="button button--small button--secondary"
            disabled={pending}
            aria-label={`${p.ativo ? 'Desativar' : 'Ativar'} ${p.sku}`}
            onClick={() => void onSetActive(p.id, !p.ativo)}
          >
            {pending ? 'Salvando…' : p.ativo ? 'Desativar' : 'Ativar'}
          </button>
        </td>
      ) : null}
    </tr>
  );
}

/** Quantidade + "Adicionar ao carrinho"; confirma com "Adicionado" por alguns segundos. */
function AdicionarAoCarrinho({
  produto,
  onAdicionar,
}: {
  produto: Produto;
  onAdicionar: (produto: Produto, quantidade: number) => boolean;
}) {
  const uid = useId();
  const [texto, setTexto] = useState('1');
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const quantidade = Number(texto);
  const valida = quantidadeValida(quantidade);

  function adicionar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valida) return;
    const ok = onAdicionar(produto, quantidade);
    setMensagem(
      ok
        ? { ok, texto: `${quantidade.toLocaleString('pt-BR')} no carrinho` }
        : { ok, texto: `O carrinho aceita até ${ITENS_MAX} produtos.` },
    );
    setTexto('1');
  }

  return (
    <form className="adicionar" onSubmit={adicionar} noValidate>
      <label htmlFor={`${uid}-qtd`} className="sr-only">
        Quantidade de {produto.sku} para adicionar
      </label>
      <input
        id={`${uid}-qtd`}
        className="input num adicionar__qtd"
        type="number"
        inputMode="numeric"
        min={QUANTIDADE_MIN}
        max={QUANTIDADE_MAX}
        step={1}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setMensagem(null);
        }}
        aria-invalid={valida ? undefined : true}
      />
      <button
        type="submit"
        className="button button--small"
        disabled={!valida}
        aria-label={`Adicionar ${produto.sku} ao carrinho`}
      >
        Adicionar ao carrinho
      </button>
      {mensagem ? (
        <span className={mensagem.ok ? 'adicionar__ok' : 'field-error'} role="status">
          {mensagem.texto}
        </span>
      ) : null}
    </form>
  );
}

interface EditorProps {
  produto: Produto;
  campo: 'preco' | 'nome';
  /** Com o produto alterado (salvou) ou null (cancelou). */
  onDone: (updated: Produto | null) => void;
}

/** Edição na própria linha: PUT /preco (preço em reais → centavos) ou PATCH { nome }. */
function InlineEditor({ produto, campo, onDone }: EditorProps) {
  const uid = useId();
  const [value, setValue] = useState(() =>
    campo === 'preco' ? centavosParaTexto(produto.preco.centavos) : produto.nome,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const label = campo === 'preco' ? `Novo preço de ${produto.sku}` : `Novo nome de ${produto.sku}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    let request: () => Promise<Produto>;
    if (campo === 'preco') {
      const convertido = reaisParaCentavos(value);
      if ('erro' in convertido) {
        setError(convertido.erro);
        return;
      }
      request = () =>
        updatePreco(produto.id, { centavos: convertido.centavos, moeda: produto.preco.moeda });
    } else {
      const erro = validateNomeProduto(value);
      if (erro) {
        setError(erro);
        return;
      }
      request = () => updateProduto(produto.id, { nome: value.trim() });
    }
    setSaving(true);
    try {
      const updated = await request();
      onDone(updated);
    } catch (err) {
      setError(describeProdutoError(err));
      setSaving(false);
    }
  }

  return (
    <form className="inline-edit" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <label htmlFor={`${uid}-input`} className="sr-only">
        {label}
      </label>
      <input
        id={`${uid}-input`}
        className={`input${campo === 'preco' ? ' num inline-edit__preco' : ''}`}
        type="text"
        inputMode={campo === 'preco' ? 'decimal' : undefined}
        value={value}
        maxLength={campo === 'nome' ? NOME_PRODUTO_MAX : undefined}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-error` : undefined}
      />
      <div className="inline-edit__actions">
        <button type="submit" className="button button--small" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          className="button button--small button--secondary"
          onClick={() => onDone(null)}
        >
          Cancelar
        </button>
      </div>
      {error ? (
        <p id={`${uid}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
