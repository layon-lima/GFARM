import { useState, useMemo } from 'react';
import { Plus, FileSpreadsheet, FileDown, Search, CircleDot, CheckCircle2, Link2, Unlink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { api } from '@/api/apiClient';
import { safeDelete, isNotFoundError } from '@/lib/entityOps';
import { useToast } from '@/components/ui/use-toast';
import { formatQtd } from '@/lib/format';
import { formatPlaca, formatKg, round3, statusPorSaldo, normalizePlaca } from '@/lib/pesagem';
import { exportPDF, exportCSV } from '@/lib/exports';
import SearchSelect from '@/components/SearchSelect';
import TicketColumnsManager, { DEFAULT_ORDER, DEFAULT_VISIBLE, COLUMN_LABELS } from './TicketColumnsManager';
import { usePersistentState } from '@/hooks/usePersistentState';
import AberturaTicketDialog from './AberturaTicketDialog';
import FechamentoTicketDialog from './FechamentoTicketDialog';
import TicketDetalheDialog from './TicketDetalheDialog';
import VincularTicketDialog from './VincularTicketDialog';
import NfeBadge from './NfeBadge';

const TIPO_LABEL = { venda: 'Venda', lavoura: 'Lavoura', compra: 'Compra', entrada_saida: 'Ent/Saída' };

export default function TicketsManager({ tickets, pedidos, pessoas, produtos, transportadoras, onReload, mode = 'ativos', isAdmin }) {
  const historico = mode === 'historico';
  const naovinculados = mode === 'naovinculados';
  const [busca, setBusca] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [pedidoFiltro, setPedidoFiltro] = useState('all');
  const [placaFiltro, setPlacaFiltro] = useState('all');
  const [produtoFiltro, setProdutoFiltro] = useState('all');
  const [clienteFiltro, setClienteFiltro] = useState('all');
  const [tipoFiltro, setTipoFiltro] = useState('all');
  const [fecharTicket, setFecharTicket] = useState(null);
  const [formAberto, setFormAberto] = useState(false);
  const [detalheTicket, setDetalheTicket] = useState(null);
  const [vincularTicket, setVincularTicket] = useState(null);
  const [excluirTicket, setExcluirTicket] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const { toast } = useToast();

  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const produtoNome = (id) => produtos.find((p) => p.id === id)?.nome || '—';
  const pedidoDoTicket = (id) => pedidos.find((p) => p.id === id);
  const produtoDoTicket = (t) => t.produto_id ? produtoNome(t.produto_id) : (t.tipo === 'venda' ? 'A definir' : '—');

  const [colOrder, setColOrder] = usePersistentState('tickets_col_order', DEFAULT_ORDER);
  const [colVisible, setColVisible] = usePersistentState('tickets_col_visible', DEFAULT_VISIBLE);

  const visibleCols = colOrder.filter((k) => colVisible[k]);

  const COL_ALIGN = {
    tara: 'right', bruto: 'right', liquido: 'right',
    nf: 'center', status: 'center',
  };

  const thClass = (key) => {
    const a = COL_ALIGN[key];
    if (a === 'right') return 'p-2 font-medium text-right whitespace-nowrap';
    if (a === 'center') return 'p-2 font-medium text-center whitespace-nowrap';
    return 'p-2 font-medium text-left whitespace-nowrap';
  };

  const tdClass = (key) => {
    const a = COL_ALIGN[key];
    if (a === 'right') return 'p-2 text-right whitespace-nowrap';
    if (a === 'center') return 'p-2 text-center whitespace-nowrap';
    return 'p-2 whitespace-nowrap';
  };

  const renderCell = (key, t, ped) => {
    switch (key) {
      case 'produto': return <span className="text-xs">{produtoDoTicket(t)}</span>;
      case 'tipo': return <Badge variant="outline" className="text-[10px] py-0 px-1.5">{TIPO_LABEL[t.tipo] || t.tipo}</Badge>;
      case 'abertura': return <span className="text-xs whitespace-nowrap">{t.data_abertura ? new Date(t.data_abertura).toLocaleString('pt-BR') : '—'}</span>;
      case 'fechamento': return <span className="text-xs whitespace-nowrap">{t.data_fechamento ? new Date(t.data_fechamento).toLocaleString('pt-BR') : '—'}</span>;
      case 'motorista': return t.motorista;
      case 'placa': return <span className="font-mono">{formatPlaca(t.placa)}</span>;
      case 'tara': return formatQtd(t.peso_tara || 0);
      case 'bruto': return t.peso_bruto ? formatQtd(t.peso_bruto) : '—';
      case 'liquido': return <span className="font-semibold">{t.peso_liquido ? formatQtd(t.peso_liquido) : '—'}</span>;
      case 'pedido': return ped ? (
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-mono font-semibold">{ped.numero}</span>
          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{clienteNome(ped.cliente_id)}</span>
        </div>
      ) : <span className="text-xs text-muted-foreground">—</span>;
      case 'cliente': return <span className="text-xs">{ped ? clienteNome(ped.cliente_id) : '—'}</span>;
      case 'nf': return <NfeBadge ticket={t} size="xs" />;
      case 'status': return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="w-3 h-3" /> Fechado</Badge>;
      default: return null;
    }
  };

  const exportColVal = (key, t, ped) => {
    switch (key) {
      case 'produto': return produtoDoTicket(t);
      case 'tipo': return TIPO_LABEL[t.tipo] || t.tipo || '';
      case 'abertura': return t.data_abertura ? new Date(t.data_abertura).toLocaleString('pt-BR') : '';
      case 'fechamento': return t.data_fechamento ? new Date(t.data_fechamento).toLocaleString('pt-BR') : '';
      case 'motorista': return t.motorista || '';
      case 'placa': return formatPlaca(t.placa);
      case 'tara': return formatQtd(t.peso_tara || 0);
      case 'bruto': return formatQtd(t.peso_bruto || 0);
      case 'liquido': return formatQtd(t.peso_liquido || 0);
      case 'pedido': return ped ? ped.numero : '';
      case 'cliente': return ped ? clienteNome(ped.cliente_id) : '';
      case 'nf': return t.nfe_importada ? (t.nfe_numero ? `Sim - ${t.nfe_numero}` : 'Sim') : 'Não';
      case 'status': return t.status;
      default: return '';
    }
  };

  const placasUnicas = useMemo(() => {
    const set = new Set();
    tickets.forEach((t) => { if (t.status !== 'aberto' && t.placa) set.add(t.placa); });
    return Array.from(set).sort();
  }, [tickets]);

  const pedidosComTicket = useMemo(() => {
    const ids = new Set();
    tickets.filter((t) => t.status !== 'aberto' && t.pedido_id).forEach((t) => ids.add(t.pedido_id));
    return pedidos.filter((p) => ids.has(p.id));
  }, [tickets, pedidos]);

  const produtosComTicket = useMemo(() => {
    const ids = new Set();
    tickets.filter((t) => t.status !== 'aberto').forEach((t) => {
      const ped = pedidoDoTicket(t.pedido_id);
      const pid = t.produto_id || (ped ? ped.produto_id : '');
      if (pid) ids.add(pid);
    });
    return produtos.filter((p) => ids.has(p.id));
  }, [tickets, produtos]);

  const clientesComTicket = useMemo(() => {
    const ids = new Set();
    tickets.filter((t) => t.status !== 'aberto').forEach((t) => {
      const ped = pedidoDoTicket(t.pedido_id);
      if (ped?.cliente_id) ids.add(ped.cliente_id);
    });
    return pessoas.filter((p) => ids.has(p.id));
  }, [tickets, pessoas]);

  const tiposComTicket = useMemo(() => {
    const set = new Set();
    tickets.forEach((t) => { if (t.tipo) set.add(t.tipo); });
    return Array.from(set);
  }, [tickets]);

  const abertos = useMemo(
    () => tickets.filter((t) => t.status === 'aberto').sort((a, b) => new Date(b.data_abertura) - new Date(a.data_abertura)),
    [tickets]
  );

  const naoVinculados = useMemo(
    () => tickets.filter((t) => t.status === 'fechado' && t.tipo === 'venda' && !t.pedido_id).sort((a, b) => new Date(b.data_abertura) - new Date(a.data_abertura)),
    [tickets]
  );

  const filtrados = useMemo(() => {
    if (naovinculados) {
      const q = busca.toLowerCase().trim();
      if (!q) return naoVinculados;
      return naoVinculados.filter((t) => [t.numero, t.motorista, t.placa].filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    const q = busca.toLowerCase().trim();
    const base = tickets.filter((t) => t.status !== 'aberto');
    const matchBusca = (t) => {
      if (!q) return true;
      const ped = pedidoDoTicket(t.pedido_id);
      return [t.numero, t.motorista, t.placa, ped ? clienteNome(ped.cliente_id) : ''].filter(Boolean).join(' ').toLowerCase().includes(q);
    };
    const matchFiltros = (t) => {
      const dataRef = t.data_fechamento || t.data_abertura;
      if (dataInicio && dataRef && new Date(dataRef) < new Date(dataInicio + 'T00:00:00')) return false;
      if (dataFim && dataRef && new Date(dataRef) > new Date(dataFim + 'T23:59:59')) return false;
      if (pedidoFiltro !== 'all' && t.pedido_id !== pedidoFiltro) return false;
      if (placaFiltro !== 'all' && normalizePlaca(t.placa) !== normalizePlaca(placaFiltro)) return false;
      if (produtoFiltro !== 'all') {
        const ped = pedidoDoTicket(t.pedido_id);
        const pid = t.produto_id || (ped ? ped.produto_id : '');
        if (pid !== produtoFiltro) return false;
      }
      if (clienteFiltro !== 'all') {
        const ped = pedidoDoTicket(t.pedido_id);
        const cid = ped?.cliente_id || t.cliente_id || '';
        if (cid !== clienteFiltro) return false;
      }
      if (tipoFiltro !== 'all' && t.tipo !== tipoFiltro) return false;
      return true;
    };
    if (!historico && !q) return [];
    return base.filter((t) => matchBusca(t) && matchFiltros(t)).sort((a, b) => {
      // Ordena por número do ticket (crescente), mais recentes no topo
      const numA = parseInt((a.numero || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.numero || '').replace(/\D/g, ''), 10) || 0;
      return numB - numA;
    });
  }, [tickets, busca, historico, naovinculados, naoVinculados, dataInicio, dataFim, pedidoFiltro, placaFiltro, produtoFiltro, clienteFiltro, tipoFiltro, pedidoDoTicket]);

  async function handleExcluir() {
    if (!excluirTicket) return;
    setExcluindo(true);
    try {
      // Devolve o peso líquido ao saldo do pedido vinculado, sempre que houver vínculo.
      const ped = excluirTicket.pedido_id ? pedidoDoTicket(excluirTicket.pedido_id) : null;
      if (ped) {
        const liq = Number(excluirTicket.peso_liquido) || 0;
        const novoSaldo = round3((Number(ped.saldo_kg) || 0) + liq);
        await api.entities.PedidoPesagem.update(ped.id, {
          saldo_kg: novoSaldo,
          status: statusPorSaldo(novoSaldo, ped.total_kg, ped.status),
        }).catch((e) => { if (!isNotFoundError(e)) throw e; });
      }
      await safeDelete('TicketPesagem', excluirTicket.id);
      toast({ title: 'Ticket excluído', description: ped ? 'Saldo do pedido restaurado.' : excluirTicket.numero });
      setExcluirTicket(null);
      onReload();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao excluir', description: String(err?.message || err) });
    } finally {
      setExcluindo(false);
    }
  }

  // Relatório de tickets: conjunto FIXO e completo, independente das colunas
  // selecionadas na lista e do tipo de pesagem (venda/lavoura/compra/entrada_saida).
  const transportadoraNomeDoTicket = (t) => {
    if (t.transportadora_nome) return t.transportadora_nome;
    if (t.transportadora_id) {
      const tr = transportadoras.find((p) => p.id === t.transportadora_id);
      if (tr) return tr.nome;
    }
    return '—';
  };
  const clienteNomeDoTicket = (t, ped) => {
    if (t.tipo === 'venda' && ped) return clienteNome(ped.cliente_id);
    if (t.cliente_nome) return t.cliente_nome;
    if (t.cliente_id) return clienteNome(t.cliente_id);
    return '—';
  };
  const produtoNomeDoTicket = (t, ped) => {
    if (t.produto_id) return produtoNome(t.produto_id);
    if (ped && ped.produto_id) return produtoNome(ped.produto_id);
    return t.tipo === 'venda' ? 'A definir' : '—';
  };

  const REPORT_COLS = [
    'Ticket', 'Tipo', 'Produto', 'Cliente', 'Transportadora',
    'Abertura', 'Fechamento', 'Motorista', 'Placa', 'Origem', 'Destino',
    'Tara', 'Bruto', 'Líquido', 'Pedido', 'NF', 'Observação', 'Status',
  ];

  function buildRows() {
    return filtrados.map((t) => {
      const ped = pedidoDoTicket(t.pedido_id);
      return [
        t.numero || '',
        TIPO_LABEL[t.tipo] || t.tipo || '',
        produtoNomeDoTicket(t, ped),
        clienteNomeDoTicket(t, ped),
        transportadoraNomeDoTicket(t),
        t.data_abertura ? new Date(t.data_abertura).toLocaleString('pt-BR') : '',
        t.data_fechamento ? new Date(t.data_fechamento).toLocaleString('pt-BR') : '',
        t.motorista || '',
        formatPlaca(t.placa),
        t.origem || '',
        t.destino || '',
        formatQtd(t.peso_tara || 0),
        formatQtd(t.peso_bruto || 0),
        formatQtd(t.peso_liquido || 0),
        ped ? ped.numero : '',
        t.nfe_importada ? (t.nfe_numero ? `Sim - ${t.nfe_numero}` : 'Sim') : 'Não',
        t.observacao || '',
        t.status || '',
      ];
    });
  }
  function handleExportPDF() { exportPDF('Relatório de Tickets de Pesagem', REPORT_COLS, buildRows()); }
  function handleExportCSV() { exportCSV('Relatório de Tickets de Pesagem', REPORT_COLS, buildRows()); }

  const semBusca = !busca.trim();

  return (
    <div className="space-y-4">
      {/* Botão de abertura */}
      {!historico && !naovinculados && (
        <Button onClick={() => setFormAberto(true)} className="w-full">
          <Plus className="w-4 h-4 mr-2" /> Abrir Novo Ticket
        </Button>
      )}

      {/* Tickets abertos em destaque */}
      {!historico && !naovinculados && abertos.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><CircleDot className="w-4 h-4 text-amber-500" /> Abertos ({abertos.length})</h3>
          <div className="space-y-2 max-h-[40vh] overflow-auto scrollbar-thin pr-1">
            {abertos.map((t) => (
              <Card key={t.id} className="p-3 border-amber-300 bg-amber-50/60">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setDetalheTicket(t)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-xs">{t.numero}</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5">{TIPO_LABEL[t.tipo] || t.tipo}</Badge>
                      <NfeBadge ticket={t} size="xs" />
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-white border">{formatPlaca(t.placa)}</span>
                      <span className="font-medium text-sm truncate">{t.motorista}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1 gap-2">
                      <span className="text-xs text-muted-foreground truncate min-w-0">
                        {produtoDoTicket(t)} · Tara: <span className="font-semibold text-foreground">{formatKg(t.peso_tara)}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{t.data_abertura ? new Date(t.data_abertura).toLocaleString('pt-BR') : ''}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => setFecharTicket(t)}>Fechar</Button>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setExcluirTicket(t)} title="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Busca / Histórico */}
      <div className="space-y-2">
        {naovinculados && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Unlink className="w-4 h-4" />
            <span>Tickets de venda fechados sem pedido vinculado ({naoVinculados.length}).</span>
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={naovinculados ? 'Buscar ticket, motorista ou placa...' : 'Buscar ticket, motorista, placa ou cliente...'} className="pl-9 h-9" />
        </div>

        {historico && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Data Início</span>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Data Fim</span>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Placa</span>
              <SearchSelect value={placaFiltro} onChange={setPlacaFiltro} allLabel="Todas" placeholder="Placa..." options={placasUnicas.map((p) => ({ value: p, label: formatPlaca(p) }))} />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Pedido</span>
              <SearchSelect value={pedidoFiltro} onChange={setPedidoFiltro} allLabel="Todos" placeholder="Pedido..." options={pedidosComTicket.map((p) => ({ value: p.id, label: p.numero || '—' }))} />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Produto</span>
              <SearchSelect value={produtoFiltro} onChange={setProdutoFiltro} allLabel="Todos" placeholder="Produto..." options={produtosComTicket.map((p) => ({ value: p.id, label: p.nome }))} />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Cliente</span>
              <SearchSelect value={clienteFiltro} onChange={setClienteFiltro} allLabel="Todos" placeholder="Cliente..." options={clientesComTicket.map((p) => ({ value: p.id, label: p.nome }))} />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Tipo</span>
              <SearchSelect value={tipoFiltro} onChange={setTipoFiltro} allLabel="Todos" placeholder="Tipo..." options={tiposComTicket.map((tp) => ({ value: tp, label: TIPO_LABEL[tp] || tp }))} />
            </div>
          </div>
        )}

        {historico && (
          <div className="hidden sm:flex gap-2 items-center">
            <TicketColumnsManager
              order={colOrder}
              visible={colVisible}
              onReorder={setColOrder}
              onToggle={(key, val) => setColVisible((prev) => ({ ...prev, [key]: val }))}
            />
            <Button variant="outline" size="sm" className="flex-1 h-8" onClick={handleExportPDF} disabled={filtrados.length === 0}><FileDown className="w-3.5 h-3.5 mr-1.5" /> PDF</Button>
            <Button size="sm" className="flex-1 h-8" onClick={handleExportCSV} disabled={filtrados.length === 0}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Excel</Button>
          </div>
        )}

        {/* Mobile: cards */}
        <div className="sm:hidden max-h-[44vh] overflow-auto scrollbar-thin space-y-2 pr-1">
          {filtrados.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {naovinculados ? 'Nenhuma venda fechada sem pedido.' : historico ? 'Nenhum ticket fechado.' : semBusca ? 'Use a busca para encontrar tickets fechados.' : 'Nenhum ticket encontrado.'}
            </p>
          ) : filtrados.map((t) => {
            const ped = pedidoDoTicket(t.pedido_id);
            return (
              <Card key={t.id} className="p-3 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setDetalheTicket(t)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-xs">{t.numero}</span>
                  <div className="flex items-center gap-1.5">
                    <NfeBadge ticket={t} size="xs" />
                    {naovinculados && isAdmin && (
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setVincularTicket(t); }}>
                        <Link2 className="w-3.5 h-3.5 mr-1" /> Vincular
                      </Button>
                    )}
                    <Badge variant="secondary" className="gap-1 text-[10px]"><CheckCircle2 className="w-3 h-3" /> Fechado</Badge>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="font-medium truncate">{t.motorista}</span>
                  <span className="text-xs font-mono text-muted-foreground">{formatPlaca(t.placa)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Tara <b className="text-foreground">{formatKg(t.peso_tara)}</b></span>
                  {t.peso_liquido ? <span>Líq. <b className="text-foreground">{formatKg(t.peso_liquido)}</b></span> : null}
                  <span className="truncate">{ped ? clienteNome(ped.cliente_id) : ''}</span>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Desktop: tabela */}
        {filtrados.length === 0 ? (
          <p className="hidden sm:block text-sm text-muted-foreground text-center py-6">
            {naovinculados ? 'Nenhuma venda fechada sem pedido.' : historico ? 'Nenhum ticket fechado.' : semBusca ? 'Use a busca para encontrar tickets fechados.' : 'Nenhum ticket encontrado.'}
          </p>
        ) : (
          <div className="hidden sm:block rounded-lg border overflow-auto scrollbar-thin max-h-[50vh]">
            <table className="min-w-full w-auto text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">Ticket</th>
                  {visibleCols.map((k) => (
                    <th key={k} className={thClass(k)}>{COLUMN_LABELS[k]}</th>
                  ))}
                  {naovinculados && isAdmin && <th className="text-center p-2 font-medium">Ação</th>}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((t) => {
                  const ped = pedidoDoTicket(t.pedido_id);
                  return (
                    <tr key={t.id} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => setDetalheTicket(t)}>
                       <td className="p-2 font-mono text-xs whitespace-nowrap">{t.numero}</td>
                       {visibleCols.map((k) => (
                         <td key={k} className={tdClass(k)}>{renderCell(k, t, ped)}</td>
                       ))}
                       {naovinculados && isAdmin && (
                        <td className="p-2 text-center">
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setVincularTicket(t); }}>
                            <Link2 className="w-3.5 h-3.5 mr-1" /> Vincular
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!historico && (
        <FechamentoTicketDialog
          ticket={fecharTicket}
          pedidos={pedidos}
          pessoas={pessoas}
          produtos={produtos}
          transportadoras={transportadoras}
          tickets={tickets}
          open={!!fecharTicket}
          onClose={() => setFecharTicket(null)}
          onClosed={() => { setFecharTicket(null); onReload(); }}
          onReload={onReload}
        />
      )}

      <TicketDetalheDialog
        ticket={detalheTicket}
        pedidos={pedidos}
        pessoas={pessoas}
        produtos={produtos}
        transportadoras={transportadoras}
        onClose={() => setDetalheTicket(null)}
        onExcluir={(t) => { setDetalheTicket(null); setExcluirTicket(t); }}
        onReload={onReload}
        onTicketUpdated={(t) => setDetalheTicket(t)}
      />

      <AlertDialog open={!!excluirTicket} onOpenChange={(o) => !o && setExcluirTicket(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluirTicket && (
                <>Tem certeza que deseja excluir o ticket <b className="font-mono">{excluirTicket.numero}</b> ({excluirTicket.motorista} / {formatPlaca(excluirTicket.placa)})? Esta ação não pode ser desfeita.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleExcluir} disabled={excluindo} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {excluindo ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {naovinculados && (
        <VincularTicketDialog
          ticket={vincularTicket}
          pedidos={pedidos}
          pessoas={pessoas}
          produtos={produtos}
          transportadoras={transportadoras}
          tickets={tickets}
          onClose={() => setVincularTicket(null)}
          onDone={() => { setVincularTicket(null); onReload(); }}
        />
      )}

      {!historico && !naovinculados && (
        <AberturaTicketDialog
          open={formAberto}
          onClose={() => setFormAberto(false)}
          onReload={onReload}
          tickets={tickets}
          pessoas={pessoas}
          produtos={produtos}
          transportadoras={transportadoras}
          pedidos={pedidos}
        />
      )}
    </div>
  );
}