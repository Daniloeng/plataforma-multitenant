import { createDemoAuthClient, DEMO_USER_KEY } from './demo';

describe('createDemoAuthClient', () => {
  it('entra como um usuário de demonstração com token demo-<usuario>', async () => {
    const client = createDemoAuthClient();
    expect(client.kind).toBe('demo');
    expect(await client.init()).toBeNull();
    expect(await client.login('ana')).toEqual({ usuario: 'ana', accessToken: 'demo-ana' });
    expect(window.sessionStorage.getItem(DEMO_USER_KEY)).toBe('ana');
    expect(client.getAccessToken()).toBe('demo-ana');
    // Recarregar a página (novo cliente) mantém a sessão da aba.
    expect(await createDemoAuthClient().init()).toEqual({
      usuario: 'ana',
      accessToken: 'demo-ana',
    });
  });

  it('rejeita usuário desconhecido', async () => {
    await expect(createDemoAuthClient().login('zeca')).rejects.toThrow('desconhecido');
    await expect(createDemoAuthClient().login()).rejects.toThrow('desconhecido');
  });

  it('logout e clear esquecem a sessão; o token não expira', async () => {
    const client = createDemoAuthClient();
    await client.login('bruno');
    await client.logout();
    expect(client.getAccessToken()).toBeNull();
    await client.login('bruno');
    await client.clear();
    expect(await client.init()).toBeNull();
    const unsubscribe = client.onExpired(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it('funciona mesmo sem sessionStorage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const client = createDemoAuthClient();
    expect(await client.init()).toBeNull();
    await expect(client.login('ana')).resolves.toBeNull();
    spy.mockRestore();
    set.mockRestore();
  });
});
