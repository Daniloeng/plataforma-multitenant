import { AVRO_FILES } from '../test/architecture-fixtures';
import {
  filterByService,
  formatType,
  indexEnums,
  listServices,
  parseContracts,
  relativeContractPath,
  roleOf,
  shortName,
  toEventField,
  type EventDefinition,
} from './catalog';
import { CATALOG } from './sources';

const plano = indexEnums([
  {
    name: 'Plano',
    fullName: 'br.dev.plataforma.contracts.tenants.Plano',
    symbols: ['GRATUITO', 'PROFISSIONAL', 'EMPRESARIAL'],
  },
]);

describe('formatType', () => {
  it.each([
    ['string', 'string'],
    [{ type: 'string', logicalType: 'uuid' }, 'uuid'],
    [{ type: 'long', logicalType: 'timestamp-millis' }, 'timestamp-millis'],
    [['null', 'string'], 'string?'],
    [['null', 'string', 'long'], '(string | long)?'],
    [['string', 'long'], 'string | long'],
    [['null'], 'null'],
    [{ type: 'array', items: { type: 'record', name: 'ItemPedido', fields: [] } }, 'ItemPedido[]'],
    [{ type: 'array', items: 'string' }, 'string[]'],
    [{ type: 'array' }, 'desconhecido[]'],
    [{ type: 'map', values: 'long' }, 'map<long>'],
    [{ type: 'map' }, 'map<desconhecido>'],
    [{ type: 'fixed', name: 'br.x.Hash' }, 'Hash'],
    [{ type: 'record' }, 'record'],
    [{ type: 'enum', name: 'Motivo', symbols: ['A', 'B'] }, 'enum Motivo (A | B)'],
    [{ type: 'enum' }, 'enum enum ()'],
    [{ type: 'string' }, 'string'],
    ['br.dev.outro.Desconhecido', 'Desconhecido'],
  ])('%j → %s', (type, expected) => {
    expect(formatType(type)).toBe(expected);
  });

  it('mostra os símbolos de enums referenciados pelo nome qualificado ou curto', () => {
    const label = 'enum Plano (GRATUITO | PROFISSIONAL | EMPRESARIAL)';
    expect(formatType('br.dev.plataforma.contracts.tenants.Plano', plano)).toBe(label);
    expect(formatType('Plano', plano)).toBe(label);
    expect(formatType(['null', 'br.dev.plataforma.contracts.tenants.Plano'], plano)).toBe(
      `${label}?`,
    );
  });
});

describe('toEventField', () => {
  it('inclui doc, padrão e campos de records aninhados', () => {
    const field = toEventField({
      name: 'itens',
      type: [
        'null',
        {
          type: 'map',
          values: { type: 'record', name: 'X', fields: [{ name: 'a', type: 'int', default: 0 }] },
        },
      ],
      doc: 'Itens.',
    });
    expect(field).toEqual({
      name: 'itens',
      type: 'map<X>?',
      doc: 'Itens.',
      children: [{ name: 'a', type: 'int', defaultValue: '0' }],
    });
    expect(toEventField({ name: 'r', type: { type: 'record', name: 'R', fields: [] } })).toEqual({
      name: 'r',
      type: 'R',
      children: [],
    });
    expect(toEventField({ name: 'u', type: ['null', 'string'] }).children).toBeUndefined();
  });
});

describe('utilitários de nome e caminho', () => {
  it('encurta nomes e caminhos', () => {
    expect(shortName('br.dev.Plano')).toBe('Plano');
    expect(shortName('Plano')).toBe('Plano');
    expect(relativeContractPath('../../../libs/contracts/src/main/avro/pedidos/X.avsc')).toBe(
      'pedidos/X.avsc',
    );
    expect(relativeContractPath('../outro/Y.avsc')).toBe('outro/Y.avsc');
  });
});

