import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Ruler,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { useEntidades, invalidateEntidade } from '@/lib/useEntidades';
import { safeDelete } from '@/lib/entityOps';
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

function MiniStat({ icon: Icon, label, value, helper }) {
  return (
    <div className="flex min-h-[52px] items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <p className="text-lg font-semibold leading-none">{value}</p>
          {helper ? <span className="truncate text-[9px] text-muted-foreground">{helper}</span> : null}
        </div>
      </div>
    </div>
  );
}

function parseDecimal(value) {
  const raw = String(value ?? '').trim();

  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextLavouraNumero(lavouras = []) {
  let max = 0;

  for (const lavoura of lavouras) {
    const match = String(lavoura?.numero || '').match(/(\d+)\s*$/);
    if (!match) continue;

    const numero = Number.parseInt(match[1], 10);
    if (Number.isFinite(numero) && numero > max) {
      max = numero;
    }
  }

  return `LAV-${String(max + 1).padStart(6, '0')}`;
}

export default function LavourasManager() {
  const { data } = useEntidades({ Lavoura: {} });
  const lavouras = data.Lavoura || [];

  const totalHa = useMemo(
    () => lavouras.reduce((sum, item) => sum + (Number(item.hectares) || 0), 0),
    [lavouras]
  );

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <MiniStat icon={MapPin} label="Lavouras" value={lavouras.length} />
        <MiniStat icon={Ruler} label="Área cadastrada" value={formatQtd(totalHa)} helper="ha" />
      </div>

      <LavourasPanel lavouras={lavouras} />
    </div>
  );
}

