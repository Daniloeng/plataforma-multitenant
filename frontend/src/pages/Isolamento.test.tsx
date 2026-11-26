// Dia 9: selo do nível no cabeçalho, promoção na página Tenants, isolamento dos pedidos e o 503
// tenant-em-migracao nas telas de negócio (tudo contra o modo demo, MSW).

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from '../App';
import { MENSAGEM_TENANT_EM_MIGRACAO } from '../api/http';
import { createDemoAuthClient } from '../auth/demo';
import { ISOLAMENTO_POLL_MS } from '../hooks/useIsolamentoPedidos';
import { MIGRACAO_MS, iniciarMigracao } from '../mocks/isolamento';
import { server } from '../mocks/server';
import { SEED_TENANTS, resetTenantStore } from '../mocks/tenants';

type User = ReturnType<typeof userEvent.setup>;

const AURORA = 'distribuidora-aurora';
const POOL = 'Pool: dados compartilhados, filtrados por tenant';
const BRIDGE = 'Bridge: database e namespace Pulsar dedicados';

afterEach(() => {
  window.location.hash = '';
  vi.useRealTimers();
});

/** Abre o hash no modo demo, entra como `nome` e, se pedido, escolhe o tenant no cabeçalho. */
async function abrir(nome: string, tenant?: string, hash = '#/conta'): Promise<User> {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App authClient={createDemoAuthClient()} />);
  await user.click(await screen.findByRole('button', { name: 'Entrar' }));
  const dialog = screen.getByRole('dialog', { name: 'Entrar no modo demo' });
  await user.click(within(dialog).getByRole('button', { name: new RegExp(`Entrar como ${nome}`) }));
  await screen.findByRole('button', { name: 'Sair' });
  if (tenant) await user.selectOptions(await within(sessao()).findByLabelText('Tenant'), tenant);
  return user;
}

function sessao() {
  return screen.getByRole('region', { name: 'Sessão' });
}

function irPara(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

/** Avança o relógio falso (setTimeout e Date) e deixa as respostas chegarem. */
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function isolamento() {
  return screen.getByRole('status', { name: 'Isolamento dos pedidos' });
}

/** Aurora já promovida para Bridge e migrando (como logo depois do POST de promoção). */
function auroraMigrando() {
  resetTenantStore(
    SEED_TENANTS.map((t) => (t.id === AURORA ? { ...t, nivelIsolamento: 'BRIDGE' } : t)),
  );
  iniciarMigracao(AURORA);
}

describe('selo do nível no cabeçalho', () => {
  it('mostra o nível do tenant escolhido, com cor e explicação', async () => {
    const user = await abrir('Ana Souza', AURORA);
    const selo = within(sessao()).getByTitle(POOL);
    expect(selo).toHaveClass('pill--nivel-pool');
    expect(selo).toHaveTextContent('Pool');
    // O leitor de tela lê a explicação (o select aponta para ela com aria-describedby).
    expect(within(sessao()).getByLabelText('Tenant')).toHaveAccessibleDescription(
      `Plano Profissional · 20 req/s Nível ${POOL}`,
    );

    await user.selectOptions(within(sessao()).getByLabelText('Tenant'), 'atacado-vale-verde');
    expect(within(sessao()).getByTitle(BRIDGE)).toHaveClass('pill--nivel-bridge');
  });

  it('sem tenant escolhido, não há selo', async () => {
    await abrir('Ana Souza');
    expect(within(sessao()).getByText('Nenhum tenant selecionado')).toBeVisible();
    expect(within(sessao()).queryByTitle(POOL)).not.toBeInTheDocument();
  });
});

describe('promoção na página Tenants', () => {
  it('admin promove o tenant do cabeçalho: a linha e o selo do cabeçalho mudam', async () => {
    const user = await abrir('Administradora', AURORA, '#/tenants');
    expect(within(sessao()).getByTitle(POOL)).toBeVisible();
    const linha = await screen.findByRole('row', { name: AURORA });

    await user.click(within(linha).getByRole('button', { name: `Promover ${AURORA}` }));
    const form = within(linha).getByRole('form', { name: `Promover ${AURORA}` });
    const select = within(form).getByLabelText(`Novo nível de ${AURORA}`);
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Bridge', 'Silo']);
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));

    expect(await within(linha).findByTitle(BRIDGE)).toHaveClass('pill--nivel-bridge');
    expect(within(linha).queryByRole('form')).not.toBeInTheDocument();
    const aviso = screen.getByText(/promovido para Bridge/).closest('[role="status"]')!;
    expect(aviso).toHaveTextContent(
      'Os serviços migram os dados do tenant para o nível novo em segundos',
    );
    expect(aviso).toHaveTextContent('tenant-em-migracao');
    // O /api/v1/me é recarregado: o selo do cabeçalho mostra o nível novo.
    expect(await within(sessao()).findByTitle(BRIDGE)).toBeVisible();
  });
});

