import { useMemo, useState } from 'react';
import {
  Boxes,
  Check,
  ClipboardCheck,
  Pencil,
  Plus,
  Search,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { useEntidades, invalidateEntidade } from '@/lib/useEntidades';
import { safeDelete } from '@/lib/entityOps';
import { SETOR_ICONS } from '@/lib/setorIcon';
import SetorIcon from '@/components/setorIcon';
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

const EMPTY_FORM = {
  nome: '',
  descricao: '',
  cor: '#16a34a',
  icon: '',
  controla_validade: false,
  tem_aba_mobile: false,
  permite_inventario: false,
};

const norm = (value) => String(value || '').trim().toLowerCase();

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

function ToggleCard({ icon: Icon, title, description, checked, onChange }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors ${
        checked ? 'border-primary bg-primary/[0.05]' : 'bg-background hover:border-primary/35 hover:bg-muted/20'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
          </div>
        </div>
        <Switch
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={onChange}
        />
      </div>
    </div>
  );
}

export default function SetorManager() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busca, setBusca] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { toast } = useToast();

  const { data } = useEntidades({ Setor: {} });
  const items = data.Setor || [];

  const filteredItems = useMemo(() => {
    const q = busca.toLowerCase().trim();
    const sorted = [...items].sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
    if (!q) return sorted;
    return sorted.filter((s) =>
      (s.nome || '').toLowerCase().includes(q) ||
      (s.descricao || '').toLowerCase().includes(q)
    );
  }, [items, busca]);

  const stats = useMemo(() => ({
    total: items.length,
    validade: items.filter((s) => !!s.controla_validade).length,
    mobile: items.filter((s) => !!s.tem_aba_mobile).length,
    inventario: items.filter((s) => !!s.permite_inventario).length,
  }), [items]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const duplicado = items.some((s) => norm(s.nome) === norm(form.nome) && s.id !== editingId);
    if (duplicado) {
      toast({
        variant: 'destructive',
        title: 'Setor duplicado',
        description: `Já existe um setor com o nome "${form.nome}".`,
      });
      return;
    }

    try {
      if (editingId) {
        await api.entities.Setor.update(editingId, form);
        toast({ title: 'Setor atualizado' });
      } else {
        await api.entities.Setor.create(form);
        toast({ title: 'Setor cadastrado' });
      }

      resetForm();
      invalidateEntidade('Setor');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao salvar setor', description: String(err?.message || err) });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;
    try {
      await safeDelete('Setor', deleteTarget.id);
      toast({ title: 'Setor removido' });
      if (editingId === deleteTarget.id) resetForm();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao excluir', description: String(err?.message || err) });
    } finally {
      setDeleteTarget(null);
    }
  }

  function handleEdit(item) {
    setForm({
      nome: item.nome || '',
      descricao: item.descricao || '',
      cor: item.cor || '#16a34a',
      icon: item.icon || '',
      controla_validade: !!item.controla_validade,
      tem_aba_mobile: !!item.tem_aba_mobile,
      permite_inventario: !!item.permite_inventario,
    });
    setEditingId(item.id);
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
        <Card className="rounded-2xl border shadow-none">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">{editingId ? 'Editar setor' : 'Novo setor'}</h3>
                <p className="text-xs text-muted-foreground">Estrutura principal de organização do estoque.</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_116px] xl:grid-cols-1 2xl:grid-cols-[1fr_116px]">
              <div className="space-y-1.5">
                <Label htmlFor="setor-nome">Nome *</Label>
                <Input
                  id="setor-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Fertilizantes"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="setor-cor">Cor</Label>
                <div className="flex h-9 items-center gap-2 rounded-md border px-2">
                  <input
                    type="color"
                    id="setor-cor"
                    value={form.cor}
                    onChange={(e) => setForm({ ...form, cor: e.target.value })}
                    className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{form.cor}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setor-desc">Descrição</Label>
              <Input
                id="setor-desc"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Descrição operacional do setor"
              />
            </div>

            <div className="space-y-2">
              <Label>Ícone</Label>
              <div className="grid grid-cols-7 gap-1.5">
                {SETOR_ICONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.key}
                    onClick={() => setForm({ ...form, icon: opt.key })}
                    title={opt.label}
                    className={`flex h-9 items-center justify-center rounded-lg border transition-colors ${
                      form.icon === opt.key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <SetorIcon icon={opt.key} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <ToggleCard
                icon={Check}
                title="Controla validade"
                description="Usa lotes e validade para itens sensíveis."
                checked={!!form.controla_validade}
                onChange={(v) => setForm({ ...form, controla_validade: v })}
              />
              <ToggleCard
                icon={Smartphone}
                title="Aba mobile"
                description="Exibe este setor na experiência mobile."
                checked={!!form.tem_aba_mobile}
                onChange={(v) => setForm({ ...form, tem_aba_mobile: v })}
              />
              <ToggleCard
                icon={ClipboardCheck}
                title="Permite inventário"
                description="Habilita a conferência física deste setor."
                checked={!!form.permite_inventario}
                onChange={(v) => setForm({ ...form, permite_inventario: v })}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1 gap-2">
                {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Salvar alterações' : 'Adicionar setor'}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="gap-2">
                <X className="h-4 w-4" />
                {editingId ? 'Cancelar' : 'Limpar'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MiniStat icon={Boxes} label="Setores" value={stats.total} />
            <MiniStat icon={Check} label="Com validade" value={stats.validade} />
            <MiniStat icon={Smartphone} label="Mobile" value={stats.mobile} />
            <MiniStat icon={ClipboardCheck} label="Inventário" value={stats.inventario} />
          </div>

          <Card className="overflow-hidden rounded-2xl border shadow-none">
            <div className="border-b p-3">
              <div className="relative max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar setor por nome ou descrição..."
                  className="pl-9"
                />
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum setor encontrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[72px]">Ícone</TableHead>
                      <TableHead>Setor</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Configurações</TableHead>
                      <TableHead className="w-[110px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id} className={editingId === item.id ? 'bg-primary/[0.04]' : ''}>
                        <TableCell>
                          <div
                            className="flex h-9 w-9 items-center justify-center rounded-lg border"
                            style={{ backgroundColor: `${item.cor || '#16a34a'}18`, color: item.cor || '#16a34a' }}
                          >
                            <SetorIcon setor={item} className="h-4 w-4" />
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold">{item.nome}</TableCell>
                        <TableCell className="max-w-[320px] text-sm text-muted-foreground">
                          <span className="line-clamp-2">{item.descricao || '—'}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {item.controla_validade ? <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">Validade</Badge> : null}
                            {item.tem_aba_mobile ? <Badge className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50">Mobile</Badge> : null}
                            {item.permite_inventario ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Inventário</Badge> : null}
                            {!item.controla_validade && !item.tem_aba_mobile && !item.permite_inventario ? <span className="text-xs text-muted-foreground">Padrão</span> : null}
                          </div>
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
            <AlertDialogTitle>Excluir setor?</AlertDialogTitle>
            <AlertDialogDescription>
              O setor <strong>{deleteTarget?.nome}</strong> será removido. O sistema pode bloquear a operação se existirem vínculos ativos.
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
