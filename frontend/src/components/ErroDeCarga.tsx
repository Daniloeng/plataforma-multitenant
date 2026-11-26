import type { ReactNode } from 'react';
import { falaDeMigracao } from '../api/http';

/**
 * Erro ao carregar uma lista das telas de negócio. No 503 `tenant-em-migracao` (Dia 9) o problema
 * é passageiro: a dica de como subir o ambiente (`children`) dá lugar a "Tentar de novo".
 */
export function ErroDeCarga({
  titulo,
  mensagem,
  onTentarDeNovo,
  children,
}: {
  titulo: string;
  mensagem: string;
  onTentarDeNovo: () => void;
  /** Dica para falhas de verdade (ex.: como subir o ambiente). */
  children: ReactNode;
}) {
  const migracao = falaDeMigracao(mensagem);
  return (
    <div className={migracao ? 'alert alert--warn' : 'alert'} role="alert">
      <strong>{titulo}</strong> {mensagem}
      {migracao ? (
        <p>
          <button
            type="button"
            className="button button--small button--secondary"
            onClick={onTentarDeNovo}
          >
            Tentar de novo
          </button>
        </p>
      ) : (
        <p>{children}</p>
      )}
    </div>
  );
}
