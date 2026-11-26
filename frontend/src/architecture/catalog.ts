// Catálogo de eventos: transforma os schemas Avro (.avsc) de libs/contracts em dados para a UI.
// Funções puras, sem React e sem import.meta.glob, para serem testadas com fixtures.

/** Ordem de exibição dos serviços de domínio (filtro, matriz e ordenação dos eventos). */
export const SERVICE_ORDER = ['tenants', 'catalogo', 'pedidos', 'pagamentos'] as const;

/** Campos de metadados presentes em todos os eventos (regra do projeto, ver CLAUDE.md). */
export const METADATA_FIELDS = ['eventId', 'tenantId', 'occurredAt', 'traceparent'] as const;

/** Tipo Avro como aparece no JSON: nome primitivo/qualificado, objeto ou união (array). */
export type AvroType = string | AvroType[] | AvroComplexType;

export interface AvroComplexType {
  type: AvroType;
  name?: string;
  namespace?: string;
  logicalType?: string;
  symbols?: string[];
  items?: AvroType;
  values?: AvroType;
  fields?: AvroField[];
  doc?: string;
}

export interface AvroField {
  name: string;
  type: AvroType;
  doc?: string;
  default?: unknown;
}

export interface EnumDefinition {
  name: string;
  fullName: string;
  symbols: string[];
  doc?: string;
}

export interface EventField {
  name: string;
  /** Tipo legível: "uuid", "string?", "ItemPedido[]", "enum Plano (A | B)"… */
  type: string;
  doc?: string;
  /** Valor padrão já formatado (ex.: "BRL"), quando existe e não é null. */
  defaultValue?: string;
  /** Campos de um record aninhado (direto ou como item de array). */
  children?: EventField[];
}

export interface EventDefinition {
  /** Nome do record Avro, ex.: PedidoCriado. */
  name: string;
  namespace: string;
  /** Nome do evento, ex.: pedido.criado. */
  event: string;
  topic: string;
  producer: string;
  consumers: string[];
  doc: string;
  /** Caminho do .avsc relativo a libs/contracts/src/main/avro, ex.: pedidos/PedidoCriado.avsc. */
  file: string;
  /** Campos de negócio. */
  fields: EventField[];
  /** Campos de metadados (eventId, tenantId, occurredAt, traceparent). */
  metadata: EventField[];
}

export interface Catalog {
  events: EventDefinition[];
  enums: EnumDefinition[];
  /** Arquivos que não puderam ser lidos (JSON inválido ou record sem x-evento). */
  problems: string[];
}

export type ServiceRole = 'publica' | 'consome';

const AVRO_DIR = 'libs/contracts/src/main/avro/';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Último segmento de um nome qualificado: br.dev.x.Plano → Plano. */
export function shortName(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1);
}

/** Caminho do glob (../../../libs/contracts/src/main/avro/pedidos/X.avsc) → pedidos/X.avsc. */
export function relativeContractPath(path: string): string {
  const i = path.indexOf(AVRO_DIR);
  return i >= 0 ? path.slice(i + AVRO_DIR.length) : path.replace(/^(\.\.?\/)+/, '');
}

function qualify(name: string, namespace: string | undefined): string {
  return name.includes('.') || !namespace ? name : `${namespace}.${name}`;
}

function enumLabel(name: string, symbols: readonly string[]): string {
  return `enum ${shortName(name)} (${symbols.join(' | ')})`;
}

/** Índice de enums por nome qualificado e por nome curto. */
export type EnumIndex = ReadonlyMap<string, EnumDefinition>;

export function indexEnums(enums: readonly EnumDefinition[]): EnumIndex {
  const index = new Map<string, EnumDefinition>();
  for (const e of enums) {
    index.set(e.fullName, e);
    if (!index.has(e.name)) index.set(e.name, e);
  }
  return index;
}

/** Converte um tipo Avro em texto legível. */
export function formatType(type: AvroType, enums: EnumIndex = new Map()): string {
  if (typeof type === 'string') {
    const known = enums.get(type) ?? enums.get(shortName(type));
    if (known) return enumLabel(known.name, known.symbols);
    return shortName(type);
  }
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== 'null');
    const parts = nonNull.map((t) => formatType(t, enums));
    const text = parts.length > 1 ? parts.join(' | ') : (parts[0] ?? 'null');
    return nonNull.length < type.length && nonNull.length > 0
      ? parts.length > 1
        ? `(${text})?`
        : `${text}?`
      : text;
  }
  if (type.logicalType) return type.logicalType;
  switch (type.type) {
    case 'enum':
      return enumLabel(type.name ?? 'enum', type.symbols ?? []);
    case 'array':
      return `${formatType(type.items ?? 'desconhecido', enums)}[]`;
    case 'map':
      return `map<${formatType(type.values ?? 'desconhecido', enums)}>`;
    case 'record':
    case 'fixed':
      return shortName(type.name ?? type.type);
    default:
      return formatType(type.type, enums);
  }
}