describe('parseContracts', () => {
  it('separa eventos e enums, agrupa metadados e ordena por serviço', () => {
    const { events, enums, problems } = parseContracts(AVRO_FILES);
    expect(problems).toEqual([]);
    expect(enums.map((e) => e.fullName)).toEqual(['br.dev.plataforma.contracts.tenants.Plano']);
    expect(enums[0]?.doc).toBe('Plano contratado.');
    expect(events.map((e) => e.event)).toEqual([
      'tenant.criado',
      'produto.alterado',
      'pedido.criado',
      'pagamento.aprovado',
    ]);

    const tenant = events[0]!;
    expect(tenant).toMatchObject({
      name: 'TenantCriado',
      namespace: 'br.dev.plataforma.contracts.tenants',
      topic: 'persistent://plataforma/tenants/tenant.criado.v1',
      producer: 'tenants',
      consumers: ['catalogo'],
      file: 'tenants/TenantCriado.avsc',
    });
    expect(tenant.metadata.map((f) => [f.name, f.type])).toEqual([
      ['eventId', 'uuid'],
      ['tenantId', 'string'],
      ['occurredAt', 'timestamp-millis'],
      ['traceparent', 'string?'],
    ]);
    expect(tenant.fields.map((f) => f.type)).toEqual([
      'string',
      'enum Plano (GRATUITO | PROFISSIONAL | EMPRESARIAL)',
    ]);

    const pedido = events.find((e) => e.event === 'pedido.criado')!;
    expect(pedido.fields[0]).toMatchObject({ name: 'itens', type: 'ItemPedido[]' });
    expect(pedido.fields[0]?.children?.map((c) => c.name)).toEqual(['sku', 'quantidade']);
    expect(pedido.fields[1]).toMatchObject({ defaultValue: 'BRL', doc: 'Código ISO 4217.' });
  });

  it('relata arquivos inválidos e tolera atributos ausentes', () => {
    const { events, enums, problems } = parseContracts({
      'a/Quebrado.avsc': '{ não é json',
      'a/Lista.avsc': '[]',
      'a/SemEvento.avsc': JSON.stringify({ type: 'record', name: 'SemEvento', fields: [] }),
      'a/Fixo.avsc': JSON.stringify({ type: 'fixed', name: 'Hash', size: 16 }),
      'a/Enum.avsc': JSON.stringify({ type: 'enum', symbols: ['A', 1] }),
      'a/Minimo.avsc': JSON.stringify({ type: 'record', 'x-evento': 'x.minimo', fields: [{}] }),
      'a/Outro.avsc': JSON.stringify({
        type: 'record',
        name: 'Outro',
        'x-evento': 'a.outro',
        'x-produtor': 'zeta',
        'x-consumidores': 'não é lista',
      }),
    });
    expect(problems).toEqual([
      'a/Lista.avsc: schema não é um objeto',
      'a/Quebrado.avsc: JSON inválido',
      'a/SemEvento.avsc: record sem "x-evento"',
    ]);
    expect(enums).toEqual([{ name: 'Enum', fullName: 'Enum', symbols: ['A'] }]);
    expect(events.map((e) => e.event)).toEqual(['x.minimo', 'a.outro']);
    expect(events[0]).toMatchObject({
      name: '',
      namespace: '',
      topic: '',
      producer: '',
      consumers: [],
      doc: '',
      fields: [],
      metadata: [],
    });
    expect(events[1]?.consumers).toEqual([]);
  });

  it('devolve catálogo vazio para diretório vazio', () => {
    expect(parseContracts({})).toEqual({ events: [], enums: [], problems: [] });
  });
});

describe('serviços', () => {
  const events = parseContracts(AVRO_FILES).events;
  const extra = { ...events[0]!, producer: 'zeta', consumers: ['alfa', ''] } as EventDefinition;

  it('lista os serviços do roadmap e depois os desconhecidos', () => {
    expect(listServices(events)).toEqual(['tenants', 'catalogo', 'pedidos', 'pagamentos']);
    expect(listServices([...events, extra])).toEqual([
      'tenants',
      'catalogo',
      'pedidos',
      'pagamentos',
      'alfa',
      'zeta',
    ]);
  });

  it('indica o papel e filtra por serviço', () => {
    const pedido = events.find((e) => e.event === 'pedido.criado')!;
    expect(roleOf(pedido, 'pedidos')).toBe('publica');
    expect(roleOf(pedido, 'pagamentos')).toBe('consome');
    expect(roleOf(pedido, 'tenants')).toBeUndefined();
    expect(filterByService(events, 'todos')).toHaveLength(4);
    expect(filterByService(events, 'pedidos').map((e) => e.event)).toEqual([
      'pedido.criado',
      'pagamento.aprovado',
    ]);
  });
});

describe('catálogo real (libs/contracts)', () => {
  it('lê os schemas do repositório em build time', () => {
    expect(CATALOG.problems).toEqual([]);
    expect(CATALOG.events.length).toBeGreaterThan(0);
    for (const e of CATALOG.events) {
      expect(e.topic).toMatch(/^persistent:\/\/plataforma\/[a-z]+\/[a-z.]+\.v\d+$/);
      expect(e.metadata.map((f) => f.name)).toEqual([
        'eventId',
        'tenantId',
        'occurredAt',
        'traceparent',
      ]);
    }
    expect(CATALOG.events.some((e) => e.name === 'Plano')).toBe(false);
  });
});
