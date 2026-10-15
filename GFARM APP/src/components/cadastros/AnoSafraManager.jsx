import { useMemo, useState } from 'react';
import { CalendarDays, Plus, Search, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { useEntidades, invalidateEntidade } from '@/lib/useEntidades';
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

export default function AnoSafraManager() {
  const [novo, setNovo] = useState('');
  const [busca, setBusca] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { toast } = useToast();

  const { data } = useEntidades({
    AnoSafra: { sort: '-created_date', limit: 500 },
  });

  const anosSafra = data.AnoSafra || [];

  const filtered = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return [...anosSafra]
      .sort((a, b) => String(b.nome || '').localeCompare(String(a.nome || '')))
      .filter((item) => !q || String(item.nome || '').toLowerCase().includes(q));
  }, [anosSafra, busca]);

  async function handleAdd(e) {
    e.preventDefault();
    const nome = novo.trim();

    if (!nome) {
      toast({ variant: 'destructive', title: 'Informe o ano safra' });
      return;
    }

    const existe = anosSafra.some((a) => String(a.nome || '').trim().toUpperCase() === nome.toUpperCase());
    if (existe) {
      toast({ variant: 'destructive', title: 'Ano safra já cadastrado' });
      return;
    }

    setSaving(true);
    try {
      await api.entities.AnoSafra.create({ nome });
      invalidateEntidade('AnoSafra');
      setNovo('');
      toast({ title: 'Ano safra cadastrado', description: nome });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao cadastrar', description: String(err?.message || err) });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;
    try {
      await api.entities.AnoSafra.delete(deleteTarget.id);
      invalidateEntidade('AnoSafra');
      toast({ title: 'Ano safra removido' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao remover', description: String(err?.message || err) });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="rounded-2xl border shadow-none">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">Novo Ano / Safra</h3>
                <p className="text-xs text-muted-foreground">Período agrícola usado nos controles do ERP.</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleAdd} className="space-y-3 p-4">
            <Input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              placeholder="Ex.: 2026/2027"
            />

            <div className="rounded-xl border bg-muted/15 p-3 text-xs leading-relaxed text-muted-foreground">
              Cadastre cada safra uma única vez. O período ficará disponível nas ordens e demais operações agrícolas.
            </div>

            <Button type="submit" disabled={saving} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              {saving ? 'Salvando...' : 'Adicionar ano/safra'}
            </Button>
          </form>
        </Card>

        <Card className="overflow-hidden rounded-2xl border shadow-none">
          <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Períodos cadastrados</h3>
              <p className="text-xs text-muted-foreground">{anosSafra.length} registro(s) no cadastro mestre</p>
            </div>

            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ano/safra..." className="pl-9" />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/35" />
              <p className="text-sm text-muted-foreground">Nenhum ano/safra encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead>Uso</TableHead>
                    <TableHead className="w-[90px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((ano) => (
                    <TableRow key={ano.id}>
                      <TableCell>
                        <Badge className="border-emerald-200 bg-emerald-50 font-mono text-emerald-700 hover:bg-emerald-50">
                          {ano.nome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">Disponível para operações agrícolas</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(ano)}
                          >
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ano/safra?</AlertDialogTitle>
            <AlertDialogDescription>
              O período <strong>{deleteTarget?.nome}</strong> será removido do cadastro.
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
