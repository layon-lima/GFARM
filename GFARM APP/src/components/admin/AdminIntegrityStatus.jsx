import {
  useEffect,
  useState,
} from 'react';

import {
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  DatabaseBackup,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { adminApi } from '@/api/adminClient';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';


function formatarData(valor) {
  if (!valor) {
    return '—';
  }

  try {
    return new Date(
      valor
    ).toLocaleString(
      'pt-BR'
    );
  } catch {
    return '—';
  }
}


export default function AdminIntegrityStatus() {
  const { user } = useAuth();

  const podeVerIntegridade = hasPermission(
    user,
    'admin.integridade.visualizar'
  );
  const podeVerificarIntegridade = hasPermission(
    user,
    'admin.integridade.verificar'
  );
  const podeVerAuditoria = hasPermission(
    user,
    'admin.auditoria.visualizar'
  );
  const podeVerBackups = hasPermission(
    user,
    'admin.backups.visualizar'
  );
  const podeCriarBackup = hasPermission(
    user,
    'admin.backups.criar'
  );

  const [
    integridade,
    setIntegridade,
  ] = useState(null);

  const [
    auditoria,
    setAuditoria,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    dialogOpen,
    setDialogOpen,
  ] = useState(false);

  const [
    backupInfo,
    setBackupInfo,
  ] = useState(null);

  const [
    backupLoading,
    setBackupLoading,
  ] = useState(false);


  const carregar = async () => {
    if (!podeVerIntegridade) {
      setIntegridade(null);
      return;
    }

    setLoading(true);

    try {
      const dados =
        await adminApi.integridade();

      setIntegridade(
        dados
      );

    } catch {
      setIntegridade(
        null
      );

    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    carregar();

    if (podeVerBackups) {
      adminApi.backups()
        .then(setBackupInfo)
        .catch(() => {
          setBackupInfo(null);
        });
    } else {
      setBackupInfo(null);
    }
  }, [podeVerBackups, podeVerIntegridade]);


  const criarBackup = async () => {
    setBackupLoading(true);

    try {
      await adminApi.criarBackup();

      if (podeVerBackups) {
        const info =
          await adminApi.backups();

        setBackupInfo(info);
      }

    } finally {
      setBackupLoading(false);
    }
  };


  const abrirAuditoria = async () => {
    setDialogOpen(true);

    try {
      const itens =
        await adminApi.auditoria(
          30
        );

      setAuditoria(
        itens || []
      );

    } catch {
      setAuditoria([]);
    }
  };


  const executarVerificacao =
    async () => {
      setLoading(true);

      try {
        const resultado = await (
          adminApi
          .verificarIntegridade()
        );

        if (podeVerIntegridade) {
          await carregar();
        } else {
          setIntegridade(resultado);
        }

      } finally {
        setLoading(false);
      }
    };


  const ok =
    integridade?.status === 'ok';


  return (
    <>
      <div className="mx-2 my-2 rounded-lg border bg-muted/20 p-2.5">
        <div className="flex items-center gap-2">
          {ok ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-amber-600" />
          )}

          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">
              Integridade do sistema
            </div>

            <div className="text-[11px] text-muted-foreground">
              {loading
                ? 'Verificando...'
                : integridade
                  ? (
                    ok
                      ? 'Estoque íntegro'
                      : `${integridade.problemas} problema(s)`
                  )
                  : 'Não verificada'
              }
            </div>
          </div>
        </div>

        {(podeVerBackups || podeCriarBackup) && (
        <div className="mt-2 rounded-md border bg-background/60 p-2">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-3.5 w-3.5 text-primary" />

            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold">
                Backup do ERP
              </div>

              <div className="truncate text-[10px] text-muted-foreground">
                {backupInfo?.itens?.[0]
                  ? `Último: ${new Date(
                      backupInfo.itens[0].modificado_em
                    ).toLocaleString('pt-BR')}`
                  : 'Nenhum backup encontrado'
                }
              </div>
            </div>

            {podeCriarBackup && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                disabled={backupLoading}
                onClick={criarBackup}
              >
                {backupLoading
                  ? 'Criando...'
                  : 'Criar'
                }
              </Button>
            )}
          </div>
        </div>
        )}

        <div className="mt-2 flex gap-1.5">
          {podeVerificarIntegridade && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 flex-1 px-2 text-[11px]"
              onClick={
                executarVerificacao
              }
              disabled={loading}
            >
              <RefreshCw className={`mr-1.5 h-3 w-3 ${
                loading
                  ? 'animate-spin'
                  : ''
              }`} />
              Verificar
            </Button>
          )}

          {podeVerAuditoria && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 flex-1 px-2 text-[11px]"
              onClick={
                abrirAuditoria
              }
            >
              <ClipboardList className="mr-1.5 h-3 w-3" />
              Auditoria
            </Button>
          )}
        </div>
      </div>


      {podeVerAuditoria && (
      <Dialog
        open={dialogOpen}
        onOpenChange={
          setDialogOpen
        }
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Auditoria do ERP
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[65vh] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">
                    Data
                  </th>
                  <th className="px-3 py-2 text-left">
                    Usuário
                  </th>
                  <th className="px-3 py-2 text-left">
                    Ação
                  </th>
                  <th className="px-3 py-2 text-left">
                    Entidade
                  </th>
                  <th className="px-3 py-2 text-left">
                    Registro
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {auditoria.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      Nenhum evento registrado.
                    </td>
                  </tr>
                ) : (
                  auditoria.map(
                    (item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {formatarData(
                            item.created_date
                          )}
                        </td>

                        <td className="px-3 py-2">
                          {item.usuario_nome || '—'}
                        </td>

                        <td className="px-3 py-2">
                          {item.acao || '—'}
                        </td>

                        <td className="px-3 py-2">
                          {item.entidade || '—'}
                        </td>

                        <td className="px-3 py-2 font-mono text-xs">
                          {item.registro_id || '—'}
                        </td>
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
      )}
    </>
  );
}
