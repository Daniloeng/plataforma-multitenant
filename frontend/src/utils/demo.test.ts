import { isDemoMode } from './demo';

afterEach(() => vi.unstubAllEnvs());

describe('isDemoMode', () => {
  it('é true apenas quando VITE_DEMO = "true"', () => {
    vi.stubEnv('VITE_DEMO', 'true');
    expect(isDemoMode()).toBe(true);
    vi.stubEnv('VITE_DEMO', 'false');
    expect(isDemoMode()).toBe(false);
  });

  it('é false sem a variável', () => {
    vi.stubEnv('VITE_DEMO', '');
    expect(isDemoMode()).toBe(false);
  });
});
