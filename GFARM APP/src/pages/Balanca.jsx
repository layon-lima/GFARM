import { Scale, ShieldX } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { canAccessBalanca } from '@/lib/permissions';
import BalancaStatusGrid from '@/components/balanca/BalancaStatusGrid';
import BalancaControles from '@/components/balanca/BalancaControles';
import BalancaConfig from '@/components/balanca/BalancaConfig';

export default function Balanca() {
  const { user } = useAuth();
  const podeAcessar = canAccessBalanca(user);

  if (!podeAcessar) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center">
        <div className="p-4 rounded-2xl bg-destructive/10 text-destructive mb-4">
          <ShieldX className="w-10 h-10" />
        </div>
        <h1 className="text-xl font-bold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground mt-1">Você não possui permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-[1200px] mx-auto">
      <header>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Scale className="w-5 h-5 sm:w-6 sm:h-6 text-primary" /> Central da Balança
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie a conexão com a balança Toledo Prix e valide a integração.
        </p>
      </header>

      <BalancaStatusGrid />
      <BalancaControles />
      <BalancaConfig />
    </div>
  );
}