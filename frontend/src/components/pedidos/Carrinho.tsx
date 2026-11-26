import { useId, useState } from 'react';
import { formatDinheiro } from '../../api/catalogo';
import {
  PROBLEMA_CHAVE_REUTILIZADA,
  PROBLEMA_PRODUTO_INDISPONIVEL,
  QUANTIDADE_MAX,
  QUANTIDADE_MIN,
  subtotal,
} from '../../api/pedidos';
import type { ItemCarrinho, UseCarrinho } from '../../hooks/useCarrinho';
import { useEnviarPedido, type ErroEnvio } from '../../hooks/useEnviarPedido';
import { pedidoHash } from '../../hooks/useHashRoute';

/** Resumo do carrinho do comprador (por tenant) e o botão "Fazer pedido". */
export function Carrinho({ carrinho }: { carrinho: UseCarrinho }) {
  const { itens, unidades, totalEstimado, moedasDiferentes, remover, esvaziar, definirQuantidade } =
    carrinho;
  const envio = useEnviarPedido();
  // Item com o campo de quantidade inválido -> a quantidade do item quando o campo ficou inválido.
  // Se a quantidade muda por fora (ex.: "Adicionar" de novo), a linha volta a mostrar um número
  // válido e a marca antiga deixa de valer sozinha, sem depender de um aviso da linha.
  const [invalidos, setInvalidos] = useState<ReadonlyMap<string, number>>(new Map());

  const indisponivel = envio.erro?.problemType === PROBLEMA_PRODUTO_INDISPONIVEL;
  const citados = new Set(indisponivel ? citadosNoErro(itens, envio.erro!) : []);

  async function fazerPedido() {
    const resultado = await envio.enviar(
      itens.map(({ produtoId, quantidade }) => ({ produtoId, quantidade })),
    );
    if (!resultado) return;
    esvaziar();
    window.location.hash = pedidoHash(resultado.pedido.id);
  }

  /** `quantidade` = a do item quando o campo ficou inválido; null = o campo voltou a valer. */
  function marcarInvalido(produtoId: string, quantidade: number | null) {
    setInvalidos((prev) => {
      if ((prev.get(produtoId) ?? null) === quantidade) return prev;
      const next = new Map(prev);
      if (quantidade === null) next.delete(produtoId);
      else next.set(produtoId, quantidade);
      return next;
    });
  }

  const pendentesInvalidos = itens.some((i) => invalidos.get(i.produtoId) === i.quantidade);

  return (
    <section className="section card carrinho" aria-labelledby="carrinho-title">
      <div className="section__head carrinho__head">
        <h2 id="carrinho-title">Carrinho</h2>
        <span className="muted" aria-live="polite">
          {itens.length === 0
            ? 'vazio'
            : `${itens.length === 1 ? '1 produto' : `${itens.length} produtos`} · ${unidades.toLocaleString('pt-BR')} ${unidades === 1 ? 'unidade' : 'unidades'}`}
        </span>
      </div>

      {itens.length === 0 ? (
        <p className="muted empty">
          Seu carrinho está vazio. Use “Adicionar ao carrinho” nos produtos abaixo.
        </p>
      ) : (
        <>
          <ul className="carrinho__itens" aria-label="Itens do carrinho">
            {itens.map((item) => (
              <LinhaCarrinho
                key={item.produtoId}
                item={item}
                destaque={citados.has(item.produtoId)}
                onQuantidade={(q) => {
                  envio.limparErro();
                  definirQuantidade(item.produtoId, q);
                }}
                onInvalido={(inv) => marcarInvalido(item.produtoId, inv ? item.quantidade : null)}
                onRemover={() => {
                  envio.limparErro();
                  marcarInvalido(item.produtoId, null);
                  remover(item.produtoId);
                }}
              />
            ))}
          </ul>

          {totalEstimado ? (
            <>
              <p className="carrinho__total">
                <span>Total estimado</span>
                <strong className="num">{formatDinheiro(totalEstimado)}</strong>
              </p>
              <p className="muted carrinho__aviso">
                Estimativa com os preços do catálogo. O preço final é o do servidor, calculado
                quando o pedido é criado.
              </p>
            </>
          ) : null}
          {moedasDiferentes ? (
            <p className="alert carrinho__moedas" role="status">
              Os produtos têm moedas diferentes; faça um pedido por moeda.
            </p>
          ) : null}

          {envio.erro ? (
            <div className={`alert${indisponivel ? ' alert--indisponivel' : ''}`} role="alert">
              <strong>
                {indisponivel
                  ? 'Produto indisponível.'
                  : envio.erro.problemType === PROBLEMA_CHAVE_REUTILIZADA
                    ? 'Chave de idempotência reutilizada.'
                    : 'Não foi possível fazer o pedido.'}
              </strong>{' '}
              {envio.erro.message}
              {indisponivel ? (
                <p>
                  {citados.size > 1 ? 'Remova os itens destacados' : 'Remova o item destacado'} (ou
                  atualize a lista de produtos) e tente de novo.
                </p>
              ) : null}
              {envio.erro.rede ? (
                <p>
                  Tente de novo: a repetição usa a mesma chave de idempotência, então o pedido não é
                  criado em dobro.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="form__actions carrinho__acoes">
            <button
              type="button"
              className="button"
              disabled={envio.enviando || pendentesInvalidos || moedasDiferentes}
              onClick={() => void fazerPedido()}
            >
              {envio.enviando
                ? 'Enviando pedido…'
                : envio.erro?.rede
                  ? 'Tentar de novo'
                  : 'Fazer pedido'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={envio.enviando}
              onClick={() => {
                envio.limparErro();
                setInvalidos(new Map());
                esvaziar();
              }}
            >
              Esvaziar carrinho
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Itens apontados pelo 409 produto-indisponivel: pelos ids exatos da propriedade `produtos`;
 * se a resposta não a trouxer, pelo id ou SKU citado no detail (reserva).
 */
function citadosNoErro(itens: readonly ItemCarrinho[], erro: ErroEnvio): string[] {
  const { produtos, message } = erro;
  const citado = produtos
    ? (i: ItemCarrinho) => produtos.includes(i.produtoId)
    : (i: ItemCarrinho) => message.includes(i.produtoId) || message.includes(i.sku);
  return itens.filter(citado).map((i) => i.produtoId);
}

interface LinhaProps {
  item: ItemCarrinho;
  destaque: boolean;
  onQuantidade: (quantidade: number) => void;
  onInvalido: (invalido: boolean) => void;
  onRemover: () => void;
}

function LinhaCarrinho({ item, destaque, onQuantidade, onInvalido, onRemover }: LinhaProps) {
  const uid = useId();
  const [texto, setTexto] = useState(String(item.quantidade));
  const [erro, setErro] = useState<string | null>(null);
  // A quantidade mudou por fora (ex.: "Adicionar" de novo): o campo acompanha e o erro some (a
  // marca de inválido no Carrinho é da quantidade antiga, então também deixa de valer).
  const [ultima, setUltima] = useState(item.quantidade);
  if (ultima !== item.quantidade) {
    setUltima(item.quantidade);
    setTexto(String(item.quantidade));
    setErro(null);
  }

  function mudar(valor: string) {
    setTexto(valor);
    const n = Number(valor);
    if (valor.trim() === '' || !Number.isInteger(n) || n < QUANTIDADE_MIN || n > QUANTIDADE_MAX) {
      setErro(`Use de ${QUANTIDADE_MIN} a ${QUANTIDADE_MAX.toLocaleString('pt-BR')}.`);
      onInvalido(true);
      return;
    }
    setErro(null);
    onInvalido(false);
    setUltima(n);
    onQuantidade(n);
  }

  return (
    <li
      className={`carrinho__item${destaque ? ' carrinho__item--indisponivel' : ''}`}
      aria-label={item.sku}
    >
      <div className="carrinho__produto">
        <span className="carrinho__nome">{item.nome}</span>
        <span className="muted carrinho__sku">
          <code>{item.sku}</code> · {formatDinheiro(item.precoUnitario)} cada
          {destaque ? <strong className="carrinho__marca"> · indisponível</strong> : null}
        </span>
      </div>
      <div className="carrinho__controles">
        <label htmlFor={`${uid}-qtd`} className="sr-only">
          Quantidade de {item.sku} no carrinho
        </label>
        <input
          id={`${uid}-qtd`}
          className="input num carrinho__qtd"
          type="number"
          inputMode="numeric"
          min={QUANTIDADE_MIN}
          max={QUANTIDADE_MAX}
          step={1}
          value={texto}
          onChange={(e) => mudar(e.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${uid}-erro` : undefined}
        />
        <span className="num carrinho__subtotal" aria-label={`Subtotal de ${item.sku}`}>
          {formatDinheiro(subtotal(item.precoUnitario, item.quantidade))}
        </span>
        <button
          type="button"
          className="button button--small button--secondary"
          aria-label={`Remover ${item.sku} do carrinho`}
          onClick={onRemover}
        >
          Remover
        </button>
      </div>
      {erro ? (
        <p id={`${uid}-erro`} className="field-error" role="alert">
          {erro}
        </p>
      ) : null}
    </li>
  );
}
