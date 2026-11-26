import {
  COMPONENT_STATUS_LABEL,
  PLATFORM_STATUS_LABEL,
  formatDateTime,
  formatLatency,
} from './format';

describe('formatDateTime', () => {
  it('formata em pt-BR no horário de Brasília', () => {
    expect(formatDateTime('2026-11-26T12:00:00Z')).toBe('26/11/2026, 09:00:00');
  });

  it('indica data inválida', () => {
    expect(formatDateTime('ontem')).toBe('data inválida');
  });
});

describe('formatLatency', () => {
  it.each([
    [3, '3 ms'],
    [12.4, '12 ms'],
    [0, '< 1 ms'],
    [0.4, '< 1 ms'],
    [1530, '1,5 s'],
    [2000, '2 s'],
    [null, '—'],
    [undefined, '—'],
    [Number.NaN, '—'],
    [-1, '—'],
  ])('%s -> %s', (input, expected) => {
    expect(formatLatency(input)).toBe(expected);
  });
});

describe('rótulos', () => {
  it('traduz os status', () => {
    expect(PLATFORM_STATUS_LABEL).toEqual({
      UP: 'Operacional',
      DEGRADED: 'Degradada',
      DOWN: 'Fora do ar',
    });
    expect(COMPONENT_STATUS_LABEL.DOWN).toBe('Indisponível');
  });
});
