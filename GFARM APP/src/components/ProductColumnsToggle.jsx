import { Columns3 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

// Colunas fixas (Produto, Ações) nunca aparecem aqui — sempre visíveis.
const DEFAULT_COLUMNS = [
  { key: 'quantidade', label: 'Quantidade' },
  { key: 'valor_unit', label: 'Valor Unit.' },
  { key: 'valor_total', label: 'Valor Total' },
  { key: 'codigo', label: 'Código' },
  { key: 'referencia', label: 'Ref.' },
  { key: 'setor', label: 'Setor' },
  { key: 'deposito', label: 'Depósito' },
  { key: 'maquina', label: 'Máquina' },
  { key: 'gaveta', label: 'Gaveta' },
  { key: 'status', label: 'Status' },
];

export function buildDefaultVisibility(showStatus) {
  const v = {};
  for (const c of DEFAULT_COLUMNS) v[c.key] = true;
  if (showStatus === false) v.status = false;
  return v;
}

export default function ProductColumnsToggle({ visibility, onToggle, showStatus }) {
  const cols = DEFAULT_COLUMNS.filter((c) => (c.key === 'status' ? showStatus !== false : true));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="w-4 h-4" /> Colunas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-2">
        <div className="space-y-1">
          {cols.map((c) => (
            <label
              key={c.key}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer hover:bg-muted/60"
            >
              <Checkbox
                checked={!!visibility[c.key]}
                onCheckedChange={(v) => onToggle(c.key, !!v)}
              />
              <Label className="cursor-pointer text-sm">{c.label}</Label>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}