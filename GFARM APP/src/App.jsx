import { useEffect } from 'react';
import UsuarioPermissoes from '@/pages/UsuarioPermissoes';
import { ThemeProvider } from 'next-themes';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { useUppercaseInputs } from '@/hooks/useUppercaseInputs';
import { useIsMobile } from '@/hooks/use-mobile';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import ResponsiveDashboard from '@/pages/ResponsiveDashboard';
import SetorDetail from '@/pages/SetorDetail';
import Cadastros from '@/pages/Cadastros';
import Movimentacoes from '@/pages/Movimentacoes';
import Abastecimento from '@/pages/Abastecimento';
import Pesagem from '@/pages/Pesagem';
import Aplicacao from '@/pages/Aplicacao';
import Relatorios from '@/pages/Relatorios';
import Inventario from '@/pages/Inventario';
import MobileInventario from '@/pages/mobile/MobileInventario';
import Balanca from '@/pages/Balanca';
import MobileSetores from '@/pages/mobile/MobileSetores';
import MobileMais from '@/pages/mobile/MobileMais';
import MobileAdmin from '@/pages/mobile/MobileAdmin';
import MobileEntradaSaldo from '@/pages/mobile/MobileEntradaSaldo';
import { BalancaProvider } from '@/lib/balancaContext';
import { Toaster } from '@/components/ui/toaster';
import { sincronizarAbastecimentosOffline } from '@/lib/abastecimentoOffline';

function MobileOnly({ children }) {
  const isMobile = useIsMobile();
  return isMobile ? children : <Navigate to="/" replace />;
}

function ResponsiveInventario() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileInventario /> : <Inventario />;
}

const AuthenticatedApp = () => {
  const isMobile = useIsMobile();
  const {
    user,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    isAuthenticated,
    navigateToLogin,
  } = useAuth();

  useEffect(() => {
    if (
      !isMobile
      || !isAuthenticated
      || !user?.id
    ) {
      return undefined;
    }

    const sincronizar = () => {
      if (
        typeof document !== 'undefined'
        && document.visibilityState === 'hidden'
      ) {
        return;
      }

      sincronizarAbastecimentosOffline({
        userId: user.id,
      }).catch(() => {
        // Sincronização silenciosa: uma próxima retomada tentará novamente.
      });
    };

    const aoVisivel = () => {
      if (document.visibilityState === 'visible') {
        sincronizar();
      }
    };

    sincronizar();

    window.addEventListener('online', sincronizar);
    window.addEventListener('focus', sincronizar);
    window.addEventListener('pageshow', sincronizar);
    document.addEventListener(
      'visibilitychange',
      aoVisivel
    );

    return () => {
      window.removeEventListener('online', sincronizar);
      window.removeEventListener('focus', sincronizar);
      window.removeEventListener('pageshow', sincronizar);
      document.removeEventListener(
        'visibilitychange',
        aoVisivel
      );
    };
  }, [
    isMobile,
    isAuthenticated,
    user?.id,
  ]);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<ResponsiveDashboard />} />
        <Route
          path="/setores"
          element={
            <MobileOnly>
              <MobileSetores />
            </MobileOnly>
          }
        />
        <Route path="/setor/:setorId" element={<SetorDetail />} />
        <Route path="/cadastros" element={<Cadastros />} />
        <Route path="/usuarios/:userId/permissoes" element={<UsuarioPermissoes />} />
        <Route path="/movimentacoes" element={<Movimentacoes />} />
        <Route path="/abastecimento" element={<Abastecimento />} />
        <Route path="/pesagem" element={<Pesagem />} />
        <Route path="/aplicacao" element={<Aplicacao />} />
        <Route path="/relatorios" element={<Relatorios />} />
        <Route path="/inventario" element={<ResponsiveInventario />} />
        <Route path="/balanca" element={<Balanca />} />
        <Route
          path="/mais"
          element={
            <MobileOnly>
              <MobileMais />
            </MobileOnly>
          }
        />
        <Route
          path="/admin-mobile"
          element={
            <MobileOnly>
              <MobileAdmin />
            </MobileOnly>
          }
        />
        <Route
          path="/entrada-manual-saldo"
          element={
            <MobileOnly>
              <MobileEntradaSaldo />
            </MobileOnly>
          }
        />
        <Route
          path="/entrada-manual-saldo/:setorId"
          element={
            <MobileOnly>
              <MobileEntradaSaldo />
            </MobileOnly>
          }
        />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  useUppercaseInputs();

  return (
    <AuthProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme="light">
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <BalancaProvider>
              <AuthenticatedApp />
            </BalancaProvider>
            <Toaster />
          </Router>
        </QueryClientProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
