import { Fuel, Droplet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatQtd } from '@/lib/format';
function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AbastecimentoRow({ abast, maquinas, produtos }) {
  const maquina = maquinas.find((m) => m.id === abast.maquina_id);
  const produto = produtos.find((p) => p.id === abast.produto_id);
  const data = fmtData(abast.data);

  const status = abast.status || 'pendente';
  const badge =
    status === 'confirmado'
      ? { label: 'Confirmado', cls: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' }
      : status === 'cancelado'
      ? { label: 'Cancelado', cls: 'bg-red-100 text-red-800 hover:bg-red-100' }
      : { label: 'Pendente', cls: 'bg-amber-100 text-amber-800 hover:bg-amber-100' };

  return (
    <Card className="p-3 flex items-center gap-3">
      <div className="shrink-0 w-9 h-9 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex items-center justify-center">
        <Fuel className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{maquina?.nome || 'Máquina removida'}</span>
          {maquina && <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{maquina.codigo}</span>}
          <Badge variant="secondary" className={badge.cls}>{badge.label}</Badge>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <Droplet className="w-3 h-3" />
          <span className="truncate">{produto?.nome || 'Combustível removido'}</span>
          <span className="text-foreground font-medium tabular-nums">
            {formatQtd(abast.quantidade)} {abast.unidade || produto?.unidade || 'un'}
          </span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs text-muted-foreground">{data}</div>
        {abast.confirmado_por && <div className="text-[11px] text-muted-foreground truncate max-w-[120px]">por {abast.confirmado_por}</div>}
        {abast.numero_mov && <Badge variant="outline" className="mt-0.5 text-[10px] font-mono">{abast.numero_mov}</Badge>}
      </div>
    </Card>
  );
}