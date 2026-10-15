import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  ChevronRight,
  ClipboardList,
  FileBarChart,
  Fuel,
  PackagePlus,
  Scale,
  Settings,
  ShieldCheck,
  Sprout,
} from 'lucide-react';

import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { filterProdutos } from '@/lib/estoqueFilters';
import { mobilePageAllowed } from '@/lib/mobileAccess';
import { setoresAcessiveis } from '@/lib/setoresAcesso';

const FILTROS_VAZIOS = {
  setor_id: [],
  estoque: '',
  deposito_id: [],
  maquina_id: [],
  gaveta_id: [],
  unidade: [],
  codigo: '',
  referencia: '',
  quantidade_min: '',
  quantidade_max: '',
  valor_unit_min: '',
  valor_unit_max: '',
  valor_total_min: '',
  valor_total_max: '',
};

const MOBILE_SHORTCUTS = [
  {
    key: 'movimentacoes',
    label: 'Movimentos',
    description: 'Entradas, saídas e histórico',
    path: '/movimentacoes',
    icon: ArrowLeftRight,
    tone: 'blue',
  },
  {
    key: 'abastecimento',
    label: 'Abastecimento',
    description: 'Registrar abastecimento',
    path: '/abastecimento',
    icon: Fuel,
    tone: 'orange',
  },
  {
    key: 'pesagem',
    label: 'Pesagem',
    description: 'Tickets e operações',
    path: '/pesagem',
    icon: Scale,
    tone: 'slate',
  },
  {
    key: 'aplicacao',
    label: 'Aplicação',
    description: 'Ordens de aplicação',
    path: '/aplicacao',
    icon: Sprout,
    tone: 'green',
  },
  {
    key: 'cadastros',
    label: 'Cadastros',
    description: 'Dados do sistema',
    path: '/cadastros',
    icon: Settings,
    tone: 'violet',
  },
  {
    key: 'relatorios',
    label: 'Relatórios',
    description: 'Análises e exportações',
    path: '/relatorios',
    icon: FileBarChart,
    tone: 'cyan',
  },
  {
    key: 'inventario',
    label: 'Inventário',
    description: 'Conferir estoque físico',
    path: '/inventario',
    icon: ClipboardList,
    tone: 'emerald',
  },
];

export default function MobileHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const atalhosPermitidos = MOBILE_SHORTCUTS.filter(
    (atalho) => mobilePageAllowed(user, atalho.key)
  );

  const entradaManualPermitida =
    user?.role === 'admin'
    || user?.pode_entrada_manual_saldo_mobile === true;

  const atalhoEntradaManual = {
    key: 'entrada-manual-saldo',
    label: 'Entrada Manual de Saldo',
    description: 'Escolher setor e lançar saldo',
    path: '/entrada-manual-saldo',
    icon: PackagePlus,
    tone: 'emerald',
  };

  const atalhosComEntrada = entradaManualPermitida
    ? [atalhoEntradaManual, ...atalhosPermitidos]
    : atalhosPermitidos;

  const atalhosComAdmin = user?.role === 'admin'
    ? [{ key: 'admin-mobile', label: 'Modo Admin', description: 'Cadastros para aprovação', path: '/admin-mobile', icon: ShieldCheck, tone: 'violet' }, ...atalhosComEntrada]
    : atalhosComEntrada;

  const { data, loading } = useEntidades({
    Produto: {},
    Setor: {},
    SaldoEstoque: {},
  });

  const produtos = data.Produto || [];
  const setores = data.Setor || [];
  const saldos = data.SaldoEstoque || [];

  const produtosComSaldo = useMemo(
    () =>
      filterProdutos(
        produtos,
        FILTROS_VAZIOS,
        saldos
      ),
    [produtos, saldos]
  );

  const setoresVisiveis = useMemo(
    () => setoresAcessiveis(setores, user),
    [setores, user]
  );

  const setorIds = useMemo(
    () =>
      new Set(
        setoresVisiveis.map((setor) => setor.id)
      ),
    [setoresVisiveis]
  );

  const produtosVisiveis = useMemo(
    () =>
      produtosComSaldo.filter((produto) =>
        setorIds.has(produto.setor_id)
      ),
    [produtosComSaldo, setorIds]
  );

  return (
    <div className="mobile-page mobile-home mobile-home-v5">
      {atalhosComAdmin.length > 0 ? (
        <section className="mobile-home-access">
          <div className="mobile-section-heading mobile-section-heading--simple">
            <div>
              <span className="mobile-eyebrow">Acesso rápido</span>
              <p className="mobile-section-copy">
                Funções liberadas para seu usuário.
              </p>
            </div>
          </div>

          <div className="mobile-home-access-grid">
            {atalhosComAdmin.map((atalho) => {
              const Icon = atalho.icon;

              return (
                <button
                  type="button"
                  key={atalho.key}
                  className={`mobile-home-access-card is-${atalho.tone}`}
                  onClick={() => navigate(atalho.path)}
                >
                  <span className="mobile-home-access-card__icon">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="mobile-home-access-card__copy">
                    <strong>{atalho.label}</strong>
                    <small>{atalho.description}</small>
                  </span>
                  <ChevronRight className="mobile-home-access-card__arrow h-4 w-4" />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mobile-home-sectors">
        <div className="mobile-section-heading mobile-section-heading--simple">
          <div>
            <span className="mobile-eyebrow">
              Seus setores
            </span>

            <p className="mobile-section-copy">
              Acesse os setores liberados para você.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="mobile-loading-card">
            Carregando setores...
          </div>
        ) : setoresVisiveis.length === 0 ? (
          <div className="mobile-loading-card">
            Nenhum setor foi liberado para este usuário.
          </div>
        ) : (
          <div className="mobile-sector-grid">
            {setoresVisiveis.map((setor) => {
              const itens =
                produtosVisiveis.filter(
                  (produto) =>
                    produto.setor_id === setor.id
                );

              return (
                <button
                  type="button"
                  key={setor.id}
                  className="mobile-sector-card mobile-sector-card--v5"
                  onClick={() =>
                    navigate(`/setor/${setor.id}`)
                  }
                  style={{
                    '--sector-color':
                      setor.cor || '#0f8b68',
                    '--sector-soft': `${
                      setor.cor || '#0f8b68'
                    }10`,
                  }}
                >
                  <span className="mobile-sector-card__content">
                    <strong title={setor.nome}>
                      {setor.nome}
                    </strong>

                    <small>
                      {itens.length}{' '}
                      {itens.length === 1
                        ? 'produto'
                        : 'produtos'}
                    </small>
                  </span>

                  <span className="mobile-sector-card__arrow">
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