function LavourasPanel({ lavouras }) {
  const [form, setForm] = useState({ nome: '', hectares: '' });
  const [editingId, setEditingId] = useState(null);
  const [busca, setBusca] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formNotice, setFormNotice] = useState(null);
  const formRef = useRef(null);
  const nomeRef = useRef(null);
  const { toast } = useToast();

  const hectares = parseDecimal(form.hectares);
  const editingItem = lavouras.find((item) => item.id === editingId) || null;
  const numeroPreview = editingItem?.numero || nextLavouraNumero(lavouras);

  const filtered = useMemo(() => {
    const q = busca.toLowerCase().trim();

    return [...lavouras]
      .sort((a, b) => {
        const na = Number(String(a.numero || '').match(/(\d+)\s*$/)?.[1] || 0);
        const nb = Number(String(b.numero || '').match(/(\d+)\s*$/)?.[1] || 0);

        if (na !== nb) return na - nb;
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
      })
      .filter((item) => {
        if (!q) return true;

        return [item.nome, item.numero]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });
  }, [lavouras, busca]);

  function clearForm({ keepNotice = false } = {}) {
    setForm({ nome: '', hectares: '' });
    setEditingId(null);
    if (!keepNotice) setFormNotice(null);
  }

  function showError(title, description) {
    setFormNotice({
      type: 'error',
      title,
      description,
    });

    toast({
      variant: 'destructive',
      title,
      description,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (saving) return;

    const nome = String(form.nome || '').trim().replace(/\s+/g, ' ');

    if (!nome) {
      showError('Nome obrigatório', 'Informe o nome da lavoura antes de salvar.');
      return;
    }

    if (form.hectares !== '' && hectares < 0) {
      showError('Área inválida', 'A área da lavoura não pode ser negativa.');
      return;
    }

    const duplicada = lavouras.find(
      (item) =>
        item.id !== editingId
        && String(item.nome || '').trim().toLocaleUpperCase('pt-BR')
          === nome.toLocaleUpperCase('pt-BR')
    );

    if (duplicada) {
      showError(
        'Lavoura já cadastrada',
        `Já existe uma lavoura com este nome: ${duplicada.numero || duplicada.nome}.`
      );
      return;
    }

    setSaving(true);
    setFormNotice({
      type: 'info',
      title: editingId ? 'Salvando alterações...' : 'Salvando lavoura...',
      description: 'Aguarde a confirmação do sistema.',
    });

    try {
      const payload = {
        nome,
        hectares,
      };

      let saved;

      if (editingId) {
        saved = await api.entities.Lavoura.update(editingId, payload);
      } else {
        saved = await api.entities.Lavoura.create(payload);
      }

      await invalidateEntidade('Lavoura');

      const numeroSalvo = saved?.numero || numeroPreview;
      const title = editingId ? 'Lavoura atualizada' : 'Lavoura cadastrada';
      const description = `${numeroSalvo} — ${nome} foi salva com sucesso.`;

      clearForm({ keepNotice: true });
      setFormNotice({
        type: 'success',
        title,
        description,
      });

      toast({ title, description });
    } catch (err) {
      showError(
        editingId ? 'Não foi possível atualizar a lavoura' : 'Não foi possível cadastrar a lavoura',
        String(err?.message || err || 'Falha desconhecida ao salvar.')
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;

    try {
      await safeDelete('Lavoura', deleteTarget.id);
      await invalidateEntidade('Lavoura');

      toast({
        title: 'Lavoura removida',
        description: `${deleteTarget.numero || ''} ${deleteTarget.nome || ''}`.trim(),
      });

      if (editingId === deleteTarget.id) {
        clearForm();
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir lavoura',
        description: String(err?.message || err),
      });
    } finally {
      setDeleteTarget(null);
    }
  }

  function edit(item) {
    setForm({
      nome: item.nome || '',
      hectares: item.hectares != null
        ? String(item.hectares).replace('.', ',')
        : '',
    });
    setEditingId(item.id);
    setFormNotice({
      type: 'info',
      title: `Editando ${item.numero || 'lavoura'}`,
      description: 'Altere os campos e clique em Salvar alterações.',
    });

    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      nomeRef.current?.focus();
      nomeRef.current?.select();
    });
  }

  return (
    <>
      <Card className="overflow-hidden rounded-xl border shadow-none">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MapPin className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Lavouras</h3>
              <p className="text-[11px] text-muted-foreground">Cadastro de áreas agrícolas em hectares.</p>
            </div>
          </div>

          {editingId ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Editando {editingItem?.numero || 'registro'}
            </Badge>
          ) : null}
        </div>

        <div className="grid gap-3 p-3 lg:grid-cols-[330px_minmax(0,1fr)]">
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-3 rounded-xl border bg-muted/10 p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_118px] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="lav-nome">Nome *</Label>
                <Input
                  ref={nomeRef}
                  id="lav-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Lote 01"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lav-numero">Número</Label>
                <Input
                  id="lav-numero"
                  value={numeroPreview}
                  readOnly
                  className="cursor-not-allowed bg-muted/40 font-mono text-xs"
                  aria-label="Número automático da lavoura"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lav-area">Área (ha)</Label>
              <div className="relative">
                <Input
                  id="lav-area"
                  inputMode="decimal"
                  value={form.hectares}
                  onChange={(e) => setForm({ ...form, hectares: e.target.value })}
                  placeholder="0,00"
                  className="pr-10"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">
                  ha
                </span>
              </div>
            </div>

            {formNotice ? (
              <div
                role="status"
                aria-live="polite"
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                  formNotice.type === 'error'
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : formNotice.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-blue-200 bg-blue-50 text-blue-800'
                }`}
              >
                {formNotice.type === 'info' && saving ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                ) : formNotice.type === 'success' ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                ) : formNotice.type === 'error' ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Pencil className="mt-0.5 h-4 w-4 shrink-0" />
                )}

                <div className="min-w-0">
                  <p className="font-semibold">{formNotice.title}</p>
                  <p className="mt-0.5 leading-relaxed">{formNotice.description}</p>
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving} className="flex-1 gap-2">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : editingId ? (
                  <Pencil className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar lavoura'}
              </Button>

              <Button type="button" variant="outline" disabled={saving} onClick={() => clearForm()}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar lavoura por nome ou número..."
                className="h-9 pl-9"
              />
            </div>

            {filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Nenhuma lavoura encontrada.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">Número</TableHead>
                      <TableHead>Lavoura</TableHead>
                      <TableHead className="w-[140px]">Área</TableHead>
                      <TableHead className="w-[110px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {filtered.map((item) => (
                      <TableRow key={item.id} className={editingId === item.id ? 'bg-primary/[0.04]' : ''}>
                        <TableCell className="font-mono text-xs font-semibold">{item.numero || '—'}</TableCell>
                        <TableCell className="font-semibold">{item.nome}</TableCell>
                        <TableCell>{formatQtd(item.hectares || 0)} ha</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={`Editar ${item.nome || 'lavoura'}`}
                              onClick={() => edit(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>

                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              aria-label={`Excluir ${item.nome || 'lavoura'}`}
                              onClick={() => setDeleteTarget(item)}
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
          </div>
        </div>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lavoura?</AlertDialogTitle>
            <AlertDialogDescription>
              A lavoura <strong>{deleteTarget?.numero ? `${deleteTarget.numero} — ` : ''}{deleteTarget?.nome}</strong> será removida caso não existam vínculos ativos.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
