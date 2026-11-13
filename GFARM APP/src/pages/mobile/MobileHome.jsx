import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  ClipboardList,
  FileBarChart,
  Fuel,
  Leaf,
  PackagePlus,
  Settings,
  ShieldCheck,
} from 'lucide-react';

import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { mobilePageAllowed } from '@/lib/mobileAccess';
import { hasPermission } from '@/lib/permissions';
import { setoresAcessiveis } from '@/lib/setoresAcesso';
import SetorIcon from '@/components/setorIcon';

const ACOES = [
  { key: 'abastecimento', label: 'Abastecimento', path: '/abastecimento', icon: Fuel, tone: 'orange' },
  { key: 'informes-lavoura', label: 'Saída para Lavoura', path: '/informes-lavoura', icon: Leaf, tone: 'green' },
  { key: 'inventario', label: 'Inventário', path: '/inventario', icon: ClipboardList, tone: 'green' },
  { key: 'movimentacoes', label: 'Movimentos', path: '/movimentacoes', icon: ArrowLeftRight, tone: 'blue' },
  { key: 'cadastros', label: 'Cadastros', path: '/cadastros', icon: Settings, tone: 'violet' },
  { key: 'relatorios', label: 'Relatórios', path: '/relatorios', icon: FileBarChart, tone: 'cyan' },
];

function acessoAcao(user, acao) {
  if (acao.key === 'informes-lavoura') {
    return hasPermission(user, 'mobile.informe_lavoura.solicitar')
      || hasPermission(user, 'admin.informe_lavoura.revisar');
  }
  return mobilePageAllowed(user, acao.key);
}

export default function MobileHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // A home consulta apenas setores: saldo/produtos são carregados na própria
  // tela de setor, evitando tráfego e contadores sem utilidade aqui.
  const { data, loading } = useEntidades({ Setor: {} });
  const setores = useMemo(
    () => setoresAcessiveis(data.Setor || [], user),
    [data.Setor, user]
  );
  const atalhos = [
    ...ACOES.filter((item) => acessoAcao(user, item)),
    ...(
      hasPermission(user, 'mobile.estoque.entrada_manual_saldo')
      || hasPermission(user, 'admin.entrada_saldo_mobile.revisar')
      ? [{ key: 'entrada-manual-saldo', label: 'Entrada Manual', path: '/entrada-manual-saldo', icon: PackagePlus, tone: 'green' }]
      : []
    ),
    ...(user?.role === 'admin'
      ? [{ key: 'admin-mobile', label: 'Modo Admin', path: '/admin-mobile', icon: ShieldCheck, tone: 'violet' }]
      : []),
  ];

  return (
    <div className="mobile-page mobile-home mobile-home-v6">
      {atalhos.length > 0 && (
        <section className="mobile-home-access" aria-label="Acesso rápido">
          <h1 className="mobile-glass-section-title">Acesso rápido</h1>
          <div className="mobile-home-access-grid">
            {atalhos.map((item) => {
              const Icon = item.icon;
              return (
                <button type="button" key={item.key}
                  className={`mobile-home-access-card is-${item.tone}`}
                  onClick={() => navigate(item.path)}
                  aria-label={item.label}>
                  <span className="mobile-home-access-card__icon"><Icon className="h-5 w-5" /></span>
                  <strong className="mobile-home-access-card__title">{item.label}</strong>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="mobile-home-sectors" aria-label="Setores">
        <h2 className="mobile-glass-section-title">Setores</h2>
        {loading ? (
          <p className="mobile-loading-card">Carregando setores...</p>
        ) : setores.length === 0 ? (
          <p className="mobile-loading-card">Nenhum setor liberado.</p>
        ) : (
          <div className="mobile-sector-grid">
            {setores.map((setor) => (
              <button type="button" key={setor.id}
                className="mobile-sector-card mobile-sector-card--v5 mobile-sector-card--v6"
                onClick={() => navigate(`/setor/${setor.id}`)}
                aria-label={`Abrir ${setor.nome}`}>
                <SetorIcon setor={setor} className="mobile-sector-card--v6__icon" />
                <strong className="mobile-sector-card--v6__title">{setor.nome}</strong>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
