import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BadgeDollarSign,
  Boxes,
  CalendarClock,
  CalendarRange,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  Database,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Filter,
  FlaskConical,
  Fuel,
  IdCard,
  LandPlot,
  ListChecks,
  Loader2,
  LockKeyhole,
  MapPin,
  Network,
  Package,
  RefreshCcw,
  Repeat2,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Tractor,
  Truck,
  Undo2,
  UserRoundCheck,
  Warehouse,
  Wheat,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import SearchSelect from '@/components/SearchSelect';
import { useToast } from '@/components/ui/use-toast';
import { relatoriosApi } from '@/api/relatoriosClient';
import { exportExcel, exportPDF } from '@/lib/exports';
import {
  MobileReportCatalog,
  MobileReportRunner,
} from '@/components/relatorios/MobileRelatorios';


const ICONS = {
  Warehouse,
  Boxes,
  TriangleAlert: AlertTriangle,
  CalendarClock,
  Files: FileText,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Repeat2,
  Undo2,
  LockKeyhole,
  ListChecks,
  Fuel,
  Sprout,
  FlaskConical,
  ClipboardCheck,
  ClipboardList,
  ScrollText: FileText,
  Scale,
  BadgeDollarSign,
  FileCheck2,
  Package,
  ContactRound,
  UserRoundCheck,
  Truck,
  Container: Truck,
  IdCard,
  Car,
  Tractor,
  Network,
  MapPinHouse: MapPin,
  LandPlot,
  Wheat,
  CalendarRange,
  ShieldCheck,
};


const CATEGORY_ICONS = {
  Estoque: Warehouse,
  Movimentações: ArrowLeftRight,
  Operações: Tractor,
  Pesagem: Scale,
  Cadastros: Database,
  Administração: ShieldCheck,
};


function formatCell(value, type) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (type === 'boolean') {
    return value ? 'Sim' : 'Não';
  }

  if (type === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return num.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }

  if (type === 'currency') {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return num.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  if (type === 'date') {
    const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('pt-BR');
  }

  if (type === 'datetime') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-BR');
  }

  return String(value);
}


function reportIcon(report, className = 'h-5 w-5') {
  const Icon = ICONS[report.icon] || FileText;
  return <Icon className={className} />;
}


function useMobileReports() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);

    update();
    media.addEventListener?.('change', update);

    return () => {
      media.removeEventListener?.('change', update);
    };
  }, []);

  return isMobile;
}


function ReportCard({ report, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(report)}
      className="group text-left"
    >
      <Card className="h-full border-border/70 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            {reportIcon(report, 'h-5 w-5')}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {report.code}
              </span>

              <span className="text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Abrir
              </span>
            </div>

            <h3 className="mt-1 font-semibold leading-tight text-foreground">
              {report.title}
            </h3>

            <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {report.description}
            </p>
          </div>
        </div>
      </Card>
    </button>
  );
}


function FilterField({ filter, value, options, onChange }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {filter.label}
      </label>

      <SearchSelect
        value={value || 'all'}
        onChange={onChange}
        options={options || []}
        allLabel="Todos"
        placeholder={filter.label}
        className="w-full"
      />
    </div>
  );
}


