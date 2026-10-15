import { useState, useMemo } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import SearchSelect from '@/components/SearchSelect';
import { exportExcel } from '@/lib/exports';
import { formatQtd } from '@/lib/format';
import { parseItens } from '@/lib/osAplicacao';
import { useEntidades } from '@/lib/useEntidades';

const STATUS_OPTS = [
  { value: 'pendente', label: 'Pendentes' },
  { value: 'baixada', label: 'Baixadas' },
  { value: 'cancelada', label: 'Canceladas' },
];
const statusLabel = (s) => (s === 'pendente' ? 'Pendente' : s === 'baixada' ? 'Baixada' : s === 'cancelada' ? 'Cancelada' : s);

const NIVEIS = [
  { value: 'detalhado', label: 'Detalhado (por item)' },
  { value: 'produto', label: 'Por Produto' },
  { value: 'lavoura', label: 'Por Lavoura' },
  { value: 'safra', label: 'Por Safra' },
  { value: 'produto_safra', label: 'Por Produto + Safra' },
];

export default function RelatorioAplicacao() {
  const [ano, setAno] = useState('all');
  const [cultura, setCultura] = useState('all');
  const [lavoura, setLavoura] = useState('all');
  const [produto, setProduto] = useState('all');
  const [status, setStatus] = useState('all');
  const [dataDe, setDataDe] = useState('');
  const [dataAte, setDataAte] = useState('');
  const [nivel, setNivel] = useState('detalhado');
  const [exportando, setExportando] = useState(false);

  const { data, loading } = useEntidades({
    OrdemServicoAplicacao: { sort: '-data', limit: 1000 },
    Cultura: {},
    Lavoura: {},
    AnoSafra: {},
    Produto: {},
  });
  const {
    OrdemServicoAplicacao: ordens, Cultura: culturas, Lavoura: lavouras, AnoSafra: anosSafra, Produto: produtos,
  } = data;

  const ordensFiltradas = useMemo(() => {
    return (ordens || []).filter((o) => {
      if (ano !== 'all' && o.ano_safra !== ano) return false;
      if (cultura !== 'all' && o.cultura_id !== cultura) return false;
      if (lavoura !== 'all' && o.lavoura_id !== lavoura) return false;
      if (status !== 'all' && o.status !== status) return false;
      if (produto !== 'all' && !parseItens(o.itens).some((it) => it.produto_id === produto)) return false;
      if (dataDe && (!o.data || new Date(o.data) < new Date(dataDe + 'T00:00:00'))) return false;
      if (dataAte && (!o.data || new Date(o.data) > new Date(dataAte + 'T23:59:59'))) return false;
      return true;
    });
  }, [ordens, ano, cultura, lavoura, status, produto, dataDe, dataAte]);

  // Constrói colunas + linhas (números como number, texto como string) conforme o nível.
  const { colunas, numericCols, rows } = useMemo(() => {
    if (nivel === 'detalhado') {
      const colunas = ['Nº OS', 'Data', 'Safra', 'Cultura', 'Lavoura', 'Hectares', 'Status', 'Produto', 'Código', 'Unidade', 'Dose/ha', 'Previsto', 'Realizado', 'Custo Unit.', 'Custo Total'];
      const numericCols = new Set([5, 10, 11, 12, 13, 14]);
      const rows = [];
      for (const o of ordensFiltradas) {
        for (const it of parseItens(o.itens)) {
          rows.push([
            o.numero || '', o.data ? new Date(o.data).toLocaleDateString('pt-BR') : '',
            o.ano_safra || '', o.cultura_nome || '', o.lavoura_nome || '',
            Number(o.hectares) || 0, statusLabel(o.status),
            it.nome || '', it.codigo || '', it.unidade || '',
            Number(it.dose_por_hect) || 0, Number(it.previsto) || 0, Number(it.realizado) || 0,
            Number(it.custo_unitario) || 0, Number(it.custo_total) || 0,
          ]);
        }
      }
      return { colunas, numericCols, rows };
    }

    // Agregação por chave.
    const groups = {};
    for (const o of ordensFiltradas) {
      for (const it of parseItens(o.itens)) {
        let key, label, extra = {};
        if (nivel === 'produto') { key = it.produto_id; label = it.nome || ''; extra = { codigo: it.codigo || '', unidade: it.unidade || '' }; }
        else if (nivel === 'lavoura') { key = o.lavoura_id || ''; label = o.lavoura_nome || ''; }
        else if (nivel === 'safra') { key = o.ano_safra || ''; label = o.ano_safra || ''; }
        else if (nivel === 'produto_safra') { key = `${it.produto_id}|${o.ano_safra}`; label = it.nome || ''; extra = { safra: o.ano_safra || '', codigo: it.codigo || '', unidade: it.unidade || '' }; }
        if (!groups[key]) groups[key] = { label, previsto: 0, realizado: 0, custo: 0, osIds: new Set(), ha: {}, ...extra };
        const g = groups[key];
        g.previsto += Number(it.previsto) || 0;
        g.realizado += Number(it.realizado) || 0;
        g.custo += Number(it.custo_total) || 0;
        g.osIds.add(o.id);
        g.ha[o.id] = Number(o.hectares) || 0;
      }
    }

    if (nivel === 'produto') {
      const colunas = ['Produto', 'Código', 'Unidade', 'Qtd OS', 'Hectares', 'Previsto', 'Realizado', 'Custo Total'];
      const numericCols = new Set([3, 4, 5, 6, 7]);
      const rows = Object.values(groups).map((g) => [
        g.label, g.codigo, g.unidade, g.osIds.size,
        Object.values(g.ha).reduce((a, b) => a + b, 0), g.previsto, g.realizado, g.custo,
      ]);
      return { colunas, numericCols, rows };
    }
    if (nivel === 'lavoura') {
      const colunas = ['Lavoura', 'Hectares', 'Qtd OS', 'Previsto', 'Realizado', 'Custo Total'];
      const numericCols = new Set([1, 2, 3, 4, 5]);
      const rows = Object.values(groups).map((g) => [
        g.label, g.ha[Object.keys(g.ha)[0]] || 0, g.osIds.size, g.previsto, g.realizado, g.custo,
      ]);
      return { colunas, numericCols, rows };
    }
    if (nivel === 'safra') {
      const colunas = ['Safra', 'Qtd OS', 'Hectares', 'Previsto', 'Realizado', 'Custo Total'];
      const numericCols = new Set([1, 2, 3, 4, 5]);
      const rows = Object.values(groups).map((g) => [
        g.label, g.osIds.size, Object.values(g.ha).reduce((a, b) => a + b, 0), g.previsto, g.realizado, g.custo,
      ]);
      return { colunas, numericCols, rows };
    }
    // produto_safra
    const colunas = ['Safra', 'Produto', 'Código', 'Unidade', 'Qtd OS', 'Previsto', 'Realizado', 'Custo Total'];
    const numericCols = new Set([4, 5, 6, 7]);
    const rows = Object.values(groups).map((g) => [
      g.safra, g.label, g.codigo, g.unidade, g.osIds.size, g.previsto, g.realizado, g.custo,
    ]);
    return { colunas, numericCols, rows };
  }, [ordensFiltradas, nivel]);

  async function handleExcel() {
    if (!rows.length) return;
    setExportando(true);
    try {
      await exportExcel(`Relatório Aplicação — ${NIVEIS.find((n) => n.value === nivel)?.label || nivel}`, colunas, rows);
    } finally {
      setExportando(false);
    }
  }

  function fmt(v, idx) {
    if (numericCols.has(idx)) return formatQtd(Number(v) || 0);
    return v ?? '';
  }

  return (
    <div className="space-y-6 mt-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-muted-foreground">Filtros:</span>
          <SearchSelect value={ano} onChange={setAno} allLabel="Todas as safras" placeholder="Safra" className="w-[160px]"
            options={(anosSafra || []).map((a) => ({ value: a.nome, label: a.nome }))} />
          <SearchSelect value={cultura} onChange={setCultura} allLabel="Todas as culturas" placeholder="Cultura" className="w-[170px]"
            options={(culturas || []).map((c) => ({ value: c.id, label: c.nome }))} />
          <SearchSelect value={lavoura} onChange={setLavoura} allLabel="Todas as lavouras" placeholder="Lavoura" className="w-[200px]"
            options={(lavouras || []).map((l) => ({ value: l.id, label: l.nome }))} />
          <SearchSelect value={produto} onChange={setProduto} allLabel="Todos os produtos" placeholder="Produto" className="w-[220px]"
            options={(produtos || []).map((p) => ({ value: p.id, label: p.nome }))} />
          <SearchSelect value={status} onChange={setStatus} allLabel="Todos os status" placeholder="Status" className="w-[150px]"
            options={STATUS_OPTS} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-muted-foreground">Período:</span>
          <Input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} className="w-[160px]" />
          <span className="text-muted-foreground">até</span>
          <Input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} className="w-[160px]" />
          <span className="text-sm font-semibold text-muted-foreground ml-2">Nível:</span>
          <select className="h-9 glass-input rounded-md px-2 text-sm" value={nivel} onChange={(e) => setNivel(e.target.value)}>
            {NIVEIS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </div>
      </Card>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold">Relatório de Aplicação — {NIVEIS.find((n) => n.value === nivel)?.label} ({rows.length} linha{rows.length === 1 ? '' : 's'})</h3>
        <Button onClick={handleExcel} disabled={!rows.length || exportando}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> {exportando ? 'Gerando…' : 'Exportar Excel'}
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Nenhum registro para os filtros selecionados.</p>
        ) : (
          <div className="max-h-[560px] overflow-auto scrollbar-thin">
            <table className="min-w-full w-auto text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  {colunas.map((c, i) => (
                    <th key={i} className={`p-2 whitespace-nowrap ${numericCols.has(i) ? 'text-right' : 'text-left'}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((r, ri) => (
                  <tr key={ri} className="border-t">
                    {r.map((cell, ci) => (
                      <td key={ci} className={`p-2 whitespace-nowrap tabular-nums ${numericCols.has(ci) ? 'text-right' : 'text-left'}`}>{fmt(cell, ci)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <p className="text-xs text-muted-foreground p-2 text-center">Mostrando 300 de {rows.length} linhas no preview. O Excel exporta todas.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}