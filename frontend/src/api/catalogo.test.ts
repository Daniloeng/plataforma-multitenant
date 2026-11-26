import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { signInAs } from '../test/session';
import {
  PROBLEMA_LIMITE_DO_PLANO,
  PROBLEMA_SKU_DUPLICADO,
  centavosParaTexto,
  createProduto,
  describeProdutoError,
  formatDinheiro,
  getProduto,
  isProduto,
  listProdutos,
  podeGerirCatalogo,
  problemTypeOf,
  produtosUrl,
  reaisParaCentavos,
  updatePreco,
  updateProduto,
  validateNomeProduto,
  validateSku,
} from './catalogo';
import { ApiError } from './http';

/** Intl usa espaço não separável depois de "R$". */
const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('reaisParaCentavos', () => {
  it.each([
    ['12,90', 1290],
    ['12,9', 1290],
    ['12', 1200],
    ['12,', 1200],
    [',5', 50],
    ['0,05', 5],
    ['0', 0],
    ['0,00', 0],
    ['R$ 12,90', 1290],
    ['r$12,90', 1290],
    ['  7,5  ', 750],
    ['1.234,56', 123456],
    ['1.234.567,89', 123456789],
    ['1.234', 123400],
    ['12.9', 1290],
    ['12.90', 1290],
    ['0.1', 10],
    ['007,10', 710],
    // 0,1 + 0,2 em ponto flutuante dá 0,30000000000000004: aqui a conta é só com inteiros.
    ['0,29', 29],
    ['1,13', 113],
    ['4,35', 435],
    ['1.005,99', 100599],
    ['9999999999999,99', 999999999999999],
    ['1 234,00', 123400],
  ])('%s → %i centavos', (texto, centavos) => {
    expect(reaisParaCentavos(texto)).toEqual({ centavos });
  });

  it.each([
    ['', 'Informe o preço.'],
    ['   ', 'Informe o preço.'],
    ['R$', 'Informe o preço.'],
    ['-1,00', 'O preço não pode ser negativo.'],
    ['1,2,3', 'Use só uma vírgula, antes dos centavos.'],
    ['12,345', 'Use no máximo duas casas decimais.'],
    ['1.23,45', 'Pontos só separam milhares (ex.: 1.234,56).'],
    ['12.345.6', 'Digite o preço em reais, ex.: 12,90.'],
    ['12.345,6a', 'Digite o preço em reais, ex.: 12,90.'],
    ['abc', 'Digite o preço em reais, ex.: 12,90.'],
    ['1e3', 'Digite o preço em reais, ex.: 12,90.'],
    ['12.999', undefined],
    ['10000000000000', 'Preço alto demais.'],
  ])('%s → erro', (texto, erro) => {
    const resultado = reaisParaCentavos(texto);
    if (erro === undefined) {
      // "12.999" é milhar no pt-BR: 12.999 reais.
      expect(resultado).toEqual({ centavos: 1299900 });
    } else {
      expect(resultado).toEqual({ erro });
    }
  });
});

describe('centavosParaTexto e formatDinheiro', () => {
  it.each([
    [1290, '12,90'],
    [5, '0,05'],
    [0, '0,00'],
    [100, '1,00'],
    [123456, '1234,56'],
  ])('%i → %s', (centavos, texto) => {
    expect(centavosParaTexto(centavos)).toBe(texto);
    expect(reaisParaCentavos(texto)).toEqual({ centavos });
  });

  it('formata em R$ pt-BR a partir de centavos', () => {
    expect(nbsp(formatDinheiro({ centavos: 1290, moeda: 'BRL' }))).toBe('R$ 12,90');
    expect(nbsp(formatDinheiro({ centavos: 123456789, moeda: 'BRL' }))).toBe('R$ 1.234.567,89');
    expect(nbsp(formatDinheiro({ centavos: 0, moeda: 'BRL' }))).toBe('R$ 0,00');
    expect(nbsp(formatDinheiro({ centavos: 1000, moeda: 'USD' }))).toBe('US$ 10,00');
    // Moeda inválida para o Intl: cai no real (e o formatador fica em cache).
    expect(nbsp(formatDinheiro({ centavos: 1000, moeda: 'X1' }))).toBe('R$ 10,00');
    expect(nbsp(formatDinheiro({ centavos: 1000, moeda: 'X1' }))).toBe('R$ 10,00');
  });
});

describe('validação', () => {
  it('SKU segue o pattern do contrato', () => {
    expect(validateSku('CAF-TOR-500')).toBeNull();
    expect(validateSku('ABC')).toBeNull();
    expect(validateSku('A'.repeat(32))).toBeNull();
    expect(validateSku('')).toBe('Informe o SKU.');
    for (const invalido of ['AB', 'A'.repeat(33), 'caf-1', 'CAF 1', 'CAF_1', 'CAFÉ']) {
      expect(validateSku(invalido)).toBe(
        'Use de 3 a 32 caracteres: letras maiúsculas, números e hífen.',
      );
    }
  });

  it('nome tem de 2 a 200 caracteres (sem contar espaços nas pontas)', () => {
    expect(validateNomeProduto('Café')).toBeNull();
    expect(validateNomeProduto('ab')).toBeNull();
    expect(validateNomeProduto('a'.repeat(200))).toBeNull();
    expect(validateNomeProduto('   ')).toBe('Informe o nome do produto.');
    expect(validateNomeProduto(' a ')).toBe('O nome deve ter de 2 a 200 caracteres.');
    expect(validateNomeProduto('a'.repeat(201))).toBe('O nome deve ter de 2 a 200 caracteres.');
  });

  it('só gestor-tenant e plataforma-admin gerem o catálogo', () => {
    expect(podeGerirCatalogo(['gestor-tenant'])).toBe(true);
    expect(podeGerirCatalogo(['plataforma-admin'])).toBe(true);
    expect(podeGerirCatalogo(['comprador'])).toBe(false);
    expect(podeGerirCatalogo([])).toBe(false);
  });

  it('isProduto confere o formato do contrato', () => {
    const base = { id: 'p', sku: 'ABC', nome: 'X', preco: { centavos: 1, moeda: 'BRL' } };
    expect(isProduto({ ...base, ativo: true })).toBe(true);
    expect(isProduto({ ...base, ativo: true, criadoEm: null })).toBe(true);
    expect(isProduto({ ...base, ativo: 'sim' })).toBe(false);
    expect(isProduto({ ...base, ativo: true, preco: { centavos: 1.5, moeda: 'BRL' } })).toBe(false);
    expect(isProduto({ ...base, ativo: true, preco: { centavos: -1, moeda: 'BRL' } })).toBe(false);
    expect(isProduto({ ...base, ativo: true, preco: null })).toBe(false);
    expect(isProduto({ ...base, ativo: true, atualizadoEm: 1 })).toBe(false);
    expect(isProduto(null)).toBe(false);
  });
});

