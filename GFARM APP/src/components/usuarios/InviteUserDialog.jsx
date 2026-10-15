import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { UserPlus, Loader2, User, Lock } from 'lucide-react';
import { api } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';

export default function InviteUserDialog({
  open,
  onOpenChange,
  onInvited,
}) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [loading, setLoading] = useState(false);

  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const isAdminTotal = currentUser?.role === 'admin';

  const limpar = () => {
    setDisplayName('');
    setUsername('');
    setPassword('');
    setRole('user');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (
      !displayName.trim() ||
      !username.trim() ||
      !password
    ) {
      return;
    }

    setLoading(true);

    try {
      await api.users.createUser({
        display_name: displayName.trim(),
        username: username.trim(),
        password,
        role: isAdminTotal ? role : 'user',
      });

      toast({
        title: 'Usuário criado!',
        description: `${displayName.trim()} já pode acessar o sistema.`,
      });

      limpar();
      onOpenChange(false);
      onInvited?.();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao criar usuário',
        description:
          err?.message ||
          'Não foi possível criar o usuário.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!loading) {
          onOpenChange(value);

          if (!value) {
            limpar();
          }
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Novo Usuário
          </DialogTitle>

          <DialogDescription>
            Crie um usuário local para acessar o sistema.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="display-name">
              Nome
            </Label>

            <Input
              id="display-name"
              value={displayName}
              onChange={(e) =>
                setDisplayName(e.target.value)
              }
              placeholder="Ex.: João da Silva"
              required
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">
              Usuário
            </Label>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />

              <Input
                id="username"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value)
                }
                placeholder="Ex.: joao"
                className="pl-9"
                minLength={3}
                required
                disabled={loading}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">
              Senha
            </Label>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />

              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                placeholder="Senha inicial"
                className="pl-9"
                minLength={4}
                required
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Perfil</Label>

            {isAdminTotal ? (
              <Select
                value={role}
                onValueChange={setRole}
                disabled={loading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="user">
                    Usuário
                  </SelectItem>
                  <SelectItem value="subadmin">
                    Sub Administrador
                  </SelectItem>
                  <SelectItem value="admin">
                    Administrador Total
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                Usuário
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onOpenChange(false)
              }
              disabled={loading}
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              disabled={
                loading ||
                !displayName.trim() ||
                !username.trim() ||
                password.length < 4
              }
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Criar Usuário'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
