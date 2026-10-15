import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  RefreshCcw,
  Search,
  SlidersHorizontal,
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

const MOBILE_PAGE_STEP = 30;

function formatCurrency(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatNumber(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function statusClass(status) {
  if (status === 'Pago') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'Parcial') {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  if (status === 'Cancelado') {
    return 'border-slate-200 bg-slate-100 text-slate-600';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function MobileFilterField({ filter, value, options, onChange }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {filter.label}
      </span>
      <SearchSelect
        value={value || 'all'}
        onChange={onChange}
        options={options || []}
        allLabel="Todos"
        placeholder={filter.label}
        className="w-full"
      />
    </label>
  );
}

function MobilePaymentSummary({ rows }) {
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          valor: acc.valor + (Number(row.valor_pedido) || 0),
          pago: acc.pago + (Number(row.valor_pago) || 0),
          saldo: acc.saldo + (Number(row.saldo_receber) || 0),
        }),
        { valor: 0, pago: 0, saldo: 0 }
      ),
    [rows]
  );

  return (
    <div className="grid gap-2">
      <div className="rounded-2xl border bg-card p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Valor apurado dos pedidos
        </p>
        <p className="mt-1 text-xl font-black tracking-tight">
          {formatCurrency(totals.valor)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700/75">
            Pago
          </p>
          <p className="mt-1 text-base font-black text-emerald-700">
            {formatCurrency(totals.pago)}
          </p>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-700/75">
            Falta receber
          </p>
          <p className="mt-1 text-base font-black text-amber-700">
            {formatCurrency(totals.saldo)}
          </p>
        </div>
      </div>
    </div>
  );
}

