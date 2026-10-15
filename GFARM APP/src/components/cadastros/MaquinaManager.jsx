import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Database,
  Fuel,
  Loader2,
  Pencil,
  Search,
  Tractor,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import SearchSelect from '@/components/SearchSelect';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { useEntidades, invalidateEntidade } from '@/lib/useEntidades';
import { safeDelete } from '@/lib/entityOps';
import { findSetorCombustivel, produtosCombustivel } from '@/lib/abastecimento';
import { nextMaquinaCodigo } from '@/lib/maquinas';

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

const emptyForm = {
  codigo: '',
  nome: '',
  descricao: '',
  permite_abastecimento: false,
  combustivel_id: '',
  combustivel_nome: '',
};

const QUICK_FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'abastecimento', label: 'Abastecimento' },
];

function SectionTitle({ number, title, description }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {number}
      </span>

      <div className="min-w-0">
        <h4 className="text-sm font-semibold leading-5">{title}</h4>

        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = 'default' }) {
  const tones = {
    default: 'bg-muted/40 text-foreground',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  };

  return (
    <div className={`flex min-h-[52px] items-center gap-2.5 rounded-lg border px-3 py-2 ${tones[tone] || tones.default}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/80 text-current shadow-sm">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0">
        <p className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-lg font-semibold leading-none">{value}</p>
      </div>
    </div>
  );
}

function FeatureCard({ enabled, onToggle, combustivelNome }) {
  return (
    <div
      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-all ${
        enabled
          ? 'border-primary bg-primary/[0.055] shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]'
          : 'border-border bg-background'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              enabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            <Fuel className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">Permite abastecimento</span>
              {enabled && (
                <Badge className="h-5 border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-50">
                  <Check className="mr-1 h-3 w-3" />
                  Ativo
                </Badge>
              )}
            </div>

            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Libera a máquina para abastecimento e permite definir combustível preferencial.
            </p>

            {enabled && combustivelNome && (
              <p className="mt-1 truncate text-[11px] font-medium text-amber-800">
                Padrão: {combustivelNome}
              </p>
            )}
          </div>
        </div>

        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onToggle(Boolean(checked))}
          aria-label="Permitir abastecimento"
        />
      </div>
    </div>
  );
}

export default function MaquinaManager() {
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [busca, setBusca] = useState('');
  const [quickFilter, setQuickFilter] = useState('todos');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formNotice, setFormNotice] = useState(null);
  const { toast } = useToast();

  const { data } = useEntidades({ Maquina: {}, Produto: {}, Setor: {} });
  const items = data.Maquina || [];
  const produtos = data.Produto || [];
  const setores = data.Setor || [];

  const combustiveis = useMemo(
    () => produtosCombustivel(produtos, findSetorCombustivel(setores)?.id),
    [produtos, setores]
  );

  const loading = false;

  const currentCode = editingId ? form.codigo : nextMaquinaCodigo(items);

  const combustivelLabel = (id) => {
    const combustivel = combustiveis.find((x) => x.id === id);
    return combustivel ? combustivel.nome : '—';
  };

  const counters = useMemo(() => {
    const total = items.length;
    const permiteAbastecimento = items.filter((item) => item.permite_abastecimento === true).length;

    return {
      total,
      permiteAbastecimento,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = busca.toLowerCase().trim();

    return items
      .filter((item) => {
        if (!query) return true;

        return [item.codigo, item.nome, item.descricao]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .filter((item) => {
        if (quickFilter === 'abastecimento') return item.permite_abastecimento === true;
        return true;
      })
      .sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || '')));
  }, [items, busca, quickFilter]);

  const combustivelSelecionado = combustiveis.find((c) => c.id === form.combustivel_id) || null;

  const normalizarDuplicidade = (value) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleUpperCase('pt-BR');

  function avisarBloqueio(title, description) {
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

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setFormNotice(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (saving) return;

    const nome = String(form.nome || '').trim().replace(/\s+/g, ' ');

    if (!nome) {
      avisarBloqueio(
        'Nome da máquina obrigatório',
        'Preencha o nome ou a descrição principal antes de salvar.'
      );
      return;
    }

    if (
      form.permite_abastecimento
      && form.combustivel_id
      && !combustivelSelecionado
    ) {
      avisarBloqueio(
        'Combustível inválido',
        'O combustível selecionado não está mais disponível. Selecione outro ou deixe sem combustível padrão.'
      );
      return;
    }

    const duplicadaLocal = items.find(
      (item) =>
        item.id !== editingId
        && normalizarDuplicidade(item.nome) === normalizarDuplicidade(nome)
    );

    if (duplicadaLocal) {
      avisarBloqueio(
        'Máquina já cadastrada',
        `Já existe uma máquina com este nome: ${duplicadaLocal.codigo || duplicadaLocal.nome}.`
      );
      return;
    }

    setSaving(true);
    setFormNotice({
      type: 'info',
      title: editingId ? 'Salvando alterações...' : 'Salvando máquina...',
      description: 'Aguarde a confirmação do sistema.',
    });

    try {
      const combustivelPayload = form.permite_abastecimento
        ? {
            combustivel_id: combustivelSelecionado?.id || '',
            combustivel_nome: combustivelSelecionado?.nome || '',
          }
        : {
            combustivel_id: '',
            combustivel_nome: '',
          };

      if (editingId) {
        await api.entities.Maquina.update(editingId, {
          nome,
          descricao: String(form.descricao || '').trim(),
          permite_abastecimento: form.permite_abastecimento,
          ...combustivelPayload,
        });

        await invalidateEntidade('Maquina');

        setFormNotice({
          type: 'success',
          title: 'Máquina atualizada',
          description: `${form.codigo || nome} foi atualizada com sucesso.`,
        });

        toast({
          title: 'Máquina atualizada',
          description: `${form.codigo || nome} foi atualizada com sucesso.`,
        });

        setForm((prev) => ({
          ...prev,
          nome,
          descricao: String(prev.descricao || '').trim(),
        }));
      } else {
        const maquinasAtuais = await api.entities.Maquina.list();

        const duplicadaAtual = maquinasAtuais.find(
          (item) =>
            normalizarDuplicidade(item.nome) === normalizarDuplicidade(nome)
        );

        if (duplicadaAtual) {
          avisarBloqueio(
            'Máquina já cadastrada',
            `Já existe uma máquina com este nome: ${duplicadaAtual.codigo || duplicadaAtual.nome}.`
          );
          return;
        }

        const codigo = nextMaquinaCodigo(maquinasAtuais);

        const codigoEmUso = maquinasAtuais.some(
          (item) => normalizarDuplicidade(item.codigo) === normalizarDuplicidade(codigo)
        );

        if (codigoEmUso) {
          avisarBloqueio(
            'Código de máquina em uso',
            'O código automático calculado já existe. Atualize a página e tente novamente.'
          );
          return;
        }

        await api.entities.Maquina.create({
          codigo,
          nome,
          descricao: String(form.descricao || '').trim(),
          permite_abastecimento: form.permite_abastecimento,
          ...combustivelPayload,
        });

        await invalidateEntidade('Maquina');

        setForm(emptyForm);
        setEditingId(null);
        setFormNotice({
          type: 'success',
          title: 'Máquina cadastrada',
          description: `${codigo} foi cadastrada com sucesso.`,
        });

        toast({
          title: 'Máquina cadastrada',
          description: `Código gerado: ${codigo}`,
        });
      }
    } catch (err) {
      const mensagem = String(err?.message || err || 'Falha desconhecida ao salvar.');

      setFormNotice({
        type: 'error',
        title: editingId ? 'Não foi possível atualizar' : 'Não foi possível cadastrar',
        description: mensagem,
      });

      toast({
        variant: 'destructive',
        title: editingId ? 'Erro ao atualizar máquina' : 'Erro ao cadastrar máquina',
        description: mensagem,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(item) {
    setFormNotice(null);
    setForm({
      codigo: item.codigo || '',
      nome: item.nome || '',
      descricao: item.descricao || '',
      permite_abastecimento: item.permite_abastecimento === true,
      combustivel_id: item.combustivel_id || '',
      combustivel_nome: item.combustivel_nome || '',
    });

    setEditingId(item.id);
  }

  async function confirmDelete() {
    if (!deleteTarget?.id) return;

    try {
      await safeDelete('Maquina', deleteTarget.id);
      toast({
        title: 'Máquina excluída',
        description: `${deleteTarget.codigo || deleteTarget.nome || 'Registro'} foi removido.`,
      });

      if (editingId === deleteTarget.id) {
        resetForm();
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir',
        description: String(err?.message || err),
      });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <div className="maquina-manager-page space-y-3">
        <Card className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="grid gap-3 p-3 lg:grid-cols-[330px_minmax(0,1fr)]">
            <div className="space-y-3">
              <Card className="rounded-xl border shadow-none">
                <div className="border-b px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold">
                        {editingId ? 'Editar máquina' : 'Nova máquina'}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cadastro mestre de máquinas e equipamentos.
                      </p>
                    </div>

                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {editingId ? <Pencil className="h-4.5 w-4.5" /> : <Wrench className="h-4.5 w-4.5" />}
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 p-3">
                  <section>
                    <SectionTitle
                      number="1"
                      title="Identificação"
                      description="Código automático e informações principais da máquina."
                    />

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="maq-codigo">Código</Label>
                        <Input
                          id="maq-codigo"
                          readOnly
                          value={currentCode}
                          className="bg-muted/40 font-mono text-sm cursor-not-allowed"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="maq-nome">Nome / descrição principal *</Label>
                        <Input
                          id="maq-nome"
                          value={form.nome}
                          onChange={(e) => setForm({ ...form, nome: e.target.value })}
                          placeholder="Ex.: Trator John Deere 6110J"
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="maq-descricao">Descrição complementar</Label>
                        <Textarea
                          id="maq-descricao"
                          value={form.descricao}
                          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                          placeholder="Detalhes adicionais, aplicação, implemento ou observações técnicas."
                          className="min-h-[72px] resize-none"
                        />
                      </div>
                    </div>
                  </section>

                  <section>
                    <SectionTitle
                      number="2"
                      title="Configuração de abastecimento"
                      description="Defina se a máquina pode abastecer e um combustível padrão opcional."
                    />

                    <div className="space-y-3">
                      <FeatureCard
                        enabled={form.permite_abastecimento}
                        onToggle={(enabled) =>
                          setForm((prev) => ({
                            ...prev,
                            permite_abastecimento: enabled,
                            combustivel_id: enabled ? prev.combustivel_id : '',
                            combustivel_nome: enabled ? prev.combustivel_nome : '',
                          }))
                        }
                        combustivelNome={combustivelSelecionado?.nome || ''}
                      />

                      {form.permite_abastecimento && (
                        <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
                          <Label>Combustível padrão</Label>
                          <SearchSelect
                            value={form.combustivel_id}
                            onChange={(value) => setForm({ ...form, combustivel_id: value === 'all' ? '' : value })}
                            allLabel="— Nenhum combustível —"
                            placeholder="Buscar combustível..."
                            options={combustiveis
                              .filter((combustivel) => combustivel?.id)
                              .map((combustivel) => ({
                                value: combustivel.id,
                                label:
                                  String(
                                    combustivel.nome
                                    || combustivel.codigo
                                    || 'Combustível sem nome'
                                  ),
                              }))
                              .sort((a, b) =>
                                a.label.localeCompare(
                                  b.label,
                                  'pt-BR'
                                )
                              )}
                          />
                          <p className="text-xs text-amber-800">
                            Quando definido, o produto é pré-selecionado na tela de abastecimento.
                          </p>
                        </div>
                      )}
                    </div>
                  </section>

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
                      {formNotice.type === 'info' ? (
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                      ) : formNotice.type === 'success' ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      )}

                      <div className="min-w-0">
                        <p className="font-semibold">{formNotice.title}</p>
                        <p className="mt-0.5 leading-relaxed">{formNotice.description}</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                    <Button type="submit" disabled={saving} className="flex-1 gap-2">
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : editingId ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Salvar máquina'}
                    </Button>

                    <Button type="button" variant="outline" onClick={resetForm} disabled={saving} className="gap-2">
                      <X className="h-4 w-4" />
                      {editingId ? 'Cancelar' : 'Limpar'}
                    </Button>
                  </div>
                </form>
              </Card>
            </div>

            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <StatCard icon={Tractor} label="Total de máquinas" value={counters.total} tone="default" />
                <StatCard icon={Fuel} label="Liberadas p/ abastecimento" value={counters.permiteAbastecimento} tone="amber" />
              </div>

              <Card className="rounded-xl border shadow-none">
                <div className="space-y-3 p-3">
                  <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                    <div className="relative w-full xl:max-w-2xl">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar máquina por código, nome ou descrição..."
                        className="pl-9"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {QUICK_FILTERS.map((filter) => (
                        <button
                          key={filter.key}
                          type="button"
                          onClick={() => setQuickFilter(filter.key)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            quickFilter === filter.key
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
                          }`}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border">
                    <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
                      <div>
                        <h4 className="text-sm font-semibold">Máquinas cadastradas</h4>
                        <p className="text-xs text-muted-foreground">
                          {filteredItems.length} registro(s) encontrado(s)
                        </p>
                      </div>

                      {editingId && (
                        <Badge className="border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
                          Edição em andamento
                        </Badge>
                      )}
                    </div>

                    {loading ? (
                      <div className="px-4 py-10 text-sm text-muted-foreground">Carregando máquinas...</div>
                    ) : filteredItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                          <Database className="h-6 w-6" />
                        </div>
                        <div>
                          <h5 className="text-sm font-semibold">Nenhuma máquina encontrada</h5>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Ajuste a busca ou cadastre uma nova máquina para iniciar a frota.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[140px]">Código</TableHead>
                              <TableHead>Máquina</TableHead>
                              <TableHead>Abastecimento</TableHead>
                              <TableHead>Combustível padrão</TableHead>
                              <TableHead className="w-[140px] text-right">Ações</TableHead>
                            </TableRow>
                          </TableHeader>

                          <TableBody>
                            {filteredItems.map((item) => {
                              const isEditing = editingId === item.id;

                              return (
                                <TableRow key={item.id} className={isEditing ? 'bg-primary/[0.045]' : ''}>
                                  <TableCell>
                                    <Badge variant="outline" className="font-mono text-[11px]">
                                      {item.codigo || '—'}
                                    </Badge>
                                  </TableCell>

                                  <TableCell className="min-w-[180px]">
                                    <div className="flex items-start gap-3">
                                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                                        <Tractor className="h-4.5 w-4.5" />
                                      </div>

                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">{item.nome}</p>
                                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                          {item.descricao || 'Sem descrição complementar.'}
                                        </p>
                                      </div>
                                    </div>
                                  </TableCell>

                                  <TableCell>
                                    {item.permite_abastecimento === true ? (
                                      <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                                        <Fuel className="mr-1 h-3.5 w-3.5" />
                                        Liberado
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-muted-foreground">
                                        Bloqueado
                                      </Badge>
                                    )}
                                  </TableCell>

                                  <TableCell>
                                    {item.permite_abastecimento === true && item.combustivel_id ? (
                                      <span className="text-sm text-foreground">{combustivelLabel(item.combustivel_id)}</span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">Não definido</span>
                                    )}
                                  </TableCell>

                                  <TableCell>
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleEdit(item)}
                                        className="h-8 w-8"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>

                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => setDeleteTarget(item)}
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                      >
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
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </Card>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir máquina?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá{' '}
              <span className="font-semibold text-foreground">
                {deleteTarget?.nome || deleteTarget?.codigo || 'a máquina selecionada'}
              </span>
              .
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
