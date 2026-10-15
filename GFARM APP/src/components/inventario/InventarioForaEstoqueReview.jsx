import { useMemo, useState } from 'react';
import { Check, ClipboardCheck, Loader2, PackageSearch, X } from 'lucide-react';

import { api } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { resolveMediaUrl } from '@/lib/mediaUrl';

export default function InventarioForaEstoqueReview({ itens, produtos, depositos, gavetas, user, onSaved }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState(null);
  const [produtoId, setProdutoId] = useState('');
  const [depositoId, setDepositoId] = useState('');
  const [gavetaId, setGavetaId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [validade, setValidade] = useState('');
  const [saving, setSaving] = useState(false);

  const pendentes = (itens || []).filter((item) => item.status === 'pendente');
  const gavetasDestino = useMemo(
    () => gavetas.filter((item) => !depositoId || item.deposito_id === depositoId),
    [gavetas, depositoId]
  );

  const abrir = (item) => {
    setSelected(item);
    setProdutoId('');
    setDepositoId('');
    setGavetaId('');
    setMotivo('');
    setValidade('');
  };

  const aprovar = async () => {
    const produto = produtos.find((item) => item.id === produtoId);
    if (!produto || !depositoId || !gavetaId) {
      toast({ variant: 'destructive', title: 'Selecione produto, depósito e gaveta' });
      return;
    }

    setSaving(true);
    try {
      await api.entities.InventarioForaEstoque.revisar(selected.id, {
        decisao: 'aprovado',
        data_validade: validade || null,
        produto_id: produto.id,
        deposito_id: depositoId,
        gaveta_id: gavetaId || null,
      });
      toast({ title: 'Entrada aprovada', description: 'O saldo foi lançado pelo motor oficial de estoque.' });
      setSelected(null);
      onSaved?.();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro ao aprovar entrada', description: error?.message });
    } finally {
      setSaving(false);
    }
  };

  const rejeitar = async () => {
    if (!motivo.trim()) {
      toast({ variant: 'destructive', title: 'Informe o motivo da rejeição' });
      return;
    }
    setSaving(true);
    try {
      await api.entities.InventarioForaEstoque.revisar(selected.id, {
        decisao: 'rejeitado',
        motivo: motivo.trim(),
      });
      toast({ title: 'Registro rejeitado', description: 'Nenhuma alteração foi feita no estoque.' });
      setSelected(null);
      onSaved?.();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro ao rejeitar', description: error?.message });
    } finally {
      setSaving(false);
    }
  };

  if (user?.role !== 'admin') return null;

  return (
    <Card className="overflow-hidden rounded-2xl border shadow-none">
      <div className="flex items-center justify-between border-b bg-amber-50/60 px-4 py-3">
        <div><h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardCheck className="h-4 w-4 text-amber-700" />Itens fora do estoque</h2><p className="text-xs text-muted-foreground">Registros enviados pelo celular aguardando revisão.</p></div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{pendentes.length} pendentes</span>
      </div>
      {pendentes.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Nenhum item aguardando revisão.</div>
      ) : (
        <div className="grid gap-3 p-4 lg:grid-cols-2 xl:grid-cols-3">
          {pendentes.map((item) => (
            <button type="button" key={item.id} onClick={() => abrir(item)} className="flex gap-3 rounded-xl border p-3 text-left hover:border-primary/30 hover:bg-muted/20">
              {item.foto_url ? <img src={resolveMediaUrl(item.foto_url)} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted"><PackageSearch className="h-5 w-5" /></span>}
              <span className="min-w-0"><strong className="block truncate text-sm">{item.descricao}</strong><small className="mt-1 block text-muted-foreground">{item.quantidade} {item.unidade}</small><small className="mt-2 block truncate text-muted-foreground">Por {item.registrado_por || 'usuário'}</small></span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Revisar item fora do estoque</DialogTitle></DialogHeader>
          {selected ? <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
            <div>{selected.foto_url ? <img src={resolveMediaUrl(selected.foto_url)} alt={selected.descricao} className="h-56 w-full rounded-xl object-cover" /> : null}<h3 className="mt-3 font-semibold">{selected.descricao}</h3><p className="text-sm text-muted-foreground">{selected.quantidade} {selected.unidade}</p><p className="mt-2 text-xs text-muted-foreground">{selected.observacao || 'Sem observação.'}</p></div>
            <div className="space-y-4">
              <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800">Cadastre o produto primeiro, se necessário, e depois vincule-o aqui. Aprovar cria uma entrada pelo motor oficial.</div>
              <div className="space-y-1.5"><Label>Produto cadastrado *</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={produtoId} onChange={(e) => setProdutoId(e.target.value)}><option value="">Selecione...</option>{produtos.map((item) => <option key={item.id} value={item.id}>{item.codigo} · {item.nome}</option>)}</select></div>
              <div className="space-y-1.5"><Label>Depósito de entrada *</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={depositoId} onChange={(e) => { setDepositoId(e.target.value); setGavetaId(''); }}><option value="">Selecione...</option>{depositos.map((item) => <option key={item.id} value={item.id}>{item.numero} · {item.nome}</option>)}</select></div>
              <div className="space-y-1.5"><Label>Gaveta</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={gavetaId} onChange={(e) => setGavetaId(e.target.value)}><option value="">Sem gaveta</option>{gavetasDestino.map((item) => <option key={item.id} value={item.id}>{item.codigo || item.descricao}</option>)}</select></div>
              <div className="space-y-1.5"><Label>Validade (produtos com controle de lote)</Label><Input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Motivo para rejeitar</Label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Obrigatório somente ao rejeitar" /></div>
              <div className="flex gap-2"><Button variant="outline" className="flex-1 gap-2 text-destructive" disabled={saving} onClick={rejeitar}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}Rejeitar</Button><Button className="flex-1 gap-2" disabled={saving} onClick={aprovar}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Aprovar entrada</Button></div>
            </div>
          </div> : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
