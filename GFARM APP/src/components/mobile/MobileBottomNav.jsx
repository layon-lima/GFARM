import { Home } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { setoresAcessiveis } from '@/lib/setoresAcesso';
import SetorIcon from '@/components/setorIcon';

function Tab({ to, label, icon, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        ['mobile-tab', isActive ? 'is-active' : '']
          .filter(Boolean)
          .join(' ')
      }
    >
      <span className="mobile-tab__icon">{icon}</span>
      <span className="mobile-tab__label">{label}</span>
    </NavLink>
  );
}

export default function MobileBottomNav() {
  const { user } = useAuth();

  const { data } = useEntidades({
    Setor: {},
  });

  const setores = data.Setor || [];

  const setoresVisiveis = useMemo(
    () => setoresAcessiveis(setores, user),
    [setores, user]
  );

  // O Início fica fixo na primeira posição.
  // Barra com três destinos no máximo: Início e dois setores.
  // Todos os demais continuam na Home, sem rolagem horizontal.
  const setoresNaBarra = setoresVisiveis.slice(0, 2);

  const tabs = [
    {
      key: 'inicio',
      to: '/',
      label: 'Início',
      end: true,
      icon: <Home className="h-[21px] w-[21px]" />,
    },
    ...setoresNaBarra.map((setor) => ({
      key: `setor-${setor.id}`,
      to: `/setor/${setor.id}`,
      label: setor.nome,
      icon: (
        <SetorIcon
          setor={setor}
          className="h-[21px] w-[21px]"
        />
      ),
    })),
  ];

  return (
    <nav
      className="mobile-bottom-nav mobile-bottom-nav--v5"
      aria-label="Navegação principal"
      style={{
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
      }}
    >
      {tabs.map((tab) => (
        <Tab key={tab.key} {...tab} />
      ))}
    </nav>
  );
}