describe('produtosUrl', () => {
  it('monta as URLs respeitando o BASE_URL', () => {
    expect(produtosUrl(undefined, undefined, '/plataforma-multitenant/', 'https://x.io')).toBe(
      'https://x.io/plataforma-multitenant/api/v1/produtos',
    );
    expect(produtosUrl('a b', undefined, '/', 'https://x.io')).toBe(
      'https://x.io/api/v1/produtos/a%20b',
    );
    expect(produtosUrl('p1', 'preco', '/', 'https://x.io')).toBe(
      'https://x.io/api/v1/produtos/p1/preco',
    );
  });
});

describe('cliente do catálogo (contra o mock)', () => {
  beforeEach(() => signInAs('ana', 'distribuidora-aurora'));

  it('lista com token e X-Tenant-Id, limite, cursor, busca e ativo', async () => {
    const seen: URL[] = [];
    const headers: Headers[] = [];
    server.events.on('request:start', ({ request }) => {
      seen.push(new URL(request.url));
      headers.push(request.headers);
    });
    const pagina = await listProdutos({ limite: 5 });
    expect(pagina.itens).toHaveLength(5);
    expect(pagina.proximoCursor).toBe(pagina.itens[4]!.id);
    expect(pagina).toMatchObject({ total: 12, limitePlano: 500, usados: 12 });
    expect(headers[0]!.get('Authorization')).toBe('Bearer demo-ana');
    expect(headers[0]!.get('X-Tenant-Id')).toBe('distribuidora-aurora');

    await listProdutos({ cursor: pagina.proximoCursor, busca: '  café ', ativo: true });
    expect(seen[1]!.searchParams.get('limite')).toBe('20');
    expect(seen[1]!.searchParams.get('cursor')).toBe(pagina.proximoCursor);
    expect(seen[1]!.searchParams.get('busca')).toBe('café');
    expect(seen[1]!.searchParams.get('ativo')).toBe('true');
    server.events.removeAllListeners();
  });

  it('proximoCursor ausente vira null', async () => {
    server.use(
      http.get('*/api/v1/produtos', () =>
        HttpResponse.json({ itens: [], total: 0, limitePlano: 20, plano: 'GRATUITO', usados: 0 }),
      ),
    );
    expect(await listProdutos()).toEqual({
      itens: [],
      proximoCursor: null,
      total: 0,
      limitePlano: 20,
      plano: 'GRATUITO',
      usados: 0,
    });
  });

  it('resposta fora do contrato vira ApiError', async () => {
    server.use(http.get('*/api/v1/produtos', () => HttpResponse.json({ itens: [] })));
    await expect(listProdutos()).rejects.toThrow(
      'A resposta da API está fora do contrato esperado.',
    );
  });

  it('cria, obtém, renomeia, desativa e muda o preço', async () => {
    const criado = await createProduto({
      sku: 'NOVO-1',
      nome: 'Produto novo',
      preco: { centavos: 1290, moeda: 'BRL' },
    });
    expect(criado).toMatchObject({ sku: 'NOVO-1', ativo: true, preco: { centavos: 1290 } });
    expect(await getProduto(criado.id)).toEqual(criado);
    expect(await updateProduto(criado.id, { nome: 'Outro nome' })).toMatchObject({
      nome: 'Outro nome',
    });
    expect(await updateProduto(criado.id, { ativo: false })).toMatchObject({ ativo: false });
    expect(await updatePreco(criado.id, { centavos: 990, moeda: 'BRL' })).toMatchObject({
      preco: { centavos: 990, moeda: 'BRL' },
    });
  });

  it('SKU duplicado traz o type sku-duplicado e o detail', async () => {
    const erro = await createProduto({
      sku: 'CAF-TOR-500',
      nome: 'Café',
      preco: { centavos: 1, moeda: 'BRL' },
    }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect(problemTypeOf(erro)).toBe(PROBLEMA_SKU_DUPLICADO);
    expect(describeProdutoError(erro)).toBe(
      "Já existe um produto com o SKU 'CAF-TOR-500' neste tenant.",
    );
    expect(PROBLEMA_LIMITE_DO_PLANO).toBe('https://plataforma.dev.br/problemas/limite-do-plano');
  });

  it('falha de rede vira mensagem do catalogo-service', async () => {
    server.use(http.get('*/api/v1/produtos/:id', () => HttpResponse.error()));
    const erro = await getProduto('x').catch((e: unknown) => e);
    expect(describeProdutoError(erro)).toBe('Não foi possível conectar ao catalogo-service.');
    expect(problemTypeOf(erro)).toBeNull();
  });
});
