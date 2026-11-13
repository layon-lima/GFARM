import {
  Activity, LogOut, Scale, ShieldCheck, UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { canAccessBalanca, hasPermission, podeMonitorarBalancaADM } from '@/lib/permissions';
import { getDisplayInitial, getDisplayName } from '@/lib/userName';

export default function MobileMais() {
  const { user, logout } = useAuth();

  const extras = [
    ...(podeMonitorarBalancaADM(user)
      ? [{ key: 'monitor', to: '/monitor-balanca', label: 'Monitor da balança', icon: Activity }]
      : []),
    ...(user?.role !== 'admin' && hasPermission(user, 'admin.cadastros_mobile.solicitar')
      ? [{ key: 'admin', to: '/admin-mobile', label: 'Modo Admin', icon: ShieldCheck }]
      : []),
    ...(canAccessBalanca(user)
      ? [{ key: 'balanca', to: '/balanca', label: 'Balança', icon: Scale }]
      : []),
  ];

  return (
    <div className="mobile-page mobile-profile-v6 space-y-3">
      <section className="mobile-profile-card">
        <div className="mobile-profile-card__avatar">
          {user ? getDisplayInitial(user) : <UserRound className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <h1>{getDisplayName(user) || 'Usuário'}</h1>
          {user?.email && <p>{user.email}</p>}
        </div>
      </section>
      {extras.length > 0 && (
        <section className="mobile-more-list" aria-label="Outras funções">
          {extras.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.key} to={item.to} className="mobile-more-row">
                <span className="mobile-more-row__icon"><Icon className="h-5 w-5" /></span>
                <strong>{item.label}</strong>
              </Link>
            );
          })}
        </section>
      )}
      <button type="button" className="mobile-logout-button" onClick={logout}>
        <LogOut className="h-4 w-4" />
        Sair da conta
      </button>
    </div>
  );
}
