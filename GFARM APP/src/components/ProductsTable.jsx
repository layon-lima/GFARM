import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download,
  Pencil, Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getNome, getStatusEstoque } from '@/lib/estoqueFilters';
import { formatQtd, formatMoeda } from '@/lib/format';
import { useColumnConfig } from '@/hooks/useColumnConfig';
import DataTable from '@/components/tables/DataTable';
import ImagePreview from '@/components/ImagePreview';

function ProductThumb({ produto }) {
  return (
    <ImagePreview
      src={produto?.foto_url}
      alt={produto?.nome || 'Produto'}
      className="h-10 w-10 rounded-lg border object-cover"
      fallbackClassName="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground"
    />
  );
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export default function ProductsTable({
  produtos,
  setores,
  maquinas,
  gavetas,
  depositos,
  showStatus = true,
  onEdit,
  onDelete,
}) {
  const hasActions = onEdit || onDelete;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [produtos.length]);

  const nonZero = produtos.filter((p) => (Number(p.quantidade) || 0) > 0);
  const avg =
    nonZero.reduce((s, p) => s + (Number(p.quantidade) || 0), 0) /
    (nonZero.length || 1);

  const totalValor = produtos.reduce((sum, p) => {
    const unit =
      Number(p.custo_unitario) || 0;

    const value =
      (Number(p.quantidade) || 0) * unit;

    return sum + value;
  }, 0);

  const totaisPorUnidade = useMemo(() => {
    const map = {};

    for (const p of produtos) {
      const unidade = p.unidade || 'un';
      map[unidade] = (map[unidade] || 0) + (Number(p.quantidade) || 0);
    }

    return Object.entries(map);
  }, [produtos]);

  const totalPaginas = Math.max(1, Math.ceil(produtos.length / pageSize));
  const paginaAtual = Math.min(page, totalPaginas);
  const inicio = (paginaAtual - 1) * pageSize;
  const paginaRows = produtos.slice(inicio, inicio + pageSize);

  function getStatus(qtd) {
    const status = getStatusEstoque(qtd, avg);

    if (status === 'ZERADO') {
      return {
        label: 'Zerado',
        cls: 'border-red-200 bg-red-50 text-red-700',
      };
    }

    if (status === 'ALTO') {
      return {
        label: 'Alto',
        cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    }

    return {
      label: 'Baixo',
      cls: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  function depLabel(p) {
    const ids = p._deposito_ids?.length
      ? p._deposito_ids
      : p.deposito_id
        ? [p.deposito_id]
        : [];

    if (ids.length > 1) return `${ids.length} depósitos`;

    const dep = depositos?.find((d) => d.id === ids[0]);
    if (!dep) return '—';

    return `${dep.numero || ''}${dep.nome ? ` — ${dep.nome}` : ''}`.trim() || '—';
  }

  function gavetaLabel(p) {
    const ids = p._gaveta_ids?.length
      ? p._gaveta_ids
      : p.gaveta_id
        ? [p.gaveta_id]
        : [];

    if (ids.length > 1) return `${ids.length} gavetas`;

    return getNome(ids[0], gavetas, 'codigo');
  }

  function unitCost(p) {
    return Number(p.custo_unitario) || 0;
  }

  function rowValue(p) {
    return (
      (Number(p.quantidade) || 0) *
      unitCost(p)
    );
  }

  function exportCsv() {
    const headers = [
      'Produto',
      'Código',
      'Referência',
      'Quantidade',
      'Unidade',
      'Reservado',
      'Disponível',
      'Valor Unitário',
      'Valor Total',
      'Setor',
      'Depósito',
      'Máquina',
      'Gaveta',
      'Status',
    ];

    const rows = produtos.map((p) => [
      p.nome || '',
      p.codigo || '',
      p.codigo_referencia || '',
      Number(p.quantidade) || 0,
      p.unidade || '',
      Number(p.quantidade_reservada) || 0,
      p.quantidade_disponivel !== undefined
        ? Number(p.quantidade_disponivel) || 0
        : '',
      unitCost(p),
      rowValue(p),
      getNome(p.setor_id, setores),
      depLabel(p),
      getNome(p.maquina_id, maquinas),
      gavetaLabel(p),
      getStatus(p.quantidade).label,
    ]);

    const content = [
      headers.map(csvEscape).join(';'),
      ...rows.map((row) => row.map(csvEscape).join(';')),
    ].join('\r\n');

    const blob = new Blob([`\uFEFF${content}`], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pesquisa-estoque-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const columns = [
    {
      key: 'imagem',
      label: 'Imagem',
      render: (p) => <ProductThumb produto={p} />,
    },
    {
      key: 'nome',
      label: 'Produto',
      render: (p) => (
        <div className="min-w-[145px] max-w-[420px] break-words">
          <p className="font-medium leading-tight">{p.nome}</p>
          {p.codigo_referencia && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ref. {p.codigo_referencia}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'codigo',
      label: 'Código',
      render: (p) => (
        <span className="font-mono text-xs">{p.codigo || '—'}</span>
      ),
    },
    {
      key: 'referencia',
      label: 'Ref.',
      render: (p) => (
        <span className="font-mono text-xs text-muted-foreground">
          {p.codigo_referencia || '—'}
        </span>
      ),
    },
    {
      key: 'quantidade',
      label: 'Quantidade',
      align: 'right',
      render: (p) => (
        <span className="font-semibold tabular-nums">
          {formatQtd(p.quantidade || 0)}
        </span>
      ),
      footer: () => (
        <span className="text-xs">
          {totaisPorUnidade
            .map(([unidade, total]) => `${formatQtd(total)} ${unidade}`)
            .join(' • ')}
        </span>
      ),
    },
    {
      key: 'unidade',
      label: 'Unidade',
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {p.unidade || '—'}
        </span>
      ),
    },
    {
      key: 'reservado',
      label: 'Reservado',
      align: 'right',
      render: (p) => (
        <span className="tabular-nums text-muted-foreground">
          {formatQtd(p.quantidade_reservada || 0)}
        </span>
      ),
    },
    {
      key: 'disponivel',
      label: 'Disponível',
      align: 'right',
      render: (p) => (
        <span className="font-medium tabular-nums">
          {formatQtd(
            p.quantidade_disponivel !== undefined
              ? p.quantidade_disponivel
              : p.quantidade || 0
          )}
        </span>
      ),
    },
    {
      key: 'valor_unit',
      label: 'Valor Unit.',
      align: 'right',
      render: (p) => {
        const value = unitCost(p);
        return value > 0 ? formatMoeda(value) : '—';
      },
    },
    {
      key: 'valor_total',
      label: 'Valor Total',
      align: 'right',
      render: (p) => {
        const value = rowValue(p);
        return value > 0 ? (
          <span className="font-semibold text-emerald-700">
            {formatMoeda(value)}
          </span>
        ) : '—';
      },
      footer: () => (
        <span className="font-semibold text-emerald-700">
          {formatMoeda(totalValor)}
        </span>
      ),
    },
    {
      key: 'setor',
      label: 'Setor',
      render: (p) => (
        <span className="text-sm">
          {getNome(p.setor_id, setores)}
        </span>
      ),
    },
    {
      key: 'deposito',
      label: 'Depósito',
      render: (p) => (
        <span className="text-sm">{depLabel(p)}</span>
      ),
    },
    {
      key: 'maquina',
      label: 'Máquina',
      render: (p) => (
        <span className="text-sm">
          {getNome(p.maquina_id, maquinas)}
        </span>
      ),
    },
    {
      key: 'gaveta',
      label: 'Gaveta',
      render: (p) => (
        <span className="font-mono text-sm">
          {gavetaLabel(p)}
        </span>
      ),
    },
    ...(showStatus
      ? [
          {
            key: 'status',
            label: 'Status',
            render: (p) => {
              const st = getStatus(p.quantidade || 0);
              return (
                <Badge
                  variant="outline"
                  className={`${st.cls} whitespace-nowrap`}
                >
                  {st.label}
                </Badge>
              );
            },
          },
        ]
      : []),
    ...(hasActions
      ? [
          {
            key: 'actions',
            label: 'Ações',
            align: 'right',
            render: (p) => (
              <span className="inline-flex gap-1">
                {onEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(p);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(p);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  const config = useColumnConfig(
    'productsTableColsV2',
    [
      'imagem',
      'nome',
      'codigo',
      'referencia',
      'quantidade',
      'unidade',
      'valor_unit',
      'valor_total',
      'setor',
      'deposito',
      'maquina',
      'gaveta',
      'status',
    ]
  );

  const ctx = {
    setores,
    maquinas,
    gavetas,
    depositos,
    onEdit,
    onDelete,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">
            {produtos.length} registro(s)
          </p>
          <p className="text-xs text-muted-foreground">
            Use “Colunas” para escolher o que deseja visualizar.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={produtos.length === 0}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      <div className="hidden sm:block">
        <DataTable
          config={config}
          columns={columns}
          data={paginaRows}
          getRowId={(p) => p._rowKey || p.id}
          ctx={ctx}
          onRowClick={onEdit || undefined}
          rowClassName={onEdit ? 'cursor-pointer' : ''}
          footerLabel="Total"
          containerClassName="max-h-[560px]"
          toggleLabel="Colunas"
        />
      </div>

      <div className="divide-y overflow-hidden rounded-xl border sm:hidden">
        {paginaRows.map((p) => {
          const st = getStatus(p.quantidade || 0);

          return (
            <div key={p._rowKey || p.id} className="space-y-3 p-3">
              <div className="flex items-start gap-3">
                <ProductThumb produto={p} />

                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{p.nome}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.codigo || 'Sem código'}
                    {p.codigo_referencia
                      ? ` • ${p.codigo_referencia}`
                      : ''}
                  </p>
                </div>

                {showStatus && (
                  <Badge variant="outline" className={st.cls}>
                    {st.label}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Quantidade</p>
                  <p className="font-semibold">
                    {formatQtd(p.quantidade || 0)} {p.unidade || ''}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Valor total</p>
                  <p className="font-semibold">
                    {rowValue(p) > 0 ? formatMoeda(rowValue(p)) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Setor</p>
                  <p>{getNome(p.setor_id, setores)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Depósito</p>
                  <p>{depLabel(p)}</p>
                </div>
              </div>
            </div>
          );
        })}

        {paginaRows.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum produto encontrado.
          </p>
        )}
      </div>

      {produtos.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Exibir</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">por página</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {paginaAtual} de {totalPaginas} página(s)
            </span>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={paginaAtual <= 1}
              onClick={() =>
                setPage((prev) => Math.max(1, prev - 1))
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Badge variant="outline">{paginaAtual}</Badge>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={paginaAtual >= totalPaginas}
              onClick={() =>
                setPage((prev) => Math.min(totalPaginas, prev + 1))
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
