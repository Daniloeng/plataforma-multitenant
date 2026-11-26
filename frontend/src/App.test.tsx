import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { App } from './App';
import { server } from './mocks/server';
import { makeStatus } from './test/fixtures';

function mockApi(body: JsonBodyType) {
  server.use(http.get('*/api/status', () => HttpResponse.json(body)));
}

afterEach(() => vi.unstubAllEnvs());

describe('App', () => {
  it('mostra carregamento e depois a plataforma operacional', async () => {
    mockApi(makeStatus());
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Status da plataforma' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando status da plataforma');

    expect(await screen.findByTestId('overall-status')).toHaveTextContent('Operacional');
    expect(screen.getByText('26/11/2026, 09:00:00')).toHaveAttribute(
      'datetime',
      '2026-11-26T12:00:00Z',
    );
    expect(screen.getByText('0.1.0-dia01')).toBeVisible();

    const list = screen.getByRole('list', { name: 'Componentes verificados' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    const pulsar = within(list).getByRole('listitem', { name: 'pulsar' });
    expect(pulsar).toHaveTextContent('PULSAR');
    expect(pulsar).toHaveTextContent('Disponível');
    expect(pulsar).toHaveTextContent('12 ms');
    expect(pulsar).toHaveTextContent('standalone');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mostra a plataforma degradada com um componente fora', async () => {
    const base = makeStatus();
    mockApi({
      ...base,
      status: 'DEGRADED',
      components: base.components.map((c) =>
        c.name === 'mongo-pedidos' ? { ...c, status: 'DOWN', latencyMs: null, details: null } : c,
      ),
    });
    render(<App />);
    expect(await screen.findByTestId('overall-status')).toHaveTextContent('Degradada');
    const card = screen.getByRole('listitem', { name: 'mongo-pedidos' });
    expect(card).toHaveTextContent('Indisponível');
    expect(card).toHaveTextContent('—');
    expect(card).toHaveClass('component--down');
  });

  it('mostra a plataforma fora do ar', async () => {
    const base = makeStatus();
    mockApi({
      ...base,
      status: 'DOWN',
      components: base.components.map((c) => ({ ...c, status: 'DOWN', latencyMs: null })),
    });
    render(<App />);
    expect(await screen.findByTestId('overall-status')).toHaveTextContent('Fora do ar');
    expect(screen.getAllByText('Indisponível')).toHaveLength(5);
  });

  it('exibe o status bruto de um componente com valor desconhecido', async () => {
    const base = makeStatus();
    mockApi({ ...base, components: [{ ...base.components[0], status: 'STARTING' }] });
    render(<App />);
    expect(await screen.findByRole('listitem', { name: 'mongo-tenants' })).toHaveTextContent(
      'STARTING',
    );
  });

  it('explica como subir o ambiente quando a API está inacessível', async () => {
    server.use(http.get('*/api/status', () => HttpResponse.error()));
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('API inacessível.');
    expect(alert).toHaveTextContent('Não foi possível conectar à API.');
    expect(alert).toHaveTextContent('docker compose up -d');
    expect(alert).toHaveTextContent('VITE_DEMO=true npm run dev');
    expect(within(alert).getByRole('link', { name: 'versão publicada' })).toHaveAttribute(
      'href',
      'https://daniloeng.github.io/plataforma-multitenant/',
    );
    expect(screen.queryByTestId('overall-status')).not.toBeInTheDocument();
  });

  it('mostra o código HTTP quando a API responde 500', async () => {
    server.use(http.get('*/api/status', () => new HttpResponse(null, { status: 500 })));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('A API respondeu com HTTP 500.');
  });

  it('atualiza ao clicar em "Atualizar agora" e mantém dados antigos em caso de falha', async () => {
    const user = userEvent.setup();
    mockApi(makeStatus());
    render(<App />);
    expect(await screen.findByTestId('overall-status')).toHaveTextContent('Operacional');

    mockApi(makeStatus({ status: 'DEGRADED', version: '0.1.1' }));
    await user.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    expect(await screen.findByText('0.1.1')).toBeVisible();
    expect(screen.getByTestId('overall-status')).toHaveTextContent('Degradada');

    server.use(http.get('*/api/status', () => new HttpResponse(null, { status: 500 })));
    await user.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Exibindo os últimos dados recebidos.');
    expect(screen.getByText('0.1.1')).toBeVisible();
  });

  it('desabilita o botão enquanto atualiza', async () => {
    const user = userEvent.setup();
    mockApi(makeStatus());
    render(<App />);
    await screen.findByTestId('overall-status');

    let release: () => void = () => {};
    server.use(
      http.get('*/api/status', async () => {
        await new Promise<void>((r) => (release = r));
        return HttpResponse.json(makeStatus());
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    expect(await screen.findByRole('button', { name: 'Atualizando…' })).toBeDisabled();
    release();
    expect(await screen.findByRole('button', { name: 'Atualizar agora' })).toBeEnabled();
  });

  it('renderiza roadmap e progresso', async () => {
    mockApi(makeStatus());
    render(<App />);
    await screen.findByTestId('overall-status');
    expect(screen.getByRole('heading', { name: 'Microsserviços' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Progresso' })).toBeVisible();
    expect(screen.getByText('Dia 1 de 22')).toBeVisible();
  });

  it('mostra o selo de demo apenas no modo demo', async () => {
    mockApi(makeStatus());
    const { unmount } = render(<App />);
    await screen.findByTestId('overall-status');
    expect(screen.queryByText('Modo demo (API simulada)')).not.toBeInTheDocument();
    unmount();

    vi.stubEnv('VITE_DEMO', 'true');
    render(<App />);
    await screen.findByTestId('overall-status');
    expect(screen.getByText('Modo demo (API simulada)')).toBeVisible();
  });
});
