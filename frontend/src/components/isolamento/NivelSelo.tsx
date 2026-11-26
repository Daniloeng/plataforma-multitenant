import type { NivelIsolamento } from '../../api/tenants';
import { NIVEL_ISOLAMENTO_LABEL, NIVEL_ISOLAMENTO_SELO } from '../../utils/format';

/**
 * Selo do nível de isolamento (Pool, Bridge ou Silo), com cor por nível. O `title` explica o
 * nível ao passar o mouse; o leitor de tela lê a mesma explicação.
 */
export function NivelSelo({ nivel }: { nivel: NivelIsolamento }) {
  const explicacao = NIVEL_ISOLAMENTO_SELO[nivel];
  return (
    <span className={`pill pill--nivel-${nivel.toLowerCase()}`} title={explicacao}>
      <span aria-hidden="true">{NIVEL_ISOLAMENTO_LABEL[nivel]}</span>
      <span className="sr-only">Nível {explicacao}</span>
    </span>
  );
}
