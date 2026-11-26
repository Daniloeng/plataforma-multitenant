import {
  CONTA_DESCRICAO,
  CONTA_LABEL,
  NATUREZA_LABEL,
  STATUS_PAGAMENTO_LABEL,
  type Conta,
  type Natureza,
  type StatusPagamento,
} from '../../api/pagamentos';

const STATUS_CLASS: Record<StatusPagamento, string> = {
  AUTORIZANDO: 'pill--pendente',
  APROVADO: 'pill--up',
  RECUSADO: 'pill--down',
  ESTORNADO: 'pill--planned',
};

/** Selo do status do pagamento. */
export function StatusPagamentoPill({ status }: { status: StatusPagamento }) {
  return (
    <span className={`pill ${STATUS_CLASS[status]}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_PAGAMENTO_LABEL[status]}
    </span>
  );
}

/** Selo da natureza do lançamento (débito ou crédito). */
export function NaturezaPill({ natureza }: { natureza: Natureza }) {
  return (
    <span className={`pill pill--${natureza === 'DEBITO' ? 'debito' : 'credito'}`}>
      {NATUREZA_LABEL[natureza]}
    </span>
  );
}

/** Nome da conta com a explicação em texto menor. */
export function ContaLabel({ conta }: { conta: Conta }) {
  return (
    <span className="conta">
      <span className="conta__nome">{CONTA_LABEL[conta]}</span>
      <span className="conta__descricao muted">{CONTA_DESCRICAO[conta]}</span>
    </span>
  );
}
