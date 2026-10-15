import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Printer, CheckCircle2, Trash2, FileText, AlertTriangle, Pencil, MoreVertical, Ban } from 'lucide-react';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { formatQtd, formatDose } from '@/lib/format';
import { parseItens, diasEmAberto, normalizarStatusAplicacao } from '@/lib/osAplicacao';
import { gerarPDFOS } from '@/lib/osPdf';
import { invalidateEntidade } from '@/lib/useEntidades';
import { safeDelete } from '@/lib/entityOps';
import ConsumoRealDialog from '@/components/aplicacao/ConsumoRealDialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

const STATUS_LABELS = {
  pendente: { label: 'Pendente', className: 'bg-blue-500 text-white border-transparent' },
  baixada: { label: 'Baixada', className: 'bg-emerald-600 text-white border-transparent' },
  cancelada: { label: 'Cancelada', className: 'bg-muted text-muted-foreground border-transparent' },
};

export default function OsAplicacaoDetalhe({ open, onOpenChange, os, culturas, lavouras, produtos, saldos, lotes, movimentacoes, onConsumo, onEdit }) {
  const [consumoOpen, setConsumoOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [confirmCancelar, setConfirmCancelar] = useState(false);
  const [acoesOpen, setAcoesOpen] = useState(false);
  const { toast } = useToast();

  if (!os) return null;
  const itens = parseItens(os.itens);
  const cultura = culturas.find((c) => c.id === os.cultura_id);
  const lavoura = lavouras.find((l) => l.id === os.lavoura_id);
  const statusInfo = STATUS_LABELS[normalizarStatusAplicacao(os.status)] || STATUS_LABELS.pendente;

  function handlePrint() {
    gerarPDFOS(os, { cultura, lavoura });
  }

  async function handleConsumo(itensAtualizados) {
    setSaving(true);
    try {
      await onConsumo?.(os, itensAtualizados);
      setConsumoOpen(false);
      onOpenChange(false);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.startsWith('SALDO_INSUFICIENTE')) {
        const [, disp, nome] = msg.split(':');
        toast({ variant: 'destructive', title: 'Saldo insuficiente', description: `${nome || 'Produto'}: disponível ${formatQtd(Number(disp) || 0)}.` });
      } else if (msg.startsWith('DEPOSITO_OBRIGATORIO')) {
        toast({ variant: 'destructive', title: 'Depósito obrigatório', description: `Defina o depósito para ${msg.split(':')[1] || 'o produto'}.` });
      } else {
        toast({ variant: 'destructive', title: 'Erro', description: msg });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await safeDelete('OrdemServicoAplicacao', os.id);
      toast({ title: 'OS excluída' });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao excluir', description: String(err?.message || err) });
    }
  }

  async function handleCancelar() {
    await api.entities.OrdemServicoAplicacao.update(os.id, { status: 'cancelada' });
    toast({ title: 'Aplicação cancelada' });
    invalidateEntidade('OrdemServicoAplicacao');
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15 text-primary">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <DialogTitle className="font-mono">{os.numero}</DialogTitle>
                <p className="text-sm text-muted-foreground">{lavoura?.nome || os.lavoura_nome}</p>
              </div>
              <Badge className={statusInfo.className}>{statusInfo.label}</Badge>
              {normalizarStatusAplicacao(os.status) === 'pendente' && diasEmAberto(os) > 7 && (
                <Badge className="bg-red-100 text-red-700 border-transparent inline-flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Pendente há {diasEmAberto(os)} dias
                </Badge>
              )}
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {/* Dados gerais */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Cultura</p>
                <p className="font-medium">{cultura?.nome || os.cultura_nome || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ano Safra</p>
                <p className="font-medium">{os.ano_safra || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hectares</p>
                <p className="font-medium tabular-nums">{formatQtd(os.hectares || 0)} ha</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Data de Abertura</p>
                <p className="font-medium">{os.data ? new Date(os.data).toLocaleString('pt-BR') : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Responsável</p>
                <p className="font-medium">{os.responsavel || '—'}</p>
              </div>
              {os.data_execucao && (
                <div>
                  <p className="text-xs text-muted-foreground">Data da Baixa</p>
                  <p className="font-medium">{new Date(os.data_execucao).toLocaleString('pt-BR')}</p>
                </div>
              )}
              {os.custo_total > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Custo Total</p>
                  <p className="font-semibold text-primary">R$ {Number(os.custo_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              )}
            </div>

            {os.observacao && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="text-xs text-muted-foreground mb-1">Observação</p>
                <p>{os.observacao}</p>
              </div>
            )}

            {/* Tabela de itens */}
            <div className="border rounded-xl overflow-x-auto scrollbar-thin">
              <table className="min-w-full w-auto text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left whitespace-nowrap">Produto</th>
                    <th className="p-2 text-center whitespace-nowrap">Un.</th>
                    <th className="p-2 text-right whitespace-nowrap">Dose/ha</th>
                    <th className="p-2 text-right whitespace-nowrap">Previsto</th>
                    {normalizarStatusAplicacao(os.status) === 'baixada' && <th className="p-2 text-right whitespace-nowrap">Realizado</th>}
                    {normalizarStatusAplicacao(os.status) === 'baixada' && <th className="p-2 text-right whitespace-nowrap">Custo</th>}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 whitespace-nowrap font-medium">{it.nome}</td>
                      <td className="p-2 text-center whitespace-nowrap text-muted-foreground">{it.unidade}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatDose(it.dose_por_hect || 0)}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums font-semibold">{formatQtd(it.previsto || 0)}</td>
                      {normalizarStatusAplicacao(os.status) === 'baixada' && (
                        <td className="p-2 text-right whitespace-nowrap tabular-nums font-semibold text-primary">{formatQtd(it.realizado || 0)}</td>
                      )}
                      {normalizarStatusAplicacao(os.status) === 'baixada' && (
                        <td className="p-2 text-right whitespace-nowrap tabular-nums">
                          {it.custo_total ? `R$ ${Number(it.custo_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter className="flex items-center justify-between flex-wrap gap-2">
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" /> Imprimir / PDF
              </Button>
              <Popover open={acoesOpen} onOpenChange={setAcoesOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <MoreVertical className="w-4 h-4 mr-2" /> Ações
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 p-1">
                  {normalizarStatusAplicacao(os.status) === 'pendente' && (
                    <>
                      <button type="button" onClick={() => { setAcoesOpen(false); setConfirmEdit(true); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent text-left">
                        <Pencil className="w-4 h-4" /> Editar
                      </button>
                      <button type="button" onClick={() => { setAcoesOpen(false); setConsumoOpen(true); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent text-left">
                        <CheckCircle2 className="w-4 h-4" /> Baixar aplicação
                      </button>
                      <button type="button" onClick={() => { setAcoesOpen(false); setConfirmCancelar(true); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent text-left text-destructive">
                        <Ban className="w-4 h-4" /> Cancelar aplicação
                      </button>
                      <div className="my-1 h-px bg-border" />
                    </>
                  )}
                  <button type="button" onClick={() => { setAcoesOpen(false); setDeleteOpen(true); }} className="hidden w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent text-left text-destructive">
                    <Trash2 className="w-4 h-4" /> Excluir
                  </button>
                </PopoverContent>
              </Popover>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConsumoRealDialog
        open={consumoOpen}
        onOpenChange={setConsumoOpen}
        os={os}
        produtos={produtos}
        saldos={saldos}
        onConfirm={handleConsumo}
        saving={saving}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" /> Excluir OS?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a OS <b className="font-mono">{os.numero}</b>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEdit} onOpenChange={setConfirmEdit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Pencil className="w-5 h-5 text-primary" /> Editar aplicação?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja editar a OS <b className="font-mono">{os.numero}</b>? Os produtos, doses e depósitos poderão ser alterados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmEdit(false); onEdit?.(os); }}>
              Editar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancelar} onOpenChange={setConfirmCancelar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" /> Cancelar aplicação?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja cancelar a OS <b className="font-mono">{os.numero}</b>? A OS passará ao status "Cancelada" e não poderá ser executada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter OS</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelar} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}