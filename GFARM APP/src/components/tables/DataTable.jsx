import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Settings2 } from 'lucide-react';
import {
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableFooter,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

// Tabela genérica com:
//  - colunas arrastáveis (reordenação persistida via `config`)
//  - sem quebra de texto (whitespace-nowrap em todas as células + scroll horizontal)
//  - toggle de visibilidade de colunas
//
// `config` vem de useColumnConfig(storageKey, defaultOrder).
// `columns`: [{ key, label, align?, render:(row,ctx)=>node, footer?:(ctx)=>node, headerClassName?, cellClassName? }]
export default function DataTable({
  config,
  columns,
  data,
  getRowId = (row, i) => row.id || String(i),
  ctx,
  onRowClick,
  rowClassName,
  footerLabel = 'Total',
  emptyMessage = 'Nenhum registro encontrado.',
  containerClassName = 'max-h-[560px]',
  toggleLabel = 'Colunas',
  showToolbar = true,
}) {
  const defaultOrder = columns.map((c) => c.key);
  const { order, toggle, reorder } = config;

  const visibleColumns = order
    .map((key) => columns.find((c) => c.key === key))
    .filter(Boolean);

  const [dragging, setDragging] = useState(false);

  function onDragEnd(result) {
    setDragging(false);
    if (!result.destination || result.destination.index === result.source.index) return;
    reorder(result.source.index, result.destination.index);
  }

  const hasFooter = columns.some((c) => c.footer);

  return (
    <div className="w-full min-w-0 rounded-lg border overflow-hidden">
      {showToolbar && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <GripVertical className="w-3.5 h-3.5" />
            Arraste as colunas do cabeçalho para reordenar
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings2 className="w-3.5 h-3.5" /> {toggleLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56" align="end">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground px-1 mb-1">Mostrar colunas</p>
                {defaultOrder.map((key) => {
                  const col = columns.find((c) => c.key === key);
                  if (!col) return null;
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox checked={order.includes(key)} onCheckedChange={() => toggle(key)} />
                      <span>{col.label}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      <div className={`block w-full min-w-0 overflow-auto scrollbar-thin ${containerClassName}`}>
        <table className="w-full min-w-full table-auto caption-bottom text-sm">
          <TableHeader className="sticky top-0 bg-muted z-10">
            <DragDropContext onDragStart={() => setDragging(true)} onDragEnd={onDragEnd}>
              <Droppable droppableId="dt-header" direction="horizontal" type="column">
                {(provided) => (
                  <TableRow ref={provided.innerRef} {...provided.droppableProps}>
                    {visibleColumns.map((col, index) => (
                      <Draggable draggableId={col.key} index={index} key={col.key}>
                        {(p) => (
                          <TableHead
                            ref={p.innerRef}
                            {...p.draggableProps}
                            {...p.dragHandleProps}
                            style={p.draggableProps.style}
                            className={`whitespace-nowrap select-none px-2 ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${col.align === 'right' ? 'text-right' : ''} ${col.headerClassName || ''}`}
                          >
                            <span className="inline-flex items-center gap-1">
                              <GripVertical className="w-3 h-3 text-muted-foreground/60" />
                              {col.label}
                            </span>
                          </TableHead>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </TableRow>
                )}
              </Droppable>
            </DragDropContext>
          </TableHeader>
          <TableBody>
            {data.map((row, i) => (
              <TableRow
                key={getRowId(row, i)}
                onClick={onRowClick ? () => onRowClick(row, ctx) : undefined}
                className={typeof rowClassName === 'function' ? rowClassName(row, ctx) : rowClassName}
              >
                {visibleColumns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={`${['nome', 'produto', 'deposito', 'setor', 'maquina', 'observacao', 'descricao'].includes(col.key) ? 'whitespace-normal break-words' : 'whitespace-nowrap'} px-2 ${col.align === 'right' ? 'text-right' : ''} ${col.cellClassName || ''}`}
                  >
                    {col.render ? col.render(row, ctx) : null}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={Math.max(1, visibleColumns.length)} className="text-center text-sm text-muted-foreground py-8">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {hasFooter && data.length > 0 && (
            <TableFooter className="sticky bottom-0 bg-muted/70 backdrop-blur-sm z-10">
              <TableRow className="font-semibold hover:bg-transparent border-t-2 border-border">
                {visibleColumns.map((col, i) => (
                  <TableCell
                    key={col.key}
                    className={`whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''} ${col.cellClassName || ''}`}
                  >
                    {i === 0 ? footerLabel : col.footer ? col.footer(ctx) : ''}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </table>
      </div>
    </div>
  );
}