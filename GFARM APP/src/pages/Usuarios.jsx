import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserCircle,
  UserPlus,
  Users,
} from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import SearchSelect from '@/components/SearchSelect';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { api } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  hasPermission,
  roleLabel,
} from '@/lib/permissions';
import InviteUserDialog from '@/components/usuarios/InviteUserDialog';
import UsuarioNomeEditor from '@/components/usuarios/UsuarioNomeEditor';
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

function MiniStat({ icon: Icon, label, value, tone = 'default' }) {
  const toneMap = {
    default: 'bg-primary/10 text-primary',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };

  return (
    <div className="flex min-h-[62px] items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneMap[tone] || toneMap.default}`}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0">
        <p className="truncate text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-lg font-semibold leading-none">{value}</p>
      </div>
    </div>
  );
}

export default function Usuarios() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [roleFiltro, setRoleFiltro] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const isAdminTotal = currentUser?.role === 'admin';
  const canCreateUser = hasPermission(
    currentUser,
    'admin.usuarios.criar'
  );
  const canEditUser = hasPermission(
    currentUser,
    'admin.usuarios.editar'
  );
  const canDeleteUser = hasPermission(
    currentUser,
    'admin.usuarios.excluir'
  );

  const loadUsuarios = useCallback(async () => {
    setLoading(true);

    try {
      const data = await api.entities.User.list('-created_date', 200);
      setUsuarios(data);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar usuários',
        description: err?.message,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadUsuarios();
  }, [loadUsuarios]);

  const filtered = useMemo(() => {
    const q = busca.toLowerCase().trim();

    return usuarios.filter((u) => {
      if (roleFiltro && u.role !== roleFiltro) return false;

      if (!q) return true;

      return [u.display_name, u.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [usuarios, busca, roleFiltro]);

  const stats = useMemo(
    () => ({
      total: usuarios.length,
      admins: usuarios.filter((u) => u.role === 'admin').length,
      subadmins: usuarios.filter((u) => u.role === 'subadmin').length,
      users: usuarios.filter((u) => u.role === 'user').length,
    }),
    [usuarios]
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);

    try {
      await api.entities.User.delete(deleteTarget.id);

      setUsuarios((prev) =>
        prev.filter((u) => u.id !== deleteTarget.id)
      );

      toast({
        title: 'Usuário removido',
        description: `${deleteTarget.display_name || deleteTarget.username} foi removido.`,
      });

      setDeleteTarget(null);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao remover',
        description: err?.message,
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <MiniStat icon={Users} label="Usuários" value={stats.total} />
          <MiniStat
            icon={ShieldCheck}
            label="Administradores"
            value={stats.admins}
            tone="blue"
          />
          <MiniStat
            icon={ShieldCheck}
            label="Sub Administradores"
            value={stats.subadmins}
            tone="amber"
          />
          <MiniStat
            icon={UserCircle}
            label="Usuários padrão"
            value={stats.users}
            tone="green"
          />
        </div>

        <Card className="overflow-hidden rounded-2xl border shadow-none">
          <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
              <div className="relative w-full sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou usuário..."
                  className="pl-9"
                />
              </div>

              <div className="w-full sm:w-[220px]">
                <SearchSelect
                  value={roleFiltro || 'all'}
                  onChange={(value) =>
                    setRoleFiltro(value === 'all' ? '' : value)
                  }
                  allLabel="Todos os perfis"
                  placeholder="Filtrar perfil"
                  options={[
                    { value: 'admin', label: 'Administradores Totais' },
                    { value: 'subadmin', label: 'Sub Administradores' },
                    { value: 'user', label: 'Usuários' },
                  ]}
                />
              </div>
            </div>

            {canCreateUser ? (
              <Button
                onClick={() => setInviteOpen(true)}
                className="gap-2"
              >
                <UserPlus className="h-4 w-4" />
                Novo usuário
              </Button>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Users className="mx-auto mb-3 h-10 w-10 opacity-35" />
              <p className="text-sm">Nenhum usuário encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Perfil</TableHead>

                    <TableHead>Permissões</TableHead>

                    {canDeleteUser ? (
                      <TableHead className="w-[90px] text-right">
                        Ações
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                              {(u.display_name || u.username || '?')
                                .slice(0, 1)
                                .toUpperCase()}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {canEditUser &&
                                (
                                  isAdminTotal ||
                                  u.role === 'user'
                                ) ? (
                                  <UsuarioNomeEditor
                                    user={u}
                                    onSaved={loadUsuarios}
                                  />
                                ) : (
                                  <span className="font-medium">
                                    {u.display_name || u.username || '—'}
                                  </span>
                                )}

                                {isSelf ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px]"
                                  >
                                    Você
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="font-mono text-xs">
                          {u.username || '—'}
                        </TableCell>

                        <TableCell>
                          {u.role === 'admin' ? (
                            <Badge className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50">
                              Administrador Total
                            </Badge>
                          ) : u.role === 'subadmin' ? (
                            <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                              Sub Administrador
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Usuário</Badge>
                          )}
                        </TableCell>

                        <TableCell>
                          {u.role === 'admin' ? (
                            <Badge variant="outline">
                              Acesso total
                            </Badge>
                          ) : isAdminTotal ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() =>
                                navigate(`/usuarios/${u.id}/permissoes`)
                              }
                            >
                              <Settings className="h-3.5 w-3.5" />
                              Configurar permissões
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {roleLabel(u.role)}
                            </span>
                          )}
                        </TableCell>


                        {canDeleteUser ? (
                          <TableCell>
                            <div className="flex justify-end">
                              {!isSelf &&
                              (
                                isAdminTotal ||
                                u.role === 'user'
                              ) ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(u)}
                                  title="Remover usuário"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={loadUsuarios}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover usuário?</AlertDialogTitle>

            <AlertDialogDescription>
              Tem certeza que deseja remover{' '}
              <strong>
                {deleteTarget?.display_name || deleteTarget?.username}
              </strong>{' '}
              do sistema? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Cancelar
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Remover'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
