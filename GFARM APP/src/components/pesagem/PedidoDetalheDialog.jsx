import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, Unlink, Trash2, Infinity as InfinityIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatKg, formatMoeda, formatPlaca, round3, somaLiquidoTickets } from '@/lib/pesagem';
import { formatQtd } from '@/lib/format';

export default function PedidoDetalheDialog({ pedido, pessoas, produtos, tickets, pagamentos, onClose, isAdmin, onEditPedido, onDesvincularTicket, onDeletePedido }) {
  const open = !!pedido;
  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const produtoNome = (id) => produtos.find((p) => p.id === id)?.nome || '—';

  const ticketsDoPedido = (pedido ? (tickets || []).filter((t) => t.pedido_id === pedido.id) : [])
    .sort((a, b) => new Date(b.data_abertura) - new Date(a.data_abertura));

  const semLimite = pedido?.sem_limite;
  const carregadoKgCalculado = pedido ? somaLiquidoTickets(tickets, pedido.id) : 0;
  const pct = !semLimite && pedido && pedido.total_kg > 0 ? Math.max(0, Math.min(100, ((pedido.saldo_kg || 0) / pedido.total_kg) * 100)) : 0;
  const carregadoKg = semLimite ? carregadoKgCalculado : (pedido ? Math.max(0, (pedido.total_kg || 0) - (pedido.saldo_kg || 0)) : 0);
  const carregadoPct = !semLimite && pedido && pedido.total_kg > 0 ? (carregadoKg / pedido.total_kg) * 100 : 0;
  const pesoSaca = pedido ? (pedido.peso_saca_kg || 0) : 0;
  const emSacas = (kg) => pesoSaca > 0 ? kg / pesoSaca : 0;
  const carregadoSacas = pedido ? emSacas(carregadoKg) : 0;
  const totalSacas = pedido ? emSacas(pedido.total_kg || 0) : 0;
  const restanteSacas = pedido ? emSacas(pedido.saldo_kg || 0) : 0;

  const valorPesado = semLimite
    ? (pedido ? round3(emSacas(carregadoKg) * (pedido.valor_saca || 0)) : 0)
    : (pedido ? round3(emSacas(carregadoKg) * (pedido.valor_saca || 0)) : 0);
  const totalPago = pedido ? (pagamentos || []).filter((pg) => pg.pedido_id === pedido.id).reduce((s, pg) => s + (Number(pg.valor) || 0), 0) : 0;
  const saldoReceber = round3(valorPesado - totalPago);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        {pedido && (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <DialogTitle className="flex items-center gap-2">Detalhes do Pedido <span className="font-mono text-sm font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{pedido.numero}</span></DialogTitle>
                  <DialogDescription>Criado para <b>{clienteNome(pedido.cliente_id)}</b></DialogDescription>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1.5 pr-8">
                    <Button variant="outline" size="sm" onClick={() => onEditPedido?.(pedido)}>
                      <Pencil className="w-4 h-4 mr-1.5" /> Editar
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => onDeletePedido?.(pedido)}>
                      <Trash2 className="w-4 h-4 mr-1.5" /> Excluir
                    </Button>
                  </div>
                )}
              </div>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={pedido.status === 'aberto' ? 'default' : 'secondary'} className="capitalize">{pedido.status}</Badge>
                  {semLimite && <Badge className="bg-sky-100 text-sky-700 gap-1"><InfinityIcon className="w-3 h-3" /> Sem limite</Badge>}
                </div>
                {!semLimite && <span className="text-xs text-muted-foreground">Saldo: <b className="text-foreground">{formatQtd(restanteSacas)} sacas</b> de {formatQtd(totalSacas)} sacas</span>}
              </div>

              {semLimite ? (
                <div className="rounded-lg border-2 border-sky-200 bg-sky-50 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Carregado</p>
                      <p className="text-3xl font-bold text-sky-700 leading-tight mt-0.5">{formatKg(carregadoKg)}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-xs text-muted-foreground">Tipo</p>
                      <p className="text-sm font-semibold text-sky-600">Sem limite de saldo</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-primary/5 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Restante</p>
                      <p className="text-3xl font-bold text-primary leading-tight mt-0.5">{formatQtd(restanteSacas)} <span className="text-base font-semibold">sacas</span></p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-xs text-muted-foreground">Carregado</p>
                      <p className="text-lg font-semibold">{formatQtd(carregadoSacas)} <span className="text-xs font-medium text-muted-foreground">({carregadoPct.toFixed(1)}%)</span></p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium truncate">{clienteNome(pedido.cliente_id)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Produto</p>
                  <p className="font-medium truncate">{produtoNome(pedido.produto_id)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Sacas</p>
                  <p className="font-semibold">{semLimite ? '—' : formatQtd(pedido.qtd_sacas || 0)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Peso/saca</p>
                  <p className="font-semibold">{formatKg(pedido.peso_saca_kg || 0)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Valor/saca</p>
                  <p className="font-semibold">{formatMoeda(pedido.valor_saca)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Valor total</p>
                  <p className="font-semibold">{formatMoeda(pedido.valor_total)}</p>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Valor já pesado:</span><span className="font-semibold">{formatMoeda(valorPesado)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Já pago:</span><span className="font-semibold text-green-600">{formatMoeda(totalPago)}</span></div>
                <div className="flex justify-between border-t pt-1 mt-0.5"><span className="text-muted-foreground font-medium">Saldo a receber:</span><span className="font-bold text-primary">{formatMoeda(saldoReceber)}</span></div>
              </div>

              {!semLimite && (
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}

              {pedido.observacao && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Observação</p>
                  <p className="whitespace-pre-wrap">{pedido.observacao}</p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold mb-2">Tickets vinculados ({ticketsDoPedido.length})</h4>
                {ticketsDoPedido.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum ticket vinculado.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-auto scrollbar-thin">
                    {ticketsDoPedido.map((t) => (
                      <div key={t.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-xs">{t.numero}</span>
                          <div className="flex items-center gap-1.5">
                            {isAdmin && (
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onDesvincularTicket?.(t, pedido)}>
                                <Unlink className="w-3.5 h-3.5 mr-1" /> Desvincular
                              </Button>
                            )}
                            <Badge variant={t.status === 'aberto' ? 'default' : 'secondary'} className="text-[10px] capitalize">{t.status}</Badge>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                          <span className="font-medium text-foreground truncate">{t.motorista}</span>
                          <span className="font-mono">{formatPlaca(t.placa)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Tara <b className="text-foreground">{formatKg(t.peso_tara)}</b></span>
                          {t.peso_liquido ? <span>Líq. <b className="text-foreground">{formatKg(t.peso_liquido)}</b></span> : null}
                          <span className="truncate">{t.data_fechamento ? new Date(t.data_fechamento).toLocaleString('pt-BR') : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}