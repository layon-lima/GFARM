import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Columns3, GripVertical } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export const COLUMN_LABELS = {
  produto: 'Produto',
  tipo: 'Tipo',
  abertura: 'Abertura',
  fechamento: 'Fechamento',
  motorista: 'Motorista',
  placa: 'Placa',
  tara: 'Tara',
  bruto: 'Bruto',
  liquido: 'Líquido',
  pedido: 'Pedido',
  cliente: 'Cliente',
  nf: 'NF',
  status: 'Status',
};

export const DEFAULT_ORDER = [
  'produto', 'tipo', 'abertura', 'fechamento', 'motorista', 'placa',
  'tara', 'bruto', 'liquido', 'pedido', 'cliente', 'nf', 'status',
];

export const DEFAULT_VISIBLE = {
  produto: true, tipo: true, abertura: true, fechamento: true, motorista: true,
  placa: true, tara: true, bruto: true, liquido: true, pedido: true,
  cliente: true, nf: true, status: true,
};

export default function TicketColumnsManager({ order, visible, onReorder, onToggle }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
          <Columns3 className="w-4 h-4" /> Colunas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <DragDropContext onDragEnd={(result) => {
          if (!result.destination || result.destination.index === result.source.index) return;
          const newOrder = Array.from(order);
          const [moved] = newOrder.splice(result.source.index, 1);
          newOrder.splice(result.destination.index, 0, moved);
          onReorder(newOrder);
        }}>
          <Droppable droppableId="cols">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-0.5">
                {order.map((key, idx) => (
                  <Draggable key={key} draggableId={key} index={idx}>
                    {(p) => (
                      <div
                        ref={p.innerRef}
                        {...p.draggableProps}
                        className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60"
                      >
                        <span {...p.dragHandleProps} className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground">
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <Checkbox
                          checked={!!visible[key]}
                          onCheckedChange={(v) => onToggle(key, !!v)}
                        />
                        <Label className="cursor-pointer text-sm flex-1">{COLUMN_LABELS[key] || key}</Label>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </PopoverContent>
    </Popover>
  );
}