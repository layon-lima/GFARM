import { useState, useMemo } from 'react';
import { Scale, X, ShoppingCart, Sprout, Truck, ArrowLeftRight, Search } from 'lucide-react';
import PesoDisplay from '@/components/pesagem/PesoDisplay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { parseQtd, formatQtd } from '@/lib/format';
import { normalizePlaca, nextTicketNumber, formatKg } from '@/lib/pesagem';
import { useAuth } from '@/lib/AuthContext';
import { podeDigitarPeso } from '@/lib/permissions';
import SearchSelect from '@/components/SearchSelect';

const empty = { tipo: '', motorista: '', placa: '', peso: '', produto_id: '', transportadora_id: '', cliente_id: '', pedido_id: '', origem: '', destino: '', observacao: '' };

const TIPOS = [
  { value: 'venda', label: 'Venda', icon: ShoppingCart, desc: 'Saída para venda ao cliente' },
  { value: 'lavoura', label: 'Saída Para Lavoura', icon: Sprout, desc: 'Insumos para o campo' },
  { value: 'compra', label: 'Entrada Por Compra', icon: Truck, desc: 'Recebimento de mercadoria' },
  { value: 'entrada_saida', label: 'Entrada e Saída', icon: ArrowLeftRight, desc: 'Operação avulsa' },
];

