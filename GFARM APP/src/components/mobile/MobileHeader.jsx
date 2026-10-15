import {
  Leaf,
  LogOut,
  MoreHorizontal,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';

function inicialDoUsuario(user) {
  const nome =
    user?.display_name ||
    user?.nome ||
    user?.username ||
    user?.email ||
    'U';

  return String(nome).trim().charAt(0).toUpperCase() || 'U';
}

export default function MobileHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const fecharFora = (event) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', fecharFora);

    return () => {
      document.removeEventListener('pointerdown', fecharFora);
    };
  }, [open]);

  const irParaMais = () => {
    setOpen(false);
    navigate('/mais');
  };

  const sair = () => {
    setOpen(false);
    logout();
  };

  return (
    <header className="mobile-app-header">
      <div className="mobile-app-header__brand">
        <div className="mobile-app-header__mark">
          <Leaf className="h-5 w-5" />
        </div>

        <div className="min-w-0">
          <div className="mobile-app-header__farm">
            Fazenda Novo Horizonte
          </div>
        </div>
      </div>

      <div
        ref={menuRef}
        className="mobile-app-header__menu-wrap"
      >
        <button
          type="button"
          className="mobile-app-header__profile"
          onClick={() => setOpen((value) => !value)}
          aria-label="Abrir opções do usuário"
          aria-expanded={open}
        >
          {inicialDoUsuario(user)}
        </button>

        {open ? (
          <div className="mobile-app-header__menu">
            <div className="mobile-app-header__menu-head">
              <strong>
                {user?.display_name ||
                  user?.nome ||
                  user?.username ||
                  'Usuário'}
              </strong>

              {user?.email ? (
                <span>{user.email}</span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={irParaMais}
            >
              <MoreHorizontal className="h-4 w-4" />
              <span>Mais opções</span>
            </button>

            <button
              type="button"
              className="is-danger"
              onClick={sair}
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
