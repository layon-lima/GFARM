import { useState } from 'react';
import { Trash2, Unlink, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/api/apiClient';
import { safeDelete, safeUpdate, isNotFoundError } from '@/lib/entityOps';
import { useToast } from '@/components/ui/use-toast';
import { formatKg, formatPlaca, round3, statusPorSaldo } from '@/lib/pesagem';

// Desvincula um ticket do pedido: devolve o peso líquido ao saldo e,
// conforme a escolha do admin, exclui o ticket ou o mantém como "não vinculado".
export default function DesvincularTicketDialog({ ticket, pedido, onClose, onDone }) {
  const open = !!ticket;
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function restaurarSaldo() {
    const liq = Number(ticket?.peso_liquido) || 0;
    if (!pedido) return;
    const novoSaldo = round3((Number(pedido.saldo_kg) || 0) + liq);
    try {
      await api.entities.PedidoPesagem.update(pedido.id, {
        saldo_kg: novoSaldo,
        status: statusPorSaldo(novoSaldo, pedido.total_kg, pedido.status),
      });
    } catch (e) {
      if (!isNotFoundError(e)) throw e;
    }
  }

  async function handleExcluir() {
    setBusy(true);
    try {
      await restaurarSaldo();
      await safeDelete('TicketPesagem', ticket.id);
      toast({ title: 'Ticket excluído', description: 'Saldo do pedido restaurado.' });
      onDone?.();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao excluir', description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleManter() {
    setBusy(true);
    try {
      await restaurarSaldo();
      try {
        await safeUpdate('TicketPesagem', ticket.id, { pedido_id: '' });
      } catch (e) {
        if (String(e?.message || e) !== 'PHANTOM_RECORD') throw e;
      }
      toast({ title: 'Ticket desvinculado', description: 'Agora aparece em "Não vinculados".' });
      onDone?.();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao desvincular', description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose?.(); }}>
      <DialogContent className="max-w-md p-4 sm:p-6">
        {ticket && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Desvincular Ticket</DialogTitle>
              <DialogDescription>
                Ticket <b className="font-mono">{ticket.numero}</b> — {ticket.motorista} ({formatPlaca(ticket.placa)}).
                {ticket.peso_liquido ? ` Peso líquido de ${formatKg(ticket.peso_liquido)} será devolvido ao saldo do pedido.` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 pt-2">
              <Button
                type="button"
                variant="destructive"
                className="w-full justify-start"
                disabled={busy}
                onClick={handleExcluir}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Excluir o ticket
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                disabled={busy}
                onClick={handleManter}
              >
                <Unlink className="w-4 h-4 mr-2" /> Manter como não vinculado
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={onClose}>Cancelar</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}