// Fixtures da página Arquitetura: schemas Avro, Markdown de event storming e ADRs.

const metadata = [
  { name: 'eventId', type: { type: 'string', logicalType: 'uuid' }, doc: 'Id do evento.' },
  { name: 'tenantId', type: 'string' },
  { name: 'occurredAt', type: { type: 'long', logicalType: 'timestamp-millis' } },
  { name: 'traceparent', type: ['null', 'string'], default: null },
];

const avro = (value: unknown) => JSON.stringify(value, null, 2);

const P = '../../../libs/contracts/src/main/avro';

export const AVRO_FILES: Record<string, string> = {
  [`${P}/tenants/Plano.avsc`]: avro({
    type: 'enum',
    name: 'Plano',
    namespace: 'br.dev.plataforma.contracts.tenants',
    symbols: ['GRATUITO', 'PROFISSIONAL', 'EMPRESARIAL'],
    doc: 'Plano contratado.',
  }),
  [`${P}/tenants/TenantCriado.avsc`]: avro({
    type: 'record',
    name: 'TenantCriado',
    namespace: 'br.dev.plataforma.contracts.tenants',
    doc: 'Um novo tenant foi cadastrado na plataforma.',
    'x-evento': 'tenant.criado',
    'x-topico': 'persistent://plataforma/tenants/tenant.criado.v1',
    'x-produtor': 'tenants',
    'x-consumidores': ['catalogo'],
    fields: [
      ...metadata,
      { name: 'nome', type: 'string', doc: 'Razão social.' },
      { name: 'plano', type: 'br.dev.plataforma.contracts.tenants.Plano' },
    ],
  }),
  [`${P}/pedidos/PedidoCriado.avsc`]: avro({
    type: 'record',
    name: 'PedidoCriado',
    namespace: 'br.dev.plataforma.contracts.pedidos',
    doc: 'Um cliente do tenant fez um pedido.',
    'x-evento': 'pedido.criado',
    'x-topico': 'persistent://plataforma/pedidos/pedido.criado.v1',
    'x-produtor': 'pedidos',
    'x-consumidores': ['pagamentos'],
    fields: [
      ...metadata,
      {
        name: 'itens',
        type: {
          type: 'array',
          items: {
            type: 'record',
            name: 'ItemPedido',
            fields: [
              { name: 'sku', type: 'string' },
              { name: 'quantidade', type: 'int' },
            ],
          },
        },
      },
      { name: 'moeda', type: 'string', default: 'BRL', doc: 'Código ISO 4217.' },
    ],
  }),
  [`${P}/pagamentos/PagamentoAprovado.avsc`]: avro({
    type: 'record',
    name: 'PagamentoAprovado',
    namespace: 'br.dev.plataforma.contracts.pagamentos',
    doc: 'O pagamento do pedido foi aprovado.',
    'x-evento': 'pagamento.aprovado',
    'x-topico': 'persistent://plataforma/pagamentos/pagamento.aprovado.v1',
    'x-produtor': 'pagamentos',
    'x-consumidores': ['pedidos'],
    fields: [...metadata, { name: 'pedidoId', type: 'string' }],
  }),
  [`${P}/catalogo/ProdutoAlterado.avsc`]: avro({
    type: 'record',
    name: 'ProdutoAlterado',
    namespace: 'br.dev.plataforma.contracts.catalogo',
    doc: 'Um produto mudou.',
    'x-evento': 'produto.alterado',
    'x-topico': 'persistent://plataforma/catalogo/produto.alterado.v1',
    'x-produtor': 'catalogo',
    'x-consumidores': [],
    fields: [...metadata],
  }),
};

export const EVENT_STORMING_MD = `# Event storming

Texto introdutório.

## Fluxo do pedido

\`\`\`mermaid
flowchart LR
  A[Pedido criado] --> B[Pagamento aprovado]
\`\`\`

## Contexto

### Mapa de contextos

Parágrafo entre o heading e o bloco.

\`\`\`mermaid
graph TD
  tenants --> catalogo
\`\`\`

\`\`\`json
{ "nao": "mermaid" }
\`\`\`
`;

export const ADR_FILES: Record<string, string> = {
  '../../../docs/adr/0002-pulsar.md': `# ADR-0002: Apache Pulsar como broker

- **Status:** Proposto
- **Data:** 2026-11-27

## Contexto
`,
  '../../../docs/adr/0001-multi-tenant.md': `# ADR-0001: Modelo de isolamento multi-tenant

- **Status:** Aceito
- **Data:** 2026-11-26
`,
};
