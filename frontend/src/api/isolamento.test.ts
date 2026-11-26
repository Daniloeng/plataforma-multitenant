import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { ApiError } from './http';
import {
  describeIsolamentoError,
  descreveLocal,
  fetchIsolamentoPedidos,
  isSituacaoIsolamento,
  type Isolamento,
} from './isolamento';
import { signInAs } from '../test/session';

const pronto: Isolamento = {
  tenantId: 'acme',
  nivel: 'BRIDGE',
  database: 'pedidos_t_acme',
  situacao: 'PRONTO',
  migradoEm: '2026-11-26T12:00:00Z',
};

describe('fetchIsolamentoPedidos', () => {
  it('consulta com o X-Tenant-Id da sessão e devolve a posição dos dados', async () => {
    signInAs('ana', 'atacado-vale-verde');
    await expect(fetchIsolamentoPedidos()).resolves.toEqual({
      tenantId: 'atacado-vale-verde',
      nivel: 'BRIDGE',
      database: 'pedidos_t_atacado-vale-verde',
      situacao: 'PRONTO',
      migradoEm: null,
    });
  });

  it('aceita migradoEm ausente (vira null)', async () => {
    signInAs('ana', 'distribuidora-aurora');
    const { migradoEm: _, ...semData } = pronto;
    server.use(http.get('*/api/v1/isolamento/pedidos', () => HttpResponse.json(semData)));
    await expect(fetchIsolamentoPedidos()).resolves.toMatchObject({ migradoEm: null });
  });

  it('recusa corpo fora do contrato', async () => {
    signInAs('ana', 'distribuidora-aurora');
    server.use(
      http.get('*/api/v1/isolamento/pedidos', () =>
        HttpResponse.json({ ...pronto, situacao: 'PARADO' }),
      ),
    );
    await expect(fetchIsolamentoPedidos()).rejects.toThrow('fora do contrato');
  });

  it('comprador recebe 403', async () => {
    signInAs('bruno', 'farmaceutica-boa-saude');
    const erro: unknown = await fetchIsolamentoPedidos().catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).httpStatus).toBe(403);
  });
});

describe('descreveLocal', () => {
  it('Pool fica na database compartilhada; Bridge e Silo, na dedicada', () => {
    expect(
      descreveLocal({ ...pronto, nivel: 'POOL', database: 'pedidos', migradoEm: null }),
    ).toEqual({
      antes: 'Seus pedidos ficam na database compartilhada',
      database: 'pedidos',
      depois: '(Pool)',
    });
    expect(descreveLocal(pronto)).toEqual({
      antes: 'Seus pedidos ficam na database',
      database: 'pedidos_t_acme',
      depois: '(Bridge)',
    });
    expect(descreveLocal({ ...pronto, nivel: 'SILO' }).depois).toBe('(Silo)');
  });
});

describe('guards e erros', () => {
  it('reconhece as situações do contrato', () => {
    expect(isSituacaoIsolamento('PRONTO')).toBe(true);
    expect(isSituacaoIsolamento('MIGRANDO')).toBe(true);
    expect(isSituacaoIsolamento('x')).toBe(false);
  });

  it('usa a mensagem do ApiError e traduz falhas de rede', () => {
    expect(describeIsolamentoError(new ApiError('detalhe', 403))).toBe('detalhe');
    expect(describeIsolamentoError(new TypeError('Failed to fetch'))).toBe(
      'Não foi possível conectar ao pedidos-service.',
    );
  });
});
