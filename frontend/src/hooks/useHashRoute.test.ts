import { act, renderHook } from '@testing-library/react';
import { parseHash, parsePedidoId, pedidoHash, useHash, useHashRoute } from './useHashRoute';

afterEach(() => {
  window.location.hash = '';
});

describe('useHashRoute', () => {
  it.each([
    ['', 'status'],
    ['#/', 'status'],
    ['#/arquitetura', 'arquitetura'],
    ['#arquitetura/', 'arquitetura'],
    ['#/ARQUITETURA', 'arquitetura'],
    ['#/tenants', 'tenants'],
    ['#/Tenants/', 'tenants'],
    ['#/produtos', 'produtos'],
    ['#/pedidos', 'pedidos'],
    ['#/pedidos/ped-n00001', 'pedidos'],
    ['#/Pedidos/', 'pedidos'],
    ['#/outra', 'status'],
  ])('%s → %s', (hash, route) => {
    expect(parseHash(hash)).toBe(route);
  });

  it('acompanha mudanças do hash', () => {
    const { result, unmount } = renderHook(() => useHashRoute());
    expect(result.current).toBe('status');
    act(() => {
      window.location.hash = '#/arquitetura';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current).toBe('arquitetura');
    unmount();
  });

  it.each([
    ['#/pedidos', null],
    ['#/pedidos/', null],
    ['#/pedidos/Ped-AB12', 'Ped-AB12'],
    ['#pedidos/ped%20x/', 'ped x'],
    ['#/pedidos/%E0%A4%A', null],
    ['#/pedidos/a/b', null],
    ['#/produtos/x', null],
  ])('parsePedidoId(%s) → %s', (hash, id) => {
    expect(parsePedidoId(hash)).toBe(id);
  });

  it('pedidoHash codifica o id e volta pelo parsePedidoId', () => {
    expect(pedidoHash('ped 1/2')).toBe('#/pedidos/ped%201%2F2');
    expect(parsePedidoId(pedidoHash('ped 1/2'))).toBe('ped 1/2');
  });

  it('useHash acompanha o hash bruto', () => {
    const { result, unmount } = renderHook(() => useHash());
    expect(result.current).toBe('');
    act(() => {
      window.location.hash = '#/pedidos/X1';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current).toBe('#/pedidos/X1');
    unmount();
  });
});
