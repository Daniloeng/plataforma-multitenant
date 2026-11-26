import { act, renderHook } from '@testing-library/react';
import type { Produto } from '../api/catalogo';
import { makeProdutos } from '../test/fixtures';
import { carrinhoKey, lerCarrinho, useCarrinho } from './useCarrinho';

const [p1, p2] = makeProdutos(2) as [Produto, Produto];
const caro: Produto = { ...p2, preco: { centavos: 12345, moeda: 'BRL' } };

const KEY_A = carrinhoKey('bruno', 'tenant-a');
const KEY_B = carrinhoKey('bruno', 'tenant-b');

afterEach(() => vi.restoreAllMocks());

describe('useCarrinho', () => {
  it('adiciona, soma quantidades, edita, remove e calcula o total estimado', () => {
    const { result } = renderHook(() => useCarrinho(KEY_A));
    expect(result.current.itens).toEqual([]);
    expect(result.current.totalEstimado).toEqual({ centavos: 0, moeda: 'BRL' });

    act(() => void result.current.adicionar(p1, 2));
    act(() => void result.current.adicionar(caro, 1));
    act(() => void result.current.adicionar(p1, 3));
    expect(result.current.itens.map((i) => [i.sku, i.quantidade])).toEqual([
      ['PRD-001', 5],
      ['PRD-002', 1],
    ]);
    expect(result.current.unidades).toBe(6);
    expect(result.current.totalEstimado).toEqual({ centavos: 5 * 1000 + 12345, moeda: 'BRL' });

    act(() => result.current.definirQuantidade(p1.id, 20000));
    expect(result.current.itens[0]!.quantidade).toBe(10000);
    act(() => result.current.definirQuantidade(p1.id, 0));
    expect(result.current.itens[0]!.quantidade).toBe(1);

    act(() => result.current.remover(p1.id));
    expect(result.current.itens.map((i) => i.sku)).toEqual(['PRD-002']);
    act(() => result.current.esvaziar());
    expect(result.current.itens).toEqual([]);
    expect(window.sessionStorage.getItem(KEY_A)).toBeNull();
  });

  it('guarda no sessionStorage e cada tenant tem o próprio carrinho', () => {
    const { result, rerender } = renderHook(({ k }) => useCarrinho(k), {
      initialProps: { k: KEY_A },
    });
    act(() => void result.current.adicionar(p1, 2));
    expect(JSON.parse(window.sessionStorage.getItem(KEY_A)!)).toEqual([
      {
        produtoId: p1.id,
        sku: 'PRD-001',
        nome: 'Produto 1',
        precoUnitario: { centavos: 1000, moeda: 'BRL' },
        quantidade: 2,
      },
    ]);

    rerender({ k: KEY_B });
    expect(result.current.itens).toEqual([]);
    act(() => void result.current.adicionar(caro, 7));

    rerender({ k: KEY_A });
    expect(result.current.itens.map((i) => [i.sku, i.quantidade])).toEqual([['PRD-001', 2]]);

    // Outra montagem (recarregar a página) lê o carrinho do tenant B.
    const outro = renderHook(() => useCarrinho(KEY_B));
    expect(outro.result.current.itens.map((i) => [i.sku, i.quantidade])).toEqual([['PRD-002', 7]]);
  });

  it('a chave separa usuários e tenants', () => {
    expect(carrinhoKey('bruno', 'x')).toBe('plataforma.carrinho.bruno.x');
    expect(carrinhoKey('bruno', 'x')).not.toBe(carrinhoKey('outro', 'x'));
  });

  it('aceita até 200 produtos (somar a um item existente continua valendo)', () => {
    const produtos = makeProdutos(200);
    window.sessionStorage.setItem(
      KEY_A,
      JSON.stringify(
        produtos.map((p) => ({
          produtoId: p.id,
          sku: p.sku,
          nome: p.nome,
          precoUnitario: p.preco,
          quantidade: 1,
        })),
      ),
    );
    const { result } = renderHook(() => useCarrinho(KEY_A));
    expect(result.current.itens).toHaveLength(200);
    let ok = true;
    act(() => {
      ok = result.current.adicionar({ ...p1, id: 'novo' }, 1);
    });
    expect(ok).toBe(false);
    expect(result.current.itens).toHaveLength(200);
    act(() => {
      ok = result.current.adicionar(produtos[0]!, 1);
    });
    expect(ok).toBe(true);
    expect(result.current.itens[0]!.quantidade).toBe(2);
  });

  it('storage indisponível: começa vazio e funciona em memória, sem erro', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });
    const { result } = renderHook(() => useCarrinho(KEY_A));
    expect(result.current.itens).toEqual([]);
    act(() => void result.current.adicionar(p1, 3));
    expect(setItem).toHaveBeenCalled();
    expect(result.current.itens.map((i) => i.quantidade)).toEqual([3]);
  });

  it('lerCarrinho ignora JSON inválido, formato errado e itens fora do formato; limita quantidades', () => {
    const ler = (raw: string) => {
      window.sessionStorage.setItem(KEY_A, raw);
      return lerCarrinho(KEY_A);
    };
    expect(lerCarrinho(KEY_A)).toEqual([]);
    expect(ler('{')).toEqual([]);
    expect(ler('{"a":1}')).toEqual([]);
    const valido = {
      produtoId: 'p',
      sku: 'S',
      nome: 'N',
      precoUnitario: { centavos: 1, moeda: 'BRL' },
      quantidade: 99999,
    };
    expect(
      ler(
        JSON.stringify([
          valido,
          null,
          { ...valido, precoUnitario: null },
          { ...valido, precoUnitario: { centavos: 1.5, moeda: 'BRL' } },
          { ...valido, quantidade: '2' },
        ]),
      ),
    ).toEqual([{ ...valido, quantidade: 10000 }]);
  });
});