function ResultTable({ report, result }) {
  const [sort, setSort] = useState({ key: null, direction: 'asc' });
  const [visible, setVisible] = useState(() =>
    new Set((report.columns || []).map((c) => c.key))
  );

  useEffect(() => {
    setVisible(new Set((report.columns || []).map((c) => c.key)));
    setSort({ key: null, direction: 'asc' });
  }, [report.key]);

  const columns = useMemo(
    () => (report.columns || []).filter((c) => visible.has(c.key)),
    [report.columns, visible]
  );

  const rows = useMemo(() => {
    const base = [...(result?.rows || [])];
    if (!sort.key) return base;

    const col = report.columns.find((c) => c.key === sort.key);
    const direction = sort.direction === 'asc' ? 1 : -1;

    base.sort((a, b) => {
      const av = a?.[sort.key];
      const bv = b?.[sort.key];

      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      if (col?.type === 'number' || col?.type === 'currency') {
        return (Number(av) - Number(bv)) * direction;
      }

      if (col?.type === 'date' || col?.type === 'datetime') {
        return (new Date(av).getTime() - new Date(bv).getTime()) * direction;
      }

      return String(av).localeCompare(String(bv), 'pt-BR') * direction;
    });

    return base;
  }, [result?.rows, sort, report.columns]);

  const previewRows = rows.slice(0, 1000);

  const toggleColumn = (key) => {
    setVisible((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const sortBy = (key) => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc'
          ? 'desc'
          : 'asc',
    }));
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">
            Resultado da consulta
          </p>
          <p className="text-xs text-muted-foreground">
            {result.total.toLocaleString('pt-BR')} registro(s)
            {result.truncated
              ? ` · retorno limitado a ${result.returned.toLocaleString('pt-BR')}`
              : ''}
          </p>
        </div>

        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted">
            <SlidersHorizontal className="h-4 w-4" />
            Colunas
            <ChevronDown className="h-3.5 w-3.5" />
          </summary>

          <div className="absolute right-0 z-30 mt-2 max-h-80 w-64 overflow-auto rounded-xl border bg-popover p-2 shadow-xl">
            {report.columns.map((col) => (
              <label
                key={col.key}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={visible.has(col.key)}
                  onChange={() => toggleColumn(col.key)}
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>
        </details>
      </div>

      <div className="max-h-[620px] overflow-auto scrollbar-thin">
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`whitespace-nowrap border-b px-3 py-2.5 text-xs font-semibold ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(col.key)}
                    className="inline-flex items-center gap-1 hover:text-primary"
                  >
                    {col.label}
                    {sort.key === col.key && (
                      <span className="text-[10px] text-primary">
                        {sort.direction === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {previewRows.map((row, index) => (
              <tr
                key={index}
                className="border-b last:border-b-0 hover:bg-muted/30"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`max-w-[420px] whitespace-nowrap px-3 py-2 ${
                      col.align === 'right'
                        ? 'text-right tabular-nums'
                        : 'text-left'
                    }`}
                    title={String(row?.[col.key] ?? '')}
                  >
                    {formatCell(row?.[col.key], col.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 1000 && (
        <div className="border-t bg-muted/20 px-4 py-2 text-center text-xs text-muted-foreground">
          Preview mostrando 1.000 de {rows.length.toLocaleString('pt-BR')} linhas carregadas. O Excel exporta todas as linhas retornadas.
        </div>
      )}
    </div>
  );
}


function ReportRunner({ report, options, onBack }) {
  const { toast } = useToast();

  const [busca, setBusca] = useState('');
  const [dataDe, setDataDe] = useState('');
  const [dataAte, setDataAte] = useState('');
  const [filtros, setFiltros] = useState({});
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setBusca('');
    setDataDe('');
    setDataAte('');
    setFiltros({});
    setResult(null);
  }, [report.key]);

  const executar = async () => {
    setLoading(true);
    try {
      const data = await relatoriosApi.executar(report.key, {
        busca: busca || null,
        data_de: dataDe || null,
        data_ate: dataAte || null,
        filtros,
        limite: 50000,
      });
      setResult(data);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao executar relatório',
        description: error?.message || String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const limpar = () => {
    setBusca('');
    setDataDe('');
    setDataAte('');
    setFiltros({});
    setResult(null);
  };

  const filterSummary = () => {
    const lines = [];
    if (busca) lines.push(['Busca', busca]);
    if (dataDe) lines.push([`${report.period_label || 'Período'} de`, dataDe]);
    if (dataAte) lines.push([`${report.period_label || 'Período'} até`, dataAte]);

    for (const filter of report.filters || []) {
      const value = filtros[filter.key];
      if (!value || value === 'all') continue;
      const option = (options?.[filter.option_key] || []).find(
        (x) => String(x.value) === String(value)
      );
      lines.push([filter.label, option?.label || String(value)]);
    }

    return lines;
  };

  const exportarExcel = async () => {
    if (!result?.rows?.length) return;

    setExporting(true);
    try {
      const cols = report.columns.map((c) => c.label);
      const rows = result.rows.map((row) =>
        report.columns.map((c) => row?.[c.key] ?? '')
      );

      await exportExcel(report.title, cols, rows, {
        sheetName: report.code,
        columnTypes: report.columns.map((c) => c.type || 'text'),
        metadata: [
          ['Relatório', report.title],
          ['Código', report.code],
          ['Gerado em', new Date().toLocaleString('pt-BR')],
          ['Registros', result.total],
          ...filterSummary(),
        ],
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao exportar Excel',
        description: error?.message || String(error),
      });
    } finally {
      setExporting(false);
    }
  };

  const exportarPDF = async () => {
    if (!result?.rows?.length) return;

    try {
      const cols = report.columns.map((c) => c.label);
      const rows = result.rows.map((row) =>
        report.columns.map((c) => formatCell(row?.[c.key], c.type))
      );
      await exportPDF(report.title, cols, rows);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao exportar PDF',
        description: error?.message || String(error),
      });
    }
  };

  return (
    <div className="w-full min-w-0 space-y-4 p-3 lg:px-4 xl:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="mt-0.5"
            onClick={onBack}
            title="Voltar ao catálogo"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {reportIcon(report)}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">
                {report.code}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {report.category}
              </span>
            </div>

            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              {report.title}
            </h1>

            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {report.description}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!result?.rows?.length}
            onClick={exportarPDF}
          >
            <Download className="mr-2 h-4 w-4" />
            PDF
          </Button>

          <Button
            disabled={!result?.rows?.length || exporting}
            onClick={exportarExcel}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-2 h-4 w-4" />
            )}
            Excel
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-border/70">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">
              Parâmetros de seleção
            </p>
            <p className="text-xs text-muted-foreground">
              Defina os critérios e execute a consulta.
            </p>
          </div>

          <Filter className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="p-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pesquisa livre
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') executar();
                  }}
                  placeholder="Código, produto, documento, pessoa, observação..."
                  className="pl-9"
                />
              </div>
            </div>

            {report.has_period && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {report.period_label || 'Período'} de
                  </label>
                  <Input
                    type="date"
                    value={dataDe}
                    onChange={(e) => setDataDe(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {report.period_label || 'Período'} até
                  </label>
                  <Input
                    type="date"
                    value={dataAte}
                    onChange={(e) => setDataAte(e.target.value)}
                  />
                </div>
              </>
            )}

            {(report.filters || []).map((filter) => (
              <FilterField
                key={filter.key}
                filter={filter}
                value={filtros[filter.key] || 'all'}
                options={options?.[filter.option_key] || []}
                onChange={(value) =>
                  setFiltros((current) => ({
                    ...current,
                    [filter.key]: value,
                  }))
                }
              />
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={limpar}
              disabled={loading}
            >
              <X className="mr-2 h-4 w-4" />
              Limpar
            </Button>

            <Button
              type="button"
              onClick={executar}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Executar
            </Button>
          </div>
        </div>
      </Card>

      {!result && !loading && (
        <Card className="border-dashed py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileText className="h-5 w-5" />
          </div>
          <h3 className="mt-3 font-semibold">
            Relatório pronto para execução
          </h3>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
            Preencha os parâmetros que desejar. Campos em branco não restringem a consulta.
          </p>
        </Card>
      )}

      {loading && (
        <Card className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            Consultando dados do ERP...
          </p>
        </Card>
      )}

      {result && !loading && (
        <>
          {result.truncated && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A consulta encontrou {result.total.toLocaleString('pt-BR')} registros. Foram retornados os primeiros {result.returned.toLocaleString('pt-BR')} para proteger o desempenho do sistema. Restrinja os filtros para obter o conjunto completo.
              </span>
            </div>
          )}

          {result.rows.length === 0 ? (
            <Card className="py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Search className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold">
                Nenhum registro encontrado
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Ajuste os parâmetros e execute novamente.
              </p>
            </Card>
          ) : (
            <ResultTable report={report} result={result} />
          )}
        </>
      )}
    </div>
  );
}


export default function Relatorios() {
  const { toast } = useToast();
  const isMobile = useMobileReports();

  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState({
    reports: [],
    categories: [],
    options: {},
  });
  const [category, setCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;

    relatoriosApi
      .catalogo()
      .then((data) => {
        if (!active) return;
        setCatalog(data || { reports: [], categories: [], options: {} });
      })
      .catch((error) => {
        if (!active) return;
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar relatórios',
          description: error?.message || String(error),
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [toast]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');

    return (catalog.reports || []).filter((report) => {
      if (category !== 'Todos' && report.category !== category) {
        return false;
      }

      if (!term) return true;

      return [
        report.code,
        report.title,
        report.description,
        report.category,
      ]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(term);
    });
  }, [catalog.reports, category, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const report of filtered) {
      if (!map.has(report.category)) map.set(report.category, []);
      map.get(report.category).push(report);
    }
    return map;
  }, [filtered]);

  if (selected) {
    if (isMobile) {
      return (
        <MobileReportRunner
          report={selected}
          options={catalog.options}
          onBack={() => setSelected(null)}
          renderIcon={reportIcon}
          formatCell={formatCell}
        />
      );
    }

    return (
      <ReportRunner
        report={selected}
        options={catalog.options}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (isMobile) {
    return (
      <MobileReportCatalog
        catalog={catalog}
        filtered={filtered}
        grouped={grouped}
        category={category}
        setCategory={setCategory}
        search={search}
        setSearch={setSearch}
        loading={loading}
        onOpen={setSelected}
        renderIcon={reportIcon}
      />
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4 p-3 lg:px-4 xl:px-5">
      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="relative bg-gradient-to-r from-[#12362f] via-[#0f4438] to-[#0b5a46] px-5 py-1.5 text-white sm:px-6">
          <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-10">
            <FileSpreadsheet className="h-14 w-14" />
          </div>

          <div className="relative max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
              <Database className="h-4 w-4" />
              Analytics ERP
            </div>

            <h1 className="mt-0.5 text-xl font-bold">
              Central de Relatórios
            </h1>

          </div>
        </div>

        <div className="grid gap-3 px-4 py-2 sm:px-5 sm:py-2 lg:grid-cols-[minmax(280px,520px)_1fr] lg:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar relatório por nome, código ou assunto..."
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {['Todos', ...(catalog.categories || [])].map((item) => {
              const Icon = item === 'Todos'
                ? FileText
                : CATEGORY_ICONS[item] || FileText;

              return (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant={category === item ? 'default' : 'outline'}
                  onClick={() => setCategory(item)}
                  className="gap-1.5"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item}
                </Button>
              );
            })}
          </div>
        </div>
      </section>

      {loading ? (
        <Card className="py-20 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            Carregando catálogo de relatórios...
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <Search className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">
            Nenhum relatório encontrado
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tente outro termo ou selecione outra categoria.
          </p>
        </Card>
      ) : (
        <div className="space-y-7">
          {[...grouped.entries()].map(([groupName, reports]) => {
            const Icon = CATEGORY_ICONS[groupName] || FileText;

            return (
              <section key={groupName}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="font-semibold">
                        {groupName}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {reports.length} relatório(s)
                      </p>
                    </div>
                  </div>

                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {reports.map((report) => (
                    <ReportCard
                      key={report.key}
                      report={report}
                      onOpen={setSelected}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
