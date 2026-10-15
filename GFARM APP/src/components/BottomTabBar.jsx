import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  ArrowLeftRight,
  FileBarChart,
  Fuel,
  Scale,
  Sprout,
} from 'lucide-react';
import { api } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { PAGES } from '@/lib/permissions';
import { setoresAcessiveis } from '@/lib/setoresAcesso';
import SetorIcon from '@/components/setorIcon';

const allItems = [
  { key: 'dashboard', to: '/', label: 'Pesquisa', icon: LayoutDashboard, end: true },
  { key: 'movimentacoes', to: '/movimentacoes', label: 'Mov.', icon: ArrowLeftRight, end: false },
  { key: 'abastecimento', to: '/abastecimento', label: 'Abast.', icon: Fuel, end: false },
  { key: 'pesagem', to: '/pesagem', label: 'Pesagem', icon: Scale, end: false },
  { key: 'aplicacao', to: '/aplicacao', label: 'Aplicação', icon: Sprout, end: false },
  { key: 'cadastros', to: '/cadastros', label: 'Cadastros', icon: Settings, end: false },
  { key: 'relatorios', to: '/relatorios', label: 'Relatórios', icon: FileBarChart, end: false },
];

function abreviar(nome) {
  const n = (nome || '').trim();
  if (n.length <= 6) return n;
  return n.slice(0, 6) + '…';
}

export default function BottomTabBar() {
  const { user } = useAuth();
  const [setores, setSetores] = useState([]);

  // No mobile, o admin também respeita as permissões configuradas (paginas_permitidas).
  const allowedKeys = (() => {
    if (!user) return new Set();
    const allowed = user.paginas_permitidas;
    if (!Array.isArray(allowed)) return new Set(PAGES.map((p) => p.key));
    return new Set(allowed);
  })();
  const items = allItems.filter((it) => allowedKeys.has(it.key));

  useEffect(() => {
    api.entities.Setor.list()
      .then((s) => setSetores(s))
      .catch(() => setSetores([]));
  }, []);

  // No mobile, o admin também respeita setores_permitidos (igual aos usuários comuns).
  const setoresVisiveis = setoresAcessiveis(setores, user);

  if (items.length === 0 && setoresVisiveis.length === 0) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 glass-clear rounded-none border-x-0 border-b-0 text-foreground flex items-stretch justify-around overflow-x-auto scrollbar-thin"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 flex-1 py-2 text-[10px] font-medium transition-colors min-w-[52px] ${
              isActive ? 'text-primary' : 'text-foreground/60'
            }`
          }
        >
          <item.icon className="w-5 h-5 shrink-0" />
          <span className="leading-none truncate max-w-full">{item.label}</span>
        </NavLink>
      ))}
      {setoresVisiveis.map((s) => (
        <NavLink
          key={s.id}
          to={`/setor/${s.id}`}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 flex-1 py-2 text-[10px] font-medium transition-colors min-w-[52px] ${
              isActive ? 'text-primary' : 'text-foreground/60'
            }`
          }
        >
          <SetorIcon setor={s} className="w-5 h-5 shrink-0" />
          <span className="leading-none truncate max-w-full">{abreviar(s.nome)}</span>
        </NavLink>
      ))}
    </nav>
  );
}