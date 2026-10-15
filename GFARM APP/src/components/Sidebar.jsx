import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  NavLink,
  useLocation,
} from 'react-router-dom';

import {
  ArrowLeftRight,
  Boxes,
  Building2,
  Car,
  ChevronDown,
  ClipboardList,
  Contact,
  FileBarChart,
  Fuel,
  LayoutDashboard,
  Leaf,
  LogOut,
  MapPinned,
  Package,
  Palette,
  Check,
  Moon,
  Scale,
  Settings,
  Sprout,
  Sun,
  Tractor,
  Trash2,
  Users,
  Warehouse,
  X,
} from 'lucide-react';

import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';

import {
  getDisplayInitial,
  getDisplayName,
} from '@/lib/userName';

import {
  allowedPagesForUser,
  canAccessBalanca,
  canAccessUsuarios,
  hasAnyPermission,
} from '@/lib/permissions';

import {
  TooltipProvider,
} from '@/components/ui/tooltip';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import BalancaStatusBadge from '@/components/balanca/BalancaStatusBadge';
import AdminIntegrityStatus from '@/components/admin/AdminIntegrityStatus';

import {
  ERP_THEMES,
  useErpTheme,
} from '@/lib/erpTheme';


const MAIN_NAV = [
  {
    key: 'dashboard',
    to: '/',
    label: 'Pesquisa',
    icon: LayoutDashboard,
    end: true,
  },
  {
    key: 'movimentacoes',
    to: '/movimentacoes',
    label: 'Movimentos',
    icon: ArrowLeftRight,
    end: false,
  },
  {
    key: 'abastecimento',
    to: '/abastecimento',
    label: 'Abastecimento',
    icon: Fuel,
    end: false,
  },
  {
    key: 'pesagem',
    to: '/pesagem',
    label: 'Pesagem',
    icon: Scale,
    end: false,
  },
  {
    key: 'aplicacao',
    to: '/aplicacao',
    label: 'Aplicação',
    icon: Sprout,
    end: false,
  },
  {
    key: 'cadastros',
    to: '/cadastros?tab=pessoas',
    label: 'Cadastros',
    icon: Settings,
    end: false,
  },
  {
    key: 'relatorios',
    to: '/relatorios',
    label: 'Relatórios',
    icon: FileBarChart,
    end: false,
  },
  {
    key: 'inventario',
    to: '/inventario',
    label: 'Inventário',
    icon: ClipboardList,
    end: false,
  },
];


const CADASTROS = [
  {
    key: 'pessoas',
    label: 'Pessoas',
    icon: Contact,
  },
  {
    key: 'veiculos',
    label: 'Veículos',
    icon: Car,
  },
  {
    key: 'maquinas',
    label: 'Máquinas',
    icon: Tractor,
  },
  {
    key: 'produtos',
    label: 'Produtos',
    icon: Package,
  },
  {
    key: 'setores',
    label: 'Setores',
    icon: Boxes,
  },
  {
    key: 'depositos',
    label: 'Depósitos',
    icon: Warehouse,
  },
  {
    key: 'gavetas',
    label: 'Gavetas',
    icon: MapPinned,
  },
  {
    key: 'lavouras',
    label: 'Lavouras',
    icon: Building2,
  },
  {
    key: 'ano_safra',
    label: 'Ano / Safra',
    icon: Building2,
  },
  {
    key: 'usuarios',
    label: 'Usuários',
    icon: Users,
  },
];


function DesktopMainItem({
  item,
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          'top-nav__item',
          isActive
            ? 'is-active'
            : '',
        ]
          .filter(Boolean)
          .join(' ')
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />

      <span>
        {item.label}
      </span>
    </NavLink>
  );
}


