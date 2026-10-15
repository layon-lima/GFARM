import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, ShieldX } from 'lucide-react';

import Sidebar from './Sidebar';
import MobileHeader from '@/components/mobile/MobileHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useEntidades } from '@/lib/useEntidades';
import { setoresAcessiveis } from '@/lib/setoresAcesso';
import {
  allowedPagesForUser,
  canAccessBalanca,
  canAccessUsuarios,
  pageKeyForPath,
  userCanAccess,
} from '@/lib/permissions';

export default function Layout() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const swipeStartRef = useRef(null);
  const suppressClickRef = useRef(false);

  const { data: mobileNavData } = useEntidades({
    Setor: {},
  });

  const mobileSetores = useMemo(
    () =>
      setoresAcessiveis(
        mobileNavData.Setor || [],
        user
      ),
    [mobileNavData.Setor, user]
  );

  const mobileSwipePages = useMemo(
    () => [
      '/',
      ...mobileSetores.map(
        (setor) => `/setor/${setor.id}`
      ),
    ],
    [mobileSetores]
  );

  const pageKey = pageKeyForPath(location.pathname);
  const isUsuarios = location.pathname.startsWith('/usuarios');
  const isBalanca = location.pathname === '/balanca';
  const isMobileHome = isMobile && location.pathname === '/';

  const isUsuariosAllowed = canAccessUsuarios(user);

  const canAccess = isMobileHome
    ? true
    : isUsuarios
      ? isUsuariosAllowed
      : isBalanca
        ? canAccessBalanca(user)
        : userCanAccess(user, pageKey);

  const allowed = allowedPagesForUser(user);

  useEffect(() => {
    if (!user) return;
    if (canAccess) return;

    if (isMobile) {
      navigate('/', { replace: true });
      return;
    }

    if (allowed.length > 0) {
      navigate(allowed[0].path, { replace: true });
    }
  }, [user, canAccess, allowed, navigate, isMobile]);

  if (user && !canAccess && allowed.length === 0 && !isMobile) {
    return (
      <div className="flex h-screen flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 rounded-2xl bg-destructive/10 p-4 text-destructive">
          <ShieldX className="h-10 w-10" />
        </div>
        <h1 className="text-xl font-bold">Sem acesso</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Você não tem permissão para acessar nenhuma página. Contate um administrador.
        </p>
      </div>
    );
  }

  const touchBloqueiaSwipe = (target) =>
    target?.closest?.(
      'input, textarea, select, [role="dialog"], [data-no-swipe]'
    );

  const handleMobileTouchStart = (event) => {
    if (!isMobile) return;

    const touch = event.touches?.[0];

    if (!touch || touchBloqueiaSwipe(event.target)) {
      swipeStartRef.current = null;
      return;
    }

    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  };

  const handleMobileTouchEnd = (event) => {
    if (!isMobile || !swipeStartRef.current) {
      return;
    }

    const touch = event.changedTouches?.[0];
    const start = swipeStartRef.current;

    swipeStartRef.current = null;

    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (
      Math.abs(deltaX) < 70 ||
      Math.abs(deltaX) <=
        Math.abs(deltaY) * 1.25
    ) {
      return;
    }

    if (mobileSwipePages.length < 2) return;

    const normalizarRota = (path) =>
      path.replace(/\/+$/, '') || '/';

    const rotaAtual = normalizarRota(
      location.pathname
    );

    const atual = mobileSwipePages.findIndex(
      (path) => normalizarRota(path) === rotaAtual
    );

    if (atual < 0) return;

    const direcao = deltaX < 0 ? 1 : -1;
    const proximo =
      (atual + direcao + mobileSwipePages.length) %
      mobileSwipePages.length;

    suppressClickRef.current = true;

    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 350);

    navigate(mobileSwipePages[proximo]);
  };

  const handleMobileClickCapture = (event) => {
    if (!suppressClickRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  if (isMobile) {
    return (
      <div className="mobile-app-shell">
        <MobileHeader />
        <main
          className="mobile-app-content"
          onTouchStart={handleMobileTouchStart}
          onTouchEnd={handleMobileTouchEnd}
          onClickCapture={handleMobileClickCapture}
        >
          {user && !canAccess ? (
            <div className="flex h-full items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <header
        className="flex items-center gap-3 border-b bg-[#12362f] px-4 text-white lg:hidden"
        style={{
          paddingTop: 'calc(0.7rem + env(safe-area-inset-top))',
          paddingBottom: '0.7rem',
        }}
      >
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-1.5 transition-colors hover:bg-white/10"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <span className="font-bold">Controle de Estoque</span>
      </header>

      <main className="erp-compact-workspace min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-none scrollbar-thin">
        {user && !canAccess ? (
          <div className="flex h-full items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
