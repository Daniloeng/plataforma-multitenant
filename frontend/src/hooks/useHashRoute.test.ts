import { act, renderHook } from '@testing-library/react';
import { parseHash, useHashRoute } from './useHashRoute';

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
});