function MobileNavItem({
  item,
  onClick,
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground/70 hover:bg-muted hover:text-foreground'
        }`
      }
    >
      <Icon className="h-5 w-5 shrink-0" />

      {item.label}
    </NavLink>
  );
}


function ThemeControls({
  theme,
  mode,
  onThemeChange,
  onModeChange,
  compact = false,
}) {
  return (
    <div
      className={`erp-theme-control ${
        compact ? 'is-compact' : ''
      }`}
    >
      <div className="erp-theme-control__head">
        <span className="erp-theme-control__title">
          <Palette className="h-4 w-4" />
          Aparência
        </span>

        <span className="erp-theme-control__current">
          {
            ERP_THEMES.find(
              (item) => item.id === theme
            )?.label || 'Novo Horizonte'
          }
        </span>
      </div>

      <div className="erp-theme-control__themes">
        {ERP_THEMES.map((item) => {
          const active = item.id === theme;

          return (
            <button
              key={item.id}
              type="button"
              className={`erp-theme-choice ${
                active ? 'is-active' : ''
              }`}
              onClick={() =>
                onThemeChange(item.id)
              }
              title={item.label}
              aria-pressed={active}
            >
              <span
                className="erp-theme-choice__swatch"
                style={{
                  background: item.swatch,
                }}
              />

              <span className="erp-theme-choice__label">
                {item.shortLabel}
              </span>

              {active && (
                <Check className="erp-theme-choice__check h-3.5 w-3.5" />
              )}
            </button>
          );
        })}
      </div>

      <div className="erp-theme-mode">
        <button
          type="button"
          className={
            mode === 'light'
              ? 'is-active'
              : ''
          }
          onClick={() =>
            onModeChange('light')
          }
          aria-pressed={mode === 'light'}
        >
          <Sun className="h-3.5 w-3.5" />
          Claro
        </button>

        <button
          type="button"
          className={
            mode === 'dark'
              ? 'is-active'
              : ''
          }
          onClick={() =>
            onModeChange('dark')
          }
          aria-pressed={mode === 'dark'}
        >
          <Moon className="h-3.5 w-3.5" />
          Escuro
        </button>
      </div>
    </div>
  );
}


export default function Sidebar({
  open,
  onClose,
}) {
  const {
    user,
    logout,
  } = useAuth();

  const { toast } =
    useToast();

  const location =
    useLocation();

  const {
    theme,
    mode,
    setTheme,
    setMode,
  } = useErpTheme();

  const userMenuRef =
    useRef(null);

  const [deleteOpen, setDeleteOpen] =
    useState(false);

  const [userMenuOpen, setUserMenuOpen] =
    useState(false);


  const allowedKeys =
    useMemo(
      () =>
        new Set(
          allowedPagesForUser(user)
            .map((page) => page.key)
        ),
      [user]
    );


  const mainItems =
    useMemo(
      () =>
        MAIN_NAV.filter(
          (item) =>
            allowedKeys.has(item.key)
        ),
      [allowedKeys]
    );


  const cadastroItems =
    useMemo(
      () =>
        CADASTROS.filter(
          (item) =>
            item.key !== 'usuarios'
            || canAccessUsuarios(user)
        ),
      [user]
    );


  const canSeeAdminIntegrity =
    hasAnyPermission(
      user,
      [
        'admin.integridade.visualizar',
        'admin.integridade.verificar',
        'admin.auditoria.visualizar',
        'admin.backups.visualizar',
        'admin.backups.criar',
        'admin.backups.verificar',
      ]
    );

  const isCadastros =
    location.pathname === '/cadastros';


  const cadastroSelecionado =
    new URLSearchParams(
      location.search
    ).get('tab')
    || 'pessoas';


  useEffect(() => {
    setUserMenuOpen(false);
  }, [
    location.pathname,
    location.search,
  ]);


  useEffect(() => {
    if (!userMenuOpen) {
      return undefined;
    }

    const handleOutside = (event) => {
      if (
        userMenuRef.current
        && !userMenuRef.current.contains(
          event.target
        )
      ) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener(
      'pointerdown',
      handleOutside
    );

    return () => {
      document.removeEventListener(
        'pointerdown',
        handleOutside
      );
    };
  }, [userMenuOpen]);


  const handleDeleteAccount =
    async () => {
      setDeleteOpen(false);

      toast({
        title:
          'Exclusão de conta solicitada',
        description:
          'Entre em contato com o administrador para concluir a exclusão dos seus dados.',
      });

      await logout();
    };


  return (
    <>
      <TooltipProvider delayDuration={140}>
        <div className="top-nav-wrap hidden lg:block">
          <header className="top-nav">
            <NavLink
              to="/"
              className="top-nav__brand"
            >
              <span className="top-nav__brand-mark">
                <Leaf className="h-6 w-6" />
              </span>

              <span className="top-nav__brand-copy">
                <strong>
                  Controle de Estoque
                </strong>

                <small>
                  Novo Horizonte
                </small>
              </span>
            </NavLink>


            <nav className="top-nav__main">
              {mainItems.map((item) => (
                <DesktopMainItem
                  key={item.key}
                  item={item}
                />
              ))}
            </nav>


            <div className="top-nav__right">
              <div className="top-nav__balance">
                <BalancaStatusBadge />
              </div>

              <div
                ref={userMenuRef}
                className="top-nav__user-wrap"
              >
                <button
                  type="button"
                  className="top-nav__user"
                  onClick={() =>
                    setUserMenuOpen(
                      (prev) => !prev
                    )
                  }
                  aria-expanded={userMenuOpen}
                >
                  <span className="top-nav__avatar">
                    {getDisplayInitial(user)}
                  </span>

                  <span className="top-nav__user-name">
                    {getDisplayName(user)
                      || 'Usuário'}
                  </span>

                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      userMenuOpen
                        ? 'rotate-180'
                        : ''
                    }`}
                  />
                </button>


                {userMenuOpen && (
                  <div className="top-nav__user-menu">
                    <div className="top-nav__user-menu-head">
                      <strong>
                        {getDisplayName(user)
                          || 'Usuário'}
                      </strong>

                      <span>
                        {user?.email || ''}
                      </span>
                    </div>

                    <ThemeControls
                      theme={theme}
                      mode={mode}
                      onThemeChange={setTheme}
                      onModeChange={setMode}
                    />

                    {canSeeAdminIntegrity && (
                      <AdminIntegrityStatus />
                    )}

                    <button
                      type="button"
                      onClick={logout}
                    >
                      <LogOut className="h-4 w-4" />
                      Sair
                    </button>

                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir conta
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

        </div>
      </TooltipProvider>


      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}


      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card text-foreground shadow-xl transition-transform duration-300 lg:hidden ${
          open
            ? 'translate-x-0'
            : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/15 p-2 text-primary">
              <Leaf className="h-7 w-7" />
            </div>

            <div>
              <h1 className="text-base font-bold leading-tight">
                Controle de Estoque
              </h1>

              <p className="text-xs font-medium text-muted-foreground">
                Novo Horizonte
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>


        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
          {mainItems.map((item) => (
            <MobileNavItem
              key={item.key}
              item={item}
              onClick={onClose}
            />
          ))}


          {canAccessBalanca(user) && (
            <div className="mt-2 border-t pt-2">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Administração
              </p>

              <NavLink
                to="/balanca"
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground/70 hover:bg-muted hover:text-foreground'
                  }`
                }
              >
                <Scale className="h-5 w-5" />
                Balança
              </NavLink>
            </div>
          )}


          {isCadastros && (
            <div className="mt-2 border-t pt-2">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Cadastros
              </p>

              {cadastroItems.map(
                (item) => {
                  const Icon =
                    item.icon;

                  return (
                    <NavLink
                      key={item.key}
                      to={`/cadastros?tab=${item.key}`}
                      onClick={onClose}
                      className={
                        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                          cadastroSelecionado
                          === item.key
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground/70 hover:bg-muted hover:text-foreground'
                        }`
                      }
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </NavLink>
                  );
                }
              )}
            </div>
          )}
        </nav>


        <div className="space-y-2 border-t px-4 py-3">
          <ThemeControls
            theme={theme}
            mode={mode}
            onThemeChange={setTheme}
            onModeChange={setMode}
            compact
          />

          <div className="flex items-center gap-3 px-2 pb-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
              {getDisplayInitial(user)}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {getDisplayName(user)
                  || 'Usuário'}
              </p>

              <p className="truncate text-xs text-muted-foreground">
                {user?.email || ''}
              </p>
            </div>
          </div>

          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>

          <button
            onClick={() =>
              setDeleteOpen(true)
            }
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            Excluir Conta
          </button>
        </div>
      </aside>


      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir conta
            </AlertDialogTitle>

            <AlertDialogDescription>
              Tem certeza? Esta ação removerá seus dados e encerrará sua sessão.
              Esta operação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancelar
            </AlertDialogCancel>

            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteAccount}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