/** Campos de um record aninhado no tipo (direto, em array, em map ou em união). */
function nestedFields(type: AvroType): AvroField[] | undefined {
  if (typeof type === 'string') return undefined;
  if (Array.isArray(type)) {
    for (const t of type) {
      const found = nestedFields(t);
      if (found) return found;
    }
    return undefined;
  }
  if (type.type === 'record') return type.fields;
  if (type.type === 'array' && type.items !== undefined) return nestedFields(type.items);
  if (type.type === 'map' && type.values !== undefined) return nestedFields(type.values);
  return undefined;
}

function formatDefault(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function toEventField(field: AvroField, enums: EnumIndex = new Map()): EventField {
  const result: EventField = { name: field.name, type: formatType(field.type, enums) };
  if (field.doc) result.doc = field.doc;
  const defaultValue = formatDefault(field.default);
  if (defaultValue !== undefined) result.defaultValue = defaultValue;
  const children = nestedFields(field.type);
  if (children) result.children = children.map((c) => toEventField(c, enums));
  return result;
}

function serviceRank(service: string): number {
  const i = (SERVICE_ORDER as readonly string[]).indexOf(service);
  return i >= 0 ? i : SERVICE_ORDER.length;
}

/** Ordena por serviço produtor (ordem do roadmap) e depois pelo nome do evento. */
export function compareEvents(a: EventDefinition, b: EventDefinition): number {
  return (
    serviceRank(a.producer) - serviceRank(b.producer) ||
    a.producer.localeCompare(b.producer) ||
    a.event.localeCompare(b.event)
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Lê os arquivos .avsc (caminho → conteúdo bruto). Records com "x-evento" viram eventos; enums
 * soltos (ex.: tenants/Plano.avsc) não entram no catálogo, mas servem para exibir os símbolos
 * quando um campo referencia o enum pelo nome.
 */
export function parseContracts(files: Readonly<Record<string, string>>): Catalog {
  const problems: string[] = [];
  const enums: EnumDefinition[] = [];
  const records: { file: string; schema: Record<string, unknown> }[] = [];

  for (const [path, raw] of Object.entries(files)) {
    const file = relativeContractPath(path);
    let schema: unknown;
    try {
      schema = JSON.parse(raw);
    } catch {
      problems.push(`${file}: JSON inválido`);
      continue;
    }
    if (!isObject(schema)) {
      problems.push(`${file}: schema não é um objeto`);
      continue;
    }
    const name =
      typeof schema.name === 'string'
        ? schema.name
        : file.replace(/^.*\//, '').replace(/\.avsc$/, '');
    const namespace = typeof schema.namespace === 'string' ? schema.namespace : undefined;
    if (schema.type === 'enum') {
      const def: EnumDefinition = {
        name: shortName(name),
        fullName: qualify(name, namespace),
        symbols: asStringArray(schema.symbols),
      };
      if (typeof schema.doc === 'string') def.doc = schema.doc;
      enums.push(def);
    } else if (schema.type === 'record' && typeof schema['x-evento'] === 'string') {
      records.push({ file, schema });
    } else if (schema.type === 'record') {
      problems.push(`${file}: record sem "x-evento"`);
    }
  }

  const index = indexEnums(enums);
  const metadataNames: readonly string[] = METADATA_FIELDS;
  const events = records.map(({ file, schema }): EventDefinition => {
    const fields = (Array.isArray(schema.fields) ? schema.fields : []).filter(
      (f): f is AvroField => isObject(f) && typeof f.name === 'string',
    );
    const parsed = fields.map((f) => toEventField(f, index));
    return {
      name: String(schema.name ?? ''),
      namespace: String(schema.namespace ?? ''),
      event: String(schema['x-evento']),
      topic: String(schema['x-topico'] ?? ''),
      producer: String(schema['x-produtor'] ?? ''),
      consumers: asStringArray(schema['x-consumidores']),
      doc: String(schema.doc ?? ''),
      file,
      fields: parsed.filter((f) => !metadataNames.includes(f.name)),
      metadata: parsed.filter((f) => metadataNames.includes(f.name)),
    };
  });

  events.sort(compareEvents);
  enums.sort((a, b) => a.fullName.localeCompare(b.fullName));
  problems.sort();
  return { events, enums, problems };
}

/** Serviços citados nos eventos: os conhecidos na ordem do roadmap, depois os demais. */
export function listServices(events: readonly EventDefinition[]): string[] {
  const seen = new Set<string>(SERVICE_ORDER);
  const extra = new Set<string>();
  for (const e of events) {
    for (const s of [e.producer, ...e.consumers]) {
      if (s && !seen.has(s)) extra.add(s);
    }
  }
  return [...SERVICE_ORDER, ...[...extra].sort()];
}

/** Papel do serviço no evento: publica, consome ou nenhum (undefined). */
export function roleOf(event: EventDefinition, service: string): ServiceRole | undefined {
  if (event.producer === service) return 'publica';
  if (event.consumers.includes(service)) return 'consome';
  return undefined;
}

/** Eventos que o serviço publica ou consome; 'todos' devolve a lista inteira. */
export function filterByService(
  events: readonly EventDefinition[],
  service: string,
): EventDefinition[] {
  if (service === 'todos') return [...events];
  return events.filter((e) => roleOf(e, service) !== undefined);
}
