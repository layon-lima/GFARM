import {
  ArrowLeftRight,
  ClipboardList,
  LogOut,
  PackageSearch,
  Scale,
  Settings,
  Sprout,
  UserRound,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { canAccessBalanca, hasPermission } from '@/lib/permissions';
import { mobilePageAllowed } from '@/lib/mobileAccess';
import { getDisplayInitial, getDisplayName } from '@/lib/userName';

const LINKS = [
  { key: 'dashboard', to: '/', label: 'Pesquisa de estoque', icon: PackageSearch },
  { key: 'movimentacoes', to: '/movimentacoes', label: 'Movimentos', icon: ArrowLeftRight },
  { key: 'aplicacao', to: '/aplicacao', label: 'Aplicação', icon: Sprout },
  { key: 'pesagem', to: '/pesagem', label: 'Pesagem', icon: Scale },
  { key: 'inventario', to: '/inventario', label: 'Inventário', icon: ClipboardList },
  { key: 'cadastros', to: '/cadastros', label: 'Cadastros', icon: Settings },
];

export default function MobileMais() {
  const { user, logout } = useAuth();

  const links = LINKS.filter((item) => mobilePageAllowed(user, item.key));

  return (
    <div className="mobile-page">
      <section className="mobile-profile-card">
        <div className="mobile-profile-card__avatar">
          {user ? getDisplayInitial(user) : <UserRound className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <span className="mobile-eyebrow">Usuário conectado</span>
          <h1>{getDisplayName(user) || 'Usuário'}</h1>
          <p>{user?.email || ''}</p>
        </div>
      </section>

      <section>
        <div className="mobile-section-heading">
          <div>
            <span className="mobile-eyebrow">Outras funções</span>
            <h2>Mais opções</h2>
          </div>
        </div>

        <div className="mobile-more-list">
          {hasPermission(user, 'admin.cadastros_mobile.solicitar') && (
            <Link to="/admin-mobile" className="mobile-more-row">
              <span className="mobile-more-row__icon"><ShieldCheck className="h-5 w-5" /></span>
              <strong>Modo Admin</strong>
              <span className="mobile-more-row__arrow">›</span>
            </Link>
          )}
          {links.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className="mobile-more-row">
                <span className="mobile-more-row__icon"><Icon className="h-5 w-5" /></span>
                <strong>{item.label}</strong>
                <span className="mobile-more-row__arrow">›</span>
              </Link>
            );
          })}

          {canAccessBalanca(user) && (
            <Link to="/balanca" className="mobile-more-row">
              <span className="mobile-more-row__icon"><Scale className="h-5 w-5" /></span>
              <strong>Balança</strong>
              <span className="mobile-more-row__arrow">›</span>
            </Link>
          )}
        </div>
      </section>

      <button type="button" className="mobile-logout-button" onClick={logout}>
        <LogOut className="h-5 w-5" />
        Sair da conta
      </button>
    </div>
  );
}