export default function AberturaTicketDialog({ open, onClose, onReload, tickets, pessoas, produtos, transportadoras, pedidos }) {
  const [form, setForm] = useState(empty);
  const [step, setStep] = useState('tipo');
  const [buscaPedido, setBuscaPedido] = useState('');
  const [saving, setSaving] = useState(false);
  const [sairOpen, setSairOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const podeDigitar = podeDigitarPeso(user);

  const motoristas = useMemo(() => pessoas.filter((p) => p.is_motorista), [pessoas]);
  const clientes = useMemo(() => pessoas.filter((p) => p.is_cliente), [pessoas]);

  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const produtoNome = (id) => produtos.find((p) => p.id === id)?.nome || '—';

  const isVenda = form.tipo === 'venda';
  const pedidosAbertos = useMemo(() => (isVenda ? pedidos.filter((p) => p.status === 'aberto') : []), [pedidos, isVenda]);
  const pedidoSel = useMemo(() => pedidos.find((p) => p.id === form.pedido_id), [pedidos, form.pedido_id]);

  const transpsDoPedido = useMemo(() => {
    if (!pedidoSel) return [];
    const ids = (pedidoSel.transportadora_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    return ids.map((id) => transportadoras.find((t) => t.id === id)).filter(Boolean);
  }, [pedidoSel, transportadoras]);

  const pedidosVisiveis = useMemo(() => {
    if (pedidoSel) return [pedidoSel];
    const q = buscaPedido.toLowerCase().trim();
    if (!q) return pedidosAbertos;
    return pedidosAbertos.filter((p) => clienteNome(p.cliente_id).toLowerCase().includes(q) || produtoNome(p.produto_id).toLowerCase().includes(q));
  }, [pedidosAbertos, buscaPedido, pedidoSel]);

  const taraSugerida = useMemo(() => {
    const placaNorm = normalizePlaca(form.placa);
    if (!placaNorm) return null;
    const doMesmoCaminhao = tickets
      .filter((t) => t.status === 'fechado' && normalizePlaca(t.placa) === placaNorm)
      .sort((a, b) => new Date(b.data_abertura || 0) - new Date(a.data_abertura || 0));
    const ultimo = doMesmoCaminhao[0];
    if (!ultimo) return null;
    const tara = Math.min(ultimo.peso_tara || 0, ultimo.peso_bruto || 0);
    return tara > 0 ? tara : null;
  }, [form.placa, tickets]);

  function resetForm() { setForm(empty); setStep('tipo'); setBuscaPedido(''); }

  function temDados() {
    return step === 'dados' && (form.motorista.trim() || form.placa.trim() || form.peso.trim() || form.produto_id || form.transportadora_id || form.cliente_id || form.pedido_id || form.origem.trim() || form.destino.trim() || form.observacao.trim());
  }

  function tentarSair() {
    if (temDados()) {
      setSairOpen(true);
    } else {
      resetForm();
      onClose();
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.tipo) {
      toast({ variant: 'destructive', title: 'Escolha o tipo do ticket' });
      return;
    }
    if (!form.motorista.trim() || !form.placa.trim()) {
      toast({ variant: 'destructive', title: 'Motorista e placa são obrigatórios' });
      return;
    }
    if (parseQtd(form.peso) <= 0) {
      toast({ variant: 'destructive', title: 'Informe o peso da 1ª pesagem' });
      return;
    }
    if (isVenda && !form.pedido_id) {
      toast({ variant: 'destructive', title: 'Selecione o pedido', description: 'Na venda, o cliente, o produto e a transportadora vêm do pedido.' });
      return;
    }
    if (!isVenda && !form.produto_id) {
      toast({ variant: 'destructive', title: 'Selecione o produto' });
      return;
    }
    if (!isVenda && !form.transportadora_id) {
      toast({ variant: 'destructive', title: 'Selecione a transportadora' });
      return;
    }
    const placaNorm = normalizePlaca(form.placa);
    const duplicado = tickets.some((t) => t.status === 'aberto' && normalizePlaca(t.placa) === placaNorm);
    if (duplicado) {
      toast({ variant: 'destructive', title: 'Ticket aberto para esta placa', description: 'Já existe um ticket aberto para esta placa. Feche-o antes de abrir outro.' });
      return;
    }
    setSaving(true);
    try {
      const numero = nextTicketNumber(tickets);
      const transpId = isVenda
        ? (transpsDoPedido.length === 1 ? transpsDoPedido[0].id : '')
        : (form.transportadora_id || '');
      const transp = transportadoras.find((t) => t.id === transpId);
      const cliId = isVenda ? (pedidoSel?.cliente_id || '') : (form.cliente_id || '');
      await api.entities.TicketPesagem.create({
        numero,
        tipo: form.tipo,
        data_abertura: new Date().toISOString(),
        motorista: form.motorista.trim(),
        placa: placaNorm,
        produto_id: isVenda ? (pedidoSel?.produto_id || '') : (form.produto_id || ''),
        cliente_id: cliId,
        cliente_nome: cliId ? clienteNome(cliId) : '',
        transportadora_id: transpId,
        transportadora_nome: transp ? transp.nome : '',
        pedido_id: isVenda ? (form.pedido_id || '') : '',
        origem: form.origem.trim(),
        destino: isVenda ? '' : form.destino.trim(),
        peso_tara: parseQtd(form.peso),
        peso_bruto: 0,
        peso_liquido: 0,
        status: 'aberto',
        observacao: form.observacao || '',
      });
      toast({ title: 'Ticket aberto', description: numero });
      resetForm();
      onClose();
      onReload();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao abrir ticket', description: String(err?.message || err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) tentarSair(); }}>
      <DialogContent
        className="max-w-2xl w-[95vw] max-h-[90dvh] p-4 sm:p-6"
        onEscapeKeyDown={(e) => { e.preventDefault(); tentarSair(); }}
        onInteractOutside={(e) => { e.preventDefault(); tentarSair(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Scale className="w-5 h-5 text-primary" /> Abrir Novo Ticket</DialogTitle>
          <DialogDescription>Preencha os dados do ticket de pesagem.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-5xl mx-auto">
          {step === 'tipo' ? (
            <div className="space-y-3">
              <Label className="text-xs">Escolha o tipo de ticket *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TIPOS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm({ ...form, tipo: t.value })}
                      className={`flex items-center gap-3 text-left rounded-xl border p-3 transition-all ${form.tipo === t.value ? 'border-primary bg-primary/5 ring-2 ring-primary' : 'hover:bg-accent hover:border-primary/50'}`}
                    >
                      <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${form.tipo === t.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{t.label}</span>
                        <span className="block text-xs text-muted-foreground mt-0.5">{t.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {form.tipo === 'venda' && (
                <p className="text-xs text-muted-foreground">Na venda, o pedido define o cliente, o produto e a transportadora. Selecione o pedido no próximo passo.</p>
              )}
              <div className="sticky bottom-0 z-10 flex gap-2 py-3 mt-3 bg-background/95 backdrop-blur border-t">
                <Button type="button" className="flex-1 h-12 text-base" disabled={!form.tipo} onClick={() => setStep('dados')}>Continuar</Button>
                <Button type="button" variant="outline" onClick={tentarSair} className="h-12 px-6"><X className="w-5 h-5" /></Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                <span className="text-xs text-muted-foreground">Tipo: <b className="text-foreground">{TIPOS.find((t) => t.value === form.tipo)?.label}</b></span>
                <button type="button" className="text-xs text-primary underline" onClick={() => setStep('tipo')}>Alterar</button>
              </div>

              {isVenda && (
                <div className="space-y-2 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
                  <Label className="text-xs">Pedido *</Label>
                  {pedidosAbertos.length === 0 ? (
                    <p className="text-sm text-destructive">Nenhum pedido aberto disponível. Cadastre um pedido antes de abrir um ticket de venda.</p>
                  ) : pedidoSel ? (
                    <div className="space-y-2">
                      <div className="rounded-lg border bg-background p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs text-muted-foreground">{pedidoSel.numero}</span>
                          <button type="button" className="text-xs text-destructive underline" onClick={() => setForm({ ...form, pedido_id: '' })}>Trocar pedido</button>
                        </div>
                        <p className="font-medium truncate">{clienteNome(pedidoSel.cliente_id)}</p>
                        <p className="text-xs text-muted-foreground truncate">{produtoNome(pedidoSel.produto_id)}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground pt-1">
                          <span>Saldo: <b className="text-foreground">{formatKg(pedidoSel.saldo_kg)}</b></span>
                          <span>Transportadora(s): <b className="text-foreground">{transpsDoPedido.length ? transpsDoPedido.map((t) => t.nome).join(', ') : '—'}</b></span>
                        </div>
                        {pedidoSel.observacao && <p className="text-xs text-muted-foreground italic truncate pt-1">Obs: {pedidoSel.observacao}</p>}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input value={buscaPedido} onChange={(e) => setBuscaPedido(e.target.value)} placeholder="Buscar pedido por cliente ou produto..." className="pl-9" />
                      </div>
                      <div className="max-h-56 overflow-auto scrollbar-thin space-y-2 rounded-lg border bg-background p-2">
                        {pedidosVisiveis.length === 0 ? (
                          <p className="px-2 py-3 text-sm text-muted-foreground text-center">Nenhum pedido encontrado.</p>
                        ) : pedidosVisiveis.map((p) => {
                          const pesoSaca = p.peso_saca_kg || 0;
                          const saldoSacas = pesoSaca > 0 ? (p.saldo_kg || 0) / pesoSaca : 0;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => { setForm({ ...form, pedido_id: p.id }); setBuscaPedido(''); }}
                              className={`w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent hover:border-primary/50`}
                            >
                              <div className="flex justify-between gap-2">
                                <div className="min-w-0 w-full space-y-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {p.numero && <span className="font-mono text-[11px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{p.numero}</span>}
                                    {p.sem_limite && <Badge className="bg-sky-100 text-sky-700 text-[10px]">Sem limite</Badge>}
                                    <p className="font-medium truncate">{clienteNome(p.cliente_id)}</p>
                                  </div>
                                  <p className="text-xs text-muted-foreground truncate">{produtoNome(p.produto_id)} · {p.sem_limite ? 'Sem limite' : `${formatQtd(saldoSacas)} sacas disponível`}</p>
                                  {p.observacao && <p className="text-xs text-muted-foreground italic truncate">Obs: {p.observacao}</p>}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Motorista *</Label>
                  <Input value={form.motorista} onChange={(e) => setForm({ ...form, motorista: e.target.value })} list="motoristas-list-dlg" placeholder="Selecione um motorista cadastrado" required />
                  <datalist id="motoristas-list-dlg">
                    {motoristas.map((m) => (
                      <option key={m.id} value={m.nome} />
                    ))}
                  </datalist>
                  {motoristas.length === 0 && (
                    <p className="text-xs text-destructive">Nenhum motorista cadastrado. Marque a flag "Motorista" em Cadastros › Pessoas.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Placa *</Label>
                  <Input value={form.placa} onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })} placeholder="ABC1D23" required />
                </div>
                {taraSugerida && !form.peso && (
                  <div className="sm:col-span-2 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <Truck className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex-1 text-sm min-w-0">
                      <span className="text-muted-foreground">Tara do último ticket desta placa: </span>
                      <span className="font-semibold text-primary">{formatKg(taraSugerida)}</span>
                    </div>
                    <Button type="button" size="sm" className="shrink-0" onClick={() => setForm({ ...form, peso: formatQtd(taraSugerida) })}>Usar</Button>
                  </div>
                )}
                {!isVenda && (
                  <>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">{form.tipo === 'compra' ? 'Fornecedor' : 'Cliente'}</Label>
                      <SearchSelect
                        value={form.cliente_id}
                        onChange={(v) => setForm({ ...form, cliente_id: v })}
                        placeholder={form.tipo === 'compra' ? 'Buscar fornecedor...' : 'Buscar cliente...'}
                        options={clientes.map((c) => ({ value: c.id, label: c.nome }))}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Produto *</Label>
                      <SearchSelect
                        value={form.produto_id}
                        onChange={(v) => setForm({ ...form, produto_id: v })}
                        placeholder="Buscar produto..."
                        options={produtos.map((p) => ({ value: p.id, label: p.nome }))}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Transportadora *</Label>
                      <SearchSelect
                        value={form.transportadora_id}
                        onChange={(v) => setForm({ ...form, transportadora_id: v })}
                        placeholder="Buscar transportadora..."
                        options={transportadoras.map((t) => ({ value: t.id, label: t.nome }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Origem</Label>
                      <Input value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} placeholder={form.tipo === 'compra' ? 'Ex.: Fornecedor' : 'Ex.: Sede'} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Destino</Label>
                      <Input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} placeholder={form.tipo === 'lavoura' ? 'Ex.: Talhão 07' : form.tipo === 'compra' ? 'Ex.: Armazém' : ''} />
                    </div>
                  </>
                )}
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Observação</Label>
                  <Textarea rows={2} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <PesoDisplay
                    label="Peso da 1ª Pesagem (kg) *"
                    value={form.peso}
                    onChange={(v) => setForm({ ...form, peso: v })}
                    onPesoLido={(p) => setForm({ ...form, peso: p })}
                    podeDigitar={podeDigitar}
                  />
                </div>
              </div>
              <div className="sticky bottom-0 z-10 flex gap-2 py-3 mt-4 bg-background/95 backdrop-blur border-t">
                <Button type="submit" className="flex-1 h-12 text-base" disabled={saving || (isVenda && !form.pedido_id)}><Scale className="w-5 h-5" /> {saving ? 'Abrindo...' : 'Abrir Ticket'}</Button>
                <Button type="button" variant="outline" onClick={tentarSair} className="h-12 px-6">Cancelar</Button>
              </div>
            </div>
          )}
        </form>
      </DialogContent>

      <AlertDialog open={sairOpen} onOpenChange={setSairOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar formulário?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem dados preenchidos que serão perdidos. Deseja fechar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar preenchendo</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setSairOpen(false); resetForm(); onClose(); }}>
              Fechar sem salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}