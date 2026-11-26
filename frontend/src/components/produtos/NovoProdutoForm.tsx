import { useId, useRef, useState, type FormEvent } from 'react';
import {
  MOEDA_PADRAO,
  NOME_PRODUTO_MAX,
  PROBLEMA_LIMITE_DO_PLANO,
  PROBLEMA_SKU_DUPLICADO,
  createProduto,
  describeProdutoError,
  formatDinheiro,
  problemTypeOf,
  reaisParaCentavos,
  validateNomeProduto,
  validateSku,
  type Produto,
} from '../../api/catalogo';

interface Props {
  onCreated: (produto: Produto) => void;
  /** true quando o tenant já usa todos os produtos do plano (aviso antes de enviar). */
  planoCheio?: boolean;
}

interface Errors {
  sku?: string;
  nome?: string;
  preco?: string;
}

function validate(sku: string, nome: string, preco: string): Errors {
  const errors: Errors = {};
  const skuErro = validateSku(sku);
  if (skuErro) errors.sku = skuErro;
  const nomeErro = validateNomeProduto(nome);
  if (nomeErro) errors.nome = nomeErro;
  const convertido = reaisParaCentavos(preco);
  if ('erro' in convertido) errors.preco = convertido.erro;
  return errors;
}

type ServerError = { kind: 'sku' | 'limite' | 'outro'; message: string };

/** Formulário "Novo produto" (gestores): valida com as regras do contrato e faz o POST. */
export function NovoProdutoForm({ onCreated, planoCheio = false }: Props) {
  const uid = useId();
  const ids = {
    sku: `${uid}-sku`,
    skuHelp: `${uid}-sku-help`,
    skuError: `${uid}-sku-error`,
    nome: `${uid}-nome`,
    nomeError: `${uid}-nome-error`,
    preco: `${uid}-preco`,
    precoHelp: `${uid}-preco-help`,
    precoError: `${uid}-preco-error`,
  };
  const refs = {
    sku: useRef<HTMLInputElement>(null),
    nome: useRef<HTMLInputElement>(null),
    preco: useRef<HTMLInputElement>(null),
  };

  const [sku, setSku] = useState('');
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const errors: Errors = touched ? validate(sku, nome, preco) : {};
  // SKU duplicado fica ligado ao campo até o usuário trocar o SKU.
  if (!errors.sku && serverError?.kind === 'sku') errors.sku = serverError.message;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setSuccess(null);
    setServerError(null);
    const found = validate(sku, nome, preco);
    const first = (['sku', 'nome', 'preco'] as const).find((k) => found[k]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    const convertido = reaisParaCentavos(preco) as { centavos: number };
    setSubmitting(true);
    try {
      const produto = await createProduto({
        sku,
        nome: nome.trim(),
        preco: { centavos: convertido.centavos, moeda: MOEDA_PADRAO },
      });
      onCreated(produto);
      setSuccess(`Produto ${produto.sku} criado por ${formatDinheiro(produto.preco)}.`);
      setSku('');
      setNome('');
      setPreco('');
      setTouched(false);
    } catch (err) {
      const type = problemTypeOf(err);
      const message = describeProdutoError(err);
      if (type === PROBLEMA_SKU_DUPLICADO) {
        setServerError({ kind: 'sku', message });
        refs.sku.current?.focus();
      } else if (type === PROBLEMA_LIMITE_DO_PLANO) {
        setServerError({ kind: 'limite', message });
      } else {
        setServerError({ kind: 'outro', message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="card form"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      aria-labelledby="novo-produto-title"
    >
      <h2 id="novo-produto-title">Novo produto</h2>

      {planoCheio ? (
        <p className="alert alert--warn">
          O tenant já usa todos os produtos do plano: o catálogo vai recusar novos cadastros.
        </p>
      ) : null}

      <div className="form__grid">
        <div className="field-group">
          <label htmlFor={ids.sku}>SKU</label>
          <input
            ref={refs.sku}
            id={ids.sku}
            name="sku"
            type="text"
            className="input"
            value={sku}
            onChange={(e) => {
              setSku(e.target.value.toUpperCase());
              if (serverError?.kind === 'sku') setServerError(null);
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ex.: CAF-TOR-500"
            maxLength={32}
            aria-invalid={errors.sku ? true : undefined}
            aria-describedby={errors.sku ? `${ids.skuHelp} ${ids.skuError}` : ids.skuHelp}
          />
          <p id={ids.skuHelp} className="field-help">
            De 3 a 32 caracteres: letras maiúsculas, números e hífen; único no tenant.
          </p>
          {errors.sku ? (
            <p id={ids.skuError} className="field-error">
              {errors.sku}
            </p>
          ) : null}
        </div>

        <div className="field-group">
          <label htmlFor={ids.nome}>Nome</label>
          <input
            ref={refs.nome}
            id={ids.nome}
            name="nome"
            type="text"
            className="input"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoComplete="off"
            placeholder="ex.: Café torrado 500 g — caixa com 20"
            maxLength={NOME_PRODUTO_MAX}
            aria-invalid={errors.nome ? true : undefined}
            aria-describedby={errors.nome ? ids.nomeError : undefined}
          />
          {errors.nome ? (
            <p id={ids.nomeError} className="field-error">
              {errors.nome}
            </p>
          ) : null}
        </div>

        <div className="field-group">
          <label htmlFor={ids.preco}>Preço (R$)</label>
          <input
            ref={refs.preco}
            id={ids.preco}
            name="preco"
            type="text"
            inputMode="decimal"
            className="input num"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            autoComplete="off"
            placeholder="ex.: 12,90"
            aria-invalid={errors.preco ? true : undefined}
            aria-describedby={errors.preco ? `${ids.precoHelp} ${ids.precoError}` : ids.precoHelp}
          />
          <p id={ids.precoHelp} className="field-help">
            Em reais, com vírgula nos centavos; vai para a API em centavos.
          </p>
          {errors.preco ? (
            <p id={ids.precoError} className="field-error">
              {errors.preco}
            </p>
          ) : null}
        </div>
      </div>

      {serverError?.kind === 'limite' ? (
        <div className="alert" role="alert">
          <strong>Limite do plano atingido.</strong> {serverError.message} Desativar produtos não
          libera vaga (o limite conta ativos e inativos); um plano maior, sim.
        </div>
      ) : null}
      {serverError?.kind === 'sku' ? (
        <div className="alert" role="alert">
          <strong>SKU duplicado.</strong> {serverError.message}
        </div>
      ) : null}
      {serverError?.kind === 'outro' ? (
        <div className="alert" role="alert">
          <strong>Não foi possível criar o produto.</strong> {serverError.message}
        </div>
      ) : null}

      <div className="form__actions">
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Criando…' : 'Criar produto'}
        </button>
        <p className="form__success" role="status">
          {success}
        </p>
      </div>
    </form>
  );
}