function MobilePaymentCards({ rows }) {
  if (!rows.length) return null;

  return (
    <div className="space-y-2.5">
      <MobilePaymentSummary rows={rows} />

      <div className="flex items-center justify-between px-0.5 pt-1">
        <div>
          <h3 className="text-sm font-bold">Pedidos</h3>
          <p className="text-[11px] text-muted-foreground">
            Visão financeira consolidada por pedido
          </p>
        </div>
        <Badge variant="outline">{rows.length}</Badge>
      </div>

      {rows.map((row) => {
        const valor = Number(row.valor_pedido) || 0;
        const pago = Number(row.valor_pago) || 0;
        const saldo = Number(row.saldo_receber) || 0;
        const pct =
          valor > 0
            ? Math.max(0, Math.min(100, (pago / valor) * 100))
            : 0;

        return (
          <Card
            key={row.pedido}
            className="overflow-hidden rounded-2xl border shadow-none"
          >
            <div className="p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-black text-primary">
                    {row.pedido || 'Pedido'}
                  </p>
                  <p className="mt-1 break-words text-sm font-bold leading-tight">
                    {row.cliente || '—'}
                  </p>
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {row.produto || '—'}
                  </p>
                </div>

                <Badge
                  variant="outline"
                  className={'shrink-0 ' + statusClass(row.status_financeiro)}
                >
                  {row.status_financeiro || '—'}
                </Badge>
              </div>

              {row.sem_limite && (
                <div className="mt-2 inline-flex rounded-full bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700">
                  Sem limite · {formatNumber(row.carregado_kg)} kg carregados
                </div>
              )}

              <div className="mt-3 rounded-xl bg-muted/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    Valor apurado
                  </span>
                  <strong className="text-sm tabular-nums">
                    {formatCurrency(valor)}
                  </strong>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: String(pct) + '%' }}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Pago
                    </span>
                    <strong className="mt-0.5 block text-sm text-emerald-700 tabular-nums">
                      {formatCurrency(pago)}
                    </strong>
                  </div>

                  <div className="border-l pl-2.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Falta receber
                    </span>
                    <strong
                      className={
                        'mt-0.5 block text-sm tabular-nums ' +
                        (saldo > 0 ? 'text-amber-700' : 'text-emerald-700')
                      }
                    >
                      {formatCurrency(saldo)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function chooseTitleColumn(report, row) {
  const priorities = [
    'produto_nome',
    'nome',
    'numero',
    'documento',
    'pedido',
    'ticket',
    'codigo',
    'cliente',
    'maquina',
    'lavoura',
    'setor',
  ];

  for (const key of priorities) {
    const col = report.columns?.find((item) => item.key === key);
    if (
      col &&
      row?.[key] !== null &&
      row?.[key] !== undefined &&
      row?.[key] !== ''
    ) {
      return col;
    }
  }

  return (report.columns || [])[0] || null;
}

function MobileGenericCards({ report, rows, formatCell }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [visibleCount, setVisibleCount] = useState(MOBILE_PAGE_STEP);

  useEffect(() => {
    setExpanded(new Set());
    setVisibleCount(MOBILE_PAGE_STEP);
  }, [report.key, rows]);

  const visibleRows = rows.slice(0, visibleCount);

  const toggle = (index) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between px-0.5">
        <div>
          <h3 className="text-sm font-bold">Resultado</h3>
          <p className="text-[11px] text-muted-foreground">
            {rows.length.toLocaleString('pt-BR')} registro(s)
          </p>
        </div>
        <Badge variant="outline">
          {Math.min(visibleCount, rows.length)} / {rows.length}
        </Badge>
      </div>

      {visibleRows.map((row, index) => {
        const titleCol = chooseTitleColumn(report, row);
        const detailCols = (report.columns || []).filter(
          (col) => col.key !== titleCol?.key
        );
        const compactCols = detailCols.slice(0, 4);
        const extraCols = detailCols.slice(4);
        const open = expanded.has(index);

        return (
          <Card
            key={report.key + '-' + index}
            className="rounded-2xl border p-3.5 shadow-none"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {titleCol?.label || report.title}
                </p>
                <p className="mt-0.5 break-words text-sm font-black leading-tight">
                  {titleCol
                    ? formatCell(row?.[titleCol.key], titleCol.type)
                    : report.title}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
              {compactCols.map((col) => (
                <div key={col.key} className="min-w-0">
                  <span className="block text-[10px] font-semibold text-muted-foreground">
                    {col.label}
                  </span>
                  <strong
                    className={
                      'mt-0.5 block break-words text-xs leading-snug ' +
                      (col.align === 'right' ? 'tabular-nums' : '')
                    }
                  >
                    {formatCell(row?.[col.key], col.type)}
                  </strong>
                </div>
              ))}
            </div>

            {open && extraCols.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t pt-3">
                {extraCols.map((col) => (
                  <div key={col.key} className="min-w-0">
                    <span className="block text-[10px] font-semibold text-muted-foreground">
                      {col.label}
                    </span>
                    <strong
                      className={
                        'mt-0.5 block break-words text-xs leading-snug ' +
                        (col.align === 'right' ? 'tabular-nums' : '')
                      }
                    >
                      {formatCell(row?.[col.key], col.type)}
                    </strong>
                  </div>
                ))}
              </div>
            )}

            {extraCols.length > 0 && (
              <button
                type="button"
                onClick={() => toggle(index)}
                className="mt-3 flex min-h-9 w-full items-center justify-center gap-1 rounded-xl bg-muted/55 px-3 text-xs font-bold text-muted-foreground"
              >
                {open ? 'Menos detalhes' : 'Ver detalhes'}
                <ChevronDown
                  className={
                    'h-3.5 w-3.5 transition-transform ' +
                    (open ? 'rotate-180' : '')
                  }
                />
              </button>
            )}
          </Card>
        );
      })}

      {visibleCount < rows.length && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-xl"
          onClick={() =>
            setVisibleCount((current) =>
              Math.min(rows.length, current + MOBILE_PAGE_STEP)
            )
          }
        >
          Mostrar mais
        </Button>
      )}
    </div>
  );
}

export function MobileReportCatalog({
  catalog,
  filtered,
  grouped,
  category,
  setCategory,
  search,
  setSearch,
  loading,
  onOpen,
  renderIcon,
}) {
  return (
    <div className="mobile-reports-page space-y-4 px-3 pb-24 pt-3">
      <div className="px-0.5">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">
          Consulta
        </p>
        <h1 className="mt-0.5 text-xl font-black tracking-tight">
          Relatórios
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Informações organizadas para leitura rápida no celular.
        </p>
      </div>

      <div className="sticky top-0 z-20 -mx-3 border-y bg-background/95 px-3 py-2.5 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar relatório..."
            className="h-11 rounded-xl pl-9 text-base"
          />
        </div>

        <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto pb-0.5">
          {['Todos', ...(catalog.categories || [])].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={
                'min-h-9 shrink-0 rounded-full border px-3 text-xs font-bold ' +
                (category === item
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground')
              }
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
          <p className="mt-2 text-xs text-muted-foreground">
            Carregando relatórios...
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl border-dashed py-12 text-center shadow-none">
          <Search className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 text-sm font-bold">
            Nenhum relatório encontrado
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {[...grouped.entries()].map(([groupName, reports]) => (
            <section key={groupName}>
              <div className="mb-2 flex items-center justify-between px-0.5">
                <h2 className="text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                  {groupName}
                </h2>
                <span className="text-[10px] font-bold text-muted-foreground">
                  {reports.length}
                </span>
              </div>

              <div className="space-y-2">
                {reports.map((report) => (
                  <button
                    key={report.key}
                    type="button"
                    onClick={() => onOpen(report)}
                    className="flex w-full min-w-0 items-center gap-3 rounded-2xl border bg-card p-3 text-left active:bg-muted/35"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      {renderIcon(report, 'h-5 w-5')}
                    </div>

                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[9px] font-black uppercase tracking-wide text-primary">
                        {report.code}
                      </span>
                      <strong className="mt-0.5 block text-sm leading-tight">
                        {report.title}
                      </strong>
                      <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                        {report.description}
                      </span>
                    </div>

                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/55" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function MobileReportRunner({
  report,
  options,
  onBack,
  renderIcon,
  formatCell,
}) {
  const { toast } = useToast();
  const isPaymentSummary = report.key === 'pagamentos';

  const [busca, setBusca] = useState('');
  const [dataDe, setDataDe] = useState('');
  const [dataAte, setDataAte] = useState('');
  const [filtros, setFiltros] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState(null);

  const mobileFilters = useMemo(() => {
    if (isPaymentSummary) {
      return (report.filters || []).filter(
        (filter) => filter.key === 'cliente_id'
      );
    }
    return report.filters || [];
  }, [isPaymentSummary, report.filters]);

  const executar = async () => {
    setLoading(true);
    try {
      const data = await relatoriosApi.executar(report.key, {
        busca: busca || null,
        data_de: isPaymentSummary ? null : (dataDe || null),
        data_ate: isPaymentSummary ? null : (dataAte || null),
        filtros,
        limite: 1000,
        mobile_view: true,
      });
      setResult(data);
      setFiltersOpen(false);
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

  useEffect(() => {
    setBusca('');
    setDataDe('');
    setDataAte('');
    setFiltros({});
    setResult(null);
    setFiltersOpen(false);

    let active = true;

    const carregar = async () => {
      setLoading(true);
      try {
        const data = await relatoriosApi.executar(report.key, {
          busca: null,
          data_de: null,
          data_ate: null,
          filtros: {},
          limite: 1000,
          mobile_view: true,
        });
        if (active) setResult(data);
      } catch (error) {
        if (!active) return;
        toast({
          variant: 'destructive',
          title: 'Erro ao executar relatório',
          description: error?.message || String(error),
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    carregar();

    return () => {
      active = false;
    };
  }, [report.key, toast]);

  const limpar = () => {
    setBusca('');
    setDataDe('');
    setDataAte('');
    setFiltros({});
  };

  const exportConfig = useMemo(() => {
    if (isPaymentSummary && result?.view === 'mobile_order_summary') {
      return {
        labels: [
          'Pedido',
          'Cliente',
          'Produto',
          'Valor do pedido',
          'Pago',
          'Falta receber',
          'Status',
        ],
        keys: [
          'pedido',
          'cliente',
          'produto',
          'valor_pedido',
          'valor_pago',
          'saldo_receber',
          'status_financeiro',
        ],
        types: [
          'text',
          'text',
          'text',
          'currency',
          'currency',
          'currency',
          'text',
        ],
      };
    }

    return {
      labels: (report.columns || []).map((col) => col.label),
      keys: (report.columns || []).map((col) => col.key),
      types: (report.columns || []).map((col) => col.type || 'text'),
    };
  }, [isPaymentSummary, report.columns, result?.view]);

  const exportarExcelMobile = async () => {
    if (!result?.rows?.length) return;
    setExporting(true);
    try {
      await exportExcel(
        report.title,
        exportConfig.labels,
        result.rows.map((row) =>
          exportConfig.keys.map((key) => row?.[key] ?? '')
        ),
        {
          sheetName: report.code,
          columnTypes: exportConfig.types,
        }
      );
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

  const exportarPDFMobile = async () => {
    if (!result?.rows?.length) return;
    try {
      await exportPDF(
        report.title,
        exportConfig.labels,
        result.rows.map((row) =>
          exportConfig.keys.map((key, index) =>
            formatCell(row?.[key], exportConfig.types[index])
          )
        )
      );
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao exportar PDF',
        description: error?.message || String(error),
      });
    }
  };

  return (
    <div className="mobile-report-runner space-y-3 px-3 pb-24 pt-3">
      <div className="flex items-start gap-2.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl"
          onClick={onBack}
          title="Voltar"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {renderIcon(report, 'h-5 w-5')}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-black uppercase tracking-wide text-primary">
              {report.code}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {report.category}
            </span>
          </div>
          <h1 className="mt-0.5 break-words text-lg font-black leading-tight">
            {report.title}
          </h1>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') executar();
          }}
          placeholder={
            isPaymentSummary
              ? 'Buscar pedido, cliente ou produto...'
              : 'Buscar neste relatório...'
          }
          className="h-11 rounded-xl pl-9 text-base"
        />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-between rounded-xl"
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
          </span>
          <ChevronDown
            className={
              'h-4 w-4 transition-transform ' +
              (filtersOpen ? 'rotate-180' : '')
            }
          />
        </Button>

        <Button
          type="button"
          className="h-11 rounded-xl px-4"
          onClick={executar}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          <span className="ml-2">Atualizar</span>
        </Button>
      </div>

      {filtersOpen && (
        <Card className="rounded-2xl border p-3 shadow-none">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Filtros do relatório</span>
            </div>
            <button
              type="button"
              onClick={limpar}
              className="flex min-h-9 items-center gap-1 px-2 text-xs font-bold text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Limpar
            </button>
          </div>

          <div className="space-y-3">
            {!isPaymentSummary && report.has_period && (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    De
                  </span>
                  <Input
                    type="date"
                    value={dataDe}
                    onChange={(event) => setDataDe(event.target.value)}
                    className="h-11 text-base"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Até
                  </span>
                  <Input
                    type="date"
                    value={dataAte}
                    onChange={(event) => setDataAte(event.target.value)}
                    className="h-11 text-base"
                  />
                </label>
              </div>
            )}

            {mobileFilters.map((filter) => (
              <MobileFilterField
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

            {isPaymentSummary && (
              <p className="rounded-xl bg-muted/45 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                No celular, este relatório é consolidado por pedido. Os pagamentos individuais continuam registrados no sistema, mas não são exibidos como uma lista longa.
              </p>
            )}
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 flex-1 rounded-xl"
          disabled={!result?.rows?.length}
          onClick={exportarPDFMobile}
        >
          <Download className="mr-2 h-4 w-4" />
          PDF
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-10 flex-1 rounded-xl"
          disabled={!result?.rows?.length || exporting}
          onClick={exportarExcelMobile}
        >
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-2 h-4 w-4" />
          )}
          Excel
        </Button>
      </div>

      {result?.truncated && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Há mais registros do que o limite da visualização mobile. Use os filtros para restringir a consulta.
          </span>
        </div>
      )}

      {loading && !result ? (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
          <p className="mt-2 text-xs text-muted-foreground">
            Carregando relatório...
          </p>
        </div>
      ) : result && result.rows.length === 0 ? (
        <Card className="rounded-2xl border-dashed py-12 text-center shadow-none">
          <Search className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 text-sm font-bold">
            Nenhum registro encontrado
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajuste os filtros e tente novamente.
          </p>
        </Card>
      ) : result?.view === 'mobile_order_summary' ? (
        <MobilePaymentCards rows={result.rows} />
      ) : result?.rows?.length ? (
        <MobileGenericCards
          report={report}
          rows={result.rows}
          formatCell={formatCell}
        />
      ) : null}
    </div>
  );
}
