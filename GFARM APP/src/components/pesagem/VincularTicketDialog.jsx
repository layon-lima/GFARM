import { useState, useMemo } from 'react';
import { Link2, CheckCircle2, Scissors, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { formatKg, formatMoeda, formatPlaca, round3 } from '@/lib/pesagem';
import QuebrarTicketDialog from './QuebrarTicketDialog';
import PedidoInfo from './PedidoInfo';

// helper de nome de produto (usado pelo PedidoInfo)
const produtoNome = (produtos, id) => (produtos || []).find((p) => p.id === id)?.nome || '—';

// Vincula um ticket "não vinculado" a um pedido aberto, subtraindo o peso líquido do saldo.
// Se o saldo for insuficiente, ativa a função de quebra de ticket.
export default function VincularTicketDialog({ ticket, pedidos, pessoas, produtos, transportadoras, tickets, onClose, onDone }) {
  const open = !!ticket;
  const [pedidoId, setPedidoId] = useState('');
  const [busca, setBusca] = useState('');
  const [busy, setBusy] = useState(false);
  const [quebrarOpen, setQuebrarOpen] = useState(false);
  const { toast } = useToast();

  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';

  const pedidosAbertos = useMemo(
    () => (pedidos || []).filter((p) => p.status === 'aberto'),
    [pedidos]
  );

  const visiveis = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return pedidosAbertos;
    return pedidosAbertos.filter((p) => clienteNome(p.cliente_id).toLowerCase().includes(q));
  }, [pedidosAbertos, busca]);

  const pedidoSelecionado = pedidosAbertos.find((p) => p.id === pedidoId) || null;
  const liq = Number(ticket?.peso_liquido) || 0;
  const semLimite = !!pedidoSelecionado?.sem_limite;
  const saldoInsuficiente = !!pedidoSelecionado && !semLimite && liq > (Number(pedidoSelecionado.saldo_kg) || 0) + 0.001;

  async function handleVincular() {
    if (!pedidoId) {
      toast({ variant: 'destructive', title: 'Selecione um pedido' });
      return;
    }
    if (semLimite) {
      setBusy(true);
      try {
        await api.entities.TicketPesagem.update(ticket.id, {
          pedido_id: pedidoSelecionado.id,
          produto_id: pedidoSelecionado.produto_id,
          cliente_id: pedidoSelecionado.cliente_id,
          cliente_nome: clienteNome(pedidoSelecionado.cliente_id),
        });
        toast({ title: 'Ticket vinculado', description: 'Pedido sem limite — saldo não debitado.' });
        setPedidoId('');
        setBusca('');
        onDone?.();
      } catch (err) {
        toast({ variant: 'destructive', title: 'Erro ao vincular', description: String(err?.message || err) });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (saldoInsuficiente) {
      setQuebrarOpen(true);
      return;
    }
    setBusy(true);
    try {
      const novoSaldo = round3((Number(pedidoSelecionado.saldo_kg) || 0) - liq);
      await api.entities.PedidoPesagem.update(pedidoSelecionado.id, {
        saldo_kg: novoSaldo,
      });
      await api.entities.TicketPesagem.update(ticket.id, { pedido_id: pedidoSelecionado.id });
      toast({ title: 'Ticket vinculado', description: `Saldo do pedido atualizado.` });
      setPedidoId('');
      setBusca('');
      onDone?.();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao vincular', description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open && !quebrarOpen} onOpenChange={(o) => { if (!o && !busy && !quebrarOpen) { setPedidoId(''); setBusca(''); onClose?.(); } }}>
        <DialogContent className="max-w-md p-4 sm:p-6">
          {ticket && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" /> Vincular Ticket</DialogTitle>
                <DialogDescription>
                  Ticket <b className="font-mono">{ticket.numero}</b> — {ticket.motorista} ({formatPlaca(ticket.placa)}).
                  {liq ? ` Peso líquido ${formatKg(liq)} será descontado do saldo do pedido.` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label>Pedido aberto *</Label>
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar pedido por cliente..."
                    autoFocus
                  />
                </div>

                {pedidosAbertos.length === 0 ? (
                  <p className="text-sm text-destructive">Nenhum pedido aberto com saldo disponível. Cadastre/abra um pedido antes de vincular.</p>
                ) : (
                  <div className="max-h-64 overflow-auto scrollbar-thin space-y-2 rounded-lg border p-2">
                    {visiveis.length === 0 ? (
                      <p className="px-2 py-3 text-sm text-muted-foreground text-center">Nenhum pedido encontrado.</p>
                    ) : visiveis.map((p) => {
                      const selected = p.id === pedidoId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPedidoId(p.id)}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}
                        >
                          <div className="flex justify-between gap-2">
                            <PedidoInfo pedido={p} clienteNome={clienteNome} produtoNome={(id) => produtoNome(produtos, id)} />
                            {selected && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {pedidoSelecionado && (
                  <div className="space-y-2">
                    <PedidoInfo variant="summary" pedido={pedidoSelecionado} clienteNome={clienteNome} produtoNome={(id) => produtoNome(produtos, id)} />
                    {semLimite ? (
                      <div className="flex items-center gap-1.5 text-xs text-sky-700 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" /> Pedido sem limite — saldo não debitado.
                      </div>
                    ) : (
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                        <div className="flex justify-between"><span className="text-muted-foreground">Saldo atual:</span><span className="font-semibold">{formatKg(pedidoSelecionado.saldo_kg)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Após vincular:</span><span className="font-semibold">{formatKg(round3((Number(pedidoSelecionado.saldo_kg) || 0) - liq))}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Valor total:</span><span className="font-semibold">{formatMoeda(pedidoSelecionado.valor_total)}</span></div>
                        {saldoInsuficiente && (
                          <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium pt-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Saldo insuficiente — será necessário quebrar o ticket.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onClose}>Cancelar</Button>
                  {saldoInsuficiente ? (
                    <Button type="button" className="flex-1 bg-amber-600 hover:bg-amber-700" disabled={busy || !pedidoId} onClick={handleVincular}>
                      <Scissors className="w-4 h-4 mr-2" /> Quebrar Ticket
                    </Button>
                  ) : (
                    <Button type="button" className="flex-1" disabled={busy || !pedidoId} onClick={handleVincular}>
                      {busy ? 'Vinculando...' : 'Vincular'}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {quebrarOpen && ticket && pedidoSelecionado && (
        <QuebrarTicketDialog
          open={quebrarOpen}
          onClose={() => setQuebrarOpen(false)}
          onDone={() => { setQuebrarOpen(false); setPedidoId(''); setBusca(''); onDone?.(); }}
          ticket={ticket}
          pesoBruto={ticket.peso_bruto}
          isInverted={false}
          liquido={liq}
          pedidoSel={pedidoSelecionado}
          pedidos={pedidos}
          pessoas={pessoas}
          produtos={produtos}
          transportadoras={transportadoras}
          transportadoraId={(pedidoSelecionado.transportadora_ids || '').split(',')[0]?.trim() || ticket.transportadora_id || ''}
          observacao={ticket.observacao || ''}
          tickets={tickets}
        />
      )}
    </>
  );
}