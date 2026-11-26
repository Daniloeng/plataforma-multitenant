import { useId, useState } from 'react';
import { BUSCA_MAX, podeGerirCatalogo, type FiltroProdutos } from '../api/catalogo';
import type { TenantDoUsuario } from '../api/me';
import { useAuth } from '../auth/context';
import { LoginPrompt } from '../components/auth/LoginPrompt';
import { NovoProdutoForm } from '../components/produtos/NovoProdutoForm';
import { ProdutoList } from '../components/produtos/ProdutoList';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useProdutos } from '../hooks/useProdutos';
import { PLANO_LABEL } from '../utils/format';

/** Espera depois da última tecla antes de buscar. */
export const BUSCA_DEBOUNCE_MS = 300;

type Situacao = 'todos' | 'ativos' | 'inativos';

const ATIVO_POR_SITUACAO: Record<Situacao, boolean | undefined> = {
  todos: undefined,
  ativos: true,
  inativos: false,
};

/** Página Produtos: catálogo do tenant selecionado (catalogo-service, /api/v1/produtos). */
export function ProdutosPage() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <p className="section muted" role="status">
        Verificando sessão…
      </p>
    );
  }
  if (auth.status === 'anonymous') {
    return (
      <LoginPrompt>
        O catálogo é de cada tenant: entre e escolha um tenant para ver os produtos e preços.
      </LoginPrompt>
    );
  }
  if (!auth.me) {
    return auth.meError ? (
      <div className="section alert" role="alert">
        <strong>Não foi possível carregar seus dados.</strong> {auth.meError}
      </div>
    ) : (
      <p className="section muted" role="status">
        Carregando seus dados…
      </p>
    );
  }
  if (!auth.selectedTenant) {
    return (
      <div className="section card empty">
        <strong>Selecione um tenant no cabeçalho.</strong>{' '}
        <span className="muted">
          O catálogo vem do tenant escolhido, enviado no <code>X-Tenant-Id</code>.
        </span>
      </div>
    );
  }
  // key: trocar de tenant monta o catálogo do zero (lista, busca e filtros).
  return (
    <Catalogo
      key={auth.selectedTenant.id}
      tenant={auth.selectedTenant}
      gestor={podeGerirCatalogo(auth.me.papeis)}
    />
  );
}

function Catalogo({ tenant, gestor }: { tenant: TenantDoUsuario; gestor: boolean }) {
  const uid = useId();
  const [buscaTexto, setBuscaTexto] = useState('');
  const [situacao, setSituacao] = useState<Situacao>('todos');
  const busca = useDebouncedValue(buscaTexto.trim(), BUSCA_DEBOUNCE_MS);
  const filtro: FiltroProdutos = {
    busca: busca || undefined,
    ativo: gestor ? ATIVO_POR_SITUACAO[situacao] : undefined,
  };
  const produtos = useProdutos(tenant.id, filtro);
  const planoCheio =
    produtos.usados !== null &&
    produtos.limitePlano !== null &&
    produtos.usados >= produtos.limitePlano;

  return (
    <>
      <section className="section card catalogo-tenant" aria-label="Tenant atual">
        <div>
          <p className="summary__label">Tenant atual</p>
          <p className="catalogo-tenant__nome">
            {tenant.nome} <code>{tenant.id}</code>
          </p>
          <p className="muted catalogo-tenant__papel">
            {gestor
              ? 'Você pode cadastrar produtos, mudar preços, renomear e ativar ou desativar.'
              : 'Somente leitura: compradores veem só os produtos ativos.'}
          </p>
        </div>
        <PlanoUso
          plano={PLANO_LABEL[produtos.plano ?? tenant.plano]}
          usados={produtos.usados}
          limite={produtos.limitePlano}
        />
      </section>

      {gestor ? <NovoProdutoForm onCreated={produtos.added} planoCheio={planoCheio} /> : null}

      <div className="filters produtos__filtros" role="search" aria-label="Filtrar produtos">
        <div className="field-group produtos__busca">
          <label htmlFor={`${uid}-busca`}>Buscar por nome ou SKU</label>
          <input
            id={`${uid}-busca`}
            type="search"
            className="input"
            value={buscaTexto}
            maxLength={BUSCA_MAX}
            placeholder="ex.: café ou CAF-"
            onChange={(e) => setBuscaTexto(e.target.value)}
          />
        </div>
        {gestor ? (
          <div className="field-group">
            <label htmlFor={`${uid}-situacao`}>Situação</label>
            <select
              id={`${uid}-situacao`}
              className="input"
              value={situacao}
              onChange={(e) => setSituacao(e.target.value as Situacao)}
            >
              <option value="todos">Todos</option>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
            </select>
          </div>
        ) : null}
      </div>

      <ProdutoList
        {...produtos}
        gestor={gestor}
        filtrado={Boolean(filtro.busca) || filtro.ativo !== undefined}
      />
    </>
  );
}

/** "12 de 500 produtos do plano" com barra; cheia (vermelha) no limite. */
function PlanoUso({
  plano,
  usados,
  limite,
}: {
  plano: string;
  usados: number | null;
  limite: number | null;
}) {
  if (usados === null || limite === null) {
    return <p className="muted plano-uso">Plano {plano}</p>;
  }
  const percent = limite > 0 ? Math.min(100, Math.round((usados / limite) * 100)) : 100;
  const cheio = usados >= limite;
  const fmt = (n: number) => n.toLocaleString('pt-BR');
  return (
    <div className="plano-uso">
      <p className="progress__label">
        <span>
          {fmt(usados)} de {fmt(limite)} produtos do plano {plano}
        </span>
        <span className="num muted">{percent}%</span>
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-label="Uso do plano"
        aria-valuemin={0}
        aria-valuemax={limite}
        aria-valuenow={usados}
      >
        <div
          className={`progress__bar${cheio ? ' progress__bar--cheio' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
