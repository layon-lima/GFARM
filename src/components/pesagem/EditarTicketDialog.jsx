import { useState, useEffect, useMemo } from 'react';
import { Loader2, Save, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { parseQtd, formatQtd } from '@/lib/format';
import { calcLiquido, formatKg, normalizePlaca, round3, ajustarEstoqueVendaTicket } from '@/lib/pesagem';
import { useAuth } from '@/lib/AuthContext';
import { podeDigitarPeso } from '@/lib/permissions';
import SearchSelect from '@/components/SearchSelect';

const TIPO_LABEL = { venda: 'Venda', lavoura: 'Saída p/ Lavoura', compra: 'Entrada p/ Compra', entrada_saida: 'Entrada e Saída', avulsa: 'Avulsa' };

function isoToInput(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ''; }
}
function inputToIso(v) {
  if (!v) return '';
  try { return new Date(v).toISOString(); } catch { return ''; }
}

export default function EditarTicketDialog({ ticket, pedidos = [], pessoas = [], produtos = [], transportadoras = [], onClose, onSaved }) {
  const open = !!ticket;
  const { toast } = useToast();
  const { user } = useAuth();
  const podeEditarPeso = podeDigitarPeso(user);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (!ticket) return;
    setForm({
      motorista: ticket.motorista || '',
      placa: ticket.placa || '',
      origem: ticket.origem || '',
      destino: ticket.destino || '',
      observacao: ticket.observacao || '',
      data_abertura: isoToInput(ticket.data_abertura),
      data_fechamento: isoToInput(ticket.data_fechamento),
      peso_tara: ticket.peso_tara ? String(ticket.peso_tara) : '',
      peso_bruto: ticket.peso_bruto ? String(ticket.peso_bruto) : '',
      produto_id: ticket.produto_id || '',
      cliente_id: ticket.cliente_id || '',
      transportadora_id: ticket.transportadora_id || '',
    });
  }, [ticket]);

  const isVenda = ticket?.tipo === 'venda';
  const isFechado = ticket?.status === 'fechado';
  const pedido = useMemo(() => (ticket ? pedidos.find((p) => p.id === ticket.pedido_id) : null), [ticket, pedidos]);
  const clientes = useMemo(() => pessoas.filter((p) => p.is_cliente), [pessoas]);
  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const produtoNome = (id) => produtos.find((p) => p.id === id)?.nome || '—';
  const transpNome = (id) => transportadoras.find((t) => t.id === id)?.nome || '—';

  const taraNum = parseQtd(form.peso_tara);
  const brutoNum = parseQtd(form.peso_bruto);
  const liquido = round3(
    calcLiquido(brutoNum, taraNum) + (Number(ticket?.correcao_peso_kg) || 0)
  );
  const liquidoAntigo = round3(Number(ticket?.peso_liquido) || 0);
  const pesosMudaram = isVenda && isFechado && round3(liquido) !== liquidoAntigo;

  function setField(k, v) { setForm((prev) => ({ ...prev, [k]: v })); }

  async function salvar() {
    if (!ticket) return;
    if (!form.motorista.trim() || !form.placa.trim()) {
      toast({ variant: 'destructive', title: 'Motorista e placa são obrigatórios' });
      return;
    }
    setSaving(true);
    try {
      const updateData = {
        motorista: form.motorista.trim(),
        placa: normalizePlaca(form.placa),
        origem: form.origem.trim(),
        destino: form.destino.trim(),
        observacao: form.observacao || '',
        data_abertura: form.data_abertura ? inputToIso(form.data_abertura) : (ticket.data_abertura || ''),
        data_fechamento: isFechado ? (form.data_fechamento ? inputToIso(form.data_fechamento) : (ticket.data_fechamento || '')) : '',
      };

      if (podeEditarPeso) {
        updateData.peso_tara = round3(taraNum);
        updateData.peso_bruto = round3(brutoNum);
        updateData.peso_liquido = round3(liquido);
      }

      if (!isVenda) {
        if (form.produto_id) updateData.produto_id = form.produto_id;
        if (form.cliente_id) { updateData.cliente_id = form.cliente_id; updateData.cliente_nome = clienteNome(form.cliente_id); }
        if (form.transportadora_id) { updateData.transportadora_id = form.transportadora_id; updateData.transportadora_nome = transpNome(form.transportadora_id); }
      }

      await api.entities.TicketPesagem.update(ticket.id, updateData);

      let baixaError = null;
      if (podeEditarPeso && (pesosMudaram)) {
        const r = await ajustarEstoqueVendaTicket({ ticket, novoLiquido: liquido, produtos });
        baixaError = r.baixaError;
      }

      if (baixaError) {
        if (baixaError.startsWith('SALDO_INSUFICIENTE')) {
          toast({ variant: 'destructive', title: 'Ticket salvo — estoque não rebaixado', description: `Saldo disponível: ${baixaError.split(':')[1] || '0'}. Verifique o estoque.` });
        } else {
          toast({ variant: 'destructive', title: 'Ticket salvo — atenção ao estoque', description: baixaError });
        }
      } else {
        toast({ title: 'Ticket atualizado' });
      }

      const updated = { ...ticket, ...updateData };
      onSaved?.(updated);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: String(err?.message || err) });
    } finally {
      setSaving(false);
    }
  }

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Editar Ticket {ticket.numero}</DialogTitle>
          <DialogDescription>
            {podeEditarPeso ? 'Todos os campos podem ser editados.' : 'Você pode editar os dados descritivos. A edição de pesos exige permissão do administrador.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={ticket.status === 'aberto' ? 'default' : 'secondary'} className="capitalize">{ticket.status}</Badge>
            <Badge variant="outline">{TIPO_LABEL[ticket.tipo] || ticket.tipo}</Badge>
          </div>

          {isVenda && pedido && (
            <div className="rounded-lg border bg-primary/5 p-3 text-sm space-y-1">
              <p className="text-xs text-muted-foreground">Pedido vinculado (somente leitura)</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Cliente:</span><span className="font-medium truncate">{clienteNome(pedido.cliente_id)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Produto:</span><span className="font-medium truncate">{produtoNome(pedido.produto_id)}</span></div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Motorista *</Label>
              <Input value={form.motorista || ''} onChange={(e) => setField('motorista', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Placa *</Label>
              <Input value={form.placa || ''} onChange={(e) => setField('placa', e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Origem</Label>
              <Input value={form.origem || ''} onChange={(e) => setField('origem', e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Destino</Label>
              <Input value={form.destino || ''} onChange={(e) => setField('destino', e.target.value)} />
            </div>

            {!isVenda && (
              <>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Produto</Label>
                  <SearchSelect value={form.produto_id} onChange={(v) => setField('produto_id', v)} placeholder="Buscar produto..." options={produtos.map((p) => ({ value: p.id, label: p.nome }))} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">{ticket.tipo === 'compra' ? 'Fornecedor' : 'Cliente'}</Label>
                  <SearchSelect value={form.cliente_id} onChange={(v) => setField('cliente_id', v)} placeholder={ticket.tipo === 'compra' ? 'Buscar fornecedor...' : 'Buscar cliente...'} options={clientes.map((c) => ({ value: c.id, label: c.nome }))} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Transportadora</Label>
                  <SearchSelect value={form.transportadora_id} onChange={(v) => setField('transportadora_id', v)} placeholder="Buscar transportadora..." options={transportadoras.map((tt) => ({ value: tt.id, label: tt.nome }))} />
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Abertura</Label>
              <Input type="datetime-local" value={form.data_abertura || ''} onChange={(e) => setField('data_abertura', e.target.value)} />
            </div>
            {isFechado && (
              <div className="space-y-1">
                <Label className="text-xs">Fechamento</Label>
                <Input type="datetime-local" value={form.data_fechamento || ''} onChange={(e) => setField('data_fechamento', e.target.value)} />
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Observação</Label>
              <Textarea rows={2} value={form.observacao || ''} onChange={(e) => setField('observacao', e.target.value)} />
            </div>

            <div className="sm:col-span-2 rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Pesagens (kg)</Label>
                {!podeEditarPeso && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Lock className="w-3 h-3" /> bloqueado</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="text-[10px] text-muted-foreground">Tara</span>
                  <Input type="number" step="0.001" value={form.peso_tara || ''} disabled={!podeEditarPeso} onChange={(e) => setField('peso_tara', e.target.value)} />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Bruto</span>
                  <Input type="number" step="0.001" value={form.peso_bruto || ''} disabled={!podeEditarPeso} onChange={(e) => setField('peso_bruto', e.target.value)} />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Líquido</span>
                  <div className="h-9 flex items-center px-3 rounded-md border bg-background font-semibold">{formatQtd(liquido)}</div>
                </div>
              </div>
              {isVenda && isFechado && pesosMudaram && podeEditarPeso && (
                <p className="text-[11px] text-amber-700">O líquido mudou de {formatKg(liquidoAntigo)} para {formatKg(liquido)}. O saldo do pedido e o estoque serão reajustados ao salvar.</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onClose?.()} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}