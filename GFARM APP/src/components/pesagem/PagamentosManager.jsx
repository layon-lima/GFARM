import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Eye,
  Pencil,
  Plus,
  Search,
  Trash2,
  WalletCards,
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
import { useToast } from '@/components/ui/use-toast';
import { safeDelete } from '@/lib/entityOps';
import { formatMoeda, round3 } from '@/lib/pesagem';
import { formatQtd } from '@/lib/format';
import PagamentoFormDialog from './PagamentoFormDialog';

const PAGE_SIZE = 10;

const FORMA_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  cartao: 'Cartão',
  cheque: 'Cheque',
  outro: 'Outro',
};

const STATUS = {
  sem_pagamento: {
    label: 'Sem pagamento',
    className: 'border-slate-200 bg-slate-100 text-slate-700',
  },
  parcial: {
    label: 'Parcial',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  pago: {
    label: 'Pago',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
};

function formatData(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function valorPesadoDoPedido(pedido, tickets) {
  const pesoSaca = Number(pedido.peso_saca_kg) || 0;
  const valorSaca = Number(pedido.valor_saca) || 0;

  const liquidoKg = (tickets || [])
    .filter(
      (ticket) =>
        ticket.pedido_id === pedido.id &&
        ticket.status === 'fechado'
    )
    .reduce(
      (sum, ticket) =>
        sum + (Number(ticket.peso_liquido) || 0),
      0
    );

  if (!(pesoSaca > 0) || !(valorSaca > 0)) return 0;

  return round3((liquidoKg / pesoSaca) * valorSaca);
}

function valorFinanceiroPedido(pedido, tickets) {
  const contratado = Number(pedido.valor_total) || 0;

  if (!pedido.sem_limite && contratado > 0) {
    return contratado;
  }

  return valorPesadoDoPedido(pedido, tickets);
}

function totalPagoPedido(pedidoId, pagamentos) {
  return round3(
    (pagamentos || [])
      .filter((pagamento) => pagamento.pedido_id === pedidoId)
      .reduce(
        (sum, pagamento) =>
          sum + (Number(pagamento.valor) || 0),
        0
      )
  );
}

function statusPagamento(valorPedido, totalPago) {
  const total = Number(valorPedido) || 0;
  const pago = Number(totalPago) || 0;

  if (!(pago > 0)) return 'sem_pagamento';
  if (total > 0 && pago + 0.005 < total) return 'parcial';
  return 'pago';
}

export default function PagamentosManager({
  pagamentos = [],
  pedidos = [],
  pessoas = [],
  produtos = [],
  tickets = [],
  onReload,
}) {
  const { toast } = useToast();

  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [clienteFiltro, setClienteFiltro] = useState('all');
  const [produtoFiltro, setProdutoFiltro] = useState('all');
  const [pagina, setPagina] = useState(1);
  const [selecionadoId, setSelecionadoId] = useState('');
  const [painelTab, setPainelTab] = useState('pagamentos');

  const [formOpen, setFormOpen] = useState(false);
  const [pedidoInicialId, setPedidoInicialId] = useState('');
  const [editando, setEditando] = useState(null);
  const [excluir, setExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);

  const clienteNome = (id) =>
    pessoas.find((p) => p.id === id)?.nome || '—';

  const produtoNome = (id) =>
    produtos.find((p) => p.id === id)?.nome || '—';

  const pedidosFinanceiros = useMemo(
    () =>
      pedidos.map((pedido) => {
        const valorPedido = valorFinanceiroPedido(
          pedido,
          tickets
        );

        const recebido = totalPagoPedido(
          pedido.id,
          pagamentos
        );

        const saldo = round3(
          Math.max(0, valorPedido - recebido)
        );

        const status = statusPagamento(
          valorPedido,
          recebido
        );

        return {
          ...pedido,
          _valorPedido: valorPedido,
          _recebido: recebido,
          _saldoFinanceiro: saldo,
          _statusPagamento: status,
        };
      }),
    [pedidos, tickets, pagamentos]
  );

  const counts = useMemo(
    () => ({
      todos: pedidosFinanceiros.length,
      sem_pagamento: pedidosFinanceiros.filter(
        (p) => p._statusPagamento === 'sem_pagamento'
      ).length,
      parcial: pedidosFinanceiros.filter(
        (p) => p._statusPagamento === 'parcial'
      ).length,
      pago: pedidosFinanceiros.filter(
        (p) => p._statusPagamento === 'pago'
      ).length,
    }),
    [pedidosFinanceiros]
  );

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();

    return [...pedidosFinanceiros]
      .filter((pedido) => {
        if (
          statusFiltro !== 'todos' &&
          pedido._statusPagamento !== statusFiltro
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

        if (!q) return true;

        return [
          pedido.numero,
          clienteNome(pedido.cliente_id),
          produtoNome(pedido.produto_id),
          pedido.observacao,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort(
        (a, b) =>
          new Date(b.created_date || 0) -
          new Date(a.created_date || 0)
      );
  }, [
    pedidosFinanceiros,
    busca,
    statusFiltro,
    clienteFiltro,
    produtoFiltro,
    pessoas,
    produtos,
  ]);

  const resumo = useMemo(() => {
    const valorPedidos = round3(
      filtrados.reduce(
        (sum, pedido) =>
          sum + (Number(pedido._valorPedido) || 0),
        0
      )
    );

    const recebido = round3(
      filtrados.reduce(
        (sum, pedido) =>
          sum + (Number(pedido._recebido) || 0),
        0
      )
    );

    return {
      valorPedidos,
      recebido,
      saldo: round3(Math.max(0, valorPedidos - recebido)),
    };
  }, [filtrados]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(filtrados.length / PAGE_SIZE)
  );

  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const paginaRows = filtrados.slice(
    inicio,
    inicio + PAGE_SIZE
  );

  const selecionado =
    pedidosFinanceiros.find(
      (pedido) => pedido.id === selecionadoId
    ) ||
    paginaRows[0] ||
    null;

  const pagamentosSelecionado = useMemo(() => {
    if (!selecionado) return [];

    return pagamentos
      .filter(
        (pagamento) =>
          pagamento.pedido_id === selecionado.id
      )
      .sort(
        (a, b) =>
          new Date(b.data_pagamento || 0) -
          new Date(a.data_pagamento || 0)
      );
  }, [pagamentos, selecionado?.id]);

  const ticketsSelecionado = useMemo(() => {
    if (!selecionado) return [];

    return tickets
      .filter(
        (ticket) =>
          ticket.pedido_id === selecionado.id
      )
      .sort(
        (a, b) =>
          new Date(b.data_abertura || 0) -
          new Date(a.data_abertura || 0)
      );
  }, [tickets, selecionado?.id]);

  function selecionarPedido(pedido) {
    setSelecionadoId(pedido.id);
    setPainelTab('pagamentos');
  }

  function registrarPagamento(pedido) {
    if (!pedido || pedido.status === 'cancelado') {
      toast({
        variant: 'destructive',
        title: 'Pedido cancelado',
        description:
          'Não é possível registrar novo pagamento em um pedido cancelado.',
      });
      return;
    }

    setEditando(null);
    setPedidoInicialId(pedido.id);
    setFormOpen(true);
  }

  function novoPagamento() {
    setEditando(null);
    setPedidoInicialId(selecionado?.id || '');
    setFormOpen(true);
  }

  function editarPagamento(pagamento) {
    setPedidoInicialId('');
    setEditando(pagamento);
    setFormOpen(true);
  }

  async function handleExcluir() {
    if (!excluir) return;

    setExcluindo(true);

    try {
      await safeDelete('Pagamento', excluir.id);

      toast({
        title: 'Pagamento excluído',
        description: excluir.numero || '',
      });

      setExcluir(null);
      await onReload?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir pagamento',
        description: String(error?.message || error),
      });
    } finally {
      setExcluindo(false);
    }
  }

  function limparFiltros() {
    setBusca('');
    setStatusFiltro('todos');
    setClienteFiltro('all');
    setProdutoFiltro('all');
    setPagina(1);
  }

  const statusSelecionado = selecionado
    ? STATUS[selecionado._statusPagamento]
    : null;

  const percentualRecebido =
    resumo.valorPedidos > 0
      ? Math.min(
          100,
          (resumo.recebido / resumo.valorPedidos) * 100
        )
      : 0;

  const percentualSaldo =
    resumo.valorPedidos > 0
      ? Math.max(
          0,
          100 - percentualRecebido
        )
      : 0;

  return (
    <div className="pesagem-pagamentos-workspace space-y-3">
      <div className="pesagem-finance-summary grid gap-3 md:grid-cols-3">
        <Card className="pesagem-finance-kpi rounded-2xl border p-4 shadow-none">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <WalletCards className="h-5 w-5" />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Valor dos Pedidos
              </p>
              <p className="mt-1 text-2xl font-bold">
                {formatMoeda(resumo.valorPedidos)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {filtrados.length} pedido(s) exibido(s)
              </p>
            </div>
          </div>
        </Card>

        <Card className="pesagem-finance-kpi rounded-2xl border p-4 shadow-none">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Total Recebido
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">
                {formatMoeda(resumo.recebido)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {percentualRecebido.toLocaleString('pt-BR', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}% do valor exibido
              </p>
            </div>
          </div>
        </Card>

        <Card className="pesagem-finance-kpi rounded-2xl border p-4 shadow-none">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <CircleDollarSign className="h-5 w-5" />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Saldo a Receber
              </p>
              <p className="mt-1 text-2xl font-bold text-amber-700">
                {formatMoeda(resumo.saldo)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {percentualSaldo.toLocaleString('pt-BR', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}% do valor exibido
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="pesagem-manager-filters rounded-2xl border p-3 shadow-none">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap gap-2">
            {[
              ['todos', 'Todos'],
              ['sem_pagamento', 'Sem pagamento'],
              ['parcial', 'Parcial'],
              ['pago', 'Pago'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setStatusFiltro(key);
                  setPagina(1);
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  statusFiltro === key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent'
                }`}
              >
                {label} ({counts[key]})
              </button>
            ))}
          </div>

          <div className="grid flex-1 gap-2 md:grid-cols-3">
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
                .sort((a, b) =>
                  a.label.localeCompare(b.label)
                )}
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
                .sort((a, b) =>
                  a.label.localeCompare(b.label)
                )}
            />

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setPagina(1);
                }}
                placeholder="Buscar pedido, cliente, produto..."
                className="h-9 pl-9"
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={limparFiltros}
            className="text-muted-foreground"
          >
            Limpar
          </Button>
        </div>
      </Card>

      <div className="pesagem-manager-split grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card className="pesagem-manager-list overflow-hidden rounded-2xl border shadow-none">
          <div className="flex items-center justify-between border-b bg-muted/15 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">
                Pedidos ({filtrados.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Gestão financeira dos pedidos de venda.
              </p>
            </div>

            <Button
              size="sm"
              onClick={novoPagamento}
              disabled={!selecionado}
            >
              <Plus className="mr-2 h-4 w-4" />
              Registrar Pagamento
            </Button>
          </div>

          {filtrados.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              Nenhum pedido encontrado.
            </div>
          ) : (
            <>
              <div className="pesagem-manager-table overflow-auto">
                <table className="min-w-[1050px] w-full text-xs">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Pedido</th>
                      <th className="px-3 py-2.5 text-left">Cliente</th>
                      <th className="px-3 py-2.5 text-left">Produto</th>
                      <th className="px-3 py-2.5 text-right">Qtd. (kg)</th>
                      <th className="px-3 py-2.5 text-right">Valor do Pedido</th>
                      <th className="px-3 py-2.5 text-right">Recebido</th>
                      <th className="px-3 py-2.5 text-right">Saldo</th>
                      <th className="px-3 py-2.5 text-center">Status</th>
                      <th className="w-24 px-3 py-2.5 text-center">Ações</th>
                    </tr>
                  </thead>

                  <tbody>
                    {paginaRows.map((pedido) => {
                      const status =
                        STATUS[pedido._statusPagamento];

                      const selected =
                        pedido.id === selecionado?.id;

                      return (
                        <tr
                          key={pedido.id}
                          onClick={() => selecionarPedido(pedido)}
                          className={`cursor-pointer border-t transition-colors ${
                            selected
                              ? 'bg-primary/5'
                              : 'hover:bg-muted/30'
                          }`}
                        >
                          <td className="px-3 py-2.5 font-mono font-semibold text-primary">
                            {pedido.numero || '—'}
                          </td>

                          <td className="max-w-[200px] truncate px-3 py-2.5 font-medium">
                            {clienteNome(pedido.cliente_id)}
                          </td>

                          <td className="max-w-[170px] truncate px-3 py-2.5">
                            {produtoNome(pedido.produto_id)}
                          </td>

                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {pedido.sem_limite
                              ? 'Sem limite'
                              : formatQtd(pedido.total_kg || 0)}
                          </td>

                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                            {formatMoeda(pedido._valorPedido)}
                          </td>

                          <td className="px-3 py-2.5 text-right font-medium tabular-nums text-emerald-700">
                            {formatMoeda(pedido._recebido)}
                          </td>

                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                            {formatMoeda(pedido._saldoFinanceiro)}
                          </td>

                          <td className="px-3 py-2.5 text-center">
                            <Badge
                              variant="outline"
                              className={status.className}
                            >
                              {status.label}
                            </Badge>
                          </td>

                          <td
                            className="px-3 py-2.5 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Ver pedido"
                                onClick={() => selecionarPedido(pedido)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-primary"
                                title="Registrar pagamento"
                                onClick={() =>
                                  registrarPagamento(pedido)
                                }
                              >
                                <CircleDollarSign className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pesagem-manager-footer flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Exibindo {paginaRows.length} de {filtrados.length} pedido(s)
                </p>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={paginaAtual <= 1}
                    onClick={() =>
                      setPagina((prev) =>
                        Math.max(1, prev - 1)
                      )
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
            <div className="py-16 text-center text-sm text-muted-foreground">
              Selecione um pedido para ver os pagamentos.
            </div>
          ) : (
            <>
              <div className="border-b bg-muted/15 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xl font-bold">
                      {selecionado.numero || 'Pedido'}
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {clienteNome(selecionado.cliente_id)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {produtoNome(selecionado.produto_id)}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={statusSelecionado.className}
                  >
                    {statusSelecionado.label}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Quantidade
                    </p>
                    <p className="mt-1 font-semibold">
                      {selecionado.sem_limite
                        ? 'Sem limite'
                        : `${formatQtd(selecionado.total_kg || 0)} kg`}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Valor do Pedido
                    </p>
                    <p className="mt-1 font-semibold">
                      {formatMoeda(selecionado._valorPedido)}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Recebido
                    </p>
                    <p className="mt-1 font-semibold text-emerald-700">
                      {formatMoeda(selecionado._recebido)}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Saldo
                    </p>
                    <p className="mt-1 font-semibold">
                      {formatMoeda(selecionado._saldoFinanceiro)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="mb-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPainelTab('pagamentos')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      painelTab === 'pagamentos'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`}
                  >
                    Pagamentos ({pagamentosSelecionado.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setPainelTab('tickets')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      painelTab === 'tickets'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`}
                  >
                    Tickets ({ticketsSelecionado.length})
                  </button>
                </div>

                {painelTab === 'pagamentos' ? (
                  pagamentosSelecionado.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                      Nenhum pagamento registrado para este pedido.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-auto rounded-xl border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/35">
                          <tr>
                            <th className="px-2.5 py-2 text-left">Data</th>
                            <th className="px-2.5 py-2 text-right">Valor</th>
                            <th className="px-2.5 py-2 text-left">Forma</th>
                            <th className="w-16 px-2.5 py-2"></th>
                          </tr>
                        </thead>

                        <tbody>
                          {pagamentosSelecionado.map(
                            (pagamento) => (
                              <tr
                                key={pagamento.id}
                                className="border-t"
                              >
                                <td className="px-2.5 py-2">
                                  {formatData(
                                    pagamento.data_pagamento
                                  )}
                                </td>

                                <td className="px-2.5 py-2 text-right font-semibold text-emerald-700">
                                  {formatMoeda(pagamento.valor)}
                                </td>

                                <td className="px-2.5 py-2">
                                  {FORMA_LABELS[
                                    pagamento.forma_pagamento
                                  ] ||
                                    pagamento.forma_pagamento ||
                                    '—'}
                                </td>

                                <td className="px-2.5 py-2 text-right">
                                  <div className="inline-flex">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      title="Editar pagamento"
                                      onClick={() =>
                                        editarPagamento(pagamento)
                                      }
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>

                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      title="Excluir pagamento"
                                      onClick={() =>
                                        setExcluir(pagamento)
                                      }
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : ticketsSelecionado.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                    Nenhum ticket vinculado a este pedido.
                  </div>
                ) : (
                  <div className="max-h-72 overflow-auto rounded-xl border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/35">
                        <tr>
                          <th className="px-2.5 py-2 text-left">Ticket</th>
                          <th className="px-2.5 py-2 text-left">Placa</th>
                          <th className="px-2.5 py-2 text-right">Líquido</th>
                          <th className="px-2.5 py-2 text-center">Status</th>
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
                              {ticket.placa || '—'}
                            </td>

                            <td className="px-2.5 py-2 text-right">
                              {ticket.peso_liquido
                                ? `${formatQtd(ticket.peso_liquido)} kg`
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

                <Button
                  className="mt-4 h-11 w-full"
                  onClick={() =>
                    registrarPagamento(selecionado)
                  }
                  disabled={selecionado.status === 'cancelado'}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Registrar Pagamento
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <PagamentoFormDialog
        open={formOpen}
        pagamento={editando}
        pedidoInicialId={pedidoInicialId}
        onClose={() => {
          setFormOpen(false);
          setEditando(null);
          setPedidoInicialId('');
        }}
        onSaved={async () => {
          setFormOpen(false);
          setEditando(null);
          setPedidoInicialId('');
          await onReload?.();
        }}
        pedidos={pedidos}
        pessoas={pessoas}
        tickets={tickets}
        pagamentos={pagamentos}
      />

      <AlertDialog
        open={!!excluir}
        onOpenChange={(open) => {
          if (!open) setExcluir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir pagamento?
            </AlertDialogTitle>

            <AlertDialogDescription>
              {excluir
                ? `O pagamento ${excluir.numero || ''} no valor de ${formatMoeda(excluir.valor)} será removido permanentemente.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>
              Cancelar
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={handleExcluir}
              disabled={excluindo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindo ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
