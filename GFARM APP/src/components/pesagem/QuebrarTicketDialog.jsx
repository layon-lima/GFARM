import { useState, useMemo } from 'react';
import { Scissors, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatQtd } from '@/lib/format';
import { formatKg, round3, quebrarTicket } from '@/lib/pesagem';
import { gerarTicketPDF } from '@/lib/ticketPdf';
import PedidoInfo from '@/components/pesagem/PedidoInfo';

export default function QuebrarTicketDialog({ open, onClose, onDone, ticket, pesoBruto, isInverted, liquido, pedidoSel, pedidos, pessoas, produtos, transportadoras, transportadoraId, observacao, tickets }) {
  const [busca, setBusca] = useState('');
  const [novoPedidoId, setNovoPedidoId] = useState('');
  const [saving, setSaving] = useState(false);
  const [resultado, setResultado] = useState(null);
  const { toast } = useToast();

  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const produtoNome = (id) => produtos.find((p) => p.id === id)?.nome || '—';

  const saldoOriginal = Number(pedidoSel?.saldo_kg) || 0;
  const liquidoExcesso = round3((Number(liquido) || 0) - saldoOriginal);

  // Quebra encadeada: leve = menor pesagem, pesada = maior pesagem do ticket.
  const taraRaw = Number(ticket?.peso_tara) || 0;
  const brutoRaw = Number(ticket?.peso_bruto) || 0;
  const leve = Math.min(taraRaw, brutoRaw);
  const pesada = Math.max(taraRaw, brutoRaw);
  // Original mantém a pesagem leve como tara e fecha o pedido (bruto = leve + saldo consumido).
  // O bruto gerado vira a tara do complementar; a pesagem pesada original vira o bruto dele.
  const brutoOriginal = round3(leve + saldoOriginal);

  const pesosOriginal = useMemo(() => ({ tara: leve, bruto: brutoOriginal, liquido: saldoOriginal }),
    [leve, brutoOriginal, saldoOriginal]);

  const pesosNovo = useMemo(() => ({ tara: brutoOriginal, bruto: pesada, liquido: liquidoExcesso }),
    [brutoOriginal, pesada, liquidoExcesso]);

  const pedidosDisponiveis = useMemo(() => {
    if (!pedidos || !pedidoSel) return [];
    const q = busca.toLowerCase().trim();
    return pedidos
      .filter((p) => p.id !== pedidoSel.id && p.status === 'aberto')
      .filter((p) => {
        if (!q) return true;
        return clienteNome(p.cliente_id).toLowerCase().includes(q) || produtoNome(p.produto_id).toLowerCase().includes(q);
      });
  }, [pedidos, pedidoSel, busca]);

  async function handleConfirmar() {
    if (!novoPedidoId) {
      toast({ variant: 'destructive', title: 'Selecione um pedido para o complemento' });
      return;
    }
    const novoPedido = pedidos.find((p) => p.id === novoPedidoId);
    if (!novoPedido) return;

    setSaving(true);
    try {
      const transpNome = (id) => transportadoras.find((t) => t.id === id)?.nome || '—';
      const res = await quebrarTicket({
        ticket,
        pesoBruto,
        isInverted,
        liquido,
        pedidoSel,
        novoPedido,
        transportadoraId,
        observacao,
        clienteNome,
        transpNome,
        produtos,
        tickets,
      });
      setResultado(res);
      toast({ title: 'Ticket quebrado com sucesso', description: `Original: ${res.ticketOriginal.numero} · Complementar: ${res.ticketNovo.numero}` });
      if (onDone) onDone();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao quebrar ticket', description: String(err?.message || err) });
    } finally {
      setSaving(false);
    }
  }

  async function imprimirPDF(ticketData, label) {
    try {
      const ctx = { pedido: pedidoSel, produtoNome, clienteNome };
      await gerarTicketPDF(ticketData, ctx, { print: false });
      toast({ title: `${label} gerado`, description: ticketData.numero });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao gerar PDF', description: String(err?.message || err) });
    }
  }

  function handleClose() {
    setBusca('');
    setNovoPedidoId('');
    setResultado(null);
    onClose?.();
  }

  if (!ticket || !pedidoSel) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-amber-600" /> Quebrar Ticket {ticket.numero}
          </DialogTitle>
          <DialogDescription>
            O ticket será dividido em dois: um fecha o pedido atual e o excedente vai para outro pedido.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-4 text-center py-2">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-green-600" />
              </div>
              <p className="font-semibold">Ticket quebrado com sucesso!</p>
            </div>
            <div className="space-y-2 text-left">
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold text-primary">{resultado.ticketOriginal.numero}</span>
                  <Badge variant="secondary">Ticket original (ajustado)</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Tara {formatKg(resultado.ticketOriginal.peso_tara)} · Bruto {formatKg(resultado.ticketOriginal.peso_bruto)} · Líquido {formatKg(resultado.ticketOriginal.peso_liquido)}</p>
                <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => imprimirPDF(resultado.ticketOriginal, 'PDF original')}>
                  Baixar PDF do ticket original
                </Button>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold text-primary">{resultado.ticketNovo.numero}</span>
                  <Badge className="bg-amber-100 text-amber-700">Ticket complementar</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Tara {formatKg(resultado.ticketNovo.peso_tara)} · Bruto {formatKg(resultado.ticketNovo.peso_bruto)} · Líquido {formatKg(resultado.ticketNovo.peso_liquido)}</p>
                <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => imprimirPDF(resultado.ticketNovo, 'PDF complementar')}>
                  Baixar PDF do ticket complementar
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={handleClose}>Concluir</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Resumo da divisão */}
            <div className="rounded-lg border-2 border-amber-400/50 bg-amber-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Divisão dos pesos</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-white border p-2">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Ticket original</p>
                  <p className="text-xs">Fecha o pedido {pedidoSel.numero}</p>
                  <div className="mt-1 space-y-0.5 text-xs">
                    <p>Tara: <b>{formatKg(pesosOriginal.tara)}</b></p>
                    <p>Bruto: <b>{formatKg(pesosOriginal.bruto)}</b></p>
                    <p className="text-primary font-bold">Líquido: {formatKg(pesosOriginal.liquido)}</p>
                  </div>
                </div>
                <div className="rounded-md bg-white border p-2">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Ticket complementar</p>
                  <p className="text-xs">Vai para o novo pedido</p>
                  <div className="mt-1 space-y-0.5 text-xs">
                    <p>Tara: <b>{formatKg(pesosNovo.tara)}</b></p>
                    <p>Bruto: <b>{formatKg(pesosNovo.bruto)}</b></p>
                    <p className="text-amber-600 font-bold">Líquido: {formatKg(pesosNovo.liquido)}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Saldo excedido: {formatKg(liquidoExcesso)} será direcionado ao novo pedido.</span>
              </div>
            </div>

            {/* Seletor de novo pedido */}
            <div className="space-y-1.5">
              <Label>Escolha o pedido para o complemento *</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pedido por cliente ou produto..." className="pl-9" />
              </div>
              <div className="max-h-56 overflow-auto scrollbar-thin space-y-2 rounded-lg border p-2">
                {pedidosDisponiveis.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground text-center">Nenhum pedido disponível.</p>
                ) : pedidosDisponiveis.map((p) => {
                  const selected = p.id === novoPedidoId;
                  const ps = p.peso_saca_kg || 0;
                  const saldoSacas = p.sem_limite ? null : (ps > 0 ? (p.saldo_kg || 0) / ps : 0);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setNovoPedidoId(selected ? '' : p.id)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${selected ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500' : 'hover:bg-accent hover:border-amber-500/50'}`}
                    >
                      <div className="flex justify-between gap-2">
                        <PedidoInfo pedido={p} clienteNome={clienteNome} produtoNome={produtoNome} />
                        {selected && <CheckCircle2 className="w-5 h-5 text-amber-600 shrink-0" />}
                      </div>
                      {!p.sem_limite && (
                        <p className="text-xs text-muted-foreground mt-1">{formatQtd(saldoSacas)} sacas disponível · {formatKg(p.saldo_kg || 0)} saldo</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>Cancelar</Button>
              <Button type="button" className="flex-1 bg-amber-600 hover:bg-amber-700" disabled={saving || !novoPedidoId} onClick={handleConfirmar}>
                <Scissors className="w-4 h-4 mr-2" /> {saving ? 'Quebrando...' : 'Confirmar Quebra'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}