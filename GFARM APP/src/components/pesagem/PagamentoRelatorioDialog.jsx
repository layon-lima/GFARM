import { useState, useMemo } from 'react';
import { FileSpreadsheet, FileDown, Share2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import SearchSelect from '@/components/SearchSelect';
import { exportPDF, exportCSV, sharePDF } from '@/lib/exports';
import { formatMoeda, round3 } from '@/lib/pesagem';

const FORMAS = [
  { value: 'pix', label: 'Pix' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'outro', label: 'Outro' },
];

const formaLabel = (v) => FORMAS.find((f) => f.value === v)?.label || v || '—';

// Valor financeiro de um carregamento (ticket) com base no pedido vinculado.
function valorTicket(ticket, pedido) {
  if (!pedido) return 0;
  const pesoSaca = Number(pedido.peso_saca_kg) || 0;
  const valorSaca = Number(pedido.valor_saca) || 0;
  if (pesoSaca <= 0) return 0;
  const sacas = (Number(ticket.peso_liquido) || 0) / pesoSaca;
  return round3(sacas * valorSaca);
}

export default function PagamentoRelatorioDialog({ open, onClose, pagamentos, pedidos, pessoas, produtos, tickets }) {
  const { toast } = useToast();
  const [clienteId, setClienteId] = useState('all');
  const [pedidoId, setPedidoId] = useState('all');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [busy, setBusy] = useState(null); // 'pdf' | 'share' | null

  const clienteNome = (id) => pessoas.find((p) => p.id === id)?.nome || '—';
  const pedidoNumero = (id) => pedidos.find((p) => p.id === id)?.numero || '—';
  const produtoNome = (id) => produtos?.find((p) => p.id === id)?.nome || '—';

  const pedidosAtivos = useMemo(() => pedidos.filter((p) => p.status !== 'cancelado'), [pedidos]);
  // Apenas clientes que possuem pelo menos um pedido ativo
  const clientes = useMemo(() => {
    const idsComPedido = new Set(pedidosAtivos.map((p) => p.cliente_id));
    return pessoas.filter((p) => p.is_cliente && idsComPedido.has(p.id));
  }, [pessoas, pedidosAtivos]);

  // Pedidos disponíveis no combobox, filtrados dinamicamente pelo cliente selecionado
  const pedidosOptions = useMemo(() => {
    const list = clienteId === 'all' ? pedidosAtivos : pedidosAtivos.filter((p) => p.cliente_id === clienteId);
    return list.map((p) => ({
      value: p.id,
      label: `${p.numero ? p.numero + ' · ' : ''}${clienteNome(p.cliente_id)}`,
    }));
  }, [pedidosAtivos, clienteId, pessoas]);

  // Ao trocar o cliente, reseta o pedido se ele não pertencer ao cliente escolhido
  function handleClienteChange(v) {
    setClienteId(v);
    if (v !== 'all' && pedidoId !== 'all') {
      const belongs = pedidosAtivos.some((p) => p.id === pedidoId && p.cliente_id === v);
      if (!belongs) setPedidoId('all');
    }
  }

  // Filtra pedidos pelos critérios selecionados
  const pedidosFiltrados = useMemo(() => {
    return pedidosAtivos
      .filter((p) => {
        if (clienteId !== 'all' && p.cliente_id !== clienteId) return false;
        if (pedidoId !== 'all' && p.id !== pedidoId) return false;
        return true;
      })
      .sort((a, b) => (a.numero || '').localeCompare(b.numero || ''));
  }, [pedidosAtivos, clienteId, pedidoId]);

  // Para cada pedido, calcula carregamentos e pagamentos filtrados por data
  const dadosPorPedido = useMemo(() => {
    return pedidosFiltrados.map((ped) => {
      const carregamentos = (tickets || [])
        .filter((t) => t.pedido_id === ped.id && t.status === 'fechado')
        .filter((t) => {
          if (!t.data_fechamento) return true;
          const d = new Date(t.data_fechamento);
          if (dataInicio && d < new Date(dataInicio + 'T00:00:00')) return false;
          if (dataFim && d > new Date(dataFim + 'T23:59:59')) return false;
          return true;
        })
        .sort((a, b) => new Date(a.data_fechamento || 0) - new Date(b.data_fechamento || 0));

      const pagtos = pagamentos
        .filter((pg) => pg.pedido_id === ped.id)
        .filter((pg) => {
          if (!pg.data_pagamento) return true;
          const d = new Date(pg.data_pagamento);
          if (dataInicio && d < new Date(dataInicio + 'T00:00:00')) return false;
          if (dataFim && d > new Date(dataFim + 'T23:59:59')) return false;
          return true;
        })
        .sort((a, b) => new Date(a.data_pagamento || 0) - new Date(b.data_pagamento || 0));

      const kgCarregado = carregamentos.reduce((s, t) => s + (Number(t.peso_liquido) || 0), 0);
      const valorCarregado = carregamentos.reduce((s, t) => s + valorTicket(t, ped), 0);
      const valorPago = pagtos.reduce((s, p) => s + (Number(p.valor) || 0), 0);

      return {
        pedido: ped,
        carregamentos,
        pagamentos: pagtos,
        kgCarregado: round3(kgCarregado),
        valorCarregado: round3(valorCarregado),
        valorPago: round3(valorPago),
        saldo: round3(valorCarregado - valorPago),
      };
    });
  }, [pedidosFiltrados, tickets, pagamentos, dataInicio, dataFim]);

  // Totais gerais
  const totais = useMemo(() => {
    return dadosPorPedido.reduce(
      (acc, d) => ({
        kgCarregado: round3(acc.kgCarregado + d.kgCarregado),
        valorCarregado: round3(acc.valorCarregado + d.valorCarregado),
        valorPago: round3(acc.valorPago + d.valorPago),
      }),
      { kgCarregado: 0, valorCarregado: 0, valorPago: 0 }
    );
  }, [dadosPorPedido]);

  const fmtMoeda = (n) => formatMoeda(n);
  const fmtKg = (n) =>
    (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

  function buildReport() {
    const cols = [
      'Pedido', 'Cliente', 'Produto', 'Tipo', 'Número', 'Data',
      'Detalhe', 'Peso Líq. (kg)', 'Valor (R$)',
    ];
    const rows = [];

    dadosPorPedido.forEach((d) => {
      const { pedido: ped, carregamentos, pagamentos: pagtos } = d;
      const cliente = clienteNome(ped.cliente_id);
      const produto = produtoNome(ped.produto_id);

      // Carregamentos
      carregamentos.forEach((t) => {
        rows.push([
          ped.numero || '—',
          cliente,
          produto,
          'Carregamento',
          t.numero || '—',
          t.data_fechamento ? new Date(t.data_fechamento).toLocaleString('pt-BR') : '—',
          t.placa || '—',
          fmtKg(t.peso_liquido),
          fmtMoeda(valorTicket(t, ped)),
        ]);
      });

      // Pagamentos
      pagtos.forEach((p) => {
        rows.push([
          ped.numero || '—',
          cliente,
          produto,
          'Pagamento',
          p.numero || '—',
          p.data_pagamento ? new Date(p.data_pagamento).toLocaleString('pt-BR') : '—',
          formaLabel(p.forma_pagamento),
          '',
          fmtMoeda(p.valor),
        ]);
      });

      // Subtotal do pedido
      rows.push([
        '', '', '', 'Subtotal', '', '', '',
        fmtKg(d.kgCarregado),
        fmtMoeda(d.valorCarregado),
      ]);
      rows.push([
        '', '', '', '', '', '', 'Saldo a Receber', '',
        fmtMoeda(d.saldo),
      ]);
    });

    // Total geral
    rows.push(['', '', '', '', '', '', '', '', '']);
    rows.push([
      '', '', '', 'TOTAL GERAL', '', '', 'Carregado',
      fmtKg(totais.kgCarregado),
      fmtMoeda(totais.valorCarregado),
    ]);
    rows.push([
      '', '', '', '', '', '', 'Recebido', '',
      fmtMoeda(totais.valorPago),
    ]);
    rows.push([
      '', '', '', '', '', '', 'Pendente de Pagamento', '',
      fmtMoeda(round3(totais.valorCarregado - totais.valorPago)),
    ]);

    return { cols, rows };
  }

  function handleCSV() {
    const { cols, rows } = buildReport();
    exportCSV('Relatório de Pagamentos e Carregamentos', cols, rows);
  }
  async function handlePDF() {
    setBusy('pdf');
    try {
      const { cols, rows } = buildReport();
      await exportPDF('Relatório de Pagamentos e Carregamentos', cols, rows);
    } catch (e) {
      toast({ title: 'Erro ao gerar PDF', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }
  async function handleShare() {
    setBusy('share');
    try {
      const { cols, rows } = buildReport();
      await sharePDF('Relatório de Pagamentos e Carregamentos', cols, rows);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      toast({ title: 'Erro ao compartilhar', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  const hasData = dadosPorPedido.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Relatório de Pagamentos e Carregamentos</DialogTitle>
          <DialogDescription>
            Relatório por pedido mostrando os pesos carregados e os pagamentos realizados, com saldo a receber.
          </DialogDescription>
        </DialogHeader>

        {/* Filtros */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <SearchSelect
              value={clienteId}
              onChange={handleClienteChange}
              allLabel="Todos os clientes"
              placeholder="Buscar cliente..."
              options={clientes.map((c) => ({ value: c.id, label: c.nome }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Pedido</Label>
            <SearchSelect
              value={pedidoId}
              onChange={setPedidoId}
              allLabel="Todos os pedidos"
              placeholder="Buscar pedido..."
              options={pedidosOptions}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Data Início</Label>
            <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Data Fim</Label>
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        </div>

        {/* Botões */}
        <div className="flex gap-2 pt-1 flex-wrap">
          <Button type="button" variant="outline" className="flex-1 min-w-[110px]" onClick={onClose}>Fechar</Button>
          <Button type="button" variant="outline" className="flex-1 min-w-[110px]" onClick={handlePDF} disabled={!hasData || busy}><FileDown className="w-4 h-4 mr-2" /> {busy === 'pdf' ? 'Gerando…' : 'PDF'}</Button>
          <Button type="button" variant="outline" className="flex-1 min-w-[110px] sm:hidden" onClick={handleShare} disabled={!hasData || busy}><Share2 className="w-4 h-4 mr-2" /> {busy === 'share' ? 'Gerando…' : 'Compartilhar'}</Button>
          <Button type="button" className="flex-1 min-w-[110px] hidden sm:flex" onClick={handleCSV} disabled={!hasData}><FileSpreadsheet className="w-4 h-4 mr-2" /> Excel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}