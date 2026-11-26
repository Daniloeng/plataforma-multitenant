import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { signInAs } from '../test/session';
import {
  describeMeError,
  describePlano,
  fetchMe,
  isPapel,
  rajada,
  tamanhoDaRajada,
  testarLimite,
} from './me';
import { ApiError } from './http';

describe('limites por plano', () => {
  it('descreve o plano com o limite do gateway e calcula a rajada (2x)', () => {
    expect(describePlano('GRATUITO')).toBe('Plano Gratuito · 5 req/s');
    expect(describePlano('PROFISSIONAL')).toBe('Plano Profissional · 20 req/s');
    expect(describePlano('EMPRESARIAL')).toBe('Plano Empresarial · 50 req/s');
    expect(rajada('PROFISSIONAL')).toBe(40);
  });

  it('o teste dispara a rajada + 20 requisições, no mínimo 30', () => {
    expect(tamanhoDaRajada('GRATUITO')).toBe(30);
    expect(tamanhoDaRajada('PROFISSIONAL')).toBe(60);
    expect(tamanhoDaRajada('EMPRESARIAL')).toBe(120);
  });

  it('reconhece só os papéis do contrato', () => {
    expect(isPapel('comprador')).toBe(true);
    expect(isPapel('root')).toBe(false);
    expect(isPapel(1)).toBe(false);
  });
});

describe('fetchMe', () => {
  it('lê o usuário do gateway simulado (sem X-Tenant-Id)', async () => {
    let tenantHeader: string | null = 'não lido';
    server.events.on('request:start', ({ request }) => {
      tenantHeader = request.headers.get('X-Tenant-Id');
    });
    signInAs('bruno', 'farmaceutica-boa-saude');
    const me = await fetchMe();
    server.events.removeAllListeners();
    expect(tenantHeader).toBeNull();
    expect(me).toEqual({
      usuario: 'bruno',
      nome: 'Bruno Lima',
      papeis: ['comprador'],
      clienteId: 'cli-bruno',
      tenants: [
        {
          id: 'farmaceutica-boa-saude',
          nome: 'Farmacêutica Boa Saúde Distribuidora',
          plano: 'PROFISSIONAL',
          nivelIsolamento: 'POOL',
          ativo: true,
        },
      ],
    });
  });

  it('descarta papéis desconhecidos e aceita nome/clienteId ausentes', async () => {
    server.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({ usuario: 'x', papeis: ['comprador', 'novo-papel'], tenants: [] }),
      ),
    );
    expect(await fetchMe()).toEqual({
      usuario: 'x',
      nome: null,
      papeis: ['comprador'],
      clienteId: null,
      tenants: [],
    });
  });

  it('rejeita resposta fora do contrato e 401 com o detail', async () => {
    server.use(
      http.get('*/api/v1/me', () => HttpResponse.json({ usuario: 'x', papeis: [], tenants: [1] })),
    );
    await expect(fetchMe()).rejects.toThrow('fora do contrato');
    server.resetHandlers();
    await expect(fetchMe()).rejects.toMatchObject({
      httpStatus: 401,
      problemType: 'https://plataforma.dev.br/problemas/nao-autenticado',
    });
  });

  it('describeMeError usa a mensagem da API ou explica a falha de rede', () => {
    expect(describeMeError(new ApiError('Negado.', 403))).toBe('Negado.');
    expect(describeMeError(new TypeError('fetch failed'))).toBe(
      'Não foi possível conectar ao gateway.',
    );
  });
});

describe('testarLimite', () => {
  it('conta 200 e 429 pelo limite do plano do tenant (Gratuito: rajada de 10)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    signInAs('admin', 'ceramica-paraiba');
    // ceramica-paraiba é Gratuito, mas está suspenso: o gateway responde 403.
    const suspenso = await testarLimite(3);
    expect(suspenso).toMatchObject({ ok: 0, limitadas: 0, outras: 3 });
    expect(suspenso.primeiroErro).toBe("O tenant 'ceramica-paraiba' está suspenso.");

    signInAs('ana', 'distribuidora-aurora');
    const r = await testarLimite(60);
    expect(r).toEqual({
      total: 60,
      ok: 40,
      limitadas: 20,
      outras: 0,
      retryAfterSeconds: 1,
      primeiroErro: null,
    });
    vi.restoreAllMocks();
  });

  it('conta falhas de rede e 429 sem Retry-After', async () => {
    let n = 0;
    server.use(
      http.get('*/api/v1/me', () => {
        n += 1;
        if (n === 1) return HttpResponse.error();
        return new HttpResponse(null, { status: 429 });
      }),
    );
    const r = await testarLimite(3);
    expect(r).toMatchObject({ ok: 0, limitadas: 2, outras: 1, retryAfterSeconds: null });
    expect(r.primeiroErro).toBe('Não foi possível conectar ao gateway.');
  });
});
