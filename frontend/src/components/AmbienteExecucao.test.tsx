import { render, screen } from '@testing-library/react';
import { AmbienteExecucao, partesAmbiente } from './AmbienteExecucao';

function valorVisivel(): string | null | undefined {
  return document.querySelector('.ambiente__valor')?.textContent;
}

describe('AmbienteExecucao', () => {
  it('mostra Kubernetes com namespace e pod, com leitura sem "·" para leitor de tela', () => {
    render(
      <AmbienteExecucao
        runtime={{
          platform: 'kubernetes',
          namespace: 'plataforma',
          instance: 'status-service-7c9d8-xk2lp',
        }}
      />,
    );
    const grupo = screen.getByRole('group', { name: 'Ambiente de execução' });
    expect(grupo).toHaveTextContent(
      'Kubernetes, namespace plataforma, pod status-service-7c9d8-xk2lp',
    );
    expect(valorVisivel()).toBe(
      'Kubernetes · namespace plataforma · pod status-service-7c9d8-xk2lp',
    );
    expect(document.querySelector('.ambiente__valor')).toHaveAttribute('aria-hidden', 'true');
  });

  it('mostra Docker Compose e Local', () => {
    const { rerender } = render(
      <AmbienteExecucao runtime={{ platform: 'compose', namespace: null, instance: null }} />,
    );
    expect(valorVisivel()).toBe('Docker Compose');
    rerender(<AmbienteExecucao runtime={{ platform: 'local' }} />);
    expect(valorVisivel()).toBe('Local');
    expect(screen.getByRole('group', { name: 'Ambiente de execução' })).toHaveTextContent('Local');
  });

  it('mostra o contêiner no Compose e a instância em outras plataformas', () => {
    expect(partesAmbiente({ platform: 'compose', instance: 'a1b2c3' })).toEqual([
      'Docker Compose',
      'contêiner a1b2c3',
    ]);
    expect(partesAmbiente({ platform: 'local', instance: 'notebook' })).toEqual([
      'Local',
      'instância notebook',
    ]);
  });

  it('ignora maiúsculas e mostra como veio uma plataforma desconhecida', () => {
    expect(partesAmbiente({ platform: 'Kubernetes' })).toEqual(['Kubernetes']);
    render(
      <AmbienteExecucao runtime={{ platform: ' nomad ', namespace: 'prod', instance: 'x' }} />,
    );
    expect(valorVisivel()).toBe('nomad · namespace prod · instância x');
  });

  it('não renderiza nada quando o runtime é nulo ou ausente', () => {
    const { container, rerender } = render(<AmbienteExecucao runtime={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AmbienteExecucao />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
