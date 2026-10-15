import { useState, useEffect } from 'react';
import { FileCheck2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';

export default function MarcaNfDialog({ ticket, onClose, onDone }) {
  const open = !!ticket;
  const { toast } = useToast();
  const [nfeNumero, setNfeNumero] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (ticket) {
      setNfeNumero(ticket.nfe_numero || '');
    }
  }, [ticket]);

  async function handleSalvar() {
    if (!ticket) return;
    setSalvando(true);
    try {
      await api.entities.TicketPesagem.update(ticket.id, {
        nfe_importada: true,
        nfe_numero: nfeNumero.trim() || null,
      });
      toast({ title: 'NF vinculada', description: ticket.numero });
      onDone?.();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro', description: String(err?.message || err) });
    } finally {
      setSalvando(false);
    }
  }

  async function handleRemover() {
    if (!ticket) return;
    setSalvando(true);
    try {
      await api.entities.TicketPesagem.update(ticket.id, {
        nfe_importada: false,
        nfe_numero: null,
        nfe_produto: null,
        nfe_motorista: null,
        nfe_chave: null,
      });
      toast({ title: 'NF removida', description: ticket.numero });
      onDone?.();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro', description: String(err?.message || err) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
            Vincular NF Manualmente
          </DialogTitle>
          <DialogDescription>
            Marca o ticket <span className="font-mono font-semibold">{ticket?.numero}</span> como possuidor de nota fiscal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="nfe-numero">Número da NF (opcional)</Label>
            <Input
              id="nfe-numero"
              value={nfeNumero}
              onChange={(e) => setNfeNumero(e.target.value)}
              placeholder="Ex.: 1840"
              className="h-9"
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {ticket?.nfe_importada && (
            <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={handleRemover} disabled={salvando}>
              {salvando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Remover NF
            </Button>
          )}
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button className="flex-1" onClick={handleSalvar} disabled={salvando}>
              {salvando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileCheck2 className="w-4 h-4 mr-2" />}
              Confirmar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}