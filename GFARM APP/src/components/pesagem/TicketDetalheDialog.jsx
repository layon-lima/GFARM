import { useState } from 'react';
import { Printer, Download, Loader2, Trash2, FileCheck2, FilePlus2, Pencil, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatKg, formatMoeda, formatPlaca } from '@/lib/pesagem';
import { gerarTicketPDF } from '@/lib/ticketPdf';
import { imprimirTicketTermico } from '@/lib/ticketThermal';
import MarcaNfDialog from './MarcaNfDialog';
import EditarTicketDialog from './EditarTicketDialog';
import VincularPedidoDialog from './VincularPedidoDialog';

const TIPO_LABEL = { venda: 'Venda', lavoura: 'Saída p/ Lavoura', compra: 'Entrada p/ Compra', entrada_saida: 'Entrada e Saída', avulsa: 'Avulsa' };

export default function TicketDetalheDialog({ ticket, pedidos, pessoas, produtos, transportadoras, onClose, onExcluir, onReload, onTicketUpdated }) {
  const open = !!ticket;
  const [gerandoPdf, setGerandoPdf] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [marcaNf, setMarcaNf] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);
  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const produtoNome = (id) => produtos.find((p) => p.id === id)?.nome || '—';
  const pedido = ticket ? pedidos.find((p) => p.id === ticket.pedido_id) : null;

  async function handlePdf(opts) {
    if (!ticket) return;
    setGerandoPdf(opts.print ? 'print' : 'download');
    try {
      await gerarTicketPDF(ticket, { pedido, produtoNome, clienteNome }, opts);
    } finally {
      setGerandoPdf(null);
    }
  }

  async function handleTermico() {
    if (!ticket) return;
    setGerandoPdf('termico');
    try {
      await imprimirTicketTermico(ticket, { pedido, produtoNome, clienteNome });
    } catch (err) {
      console.error(err);
    } finally {
      setGerandoPdf(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        {ticket && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">Ticket {ticket.numero}</DialogTitle>
              <DialogDescription>Detalhes da pesagem.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant={ticket.status === 'aberto' ? 'default' : 'secondary'} className="capitalize">{ticket.status}</Badge>
                  {ticket.tipo && <Badge variant="outline">{TIPO_LABEL[ticket.tipo] || ticket.tipo}</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">Abertura: {ticket.data_abertura ? new Date(ticket.data_abertura).toLocaleString('pt-BR') : '—'}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Produto</p>
                  <p className="font-medium truncate">{produtoNome(ticket.produto_id || pedido?.produto_id || '')}</p>
                </div>
                {ticket.origem && (
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Origem</p>
                    <p className="font-medium truncate">{ticket.origem}</p>
                  </div>
                )}
                {ticket.destino && (
                  <div className="rounded-lg border p-3 col-span-2">
                    <p className="text-xs text-muted-foreground">Destino</p>
                    <p className="font-medium truncate">{ticket.destino}</p>
                  </div>
                )}
              </div>

              {ticket.transportadora_nome && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">Transportadora</p>
                  <p className="font-medium truncate">{ticket.transportadora_nome}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Motorista</p>
                  <p className="font-medium truncate">{ticket.motorista || '—'}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Placa</p>
                  <p className="font-medium font-mono">{formatPlaca(ticket.placa)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Tara</p>
                  <p className="font-semibold">{formatKg(ticket.peso_tara)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Peso bruto</p>
                  <p className="font-semibold">{ticket.peso_bruto ? formatKg(ticket.peso_bruto) : '—'}</p>
                </div>
                <div className="rounded-lg border p-3 bg-primary/5 col-span-2">
                  <p className="text-xs text-muted-foreground">Peso líquido</p>
                  <p className="text-lg font-bold text-primary">{ticket.peso_liquido ? formatKg(ticket.peso_liquido) : '—'}</p>
                </div>
                <div className="rounded-lg border p-3 col-span-2">
                  <p className="text-xs text-muted-foreground">Fechamento</p>
                  <p className="font-medium">{ticket.data_fechamento ? new Date(ticket.data_fechamento).toLocaleString('pt-BR') : '—'}</p>
                </div>
              </div>

              {pedido && (
                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <p className="text-xs text-muted-foreground mb-1">Pedido vinculado</p>
                  <div className="flex justify-between"><span className="text-muted-foreground">Cliente:</span><span className="font-medium truncate">{clienteNome(pedido.cliente_id)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Produto:</span><span className="font-medium truncate">{produtoNome(pedido.produto_id)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Saldo do pedido:</span><span className="font-semibold">{formatKg(pedido.saldo_kg || 0)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Valor total:</span><span className="font-semibold">{formatMoeda(pedido.valor_total)}</span></div>
                </div>
              )}

              {ticket.nfe_importada && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2 mb-1">
                    <FileCheck2 className="w-4 h-4 text-emerald-600" />
                    <p className="text-xs font-semibold text-emerald-700">Nota Fiscal Vinculada</p>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Número da NF:</span><span className="font-medium font-mono">{ticket.nfe_numero || '—'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">Produto (NF-e):</span><span className="font-medium text-right truncate">{ticket.nfe_produto || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Motorista (NF-e):</span><span className="font-medium truncate">{ticket.nfe_motorista || '—'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">Chave de acesso:</span><span className="font-mono text-xs text-right break-all">{ticket.nfe_chave || '—'}</span></div>
                </div>
              )}

              {ticket.observacao && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Observação</p>
                  <p className="whitespace-pre-wrap">{ticket.observacao}</p>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => handlePdf({ print: true })} disabled={!!gerandoPdf}>
                {gerandoPdf === 'print' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />} Imprimir A4
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleTermico} disabled={!!gerandoPdf}>
                {gerandoPdf === 'termico' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />} Térmica
              </Button>
              <Button className="flex-1" onClick={() => handlePdf({})} disabled={!!gerandoPdf}>
                {gerandoPdf === 'download' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} PDF
              </Button>
            </div>

            <Button variant="outline" className="w-full" onClick={() => setEditOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" /> Editar Ticket
            </Button>

            {ticket.status === 'fechado' && !ticket.pedido_id && ticket.produto_id && (
              <Button variant="ghost" className="w-full text-primary hover:text-primary" onClick={() => setVincularOpen(true)}>
                <Link2 className="w-4 h-4 mr-2" /> Vincular a Pedido
              </Button>
            )}

            {ticket.status === 'fechado' && ticket.tipo === 'venda' && (
              <Button variant="outline" className="w-full" onClick={() => setMarcaNf(true)}>
                {ticket.nfe_importada ? (
                  <><FileCheck2 className="w-4 h-4 mr-2 text-emerald-600" /> Editar NF</>
                ) : (
                  <><FilePlus2 className="w-4 h-4 mr-2" /> Marcar com NF</>
                )}
              </Button>
            )}

            {onExcluir && (
              <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => onExcluir(ticket)}>
                <Trash2 className="w-4 h-4 mr-2" /> Excluir Ticket
              </Button>
            )}
          </>
        )}
        <MarcaNfDialog
          ticket={marcaNf ? ticket : null}
          onClose={() => setMarcaNf(false)}
          onDone={() => { setMarcaNf(false); onReload?.(); }}
        />
        <EditarTicketDialog
          ticket={editOpen ? ticket : null}
          pedidos={pedidos}
          pessoas={pessoas}
          produtos={produtos}
          transportadoras={transportadoras}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => { setEditOpen(false); onReload?.(); onTicketUpdated?.(updated); }}
        />
        <VincularPedidoDialog
          ticket={vincularOpen ? ticket : null}
          pedidos={pedidos}
          pessoas={pessoas}
          produtos={produtos}
          transportadoras={transportadoras}
          onClose={() => setVincularOpen(false)}
          onDone={(updated) => { setVincularOpen(false); onReload?.(); onTicketUpdated?.(updated); }}
        />
      </DialogContent>
    </Dialog>
  );
}