import { useMemo, useState } from 'react';
import {
  Building2,
  Layers3,
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
import { nextDepositoNumber } from '@/lib/depositos';
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

const EMPTY_FORM = { nome: '', setor_id: '', descricao: '' };

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

export default function DepositoManager() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busca, setBusca] = useState('');
  const [setorFiltro, setSetorFiltro] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { toast } = useToast();

  const { data } = useEntidades({ Deposito: {}, Setor: {} });
  const items = data.Deposito || [];
  const setores = data.Setor || [];

  const nomeSetor = (id) => setores.find((s) => s.id === id)?.nome || '—';

  const filteredItems = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return [...items]
      .sort((a, b) => String(a.numero || '').localeCompare(String(b.numero || '')))
      .filter((item) => !setorFiltro || item.setor_id === setorFiltro)
      .filter((item) => {
        if (!q) return true;
        return [item.numero, item.nome, item.descricao, nomeSetor(item.setor_id)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });
  }, [items, busca, setorFiltro, setores]);

  const stats = useMemo(() => ({
    total: items.length,
    comSetor: items.filter((item) => !!item.setor_id).length,
    semSetor: items.filter((item) => !item.setor_id).length,
  }), [items]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editingId) {
        await api.entities.Deposito.update(editingId, form);
        toast({ title: 'Depósito atualizado' });
      } else {
        const numero = nextDepositoNumber(items);
        await api.entities.Deposito.create({ ...form, numero });
        toast({ title: 'Depósito cadastrado', description: `Número gerado: ${numero}` });
      }
      resetForm();
      invalidateEntidade('Deposito');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao salvar depósito', description: String(err?.message || err) });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;
    try {
      await safeDelete('Deposito', deleteTarget.id);
      toast({ title: 'Depósito removido' });
      if (editingId === deleteTarget.id) resetForm();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao excluir', description: String(err?.message || err) });
    } finally {
      setDeleteTarget(null);
    }
  }

  function handleEdit(item) {
    setForm({ nome: item.nome || '', setor_id: item.setor_id || '', descricao: item.descricao || '' });
    setEditingId(item.id);
  }

  const currentNumber = editingId
    ? items.find((item) => item.id === editingId)?.numero || '—'
    : nextDepositoNumber(items);

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="rounded-2xl border shadow-none">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Warehouse className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">{editingId ? 'Editar depósito' : 'Novo depósito'}</h3>
                <p className="text-xs text-muted-foreground">Local de armazenamento vinculado ao setor.</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-4">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
              <div className="space-y-1.5">
                <Label>Número</Label>
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 font-mono text-xs text-muted-foreground">
                  {currentNumber}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Setor</Label>
                <SearchSelect
                  value={form.setor_id || 'all'}
                  onChange={(value) => setForm({ ...form, setor_id: value === 'all' ? '' : value })}
                  allLabel="— Nenhum setor —"
                  placeholder="Buscar setor..."
                  options={setores.map((s) => ({ value: s.id, label: s.nome })).sort((a, b) => a.label.localeCompare(b.label))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dep-nome">Nome</Label>
              <Input
                id="dep-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Galpão principal"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dep-desc">Descrição</Label>
              <Input
                id="dep-desc"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Informações complementares"
              />
            </div>

            <div className="rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
              O número do depósito é gerado automaticamente e continua global no ERP.
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="flex-1 gap-2">
                {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Salvar alterações' : 'Adicionar depósito'}
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
            <MiniStat icon={Warehouse} label="Depósitos" value={stats.total} />
            <MiniStat icon={Building2} label="Com setor" value={stats.comSetor} />
            <MiniStat icon={Layers3} label="Sem setor" value={stats.semSetor} />
          </div>

          <Card className="overflow-hidden rounded-2xl border shadow-none">
            <div className="grid gap-2 border-b p-3 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por número, nome, descrição ou setor..."
                  className="pl-9"
                />
              </div>
              <SearchSelect
                value={setorFiltro || 'all'}
                onChange={(value) => setSetorFiltro(value === 'all' ? '' : value)}
                allLabel="Todos os setores"
                placeholder="Filtrar setor"
                options={setores.map((s) => ({ value: s.id, label: s.nome })).sort((a, b) => a.label.localeCompare(b.label))}
              />
            </div>

            {filteredItems.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum depósito encontrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[145px]">Número</TableHead>
                      <TableHead>Depósito</TableHead>
                      <TableHead>Setor</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="w-[110px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id} className={editingId === item.id ? 'bg-primary/[0.04]' : ''}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[11px]">{item.numero || '—'}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Warehouse className="h-4 w-4" />
                            </div>
                            <span className="font-semibold">{item.nome || 'Sem nome'}</span>
                          </div>
                        </TableCell>
                        <TableCell>{item.setor_id ? nomeSetor(item.setor_id) : <span className="text-xs text-muted-foreground">Não vinculado</span>}</TableCell>
                        <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                          <span className="line-clamp-2">{item.descricao || '—'}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" onClick={() => handleEdit(item)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(item)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
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
            <AlertDialogTitle>Excluir depósito?</AlertDialogTitle>
            <AlertDialogDescription>
              O depósito <strong>{deleteTarget?.numero}{deleteTarget?.nome ? ` — ${deleteTarget.nome}` : ''}</strong> será removido. O sistema bloqueará a exclusão caso existam vínculos ou saldo ERP.
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
