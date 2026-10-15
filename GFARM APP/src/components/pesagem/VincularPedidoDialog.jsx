import { useState, useMemo } from 'react';
import { Link2, CheckCircle2, AlertTriangle, ArrowRightLeft } from 'lucide-react';
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
import { useToast } from '@/components/ui/use-toast';
import { formatKg, round3, vincularConverterTicket } from '@/lib/pesagem';
import { formatPlaca } from '@/lib/pesagem';
import PedidoInfo from './PedidoInfo';

const TIPO_LABEL = { venda: 'Venda', lavoura: 'Saída p/ Lavoura', compra: 'Entrada p/ Compra', entrada_saida: 'Entrada e Saída', avulsa: 'Avulsa' };

// Vincula (e converte, se necessário) um ticket fechado a um pedido aberto
// DO MESMO PRODUTO. Discreto, acessível pelo modal de detalhe do ticket.
export default function VincularPedidoDialog({ ticket, pedidos, pessoas, produtos, transportadoras, onClose, onDone }) {
  const open = !!ticket;
  const [pedidoId, setPedidoId] = useState('');
  const [busca, setBusca] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const produtoNome = (id) => produtos.find((p) => p.id === id)?.nome || '—';
  const transpNome = (id) => transportadoras.find((t) => t.id === id)?.nome || '—';

  const produtoTicketId = ticket?.produto_id || '';
  const jaVenda = ticket?.tipo === 'venda';

  // Só pedidos abertos cujo produto é exatamente o do ticket.
  const pedidosCompativeis = useMemo(
    () => (pedidos || []).filter((p) => p.status === 'aberto' && p.produto_id && p.produto_id === produtoTicketId),
    [pedidos, produtoTicketId]
  );

  const visiveis = useMemo(() => {
    const q = busca.toLowerCase().trim();
    let list = pedidosCompativeis;
    // Oculta o pedido já selecionado da lista — ele aparece no resumo abaixo.
    if (pedidoId) list = list.filter((p) => p.id !== pedidoId);
    if (!q) return list;
    return list.filter((p) => clienteNome(p.cliente_id).toLowerCase().includes(q));
  }, [pedidosCompativeis, busca, pedidoId]);

  const pedidoSel = pedidosCompativeis.find((p) => p.id === pedidoId) || null;
  const liq = round3(Number(ticket?.peso_liquido) || 0);
  const semLimite = !!pedidoSel?.sem_limite;
  const saldoInsuficiente = !!pedidoSel && !semLimite && liq > (Number(pedidoSel.saldo_kg) || 0) + 0.001;

  async function handleConfirm() {
    if (!pedidoId) {
      toast({ variant: 'destructive', title: 'Selecione um pedido' });
      return;
    }
    setBusy(true);
    try {
      const { ticket: updatedTicket, baixaError, convertidoDe } = await vincularConverterTicket({
        ticket,
        pedido: pedidoSel,
        produtos,
        clienteNome,
        transpNome,
      });
      if (convertidoDe) {
        toast({
          title: 'Ticket convertido e vinculado',
          description: `Agora é Venda — ${formatKg(liq)} consumidos do pedido ${pedidoSel.numero}.`,
        });
      } else {
        toast({ title: 'Ticket vinculado', description: `${formatKg(liq)} consumidos do pedido ${pedidoSel.numero}.` });
      }
      if (baixaError) {
        if (baixaError.startsWith('SALDO_INSUFICIENTE')) {
          const disp = baixaError.split(':')[1] || '0';
          toast({
            variant: 'destructive',
            title: 'Saldo físico insuficiente',
            description: `Disponível: ${formatKg(disp)}. Pedido consumido, mas o estoque não foi baixado — verifique o saldo.`,
          });
        } else if (baixaError === 'DEPOSITO_OBRIGATORIO') {
          toast({
            variant: 'destructive',
            title: 'Depósito não definido',
            description: 'O produto não possui depósito cadastrado. Defina o depósito no cadastro para baixar o estoque.',
          });
        } else {
          toast({ variant: 'destructive', title: 'Falha ao baixar estoque', description: baixaError });
        }
      }
      setPedidoId('');
      setBusca('');
      onDone?.(updatedTicket);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao vincular', description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) { setPedidoId(''); setBusca(''); onClose?.(); } }}>
      <DialogContent className="max-w-md p-4 sm:p-6">
        {ticket && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" /> Vincular ao Pedido</DialogTitle>
              <DialogDescription>
                Ticket <b className="font-mono">{ticket.numero}</b> — {ticket.motorista} ({formatPlaca(ticket.placa)}).
                {' '}Líquido: <b>{formatKg(liq)}</b>. Apenas pedidos do mesmo produto.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              {!jaVenda && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  <ArrowRightLeft className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Este ticket é do tipo <b>{TIPO_LABEL[ticket.tipo] || ticket.tipo}</b> e será convertido para
                    <b> Venda</b>. O estoque do produto será baixado em {formatKg(liq)} e o saldo do pedido consumido normalmente.
                  </span>
                </div>
              )}

              <div className="rounded-lg border p-3 text-sm">
                <p className="text-xs text-muted-foreground">Produto do ticket</p>
                <p className="font-medium truncate">{produtoNome(produtoTicketId)}</p>
              </div>

              {pedidosCompativeis.length === 0 ? (
                <p className="text-sm text-destructive">
                  Nenhum pedido aberto com este produto. Abra um pedido para o mesmo produto antes de vincular.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Pedido aberto *</Label>
                    <Input
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por cliente..."
                      autoFocus
                    />
                  </div>
                  <div className="max-h-56 overflow-auto scrollbar-thin space-y-2 rounded-lg border p-2">
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
                            <PedidoInfo pedido={p} clienteNome={clienteNome} produtoNome={produtoNome} />
                            {selected && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {pedidoSel && (
                <div className="space-y-2">
                  <PedidoInfo variant="summary" pedido={pedidoSel} clienteNome={clienteNome} produtoNome={produtoNome} />
                  {semLimite ? (
                    <div className="flex items-center gap-1.5 text-xs text-sky-700 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" /> Pedido sem limite — saldo não debitado.
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                      <div className="flex justify-between"><span className="text-muted-foreground">Saldo atual:</span><span className="font-semibold">{formatKg(pedidoSel.saldo_kg)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Após vincular:</span><span className="font-semibold">{formatKg(round3((Number(pedidoSel.saldo_kg) || 0) - liq))}</span></div>
                      {saldoInsuficiente && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium pt-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Excede o saldo — ficará negativo.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onClose}>Cancelar</Button>
                <Button type="button" className="flex-1" disabled={busy || !pedidoId} onClick={handleConfirm}>
                  {busy ? 'Vinculando...' : jaVenda ? 'Vincular' : 'Converter e Vincular'}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}