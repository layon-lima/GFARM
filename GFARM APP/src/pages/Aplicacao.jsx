import { useState, useMemo } from 'react';
import { Plus, FileText, Search, Sprout, DollarSign, AlertCircle, AlertTriangle, ClipboardList, CheckCircle2, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { useEntidades, invalidateEntidade } from '@/lib/useEntidades';
import { formatQtd } from '@/lib/format';
import { executarOS, parseItens, diasEmAberto, normalizarStatusAplicacao } from '@/lib/osAplicacao';
import OsAplicacaoForm from '@/components/aplicacao/OsAplicacaoForm';
import OsAplicacaoDetalhe from '@/components/aplicacao/OsAplicacaoDetalhe';
import AutobaixaDialog from '@/components/aplicacao/AutobaixaDialog';
import EdicaoMassaDialog from '@/components/aplicacao/EdicaoMassaDialog';
import CustoLavouraDialog from '@/components/aplicacao/CustoLavouraDialog';
import { gerarPDFResumoOS } from '@/lib/resumoOsPdf';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

export default function Aplicacao() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [detalheOs, setDetalheOs] = useState(null);
  const [editandoOs, setEditandoOs] = useState(null);
  const [custoLavoura, setCustoLavoura] = useState(null);
  const [busca, setBusca] = useState('');
  const [tab, setTab] = useState('pendente');
  const [novoConfirm, setNovoConfirm] = useState(false);
  const [anoSafraFiltro, setAnoSafraFiltro] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [autobaixaOpen, setAutobaixaOpen] = useState(false);
  const [autobaixaSaving, setAutobaixaSaving] = useState(false);
  const [edicaoMassaOpen, setEdicaoMassaOpen] = useState(false);
  const [edicaoMassaSaving, setEdicaoMassaSaving] = useState(false);

  const { data, loading, reload } = useEntidades({
    Cultura: {},
    Lavoura: {},
    Produto: {},
    SaldoEstoque: {},
    Lote: {},
    Deposito: {},
    Movimentacao: { sort: '-data', limit: 200 },
    OrdemServicoAplicacao: { sort: '-data', limit: 500 },
    Setor: {},
    AnoSafra: {},
  });

  const { Cultura: culturas, Lavoura: lavouras, Produto: produtos, SaldoEstoque: saldos, Lote: lotes, Deposito: depositos, Movimentacao: movimentacoes, OrdemServicoAplicacao: ordens, AnoSafra: anosSafra, Setor: setores } = data;

  const anosSafraOrdenados = useMemo(
    () => [...(anosSafra || [])].sort((a, b) => (b.nome || '').localeCompare(a.nome || '')),
    [anosSafra]
  );

  const filtered = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return (ordens || []).filter((o) => {
      if (normalizarStatusAplicacao(o.status) !== tab) return false;
      const matchBusca = !q || [o.numero, o.cultura_nome, o.lavoura_nome, o.ano_safra, o.responsavel].filter(Boolean).join(' ').toLowerCase().includes(q);
      const matchAnoSafra = anoSafraFiltro === 'all' || o.ano_safra === anoSafraFiltro;
      return matchBusca && matchAnoSafra;
    });
  }, [ordens, tab, busca, anoSafraFiltro]);

  const abertasFiltered = tab === 'pendente' ? filtered : [];

  // Lavouras com aplicações baixadas para o relatório de custo.
  const lavourasComCusto = useMemo(() => {
    return (lavouras || []).filter((l) => (ordens || []).some((o) => o.lavoura_id === l.id && normalizarStatusAplicacao(o.status) === 'baixada'));
  }, [lavouras, ordens]);

  function handleEditOs(os) {
    setDetalheOs(null);
    setEditandoOs(os);
    setFormOpen(true);
  }

  // Ao salvar (criar/editar) a OS, abre o modal de detalhe imediatamente.
  function handleSavedOs(savedOs) {
    reload();
    setDetalheOs(savedOs);
  }

  async function handleConsumo(os, itensAtualizados) {
    // Atualiza os itens da OS com o realizado antes de executar.
    const osAtualizada = { ...os, itens: JSON.stringify(itensAtualizados) };
    await api.entities.OrdemServicoAplicacao.update(os.id, { itens: osAtualizada.itens });

    await executarOS({
      os: osAtualizada,
      produtos,
      lotes,
      saldos,
      movimentacoes,
      responsavel: user?.full_name || user?.email || '',
    });

    invalidateEntidade('OrdemServicoAplicacao');
    invalidateEntidade('SaldoEstoque');
    invalidateEntidade('Produto');
    invalidateEntidade('Movimentacao');
    invalidateEntidade('Lote');
    toast({ title: 'Consumo lançado', description: `${os.numero} executada. Estoque baixado.` });
  }

  async function handleAutobaixa(distribuicao) {
    setAutobaixaSaving(true);
    const selecionadas = (ordens || []).filter((o) => selectedIds.includes(o.id) && normalizarStatusAplicacao(o.status) === 'pendente');
    let ok = 0;
    let firstErr = null;
    for (const os of selecionadas) {
      const itens = distribuicao[os.id];
      if (!itens) continue;
      try {
        const osAtualizada = { ...os, itens: JSON.stringify(itens) };
        await api.entities.OrdemServicoAplicacao.update(os.id, { itens: osAtualizada.itens });
        await executarOS({
          os: osAtualizada,
          produtos,
          lotes,
          saldos,
          movimentacoes,
          responsavel: user?.full_name || user?.email || '',
        });
        ok++;
      } catch (e) {
        firstErr = firstErr || { os, err: e };
        break;
      }
    }
    invalidateEntidade('OrdemServicoAplicacao');
    invalidateEntidade('SaldoEstoque');
    invalidateEntidade('Produto');
    invalidateEntidade('Movimentacao');
    invalidateEntidade('Lote');
    setAutobaixaSaving(false);
    setAutobaixaOpen(false);
    setSelectedIds([]);
    if (firstErr) {
      const msg = String(firstErr.err?.message || firstErr.err);
      let desc = msg;
      if (msg.startsWith('SALDO_INSUFICIENTE')) {
        const [, disp, nome] = msg.split(':');
        desc = `Saldo insuficiente de ${nome || 'produto'} (disponível ${formatQtd(Number(disp) || 0)}) ao executar ${firstErr.os.numero}. ${ok} aplicações já baixadas.`;
      } else if (msg.startsWith('DEPOSITO_OBRIGATORIO')) {
        desc = `Depósito obrigatório para ${msg.split(':')[1] || 'produto'} em ${firstErr.os.numero}. ${ok} aplicações já baixadas.`;
      }
      toast({ variant: 'destructive', title: 'Erro na baixa em lote', description: desc });
    } else {
      toast({ title: 'Baixa em lote concluída', description: `${ok} aplicações baixadas e estoque baixado.` });
    }
  }

  async function handleEdicaoMassa(distribuicao) {
    setEdicaoMassaSaving(true);
    const selecionadas = (ordens || []).filter((o) => selectedIds.includes(o.id) && normalizarStatusAplicacao(o.status) === 'pendente');
    let ok = 0;
    for (const os of selecionadas) {
      const itens = distribuicao[os.id];
      if (!itens) continue;
      await api.entities.OrdemServicoAplicacao.update(os.id, { itens: JSON.stringify(itens) });
      ok++;
    }
    invalidateEntidade('OrdemServicoAplicacao');
    setEdicaoMassaSaving(false);
    setEdicaoMassaOpen(false);
    setSelectedIds([]);
    toast({ title: 'Edição em massa concluída', description: `${ok} aplicações atualizadas.` });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-3 p-3 lg:px-4 xl:px-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold">Aplicações</h1>
          <p className="text-sm text-muted-foreground mt-1">Planejamento, baixa de insumos e rastreabilidade por lavoura</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <Button
              variant="outline"
              onClick={() => gerarPDFResumoOS((ordens || []).filter((o) => selectedIds.includes(o.id)))}
            >
              <ClipboardList className="w-4 h-4 mr-2" /> Gerar Resumo PDF ({selectedIds.length})
            </Button>
          )}
          {selectedIds.length >= 2 && (
            <Button onClick={() => setAutobaixaOpen(true)}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Baixa em lote ({selectedIds.length})
            </Button>
          )}
          {selectedIds.length >= 2 && (
            <Button variant="outline" onClick={() => setEdicaoMassaOpen(true)}>
              <Edit3 className="w-4 h-4 mr-2" /> Editar em massa ({selectedIds.length})
            </Button>
          )}
          <Button onClick={() => setNovoConfirm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Nova aplicação
          </Button>
        </div>
      </header>

      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><FileText className="w-4 h-4" /> Total OS</div>
          <p className="text-lg font-semibold tabular-nums">{ordens?.length || 0}</p>
        </Card>
        <Card className="rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertCircle className="w-4 h-4" /> Abertas</div>
          <p className="text-lg font-semibold tabular-nums text-blue-600">{(ordens || []).filter((o) => normalizarStatusAplicacao(o.status) === 'pendente').length}</p>
        </Card>
        <Card className="rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Sprout className="w-4 h-4" /> Lavouras</div>
          <p className="text-lg font-semibold tabular-nums">{lavouras?.length || 0}</p>
        </Card>
        <Card className="rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-4 h-4" /> Custo Total</div>
          <p className="text-lg font-semibold tabular-nums text-primary">
            R$ {(ordens || []).reduce((s, o) => s + (Number(o.custo_total) || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </Card>
      </div>

      {/* Pastas por Ano Safra */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground shrink-0">Ano Safra:</span>
        <button
          type="button"
          onClick={() => setAnoSafraFiltro('all')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${anoSafraFiltro === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent'}`}
        >
          Todos
        </button>
        {anosSafraOrdenados.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAnoSafraFiltro(a.nome)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${anoSafraFiltro === a.nome ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent'}`}
          >
            {a.nome}
          </button>
        ))}
      </div>

      {/* Abas: status da OS + Custos por Lavoura */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto h-auto py-1">
          <TabsTrigger value="pendente">Pendentes ({(ordens || []).filter((o) => normalizarStatusAplicacao(o.status) === 'pendente').length})</TabsTrigger>
          <TabsTrigger value="baixada">Baixadas ({(ordens || []).filter((o) => normalizarStatusAplicacao(o.status) === 'baixada').length})</TabsTrigger>
          <TabsTrigger value="cancelada">Canceladas ({(ordens || []).filter((o) => o.status === 'cancelada').length})</TabsTrigger>
          <TabsTrigger value="custos">Custos por Lavoura</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab !== 'custos' && (
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por número, lavoura, cultura..." className="pl-9" />
          </div>
        </div>
      )}

      {tab !== 'custos' && (
      filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-sm text-muted-foreground mb-4">Nenhuma OS {tab === 'pendente' ? 'aberta' : tab === 'baixada' ? 'executada' : 'cancelada'}.</p>
          {tab === 'pendente' && (
            <Button onClick={() => setNovoConfirm(true)} className="mx-auto">
              <Plus className="w-4 h-4 mr-2" /> Criar primeira aplicação
            </Button>
          )}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden rounded-2xl border shadow-none">
          <div className="max-h-[55vh] overflow-auto scrollbar-thin">
            <table className="w-full min-w-[820px] table-auto text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 w-10">
                    <Checkbox
                      checked={abertasFiltered.length > 0 && abertasFiltered.every((o) => selectedIds.includes(o.id))}
                      onCheckedChange={(checked) => {
                        const ids = abertasFiltered.map((o) => o.id);
                        setSelectedIds((prev) => checked ? [...new Set([...prev, ...ids])] : prev.filter((id) => !ids.includes(id)));
                      }}
                    />
                  </th>
                  <th className="p-2 text-left whitespace-nowrap">Nº</th>
                  <th className="p-2 text-left whitespace-nowrap">Lavoura</th>
                  <th className="p-2 text-left whitespace-nowrap">Cultura</th>
                  <th className="p-2 text-center whitespace-nowrap">Safra</th>
                  <th className="p-2 text-right whitespace-nowrap">Hectares</th>
                  <th className="p-2 text-center whitespace-nowrap">Produtos</th>
                  <th className="p-2 text-right whitespace-nowrap">Custo</th>
                  <th className="p-2 text-center whitespace-nowrap">Status</th>
                  <th className="p-2 text-center whitespace-nowrap">Dias</th>
                  <th className="p-2 text-left whitespace-nowrap">Data</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const qtdItens = parseItens(o.itens).length;
                  const statusBadge = normalizarStatusAplicacao(o.status) === 'pendente'
                    ? 'bg-blue-500 text-white border-transparent'
                    : normalizarStatusAplicacao(o.status) === 'baixada'
                      ? 'bg-emerald-600 text-white border-transparent'
                      : 'bg-muted text-muted-foreground border-transparent';
                  const statusLabel = normalizarStatusAplicacao(o.status) === 'pendente' ? 'Pendente' : normalizarStatusAplicacao(o.status) === 'baixada' ? 'Baixada' : 'Cancelada';
                  return (
                    <tr key={o.id} className="border-t hover:bg-accent/30 cursor-pointer" onClick={() => setDetalheOs(o)}>
                      <td className="p-2 w-10" onClick={(e) => e.stopPropagation()}>
                        {normalizarStatusAplicacao(o.status) === 'pendente' && (
                          <Checkbox
                            checked={selectedIds.includes(o.id)}
                            onCheckedChange={(checked) => setSelectedIds((prev) => checked ? [...prev, o.id] : prev.filter((id) => id !== o.id))}
                          />
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap font-mono text-xs font-medium">{o.numero}</td>
                      <td className="p-2 whitespace-nowrap font-medium">{o.lavoura_nome || '—'}</td>
                      <td className="p-2 whitespace-nowrap">{o.cultura_nome || '—'}</td>
                      <td className="p-2 text-center whitespace-nowrap">{o.ano_safra || '—'}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatQtd(o.hectares || 0)} ha</td>
                      <td className="p-2 text-center whitespace-nowrap tabular-nums">{qtdItens}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">
                        {o.custo_total ? `R$ ${Number(o.custo_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="p-2 text-center whitespace-nowrap"><Badge className={statusBadge}>{statusLabel}</Badge></td>
                      <td className="p-2 text-center whitespace-nowrap">
                        {normalizarStatusAplicacao(o.status) === 'pendente' ? (() => {
                          const d = diasEmAberto(o);
                          const alerta = d > 7;
                          return (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${alerta ? 'text-red-600' : 'text-muted-foreground'}`}>
                              {alerta && <AlertTriangle className="w-3.5 h-3.5" />}{d}d
                            </span>
                          );
                        })() : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">{o.data ? new Date(o.data).toLocaleDateString('pt-BR') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {/* Custo por Lavoura (aba) */}
      {tab === 'custos' && (
        lavourasComCusto.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lavourasComCusto.map((l) => {
              const custo = (ordens || [])
                .filter((o) => o.lavoura_id === l.id && normalizarStatusAplicacao(o.status) === 'baixada')
                .reduce((s, o) => s + (Number(o.custo_total) || 0), 0);
              return (
                <Card key={l.id} className="p-4 cursor-pointer hover:bg-accent/30" onClick={() => setCustoLavoura(l)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{l.nome}</p>
                      <p className="text-xs text-muted-foreground">{formatQtd(l.hectares || 0)} ha</p>
                    </div>
                    <DollarSign className="w-4 h-4 text-primary shrink-0" />
                  </div>
                  <p className="text-xl font-bold text-primary mt-2 tabular-nums">
                    R$ {custo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <DollarSign className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">Nenhuma OS executada para o relatório de custos.</p>
          </Card>
        )
      )}

      <OsAplicacaoForm
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditandoOs(null); }}
        onSaved={handleSavedOs}
        culturas={culturas}
        lavouras={lavouras}
        produtos={produtos}
        saldos={saldos}
        depositos={depositos}
        ordens={ordens}
        os={editandoOs}
        anosSafra={anosSafra}
        setores={setores}
      />

      <OsAplicacaoDetalhe
        open={!!detalheOs}
        onOpenChange={(v) => !v && setDetalheOs(null)}
        os={detalheOs}
        culturas={culturas}
        lavouras={lavouras}
        produtos={produtos}
        saldos={saldos}
        lotes={lotes}
        movimentacoes={movimentacoes}
        onConsumo={handleConsumo}
        onEdit={handleEditOs}
      />

      <AutobaixaDialog
        open={autobaixaOpen}
        onOpenChange={setAutobaixaOpen}
        ordens={(ordens || []).filter((o) => selectedIds.includes(o.id) && normalizarStatusAplicacao(o.status) === 'pendente')}
        produtos={produtos}
        saldos={saldos}
        lotes={lotes}
        movimentacoes={movimentacoes}
        onConfirm={handleAutobaixa}
        saving={autobaixaSaving}
      />

      <EdicaoMassaDialog
        open={edicaoMassaOpen}
        onOpenChange={setEdicaoMassaOpen}
        ordens={(ordens || []).filter((o) => selectedIds.includes(o.id) && normalizarStatusAplicacao(o.status) === 'pendente')}
        produtos={produtos}
        onConfirm={handleEdicaoMassa}
        saving={edicaoMassaSaving}
      />

      <CustoLavouraDialog
        open={!!custoLavoura}
        onOpenChange={(v) => !v && setCustoLavoura(null)}
        lavoura={custoLavoura}
        ordens={ordens}
      />


      <AlertDialog open={novoConfirm} onOpenChange={setNovoConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar nova aplicação?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja abrir o formulário para criar uma nova aplicação?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setEditandoOs(null); setFormOpen(true); setNovoConfirm(false); }}>
              Criar aplicação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
