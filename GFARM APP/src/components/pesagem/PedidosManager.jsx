import { useMemo, useState } from 'react';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  Infinity as InfinityIcon,
  Pencil,
  Plus,
  Search,
  Truck,
  Weight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import SearchSelect from '@/components/SearchSelect';
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
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { queryClientInstance } from '@/lib/query-client';
import {
  formatKg,
  formatPlaca,
  somaLiquidoTickets,
} from '@/lib/pesagem';
import { formatQtd } from '@/lib/format';
import PedidoFormDialog from './PedidoFormDialog';

const PAGE_SIZE = 12;

const STATUS = {
  aberto: {
    label: 'Em aberto',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  parcial: {
    label: 'Parcial',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  atendido: {
    label: 'Atendido',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  cancelado: {
    label: 'Cancelado',
    className: 'border-slate-200 bg-slate-100 text-slate-600',
  },
};

function statusPedido(pedido, tickets) {
  if (pedido.status === 'cancelado') return 'cancelado';
  if (pedido.status === 'concluido') return 'atendido';

  if (pedido.sem_limite) return 'aberto';

  const entregue = somaLiquidoTickets(tickets, pedido.id);
  const saldo = Number(pedido.saldo_kg) || 0;
  const total = Number(pedido.total_kg) || 0;

  if (total > 0 && saldo <= 0) return 'atendido';
  if (entregue > 0) return 'parcial';

  return 'aberto';
}

function dataPedido(pedido) {
  return pedido.created_date || pedido.updated_date || '';
}

function formatData(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export default function PedidosManager({
  pedidos = [],
  pessoas = [],
  produtos = [],
  tickets = [],
  transportadoras = [],
  onReload,
  onGerarTicketVenda,
}) {
  const { toast } = useToast();

  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [clienteFiltro, setClienteFiltro] = useState('all');
  const [produtoFiltro, setProdutoFiltro] = useState('all');
  const [transportadoraFiltro, setTransportadoraFiltro] = useState('all');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  const [pagina, setPagina] = useState(1);
  const [selecionadoId, setSelecionadoId] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [duplicando, setDuplicando] = useState(null);
  const [cancelando, setCancelando] = useState(null);
  const [saving, setSaving] = useState(false);

  const clienteNome = (id) =>
    pessoas.find((p) => p.id === id)?.nome || '—';

  const produtoNome = (id) =>
    produtos.find((p) => p.id === id)?.nome || '—';

  const transportadorasPedido = (pedido) => {
    const ids = String(pedido.transportadora_ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    return ids
      .map((id) => transportadoras.find((t) => t.id === id))
      .filter(Boolean);
  };

  const enriquecidos = useMemo(
    () =>
      pedidos.map((pedido) => {
        const entregue = somaLiquidoTickets(tickets, pedido.id);
        const status = statusPedido(pedido, tickets);

        return {
          ...pedido,
          _status: status,
          _entregue: entregue,
          _transportadoras: transportadorasPedido(pedido),
        };
      }),
    [pedidos, tickets, transportadoras]
  );

  const counts = useMemo(
    () => ({
      todos: enriquecidos.length,
      aberto: enriquecidos.filter((p) => p._status === 'aberto').length,
      parcial: enriquecidos.filter((p) => p._status === 'parcial').length,
      atendido: enriquecidos.filter((p) => p._status === 'atendido').length,
      cancelado: enriquecidos.filter((p) => p._status === 'cancelado').length,
    }),
    [enriquecidos]
  );

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();

    return [...enriquecidos]
      .filter((pedido) => {
        if (
          statusFiltro !== 'todos' &&
          pedido._status !== statusFiltro
        ) {
          return false;
        }

        if (
          clienteFiltro !== 'all' &&
          pedido.cliente_id !== clienteFiltro
        ) {
          return false;
        }

        if (
          produtoFiltro !== 'all' &&
          pedido.produto_id !== produtoFiltro
        ) {
          return false;
        }

        if (transportadoraFiltro !== 'all') {
          const ids = String(pedido.transportadora_ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);

          if (!ids.includes(transportadoraFiltro)) return false;
        }

        const dt = dataPedido(pedido);
        if (dataInicio && dt) {
          if (new Date(dt) < new Date(`${dataInicio}T00:00:00`)) {
            return false;
          }
        }

        if (dataFim && dt) {
          if (new Date(dt) > new Date(`${dataFim}T23:59:59`)) {
            return false;
          }
        }

        if (!q) return true;

        const transportadorasTxt = pedido._transportadoras
          .map((t) => t.nome)
          .join(' ');

        return [
          pedido.numero,
          clienteNome(pedido.cliente_id),
          produtoNome(pedido.produto_id),
          transportadorasTxt,
          pedido.observacao,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort(
        (a, b) =>
          new Date(dataPedido(b) || 0) -
          new Date(dataPedido(a) || 0)
      );
  }, [
    enriquecidos,
    busca,
    statusFiltro,
    clienteFiltro,
    produtoFiltro,
    transportadoraFiltro,
    dataInicio,
    dataFim,
    pessoas,
    produtos,
  ]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(filtrados.length / PAGE_SIZE)
  );

  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const paginaRows = filtrados.slice(inicio, inicio + PAGE_SIZE);

  const selecionado =
    enriquecidos.find((p) => p.id === selecionadoId) ||
    paginaRows[0] ||
    null;

  const ticketsSelecionado = useMemo(() => {
    if (!selecionado) return [];

    return tickets
      .filter((t) => t.pedido_id === selecionado.id)
      .sort(
        (a, b) =>
          new Date(b.data_abertura || 0) -
          new Date(a.data_abertura || 0)
      );
  }, [tickets, selecionado?.id]);

  const ticketsAbertosSelecionado = ticketsSelecionado.filter(
    (t) => t.status === 'aberto'
  );

  const statusSelecionado = selecionado
    ? STATUS[selecionado._status]
    : null;

  function selecionar(pedido) {
    setSelecionadoId(pedido.id);
  }

  function novoPedido() {
    setEditando(null);
    setDuplicando(null);
    setFormOpen(true);
  }

  function editarPedido(pedido) {
    setDuplicando(null);
    setEditando(pedido);
    setFormOpen(true);
  }

  function duplicarPedido(pedido) {
    setEditando(null);
    setDuplicando(pedido);
    setFormOpen(true);
  }

  async function cancelarPedido() {
    if (!cancelando) return;

    const ticketsAbertos = tickets.filter(
      (t) =>
        t.pedido_id === cancelando.id &&
        t.status === 'aberto'
    );

    if (ticketsAbertos.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Pedido possui ticket em aberto',
        description:
          'Feche ou exclua o ticket em aberto antes de cancelar o pedido.',
      });
      setCancelando(null);
      return;
    }

    setSaving(true);

    try {
      await api.entities.PedidoPesagem.update(
        cancelando.id,
        { status: 'cancelado' }
      );

      queryClientInstance.removeQueries({
        queryKey: ['ent', 'PedidoPesagem'],
      });

      await queryClientInstance.refetchQueries({
        queryKey: ['ent', 'PedidoPesagem'],
      });

      toast({
        title: 'Pedido cancelado',
        description: cancelando.numero || '',
      });

      setCancelando(null);
      await onReload?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao cancelar pedido',
        description: String(error?.message || error),
      });
    } finally {
      setSaving(false);
    }
  }

  function gerarTicket(pedido) {
    if (!pedido) return;

    if (pedido.status !== 'aberto') {
      toast({
        variant: 'destructive',
        title: 'Pedido indisponível para pesagem',
      });
      return;
    }

    if (
      !pedido.sem_limite &&
      (Number(pedido.saldo_kg) || 0) <= 0
    ) {
      toast({
        variant: 'destructive',
        title: 'Pedido sem saldo',
        description:
          'Não é possível gerar um novo ticket para um pedido atendido.',
      });
      return;
    }

    onGerarTicketVenda?.(pedido);
  }

  function limparFiltros() {
    setBusca('');
    setStatusFiltro('todos');
    setClienteFiltro('all');
    setProdutoFiltro('all');
    setTransportadoraFiltro('all');
    setDataInicio('');
    setDataFim('');
    setPagina(1);
  }

  return (
    <div className="pesagem-pedidos-workspace space-y-3">
      <div className="pesagem-manager-heading flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="pesagem-manager-eyebrow text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            Comercial / Pesagem
          </p>
          <h2 className="pesagem-manager-title mt-1 text-xl font-semibold tracking-tight">
            Pedidos de Venda
          </h2>
          <p className="pesagem-manager-description mt-1 text-sm text-muted-foreground">
            Central para criar, acompanhar e gerenciar os pedidos usados nos tickets de venda.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => selecionado && duplicarPedido(selecionado)}
            disabled={!selecionado}
          >
            <Copy className="mr-2 h-4 w-4" />
            Duplicar
          </Button>

          <Button onClick={novoPedido}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Pedido
          </Button>
        </div>
      </div>

      <Card className="pesagem-manager-filters rounded-2xl border p-3 shadow-none">
        <div className="flex flex-col gap-3 xl:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(1);
              }}
              placeholder="Buscar por pedido, cliente, produto ou transportadora..."
              className="h-10 pl-9"
            />
          </div>

          <Button
            variant="ghost"
            className="h-10 text-muted-foreground"
            onClick={limparFiltros}
          >
            Limpar filtros
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ['todos', 'Todos'],
            ['aberto', 'Em aberto'],
            ['parcial', 'Parcial'],
            ['atendido', 'Atendido'],
            ['cancelado', 'Cancelado'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setStatusFiltro(key);
                setPagina(1);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFiltro === key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent'
              }`}
            >
              {label} ({counts[key]})
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <SearchSelect
            value={clienteFiltro}
            onChange={(value) => {
              setClienteFiltro(value);
              setPagina(1);
            }}
            allLabel="Todos os clientes"
            placeholder="Cliente..."
            options={pessoas
              .filter((p) => p.is_cliente)
              .map((p) => ({
                value: p.id,
                label: p.nome,
              }))
              .sort((a, b) => a.label.localeCompare(b.label))}
          />

          <SearchSelect
            value={produtoFiltro}
            onChange={(value) => {
              setProdutoFiltro(value);
              setPagina(1);
            }}
            allLabel="Todos os produtos"
            placeholder="Produto..."
            options={produtos
              .filter((p) => p.venda)
              .map((p) => ({
                value: p.id,
                label: p.nome,
              }))
              .sort((a, b) => a.label.localeCompare(b.label))}
          />

          <SearchSelect
            value={transportadoraFiltro}
            onChange={(value) => {
              setTransportadoraFiltro(value);
              setPagina(1);
            }}
            allLabel="Todas as transportadoras"
            placeholder="Transportadora..."
            options={transportadoras
              .map((p) => ({
                value: p.id,
                label: p.nome,
              }))
              .sort((a, b) => a.label.localeCompare(b.label))}
          />

          <Input
            type="date"
            value={dataInicio}
            onChange={(e) => {
              setDataInicio(e.target.value);
              setPagina(1);
            }}
            className="h-9"
            title="Data inicial"
          />

          <Input
            type="date"
            value={dataFim}
            onChange={(e) => {
              setDataFim(e.target.value);
              setPagina(1);
            }}
            className="h-9"
            title="Data final"
          />
        </div>
      </Card>

      <div className="pesagem-manager-split grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card className="pesagem-manager-list overflow-hidden rounded-2xl border shadow-none">
          {filtrados.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/35" />
              <p className="mt-3 text-sm font-medium">
                Nenhum pedido encontrado
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ajuste os filtros ou crie um novo pedido de venda.
              </p>
            </div>
          ) : (
            <>
              <div className="pesagem-manager-table overflow-auto">
                <table className="min-w-[1050px] w-full text-xs">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Pedido</th>
                      <th className="px-3 py-2.5 text-left">Data</th>
                      <th className="px-3 py-2.5 text-left">Cliente</th>
                      <th className="px-3 py-2.5 text-left">Produto</th>
                      <th className="px-3 py-2.5 text-left">Transportadora(s)</th>
                      <th className="px-3 py-2.5 text-right">Total kg</th>
                      <th className="px-3 py-2.5 text-right">Entregue kg</th>
                      <th className="px-3 py-2.5 text-right">Saldo kg</th>
                      <th className="px-3 py-2.5 text-center">Status</th>
                      <th className="w-12 px-3 py-2.5 text-center"></th>
                    </tr>
                  </thead>

                  <tbody>
                    {paginaRows.map((pedido) => {
                      const info = STATUS[pedido._status];
                      const selected = pedido.id === selecionado?.id;

                      return (
                        <tr
                          key={pedido.id}
                          onClick={() => selecionar(pedido)}
                          className={`cursor-pointer border-t transition-colors ${
                            selected
                              ? 'bg-primary/5'
                              : 'hover:bg-muted/30'
                          }`}
                        >
                          <td className="px-3 py-2.5 font-mono font-semibold text-primary">
                            {pedido.numero || '—'}
                          </td>

                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {formatData(dataPedido(pedido))}
                          </td>

                          <td className="max-w-[190px] truncate px-3 py-2.5 font-medium">
                            {clienteNome(pedido.cliente_id)}
                          </td>

                          <td className="max-w-[180px] truncate px-3 py-2.5">
                            {produtoNome(pedido.produto_id)}
                          </td>

                          <td className="max-w-[210px] truncate px-3 py-2.5">
                            {pedido._transportadoras.length
                              ? pedido._transportadoras
                                  .map((t) => t.nome)
                                  .join(', ')
                              : '—'}
                          </td>

                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {pedido.sem_limite
                              ? '∞'
                              : formatQtd(pedido.total_kg || 0)}
                          </td>

                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                            {formatQtd(pedido._entregue || 0)}
                          </td>

                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                            {pedido.sem_limite
                              ? '∞'
                              : formatQtd(pedido.saldo_kg || 0)}
                          </td>

                          <td className="px-3 py-2.5 text-center">
                            <Badge
                              variant="outline"
                              className={info.className}
                            >
                              {info.label}
                            </Badge>
                          </td>

                          <td
                            className="px-3 py-2.5 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => selecionar(pedido)}
                              title="Abrir pedido"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pesagem-manager-footer flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Mostrando {paginaRows.length} de {filtrados.length} pedido(s)
                </p>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={paginaAtual <= 1}
                    onClick={() =>
                      setPagina((prev) => Math.max(1, prev - 1))
                    }
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  <Badge variant="outline">
                    {paginaAtual} / {totalPaginas}
                  </Badge>

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={paginaAtual >= totalPaginas}
                    onClick={() =>
                      setPagina((prev) =>
                        Math.min(totalPaginas, prev + 1)
                      )
                    }
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card className="pesagem-manager-detail h-fit overflow-hidden rounded-2xl border shadow-none xl:sticky xl:top-4">
          {!selecionado ? (
            <div className="py-16 text-center">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/35" />
              <p className="mt-3 text-sm font-medium">
                Selecione um pedido
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Os detalhes e ações aparecerão aqui.
              </p>
            </div>
          ) : (
            <>
              <div className="border-b bg-muted/15 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-primary">
                      {selecionado.numero || 'Pedido'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Criado em {formatData(dataPedido(selecionado))}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={statusSelecionado.className}
                  >
                    {statusSelecionado.label}
                  </Badge>
                </div>

                <div className="pesagem-pedido-actions mt-4 grid gap-2">
                  <Button
                    onClick={() => editarPedido(selecionado)}
                    disabled={
                      selecionado._status === 'cancelado' ||
                      selecionado._status === 'atendido'
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar pedido
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => gerarTicket(selecionado)}
                    disabled={
                      selecionado.status !== 'aberto' ||
                      selecionado._status === 'atendido' ||
                      selecionado._status === 'cancelado'
                    }
                  >
                    <Weight className="mr-2 h-4 w-4" />
                    Gerar ticket de venda
                  </Button>

                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setCancelando(selecionado)}
                    disabled={
                      selecionado.status !== 'aberto' ||
                      selecionado._status === 'atendido' ||
                      selecionado._status === 'cancelado'
                    }
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    Cancelar pedido
                  </Button>
                </div>
              </div>

              <div className="space-y-4 p-4">
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Dados do pedido
                  </p>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Cliente
                      </p>
                      <p className="font-medium">
                        {clienteNome(selecionado.cliente_id)}
                      </p>
                    </div>

                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Produto
                      </p>
                      <p className="font-medium">
                        {produtoNome(selecionado.produto_id)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Quantidade total
                      </p>
                      <p className="font-semibold">
                        {selecionado.sem_limite
                          ? 'Sem limite'
                          : formatKg(selecionado.total_kg || 0)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Entregue
                      </p>
                      <p className="font-semibold">
                        {formatKg(selecionado._entregue || 0)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Saldo
                      </p>
                      <p className="font-semibold text-primary">
                        {selecionado.sem_limite
                          ? 'Sem limite'
                          : formatKg(selecionado.saldo_kg || 0)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Peso por saca
                      </p>
                      <p className="font-medium">
                        {formatKg(selecionado.peso_saca_kg || 0)}
                      </p>
                    </div>
                  </div>

                  {selecionado.observacao && (
                    <div className="mt-3 rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                      {selecionado.observacao}
                    </div>
                  )}
                </section>

                <section className="border-t pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Regras de pesagem
                  </p>

                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Transportadoras autorizadas
                      </p>

                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {selecionado._transportadoras.length ? (
                          selecionado._transportadoras.map((t) => (
                            <Badge
                              key={t.id}
                              variant="outline"
                              className="gap-1"
                            >
                              <Truck className="h-3 w-3" />
                              {t.nome}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Nenhuma definida
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg bg-muted/25 px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">
                        Limite de pesagem
                      </p>
                      <p className="mt-1 font-medium">
                        {selecionado.sem_limite ? (
                          <span className="inline-flex items-center gap-1.5 text-sky-700">
                            <InfinityIcon className="h-4 w-4" />
                            Sem limite
                          </span>
                        ) : (
                          formatKg(selecionado.saldo_kg || 0)
                        )}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="border-t pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Tickets vinculados
                    </p>
                    <Badge variant="outline">
                      {ticketsSelecionado.length}
                    </Badge>
                  </div>

                  {ticketsSelecionado.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Nenhum ticket vinculado.
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-auto rounded-xl border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/35">
                          <tr>
                            <th className="px-2.5 py-2 text-left">
                              Ticket
                            </th>
                            <th className="px-2.5 py-2 text-left">
                              Placa
                            </th>
                            <th className="px-2.5 py-2 text-right">
                              Líquido
                            </th>
                            <th className="px-2.5 py-2 text-center">
                              Status
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {ticketsSelecionado.map((ticket) => (
                            <tr
                              key={ticket.id}
                              className="border-t"
                            >
                              <td className="px-2.5 py-2 font-mono font-semibold">
                                {ticket.numero}
                              </td>
                              <td className="px-2.5 py-2 font-mono">
                                {formatPlaca(ticket.placa)}
                              </td>
                              <td className="px-2.5 py-2 text-right tabular-nums">
                                {ticket.peso_liquido
                                  ? formatQtd(ticket.peso_liquido)
                                  : '—'}
                              </td>
                              <td className="px-2.5 py-2 text-center">
                                <Badge
                                  variant="outline"
                                  className={
                                    ticket.status === 'fechado'
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-700'
                                  }
                                >
                                  {ticket.status === 'fechado'
                                    ? 'Concluído'
                                    : 'Em aberto'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {ticketsAbertosSelecionado.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      Há {ticketsAbertosSelecionado.length} ticket(s) em aberto vinculado(s) a este pedido.
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
        </Card>
      </div>

      <PedidoFormDialog
        open={formOpen}
        pedido={editando}
        duplicarDe={duplicando}
        tickets={tickets}
        pedidos={pedidos}
        pessoas={pessoas}
        produtos={produtos}
        transportadoras={transportadoras}
        onClose={() => {
          setFormOpen(false);
          setEditando(null);
          setDuplicando(null);
        }}
        onSaved={async () => {
          setFormOpen(false);
          setEditando(null);
          setDuplicando(null);
          await onReload?.();
        }}
      />

      <AlertDialog
        open={!!cancelando}
        onOpenChange={(open) => {
          if (!open) setCancelando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar pedido de venda?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelando
                ? `O pedido ${cancelando.numero || ''} deixará de ficar disponível para novos tickets de venda. Os tickets já concluídos permanecem no histórico.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>
              Voltar
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={cancelarPedido}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? 'Cancelando...' : 'Cancelar pedido'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
