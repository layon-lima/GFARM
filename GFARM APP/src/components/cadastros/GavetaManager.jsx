import { useMemo, useState } from 'react';
import {
  Boxes,
  MapPin,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import SearchSelect from '@/components/SearchSelect';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { useEntidades, invalidateEntidade } from '@/lib/useEntidades';
import { safeDelete } from '@/lib/entityOps';
import { sortGavetas } from '@/lib/gavetas';
import { formatQtd } from '@/lib/format';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const EMPTY_FORM = { codigo: '', descricao: '', deposito_id: '' };
const norm = (value) => String(value || '').trim().toLowerCase();

function ocupacaoPorGaveta(gavetas, produtos, lotes) {
  const map = new Map();
  for (const gaveta of gavetas) {
    map.set(gaveta.id, { itens: [], totalProdutos: 0, totalSaldo: 0 });
  }

  for (const produto of produtos) {
    if (!produto.gaveta_id) continue;
    const ocp = map.get(produto.gaveta_id);
    if (!ocp) continue;
    const qtd = Number(produto.quantidade) || 0;
    if (qtd > 0) {
      ocp.itens.push({
        nome: produto.nome,
        codigo: produto.codigo,
        quantidade: qtd,
        unidade: produto.unidade || 'un',
      });
      ocp.totalSaldo += qtd;
    }
  }

  for (const lote of lotes) {
    if (!lote.gaveta_id) continue;
    const ocp = map.get(lote.gaveta_id);
    if (!ocp) continue;
    const qtd = Number(lote.quantidade) || 0;
    if (qtd <= 0) continue;
    const produto = produtos.find((item) => item.id === lote.produto_id);
    ocp.itens.push({
      nome: produto?.nome || '—',
      codigo: produto?.codigo || '',
      quantidade: qtd,
      unidade: lote.unidade || produto?.unidade || 'un',
    });
    ocp.totalSaldo += qtd;
  }

  for (const ocp of map.values()) {
    ocp.totalProdutos = new Set(ocp.itens.map((item) => item.codigo || item.nome)).size;
  }

  return map;
}

function MiniStat({ icon: Icon, label, value }) {
  return (
    <div className="flex min-h-[62px] items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold leading-none">{value}</p>
      </div>
    </div>
  );
}

export default function GavetaManager() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busca, setBusca] = useState('');
  const [depositoFiltro, setDepositoFiltro] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { toast } = useToast();

  const { data } = useEntidades({ Gaveta: {}, Produto: {}, Lote: {}, Deposito: {} });
  const items = data.Gaveta || [];
  const produtos = data.Produto || [];
  const lotes = data.Lote || [];
  const depositos = data.Deposito || [];

  const ocupacao = useMemo(() => ocupacaoPorGaveta(items, produtos, lotes), [items, produtos, lotes]);

  const depositoLabel = (id) => {
    const deposito = depositos.find((item) => item.id === id);
    if (!deposito) return '—';
    return deposito.nome ? `${deposito.numero} — ${deposito.nome}` : deposito.numero || '—';
  };

  const filteredItems = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return sortGavetas(items)
      .filter((item) => !depositoFiltro || item.deposito_id === depositoFiltro)
      .filter((item) => {
        if (!q) return true;
        return [item.codigo, item.descricao, depositoLabel(item.deposito_id)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });
  }, [items, busca, depositoFiltro, depositos]);

  const stats = useMemo(() => {
    const ocupadas = items.filter((item) => (ocupacao.get(item.id)?.totalProdutos || 0) > 0).length;
    return {
      total: items.length,
      ocupadas,
      livres: items.length - ocupadas,
    };
  }, [items, ocupacao]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const duplicado = items.some((item) => norm(item.codigo) === norm(form.codigo) && item.id !== editingId);
    if (duplicado) {
      toast({
        variant: 'destructive',
        title: 'Gaveta duplicada',
        description: `Já existe uma gaveta com o código "${form.codigo}".`,
      });
      return;
    }

    try {
      if (editingId) {
        await api.entities.Gaveta.update(editingId, form);
        toast({ title: 'Gaveta atualizada' });
      } else {
        await api.entities.Gaveta.create(form);
        toast({ title: 'Gaveta cadastrada' });
      }
      resetForm();
      invalidateEntidade('Gaveta');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao salvar gaveta', description: String(err?.message || err) });
    }
  }

  function requestDelete(item) {
    const ocp = ocupacao.get(item.id);
    if ((ocp?.totalProdutos || 0) > 0) {
      toast({
        variant: 'destructive',
        title: 'Gaveta ocupada',
        description: 'Esta gaveta ainda contém produtos com saldo. Mova ou zere o estoque antes de excluir.',
      });
      return;
    }
    setDeleteTarget(item);
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;
    try {
      await safeDelete('Gaveta', deleteTarget.id);
      toast({ title: 'Gaveta removida' });
      if (editingId === deleteTarget.id) resetForm();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao excluir', description: String(err?.message || err) });
    } finally {
      setDeleteTarget(null);
    }
  }

  function handleEdit(item) {
    setForm({
      codigo: item.codigo || '',
      descricao: item.descricao || '',
      deposito_id: item.deposito_id || '',
    });
    setEditingId(item.id);
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="rounded-2xl border shadow-none">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MapPin className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">{editingId ? 'Editar gaveta' : 'Nova gaveta'}</h3>
                <p className="text-xs text-muted-foreground">Endereço físico interno do depósito.</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="gav-codigo">Código *</Label>
              <Input
                id="gav-codigo"
                value={form.codigo}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                placeholder="Ex.: A-01-03"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Depósito</Label>
              <SearchSelect
                value={form.deposito_id || 'all'}
                onChange={(value) => setForm({ ...form, deposito_id: value === 'all' ? '' : value })}
                allLabel="— Nenhum depósito —"
                placeholder="Buscar depósito..."
                options={depositos
                  .map((d) => ({ value: d.id, label: d.nome ? `${d.numero} — ${d.nome}` : d.numero || 'Sem número' }))
                  .sort((a, b) => a.label.localeCompare(b.label))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gav-desc">Descrição</Label>
              <Input
                id="gav-desc"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Ex.: Prateleira superior"
              />
            </div>

            <div className="rounded-xl border bg-muted/15 p-3 text-xs leading-relaxed text-muted-foreground">
              Gavetas com saldo não podem ser excluídas. O sistema preserva o endereço até que os produtos sejam movidos ou zerados.
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="flex-1 gap-2">
                {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Salvar alterações' : 'Adicionar gaveta'}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="gap-2">
                <X className="h-4 w-4" />
                {editingId ? 'Cancelar' : 'Limpar'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat icon={MapPin} label="Gavetas" value={stats.total} />
            <MiniStat icon={PackageCheck} label="Ocupadas" value={stats.ocupadas} />
            <MiniStat icon={Boxes} label="Livres" value={stats.livres} />
          </div>

          <Card className="overflow-hidden rounded-2xl border shadow-none">
            <div className="grid gap-2 border-b p-3 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por código, descrição ou depósito..."
                  className="pl-9"
                />
              </div>
              <SearchSelect
                value={depositoFiltro || 'all'}
                onChange={(value) => setDepositoFiltro(value === 'all' ? '' : value)}
                allLabel="Todos os depósitos"
                placeholder="Filtrar depósito"
                options={depositos
                  .map((d) => ({ value: d.id, label: d.nome ? `${d.numero} — ${d.nome}` : d.numero || 'Sem número' }))
                  .sort((a, b) => a.label.localeCompare(b.label))}
              />
            </div>

            {filteredItems.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhuma gaveta encontrada.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Depósito</TableHead>
                      <TableHead>Ocupação</TableHead>
                      <TableHead>Conteúdo</TableHead>
                      <TableHead className="w-[110px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => {
                      const ocp = ocupacao.get(item.id) || { itens: [], totalProdutos: 0, totalSaldo: 0 };
                      const vazia = ocp.totalProdutos === 0;

                      return (
                        <TableRow key={item.id} className={editingId === item.id ? 'bg-primary/[0.04]' : ''}>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[11px]">{item.codigo}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{item.descricao || '—'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Warehouse className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{depositoLabel(item.deposito_id)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {vazia ? (
                              <Badge variant="outline" className="border-dashed text-muted-foreground">Livre</Badge>
                            ) : (
                              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                                {ocp.totalProdutos} produto{ocp.totalProdutos === 1 ? '' : 's'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[330px]">
                            {vazia ? (
                              <span className="text-xs text-muted-foreground">Sem produtos</span>
                            ) : (
                              <div className="space-y-0.5 text-xs text-muted-foreground">
                                {ocp.itens.slice(0, 2).map((itemOcp, index) => (
                                  <p key={`${itemOcp.codigo}-${index}`} className="truncate">
                                    {itemOcp.nome}: <span className="font-medium text-foreground">{formatQtd(itemOcp.quantidade)} {itemOcp.unidade}</span>
                                  </p>
                                ))}
                                {ocp.itens.length > 2 ? <p>+{ocp.itens.length - 2} item(ns)</p> : null}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" onClick={() => handleEdit(item)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => requestDelete(item)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir gaveta?</AlertDialogTitle>
            <AlertDialogDescription>
              O endereço <strong>{deleteTarget?.codigo}</strong> será removido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