describe('isolamento dos pedidos (gestor e admin)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  it('Pool: database compartilhada pedidos', async () => {
    await abrir('Ana Souza', AURORA, '#/pedidos');
    await screen.findByRole('table', { name: 'Pedidos do tenant' });
    expect(await screen.findByText('pedidos')).toBeVisible();
    expect(isolamento()).toHaveTextContent(
      'Seus pedidos ficam na database compartilhada pedidos (Pool)',
    );
  });

  it('durante a migração mostra "Migrando dados…", consulta a cada 1 s e só então carrega a lista', async () => {
    let consultas = 0;
    let listas = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/api/v1/isolamento/pedidos')) consultas += 1;
      if (new URL(request.url).pathname.endsWith('/api/v1/pedidos')) listas += 1;
    });
    await abrir('Ana Souza', AURORA);
    auroraMigrando();
    irPara('#/pedidos');

    expect(await screen.findByText(/Migrando dados…/)).toBeVisible();
    expect(isolamento()).toHaveTextContent(
      `os pedidos estão indo para a database pedidos_t_${AURORA}`,
    );
    // A lista espera a migração (não recebe o 503): segue "Carregando pedidos…".
    expect(screen.getByText('Carregando pedidos…')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listas).toBe(0);
    const antes = consultas;

    await avancar(ISOLAMENTO_POLL_MS);
    expect(consultas).toBeGreaterThan(antes);
    expect(listas).toBe(0);
    await avancar(MIGRACAO_MS);
    expect(await screen.findByText(`pedidos_t_${AURORA}`)).toBeVisible();
    expect(isolamento()).toHaveTextContent(
      `Seus pedidos ficam na database pedidos_t_${AURORA} (Bridge)`,
    );
    expect(isolamento()).toHaveTextContent('migrado em');
    // A migração terminou: a lista carrega sozinha.
    expect(await screen.findByRole('table', { name: 'Pedidos do tenant' })).toBeVisible();
    expect(listas).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Tentar de novo" recarrega a lista depois da migração', async () => {
    server.use(
      http.get('*/api/v1/isolamento/pedidos', () => new HttpResponse(null, { status: 500 })),
    );
    const user = await abrir('Ana Souza', AURORA);
    auroraMigrando();
    irPara('#/pedidos');
    // Sem saber do isolamento, a lista carrega e recebe o 503: mensagem clara e "Tentar de novo",
    // sem a dica do Docker.
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      `Não foi possível carregar os pedidos. ${MENSAGEM_TENANT_EM_MIGRACAO}`,
    );
    expect(alerta).toHaveClass('alert--warn');
    expect(alerta).not.toHaveTextContent('docker compose');
    expect(isolamento()).toHaveTextContent(
      'Não foi possível saber onde ficam os pedidos: A API respondeu com HTTP 500.',
    );
    await avancar(MIGRACAO_MS);
    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table', { name: 'Pedidos do tenant' })).toBeVisible();
  });

  it('503 na própria consulta do isolamento: mostra "Migrando dados…" e tenta de novo', async () => {
    let respostas = 0;
    server.use(
      http.get('*/api/v1/isolamento/pedidos', () => {
        respostas += 1;
        if (respostas > 1) return undefined; // segue para o handler padrão
        return HttpResponse.json(
          {
            type: 'https://plataforma.dev.br/problemas/tenant-em-migracao',
            title: 'Tenant em migração',
            status: 503,
          },
          { status: 503 },
        );
      }),
    );
    await abrir('Ana Souza', AURORA, '#/pedidos');
    expect(await screen.findByText(/Migrando dados…/)).toBeVisible();
    expect(isolamento()).toHaveTextContent('os pedidos estão mudando de nível de isolamento.');
    await avancar(ISOLAMENTO_POLL_MS);
    expect(await screen.findByText(/database compartilhada/)).toBeVisible();
    expect(respostas).toBe(2);
  });

  it('comprador não vê o isolamento (a API responde 403 para ele)', async () => {
    await abrir('Bruno Lima', undefined, '#/pedidos');
    await screen.findByRole('table', { name: 'Pedidos do tenant' });
    expect(
      screen.queryByRole('status', { name: 'Isolamento dos pedidos' }),
    ).not.toBeInTheDocument();
  });
});

describe('503 tenant-em-migracao nas telas de negócio', () => {
  it('Produtos mostra a mensagem da migração com "Tentar de novo"', async () => {
    const user = await abrir('Ana Souza', AURORA);
    auroraMigrando();
    irPara('#/produtos');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      `Não foi possível carregar o catálogo. ${MENSAGEM_TENANT_EM_MIGRACAO}`,
    );
    expect(alerta).not.toHaveTextContent('docker compose');
    // A migração simulada termina em 1,5 s; "Tentar de novo" depois disso traz o catálogo.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    vi.setSystemTime(Date.now() + MIGRACAO_MS);
    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table', { name: /Produtos/ })).toBeVisible();
  });

  it('Pagamentos mostra a mensagem nos pagamentos e no extrato', async () => {
    await abrir('Ana Souza', AURORA);
    auroraMigrando();
    irPara('#/pagamentos');
    expect(await screen.findByText('Não foi possível carregar os pagamentos.')).toBeVisible();
    expect(await screen.findByText('Não foi possível carregar o extrato.')).toBeVisible();
    const alertas = screen.getAllByRole('alert');
    expect(alertas).toHaveLength(2);
    for (const a of alertas) {
      expect(a).toHaveTextContent(MENSAGEM_TENANT_EM_MIGRACAO);
      expect(within(a).getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    }
  });
});
