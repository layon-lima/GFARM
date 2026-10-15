import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileCheck2,
  FolderOpen,
  PackageCheck,
  Plus,
  Search,
  Warehouse,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { parseInventarioCriterios } from '@/lib/inventario';
import InventarioConference from '@/components/inventario/InventarioConference';
import InventarioDetalhe from '@/components/inventario/InventarioDetalhe';
import InventarioForaEstoqueReview from '@/components/inventario/InventarioForaEstoqueReview';

function fmtData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function compactStat({ icon: Icon, label, value }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-lg font-semibold leading-none">{value}</p>
      </div>
    </div>
  );
}

export default function Inventario() {
  const { user } = useAuth();
  const [conferenceOpen, setConferenceOpen] = useState(false);
  const [resumeId, setResumeId] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');

  const { data, loading, reload: load } = useEntidades({
    Setor: {},
    Produto: {},
    Deposito: {},
    Maquina: {},
    Gaveta: {},
    SaldoEstoque: {},
    Inventario: { sort: '-data', limit: 300 },
    InventarioForaEstoque: { sort: '-data_registro', limit: 300 },
  });

  const {
    Setor: setores = [],
    Produto: produtos = [],
    Deposito: depositos = [],
    Maquina: maquinas = [],
    Gaveta: gavetas = [],
    SaldoEstoque: saldos = [],
    Inventario: registros = [],
    InventarioForaEstoque: itensForaEstoque = [],
  } = data;

  const depositoMap = useMemo(() => new Map(depositos.map((d) => [d.id, d])), [depositos]);
  const setorMap = useMemo(() => new Map(setores.map((s) => [s.id, s])), [setores]);

  const registrosComEscopo = useMemo(
    () =>
      registros.map((registro) => {
        const criterios = parseInventarioCriterios(registro);
        const deposito = depositoMap.get(criterios.deposito_id);
        const setor = setorMap.get(criterios.setor_id || registro.setor_id);
        return {
          ...registro,
          _criterios: criterios,
          _depositoNome: deposito
            ? `${deposito.numero || ''}${deposito.numero && deposito.nome ? ' · ' : ''}${deposito.nome || ''}`
            : criterios.deposito_id
              ? 'Depósito não encontrado'
              : 'Inventário legado',
          _setorNome: setor?.nome || registro.setor_nome || 'Todos os setores',
        };
      }),
    [registros, depositoMap, setorMap]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return registrosComEscopo.filter((registro) => {
      if (statusFiltro !== 'todos' && registro.status !== statusFiltro) return false;
      if (!termo) return true;

      return [
        registro.numero,
        registro._depositoNome,
        registro._setorNome,
        registro.responsavel,
        registro.criterios_descricao,
      ]
        .filter(Boolean)
        .some((valor) => String(valor).toLowerCase().includes(termo));
    });
  }, [registrosComEscopo, busca, statusFiltro]);

  const stats = useMemo(() => {
    const abertos = registros.filter((r) => r.status === 'aberto').length;
    const concluidos = registros.filter((r) => r.status === 'concluido').length;
    const divergentes = registros.filter(
      (r) => r.status === 'concluido' && r.resultado === 'divergente'
    ).length;
    return { total: registros.length, abertos, concluidos, divergentes };
  }, [registros]);

  function novoInventario() {
    setResumeId(null);
    setConferenceOpen(true);
  }

  function abrirDoc(registro) {
    if (registro.status === 'aberto') {
      setResumeId(registro.id);
      setConferenceOpen(true);
      return;
    }
    setDetalhe(registro);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-3 p-3 lg:px-4 xl:px-5">
      <Card className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b bg-muted/20 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Estoque físico
              </p>
              <h1 className="text-[28px] font-semibold leading-none tracking-tight">Inventário</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Documento de contagem por depósito, com setor opcional e postagem de divergências no motor de estoque.
              </p>
            </div>
          </div>

          <Button onClick={novoInventario} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo inventário
          </Button>
        </div>

        <div className="space-y-4 p-5">
          <InventarioForaEstoqueReview
            itens={itensForaEstoque}
            produtos={produtos}
            depositos={depositos}
            gavetas={gavetas}
            user={user}
            onSaved={load}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {compactStat({ icon: ClipboardList, label: 'Documentos', value: stats.total })}
            {compactStat({ icon: Clock3, label: 'Em aberto', value: stats.abertos })}
            {compactStat({ icon: FileCheck2, label: 'Concluídos', value: stats.concluidos })}
            {compactStat({ icon: AlertTriangle, label: 'Com divergência', value: stats.divergentes })}
          </div>

          <Card className="overflow-hidden rounded-2xl border shadow-none">
            <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold">Documentos de inventário</h2>
                <p className="text-xs text-muted-foreground">
                  Histórico, documentos em contagem e conferências finalizadas.
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                <div className="relative min-w-0 sm:w-[330px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar número, depósito, setor..."
                    className="pl-9"
                  />
                </div>
                <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                  <SelectTrigger className="sm:w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os status</SelectItem>
                    <SelectItem value="aberto">Em aberto</SelectItem>
                    <SelectItem value="concluido">Concluído</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {filtrados.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <PackageCheck className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 font-medium">Nenhum inventário encontrado</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ajuste a busca ou crie um novo documento de inventário.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[130px]">Documento</TableHead>
                      <TableHead className="min-w-[210px]">Depósito</TableHead>
                      <TableHead className="min-w-[160px]">Setor</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Responsável</TableHead>
                      <TableHead className="text-right">Itens</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[44px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtrados.map((registro) => {
                      const aberto = registro.status === 'aberto';
                      const consistente = registro.resultado === 'consistente';

                      return (
                        <TableRow
                          key={registro.id}
                          className="cursor-pointer"
                          onClick={() => abrirDoc(registro)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {aberto ? (
                                <FolderOpen className="h-4 w-4 text-amber-600" />
                              ) : (
                                <FileCheck2 className="h-4 w-4 text-emerald-700" />
                              )}
                              <span className="font-mono text-xs font-semibold text-primary">
                                {registro.numero || '—'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Warehouse className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="font-medium">{registro._depositoNome}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{registro._setorNome}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {fmtData(registro.data)}
                          </TableCell>
                          <TableCell className="text-sm">{registro.responsavel || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(registro.total_itens) || 0}
                          </TableCell>
                          <TableCell>
                            {aberto ? (
                              <span className="text-sm text-muted-foreground">—</span>
                            ) : consistente ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Consistente
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                {Number(registro.total_divergencias) || 0} diverg.
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                aberto
                                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                                  : 'border-slate-200 bg-slate-50 text-slate-700'
                              }
                            >
                              {aberto ? 'Em contagem' : 'Concluído'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
      </Card>

      <InventarioConference
        open={conferenceOpen}
        onOpenChange={(openValue) => {
          setConferenceOpen(openValue);
          if (!openValue) setResumeId(null);
        }}
        setores={setores}
        produtos={produtos}
        depositos={depositos}
        maquinas={maquinas}
        gavetas={gavetas}
        saldos={saldos}
        user={user}
        onSaved={load}
        initialInventarioId={resumeId}
      />

      <InventarioDetalhe
        inventario={detalhe}
        depositos={depositos}
        setores={setores}
        open={!!detalhe}
        onOpenChange={(openValue) => !openValue && setDetalhe(null)}
      />
    </div>
  );
}
