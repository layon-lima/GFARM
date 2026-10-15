import { useMemo, useState } from 'react';
import {
  Building2,
  Car,
  Gauge,
  Pencil,
  Search,
  Trash2,
  Truck,
  UserRound,
  Weight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

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

import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import {
  useEntidades,
  invalidateEntidade,
} from '@/lib/useEntidades';
import { safeDelete } from '@/lib/entityOps';
import SearchSelect from '@/components/SearchSelect';


const empty = {
  placa: '',
  modelo: '',
  cor: '',
  ano: '',
  tara: '',
  capacidade_kg: '',
  transportadora_id: '',
  motorista_id: '',
  observacao: '',
};


function SectionTitle({
  number,
  title,
  description,
}) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {number}
      </span>

      <div className="min-w-0">
        <h4 className="text-sm font-semibold leading-5">
          {title}
        </h4>

        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}


function formatKg(value) {
  const numero = Number(value);

  if (!Number.isFinite(numero) || numero <= 0) {
    return '—';
  }

  return `${new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
  }).format(numero)} kg`;
}


function plateLabel(value) {
  return String(value || 'SEM PLACA')
    .toUpperCase();
}


export default function VeiculosManager() {
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('all');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { toast } = useToast();

  const { data } = useEntidades({
    Veiculo: {
      sort: '-created_date',
      limit: 500,
    },
    Pessoa: {
      sort: '-created_date',
      limit: 500,
    },
  });

  const veiculos = data.Veiculo || [];
  const pessoas = data.Pessoa || [];

  const transportadoras = useMemo(
    () => pessoas.filter(
      (pessoa) => pessoa.is_transportadora
    ),
    [pessoas]
  );

  const motoristas = useMemo(
    () => pessoas.filter(
      (pessoa) => pessoa.is_motorista
    ),
    [pessoas]
  );

  const transportadoraPorId = useMemo(
    () => new Map(
      transportadoras.map(
        (item) => [item.id, item]
      )
    ),
    [transportadoras]
  );

  const motoristaPorId = useMemo(
    () => new Map(
      motoristas.map(
        (item) => [item.id, item]
      )
    ),
    [motoristas]
  );

  const nomeTransp = (id) =>
    transportadoraPorId.get(id)?.nome || '';

  const nomeMotorista = (id) =>
    motoristaPorId.get(id)?.nome || '';

  const contagens = useMemo(() => {
    const resultado = {
      all: veiculos.length,
      transportadora: 0,
      motorista: 0,
      sem_vinculo: 0,
    };

    veiculos.forEach((veiculo) => {
      if (veiculo.transportadora_id) {
        resultado.transportadora += 1;
      }

      if (veiculo.motorista_id) {
        resultado.motorista += 1;
      }

      if (
        !veiculo.transportadora_id
        && !veiculo.motorista_id
      ) {
        resultado.sem_vinculo += 1;
      }
    });

    return resultado;
  }, [veiculos]);

  const filtered = useMemo(() => {
    const q = busca.toLowerCase().trim();

    return veiculos.filter((veiculo) => {
      const matchBusca =
        !q
        || [
          veiculo.placa,
          veiculo.modelo,
          veiculo.cor,
          veiculo.ano,
          nomeTransp(veiculo.transportadora_id),
          nomeMotorista(veiculo.motorista_id),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);

      const matchFiltro =
        filtro === 'all'
        || (
          filtro === 'transportadora'
          && !!veiculo.transportadora_id
        )
        || (
          filtro === 'motorista'
          && !!veiculo.motorista_id
        )
        || (
          filtro === 'sem_vinculo'
          && !veiculo.transportadora_id
          && !veiculo.motorista_id
        );

      return matchBusca && matchFiltro;
    });
  }, [
    veiculos,
    busca,
    filtro,
    transportadoraPorId,
    motoristaPorId,
  ]);


  function atualizar(campo, valor) {
    setForm((atual) => ({
      ...atual,
      [campo]: valor,
    }));
  }


  function limparForm() {
    setForm(empty);
    setEditingId(null);
  }


  async function handleSubmit(event) {
    event.preventDefault();

    const placa = form.placa
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .trim();

    if (!placa) {
      toast({
        variant: 'destructive',
        title: 'Placa obrigatória',
        description:
          'Informe a placa do veículo antes de salvar.',
      });
      return;
    }

    const payload = {
      ...form,
      placa,
      modelo: form.modelo.trim(),
      cor: form.cor.trim(),
      ano: form.ano.trim(),
      tara: Number(form.tara) || 0,
      capacidade_kg:
        Number(form.capacidade_kg) || 0,
      transportadora_id:
        form.transportadora_id || '',
      motorista_id:
        form.motorista_id || '',
      observacao:
        form.observacao.trim(),
    };

    setSaving(true);

    try {
      if (editingId) {
        await api.entities.Veiculo.update(
          editingId,
          payload
        );

        toast({
          title: 'Veículo atualizado',
          description:
            'As informações do veículo foram atualizadas.',
        });
      } else {
        await api.entities.Veiculo.create(
          payload
        );

        toast({
          title: 'Veículo cadastrado',
          description:
            'O novo veículo foi incluído com sucesso.',
        });
      }

      limparForm();
      invalidateEntidade('Veiculo');
    } catch (err) {
      toast({
        variant: 'destructive',
        title:
          editingId
            ? 'Erro ao atualizar veículo'
            : 'Erro ao cadastrar veículo',
        description: String(
          err?.message || err
        ),
      });
    } finally {
      setSaving(false);
    }
  }


  function handleEdit(veiculo) {
    setForm({
      placa: veiculo.placa || '',
      modelo: veiculo.modelo || '',
      cor: veiculo.cor || '',
      ano: veiculo.ano || '',
      tara: veiculo.tara ?? '',
      capacidade_kg:
        veiculo.capacidade_kg ?? '',
      transportadora_id:
        veiculo.transportadora_id || '',
      motorista_id:
        veiculo.motorista_id || '',
      observacao:
        veiculo.observacao || '',
    });

    setEditingId(veiculo.id);
  }


  async function confirmarExclusao() {
    if (!deleteTarget?.id) return;

    try {
      await safeDelete(
        'Veiculo',
        deleteTarget.id
      );

      toast({
        title: 'Veículo removido',
      });

      if (editingId === deleteTarget.id) {
        limparForm();
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir',
        description: String(
          err?.message || err
        ),
      });
    } finally {
      setDeleteTarget(null);
    }
  }


  const filtros = [
    {
      value: 'all',
      label: 'Todos',
      count: contagens.all,
    },
    {
      value: 'transportadora',
      label: 'Com transportadora',
      count: contagens.transportadora,
    },
    {
      value: 'motorista',
      label: 'Com motorista',
      count: contagens.motorista,
    },
    {
      value: 'sem_vinculo',
      label: 'Sem vínculo',
      count: contagens.sem_vinculo,
    },
  ];


  return (
    <>
      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(460px,0.92fr)_minmax(700px,1.6fr)]">
        <Card className="overflow-hidden rounded-2xl border shadow-none 2xl:sticky 2xl:top-4">
          <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/[0.055] to-transparent px-4 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Car className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <h3 className="text-base font-semibold">
                {editingId
                  ? 'Editar veículo'
                  : 'Novo veículo'}
              </h3>

              <p className="mt-0.5 text-xs text-muted-foreground">
                Identificação, capacidade e vínculos operacionais em um único cadastro.
              </p>
            </div>
          </div>


          <form
            onSubmit={handleSubmit}
            className="space-y-3 p-4"
          >
            <section className="rounded-xl border bg-muted/[0.12] p-3.5">
              <SectionTitle
                number="1"
                title="Identificação do veículo"
                description="Dados usados para localizar e reconhecer o veículo nas operações do ERP."
              />

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label htmlFor="veiculo-placa">
                      Placa *
                    </Label>

                    <Input
                      id="veiculo-placa"
                      value={form.placa}
                      onChange={(e) =>
                        atualizar(
                          'placa',
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, '')
                            .slice(0, 7)
                        )
                      }
                      className="font-mono font-semibold uppercase tracking-wide"
                      placeholder="ABC1D23"
                      maxLength={7}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="veiculo-modelo">
                      Modelo
                    </Label>

                    <Input
                      id="veiculo-modelo"
                      value={form.modelo}
                      onChange={(e) =>
                        atualizar(
                          'modelo',
                          e.target.value
                        )
                      }
                      placeholder="Ex.: Scania R450"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="veiculo-cor">
                      Cor
                    </Label>

                    <Input
                      id="veiculo-cor"
                      value={form.cor}
                      onChange={(e) =>
                        atualizar(
                          'cor',
                          e.target.value
                        )
                      }
                      placeholder="Ex.: Branco"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="veiculo-ano">
                      Ano
                    </Label>

                    <Input
                      id="veiculo-ano"
                      value={form.ano}
                      onChange={(e) =>
                        atualizar(
                          'ano',
                          e.target.value
                            .replace(/\D/g, '')
                            .slice(0, 4)
                        )
                      }
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="2026"
                    />
                  </div>
                </div>
              </div>
            </section>


            <section className="rounded-xl border bg-muted/[0.12] p-3.5">
              <SectionTitle
                number="2"
                title="Dados de carga"
                description="Pesos utilizados nas rotinas de transporte e pesagem."
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-background p-3">
                  <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <Weight className="h-4 w-4" />
                    <span className="text-xs font-medium">
                      Tara
                    </span>
                  </div>

                  <div className="relative">
                    <Input
                      id="veiculo-tara"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.tara}
                      onChange={(e) =>
                        atualizar(
                          'tara',
                          e.target.value
                        )
                      }
                      className="pr-10"
                      placeholder="0"
                    />

                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      kg
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border bg-background p-3">
                  <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <Gauge className="h-4 w-4" />
                    <span className="text-xs font-medium">
                      Capacidade
                    </span>
                  </div>

                  <div className="relative">
                    <Input
                      id="veiculo-capacidade"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.capacidade_kg}
                      onChange={(e) =>
                        atualizar(
                          'capacidade_kg',
                          e.target.value
                        )
                      }
                      className="pr-10"
                      placeholder="0"
                    />

                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      kg
                    </span>
                  </div>
                </div>
              </div>
            </section>


            <section className="rounded-xl border bg-muted/[0.12] p-3.5">
              <SectionTitle
                number="3"
                title="Vínculos operacionais"
                description="Associe o veículo aos cadastros já existentes de transportadora e motorista."
              />

              <div className="space-y-2.5">
                <div className="rounded-xl border bg-background p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                      <Building2 className="h-4 w-4" />
                    </span>

                    <div>
                      <p className="text-xs font-semibold">
                        Transportadora
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Empresa responsável pelo veículo, quando aplicável.
                      </p>
                    </div>
                  </div>

                  <SearchSelect
                    value={form.transportadora_id}
                    onChange={(value) =>
                      atualizar(
                        'transportadora_id',
                        value || ''
                      )
                    }
                    options={transportadoras.map(
                      (item) => ({
                        value: item.id,
                        label: item.nome,
                      })
                    )}
                    placeholder="Selecionar transportadora"
                  />
                </div>

                <div className="rounded-xl border bg-background p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                      <UserRound className="h-4 w-4" />
                    </span>

                    <div>
                      <p className="text-xs font-semibold">
                        Motorista
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Condutor normalmente vinculado ao veículo.
                      </p>
                    </div>
                  </div>

                  <SearchSelect
                    value={form.motorista_id}
                    onChange={(value) =>
                      atualizar(
                        'motorista_id',
                        value || ''
                      )
                    }
                    options={motoristas.map(
                      (item) => ({
                        value: item.id,
                        label: item.nome,
                      })
                    )}
                    placeholder="Selecionar motorista"
                  />
                </div>
              </div>
            </section>


            <section className="rounded-xl border bg-muted/[0.12] p-3.5">
              <SectionTitle
                number="4"
                title="Observações"
              />

              <Textarea
                rows={3}
                value={form.observacao}
                onChange={(e) =>
                  atualizar(
                    'observacao',
                    e.target.value
                  )
                }
                placeholder="Informações adicionais sobre o veículo..."
              />
            </section>


            <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={limparForm}
                  disabled={saving}
                >
                  Cancelar
                </Button>
              )}

              <Button
                type="submit"
                disabled={saving}
                className="min-w-[160px]"
              >
                {saving
                  ? 'Salvando...'
                  : editingId
                    ? 'Atualizar veículo'
                    : 'Adicionar veículo'}
              </Button>
            </div>
          </form>
        </Card>


        <Card className="min-w-0 overflow-hidden rounded-2xl border shadow-none">
          <div className="flex flex-col gap-3 border-b bg-gradient-to-r from-primary/[0.035] to-transparent px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Truck className="h-5 w-5" />
              </div>

              <div>
                <h3 className="text-base font-semibold">
                  Veículos cadastrados
                </h3>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  Consulte e gerencie a frota utilizada nas operações.
                </p>
              </div>
            </div>

            <Badge
              variant="outline"
              className="w-fit rounded-full px-3 py-1 font-medium"
            >
              {veiculos.length} veículo
              {veiculos.length === 1 ? '' : 's'}
            </Badge>
          </div>


          <div className="space-y-3 p-4">
            <div className="rounded-xl border bg-muted/[0.12] p-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  value={busca}
                  onChange={(e) =>
                    setBusca(e.target.value)
                  }
                  placeholder="Buscar por placa, modelo, cor, transportadora ou motorista..."
                  className="bg-background pl-9"
                />
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {filtros.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() =>
                      setFiltro(item.value)
                    }
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                      filtro === item.value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-foreground/70 hover:border-primary/35 hover:text-foreground'
                    }`}
                  >
                    {item.label}

                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        filtro === item.value
                          ? 'bg-white/15'
                          : 'bg-muted'
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>


            <div className="overflow-hidden rounded-xl border">
              {filtered.length === 0 ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Search className="h-5 w-5" />
                  </div>

                  <p className="text-sm font-medium">
                    Nenhum veículo encontrado
                  </p>

                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Ajuste a pesquisa ou selecione outro filtro para visualizar os registros.
                  </p>
                </div>
              ) : (
                <div className="max-h-[68vh] overflow-auto scrollbar-thin">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                      <TableRow>
                        <TableHead className="min-w-[130px]">
                          Placa
                        </TableHead>

                        <TableHead className="min-w-[155px]">
                          Veículo
                        </TableHead>

                        <TableHead className="min-w-[155px]">
                          Peso / Capacidade
                        </TableHead>

                        <TableHead className="min-w-[155px]">
                          Transportadora
                        </TableHead>

                        <TableHead className="min-w-[145px]">
                          Motorista
                        </TableHead>

                        <TableHead className="w-[92px] text-right">
                          Ações
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {filtered.map((veiculo) => {
                        const transportadora =
                          nomeTransp(
                            veiculo.transportadora_id
                          );
                        const motorista =
                          nomeMotorista(
                            veiculo.motorista_id
                          );

                        return (
                          <TableRow
                            key={veiculo.id}
                            className={
                              editingId === veiculo.id
                                ? 'bg-primary/[0.035]'
                                : ''
                            }
                          >
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="border-primary/20 bg-primary/[0.055] px-2 py-1 font-mono text-xs font-semibold text-primary"
                              >
                                {plateLabel(
                                  veiculo.placa
                                )}
                              </Badge>
                            </TableCell>

                            <TableCell>
                              <div className="min-w-0">
                                <p className="max-w-[240px] truncate text-sm font-semibold">
                                  {veiculo.modelo || 'Sem modelo informado'}
                                </p>

                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  {[
                                    veiculo.cor,
                                    veiculo.ano,
                                  ]
                                    .filter(Boolean)
                                    .join(' • ')
                                    || 'Sem cor/ano informado'}
                                </p>
                              </div>
                            </TableCell>

                            <TableCell>
                              <div className="space-y-0.5 text-xs">
                                <p>
                                  Tara: {formatKg(veiculo.tara)}
                                </p>

                                <p className="text-[11px] text-muted-foreground">
                                  Cap.: {formatKg(veiculo.capacidade_kg)}
                                </p>
                              </div>
                            </TableCell>

                            <TableCell>
                              {transportadora ? (
                                <div className="flex items-center gap-2">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                                    <Building2 className="h-3.5 w-3.5" />
                                  </span>

                                  <span className="max-w-[190px] truncate text-xs font-medium">
                                    {transportadora}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Não vinculada
                                </span>
                              )}
                            </TableCell>

                            <TableCell>
                              {motorista ? (
                                <div className="flex items-center gap-2">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                                    <UserRound className="h-3.5 w-3.5" />
                                  </span>

                                  <span className="max-w-[180px] truncate text-xs font-medium">
                                    {motorista}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Não vinculado
                                </span>
                              )}
                            </TableCell>

                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() =>
                                    handleEdit(veiculo)
                                  }
                                  title="Editar veículo"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() =>
                                    setDeleteTarget(
                                      veiculo
                                    )
                                  }
                                  title="Excluir veículo"
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


            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
              <span>
                Exibindo {filtered.length} de {veiculos.length} veículo
                {veiculos.length === 1 ? '' : 's'} carregado
                {veiculos.length === 1 ? '' : 's'}.
              </span>

              <span>
                Limite atual de consulta: 500 registros.
              </span>
            </div>
          </div>
        </Card>
      </div>


      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir veículo?
            </AlertDialogTitle>

            <AlertDialogDescription>
              {deleteTarget?.placa
                ? `O veículo de placa "${plateLabel(deleteTarget.placa)}" será excluído.`
                : 'O veículo selecionado será excluído.'}
              {' '}
              A exclusão pode ser bloqueada caso o veículo esteja vinculado a outros registros do ERP.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancelar
            </AlertDialogCancel>

            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmarExclusao}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
