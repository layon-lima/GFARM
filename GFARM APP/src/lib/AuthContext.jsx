import React, {
  createContext,
  useState,
  useContext,
  useEffect,
} from 'react';

import { api } from '@/api/apiClient';
import { prefetchEntidades } from '@/lib/useEntidades';


const AuthContext = createContext();
const CACHED_USER_KEY = 'nh_cached_user';

function readCachedUser() {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user) {
  try {
    if (user) {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CACHED_USER_KEY);
    }
  } catch {
    // Cache de contingência; nunca bloqueia a autenticação normal.
  }
}


export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] =
    useState(false);

  const [isLoadingAuth, setIsLoadingAuth] =
    useState(true);

  const [
    isLoadingPublicSettings,
    setIsLoadingPublicSettings,
  ] = useState(true);

  const [authError, setAuthError] =
    useState(null);

  const [authChecked, setAuthChecked] =
    useState(false);


  const checkUserAuth = async () => {
    setAuthError(null);

    if (!api.auth.hasToken()) {
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return;
    }

    try {
      const currentUser =
        await api.auth.me();

      writeCachedUser(currentUser);
      setUser(currentUser);
      setIsAuthenticated(true);

      prefetchEntidades(currentUser);
    } catch (error) {
      if (
        error?.status === 401
        || error?.status === 403
      ) {
        api.auth.clearToken();
        writeCachedUser(null);
        setUser(null);
        setIsAuthenticated(false);
      } else {
        const cachedUser =
          readCachedUser();

        if (cachedUser) {
          setUser(cachedUser);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      }
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };


  useEffect(() => {
    (async () => {
      setIsLoadingPublicSettings(true);

      await checkUserAuth();

      setIsLoadingPublicSettings(false);
    })();
  }, []);


  const navigateToLogin = () => {
    if (
      window.location.pathname !== '/login'
    ) {
      window.location.href = '/login';
    }
  };


  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    writeCachedUser(null);

    api.auth.logout();
  };


  const checkAppState = () => {
    setIsLoadingPublicSettings(false);
  };


  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        authChecked,
        checkUserAuth,
        checkAppState,
        navigateToLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};


export const useAuth = () => {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error(
      'useAuth must be used within an AuthProvider'
    );
  }

  return ctx;
};
