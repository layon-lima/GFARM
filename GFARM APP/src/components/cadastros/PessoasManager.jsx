import { useMemo, useState } from 'react';
import {
  Check,
  IdCard,
  MapPin,
  PackageCheck,
  Pencil,
  Phone,
  Search,
  Trash2,
  Truck,
  UserRound,
  UsersRound,
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


const empty = {
  nome: '',
  documento: '',
  ie: '',
  telefone: '',
  cidade: '',
  uf: '',
  endereco: '',
  cnh: '',
  cnh_validade: '',
  is_cliente: true,
  is_fornecedor: false,
  is_transportadora: false,
  is_motorista: false,
  observacao: '',
};


const PERFIS = [
  {
    key: 'is_cliente',
    filtro: 'cliente',
    label: 'Cliente',
    filterLabel: 'Clientes',
    descricao: 'Pessoa ou empresa que compra produtos e serviços.',
    icon: UserRound,
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    key: 'is_fornecedor',
    filtro: 'fornecedor',
    label: 'Fornecedor',
    filterLabel: 'Fornecedores',
    descricao: 'Fornece produtos, insumos ou serviços.',
    icon: PackageCheck,
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'is_transportadora',
    filtro: 'transportadora',
    label: 'Transportadora',
    filterLabel: 'Transportadoras',
    descricao: 'Empresa responsável pelo transporte de cargas.',
    icon: Truck,
    badge: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  {
    key: 'is_motorista',
    filtro: 'motorista',
    label: 'Motorista',
    filterLabel: 'Motoristas',
    descricao: 'Condutor utilizado nas operações de transporte.',
    icon: IdCard,
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
  },
];


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


function PerfilCard({
  perfil,
  checked,
  onChange,
}) {
  const Icon = perfil.icon;

  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative min-h-[112px] rounded-xl border p-3 text-left transition-all ${
        checked
          ? 'border-primary bg-primary/[0.055] shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]'
          : 'border-border bg-background hover:border-primary/35 hover:bg-muted/25'
      }`}
    >
      <span
        className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
          checked
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>

      <span className="block text-sm font-semibold">
        {perfil.label}
      </span>

      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
        {perfil.descricao}
      </span>

      <span
        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/35 bg-background'
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}


function PessoaBadges({ pessoa }) {
  const ativos = PERFIS.filter(
    (perfil) => pessoa[perfil.key]
  );

  if (!ativos.length) {
    return (
      <span className="text-xs text-muted-foreground">
        Sem perfil
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ativos.map((perfil) => {
        const Icon = perfil.icon;

        return (
          <Badge
            key={perfil.key}
            variant="outline"
            className={`gap-1 px-2 py-0.5 text-[10px] font-medium ${perfil.badge}`}
          >
            <Icon className="h-3 w-3" />
            {perfil.label}
          </Badge>
        );
      })}
    </div>
  );
}


function initialOf(nome) {
  return String(nome || '?')
    .trim()
    .charAt(0)
    .toUpperCase() || '?';
}


export default function PessoasManager() {
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('all');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { toast } = useToast();

  const { data } = useEntidades({
    Pessoa: {
      sort: '-created_date',
      limit: 500,
    },
  });

  const pessoas = data.Pessoa || [];


  const contagens = useMemo(() => {
    const resultado = {
      all: pessoas.length,
      cliente: 0,
      fornecedor: 0,
      transportadora: 0,
      motorista: 0,
    };

    pessoas.forEach((pessoa) => {
      if (pessoa.is_cliente) resultado.cliente += 1;
      if (pessoa.is_fornecedor) resultado.fornecedor += 1;
      if (pessoa.is_transportadora) resultado.transportadora += 1;
      if (pessoa.is_motorista) resultado.motorista += 1;
    });

    return resultado;
  }, [pessoas]);


  const filtered = useMemo(() => {
    const q = busca.toLowerCase().trim();

    return pessoas.filter((pessoa) => {
      const matchBusca =
        !q
        || [
          pessoa.nome,
          pessoa.documento,
          pessoa.ie,
          pessoa.cidade,
          pessoa.uf,
          pessoa.telefone,
          pessoa.cnh,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);

      const matchFiltro =
        filtro === 'all'
        || PERFIS.some(
          (perfil) =>
            perfil.filtro === filtro
            && pessoa[perfil.key]
        );

      return matchBusca && matchFiltro;
    });
  }, [pessoas, busca, filtro]);


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

    if (!form.nome.trim()) {
      toast({
        variant: 'destructive',
        title: 'Nome obrigatório',
        description:
          'Informe o nome ou a razão social da pessoa.',
      });
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await api.entities.Pessoa.update(
          editingId,
          form
        );

        toast({
          title: 'Cadastro atualizado',
          description:
            'As informações da pessoa foram atualizadas.',
        });
      } else {
        await api.entities.Pessoa.create(
          form
        );

        toast({
          title: 'Pessoa cadastrada',
          description:
            'O novo cadastro foi incluído com sucesso.',
        });
      }

      limparForm();
      invalidateEntidade('Pessoa');
    } catch (err) {
      toast({
        variant: 'destructive',
        title:
          editingId
            ? 'Erro ao atualizar cadastro'
            : 'Erro ao cadastrar pessoa',
        description: String(
          err?.message || err
        ),
      });
    } finally {
      setSaving(false);
    }
  }


  function handleEdit(pessoa) {
    setForm({
      nome: pessoa.nome || '',
      documento: pessoa.documento || '',
      ie: pessoa.ie || '',
      telefone: pessoa.telefone || '',
      cidade: pessoa.cidade || '',
      uf: pessoa.uf || '',
      endereco: pessoa.endereco || '',
      cnh: pessoa.cnh || '',
      cnh_validade:
        pessoa.cnh_validade || '',
      is_cliente:
        !!pessoa.is_cliente,
      is_fornecedor:
        !!pessoa.is_fornecedor,
      is_transportadora:
        !!pessoa.is_transportadora,
      is_motorista:
        !!pessoa.is_motorista,
      observacao:
        pessoa.observacao || '',
    });

    setEditingId(pessoa.id);
  }


  async function confirmarExclusao() {
    if (!deleteTarget?.id) return;

    try {
      await safeDelete(
        'Pessoa',
        deleteTarget.id
      );

      toast({
        title: 'Pessoa removida',
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
    ...PERFIS.map((perfil) => ({
      value: perfil.filtro,
      label: perfil.filterLabel,
      count: contagens[perfil.filtro],
    })),
  ];


  return (
    <>
      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(460px,0.92fr)_minmax(680px,1.55fr)]">
        <Card className="overflow-hidden rounded-2xl border shadow-none 2xl:sticky 2xl:top-4">
          <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/[0.055] to-transparent px-4 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UsersRound className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <h3 className="text-base font-semibold">
                {editingId
                  ? 'Editar cadastro'
                  : 'Novo cadastro'}
              </h3>

              <p className="mt-0.5 text-xs text-muted-foreground">
                Preencha os dados e defina os perfis de atuação no sistema.
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
                title="Informações básicas"
              />

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pessoa-nome">
                    Nome / Razão Social *
                  </Label>

                  <Input
                    id="pessoa-nome"
                    value={form.nome}
                    onChange={(e) =>
                      atualizar(
                        'nome',
                        e.target.value
                      )
                    }
                    placeholder="Nome da pessoa ou empresa"
                    required
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pessoa-documento">
                      CNPJ / CPF
                    </Label>

                    <Input
                      id="pessoa-documento"
                      value={form.documento}
                      onChange={(e) =>
                        atualizar(
                          'documento',
                          e.target.value
                        )
                      }
                      placeholder="CPF ou CNPJ"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="pessoa-ie">
                      Inscrição Estadual
                    </Label>

                    <Input
                      id="pessoa-ie"
                      value={form.ie || ''}
                      onChange={(e) =>
                        atualizar(
                          'ie',
                          e.target.value
                        )
                      }
                      placeholder="IE"
                    />
                  </div>
                </div>
              </div>
            </section>


            <section className="rounded-xl border bg-muted/[0.12] p-3.5">
              <SectionTitle
                number="2"
                title="Contato e endereço"
              />

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pessoa-telefone">
                      Telefone
                    </Label>

                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                      <Input
                        id="pessoa-telefone"
                        value={form.telefone}
                        onChange={(e) =>
                          atualizar(
                            'telefone',
                            e.target.value
                          )
                        }
                        className="pl-9"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_82px] gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pessoa-cidade">
                        Cidade
                      </Label>

                      <Input
                        id="pessoa-cidade"
                        value={form.cidade}
                        onChange={(e) =>
                          atualizar(
                            'cidade',
                            e.target.value
                          )
                        }
                        placeholder="Cidade"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="pessoa-uf">
                        UF
                      </Label>

                      <Input
                        id="pessoa-uf"
                        value={form.uf}
                        onChange={(e) =>
                          atualizar(
                            'uf',
                            e.target.value
                              .toUpperCase()
                              .slice(0, 2)
                          )
                        }
                        maxLength={2}
                        className="uppercase"
                        placeholder="SP"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pessoa-endereco">
                    Endereço
                  </Label>

                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

                    <Input
                      id="pessoa-endereco"
                      value={form.endereco}
                      onChange={(e) =>
                        atualizar(
                          'endereco',
                          e.target.value
                        )
                      }
                      className="pl-9"
                      placeholder="Rua, número, bairro"
                    />
                  </div>
                </div>
              </div>
            </section>


            <section className="rounded-xl border bg-muted/[0.12] p-3.5">
              <SectionTitle
                number="3"
                title="Perfis da pessoa"
                description="Selecione um ou mais perfis para definir como este cadastro será utilizado."
              />

              <div className="grid gap-2.5 sm:grid-cols-2">
                {PERFIS.map((perfil) => (
                  <PerfilCard
                    key={perfil.key}
                    perfil={perfil}
                    checked={!!form[perfil.key]}
                    onChange={(valor) =>
                      atualizar(
                        perfil.key,
                        valor
                      )
                    }
                  />
                ))}
              </div>
            </section>


            {form.is_motorista && (
              <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                <SectionTitle
                  number="4"
                  title="Dados de motorista"
                  description="Campos utilizados quando a pessoa atua como motorista."
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pessoa-cnh">
                      CNH
                    </Label>

                    <Input
                      id="pessoa-cnh"
                      value={form.cnh}
                      onChange={(e) =>
                        atualizar(
                          'cnh',
                          e.target.value
                        )
                      }
                      placeholder="Número da CNH"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="pessoa-cnh-validade">
                      Validade da CNH
                    </Label>

                    <Input
                      id="pessoa-cnh-validade"
                      type="date"
                      value={form.cnh_validade}
                      onChange={(e) =>
                        atualizar(
                          'cnh_validade',
                          e.target.value
                        )
                      }
                    />
                  </div>
                </div>
              </section>
            )}


            <section className="rounded-xl border bg-muted/[0.12] p-3.5">
              <SectionTitle
                number={form.is_motorista ? '5' : '4'}
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
                placeholder="Informações adicionais sobre a pessoa..."
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
                className="min-w-[150px]"
              >
                {saving
                  ? 'Salvando...'
                  : editingId
                    ? 'Atualizar cadastro'
                    : 'Adicionar pessoa'}
              </Button>
            </div>
          </form>
        </Card>


        <Card className="min-w-0 overflow-hidden rounded-2xl border shadow-none">
          <div className="flex flex-col gap-3 border-b bg-gradient-to-r from-primary/[0.035] to-transparent px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UsersRound className="h-5 w-5" />
              </div>

              <div>
                <h3 className="text-base font-semibold">
                  Pessoas cadastradas
                </h3>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  Visualize, busque e gerencie os cadastros do sistema.
                </p>
              </div>
            </div>

            <Badge
              variant="outline"
              className="w-fit rounded-full px-3 py-1 font-medium"
            >
              {pessoas.length} registro
              {pessoas.length === 1 ? '' : 's'}
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
                  placeholder="Buscar por nome, documento, IE, cidade, telefone ou CNH..."
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
                    Nenhum cadastro encontrado
                  </p>

                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Ajuste a pesquisa ou selecione outro perfil para visualizar os registros.
                  </p>
                </div>
              ) : (
                <div className="max-h-[68vh] overflow-auto scrollbar-thin">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                      <TableRow>
                        <TableHead className="min-w-[175px]">
                          Pessoa
                        </TableHead>

                        <TableHead className="min-w-[140px]">
                          Documento
                        </TableHead>

                        <TableHead className="min-w-[130px]">
                          Cidade / UF
                        </TableHead>

                        <TableHead className="min-w-[160px]">
                          Perfis
                        </TableHead>

                        <TableHead className="min-w-[130px]">
                          Contato
                        </TableHead>

                        <TableHead className="w-[92px] text-right">
                          Ações
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {filtered.map((pessoa) => (
                        <TableRow
                          key={pessoa.id}
                          className={
                            editingId === pessoa.id
                              ? 'bg-primary/[0.035]'
                              : ''
                          }
                        >
                          <TableCell>
                            <div className="flex items-start gap-2.5">
                              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                                {initialOf(pessoa.nome)}
                              </span>

                              <div className="min-w-0">
                                <p className="max-w-[260px] truncate text-sm font-semibold">
                                  {pessoa.nome}
                                </p>

                                {pessoa.ie && (
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    IE: {pessoa.ie}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            <span className="font-mono text-xs">
                              {pessoa.documento || '—'}
                            </span>
                          </TableCell>

                          <TableCell>
                            <span className="text-xs">
                              {pessoa.cidade || '—'}
                              {pessoa.uf
                                ? ` / ${pessoa.uf}`
                                : ''}
                            </span>
                          </TableCell>

                          <TableCell>
                            <PessoaBadges
                              pessoa={pessoa}
                            />
                          </TableCell>

                          <TableCell>
                            <div className="space-y-0.5 text-xs">
                              <p>
                                {pessoa.telefone || '—'}
                              </p>

                              {pessoa.is_motorista
                                && pessoa.cnh && (
                                  <p className="text-[11px] text-muted-foreground">
                                    CNH: {pessoa.cnh}
                                  </p>
                                )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() =>
                                  handleEdit(pessoa)
                                }
                                title="Editar cadastro"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>

                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() =>
                                  setDeleteTarget(pessoa)
                                }
                                title="Excluir cadastro"
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


            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
              <span>
                Exibindo {filtered.length} de {pessoas.length} cadastro
                {pessoas.length === 1 ? '' : 's'} carregado
                {pessoas.length === 1 ? '' : 's'}.
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
              Excluir pessoa?
            </AlertDialogTitle>

            <AlertDialogDescription>
              {deleteTarget?.nome
                ? `O cadastro "${deleteTarget.nome}" será excluído.`
                : 'O cadastro selecionado será excluído.'}
              {' '}
              A exclusão pode ser bloqueada caso esta pessoa esteja vinculada a outros registros do ERP.
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
