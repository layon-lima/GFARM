import { useState } from 'react';
import { Droplet, Check, X, ImageIcon, Clock, Loader2 } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatQtd } from '@/lib/format';
function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';

// Lista de abastecimentos pendentes para confirmação por usuário autorizado.
// A baixa do estoque só acontece ao confirmar aqui.
export default function AbastecimentoPendentes({
  pendentes,
  maquinas,
  produtos,
  savingId,
  onConfirm,
  onCancel,
}) {
  const [fotoAmpliada, setFotoAmpliada] = useState(null);

  if (pendentes.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p>Nenhum abastecimento aguardando confirmação.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {pendentes.map((abast) => {
        const maquina = maquinas.find((m) => m.id === abast.maquina_id);
        const produto = produtos.find((p) => p.id === abast.produto_id);
        const data = fmtData(abast.data);
        const busy = savingId === abast.id;
        return (
          <Card key={abast.id} className="p-3 space-y-3">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => abast.foto_url && setFotoAmpliada(resolveMediaUrl(abast.foto_url))}
                className="shrink-0 w-16 h-16 rounded-md overflow-hidden border bg-muted flex items-center justify-center"
              >
                {abast.foto_url ? (
                  <img src={resolveMediaUrl(abast.foto_url)} alt="Painel" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{maquina?.nome || 'Máquina removida'}</span>
                  {maquina && <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{maquina.codigo}</span>}
                  <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">Pendente</Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <Droplet className="w-3 h-3" />
                  <span className="truncate">{produto?.nome || 'Combustível removido'}</span>
                  <span className="text-foreground font-medium tabular-nums">
                    {formatQtd(abast.quantidade)} {abast.unidade || produto?.unidade || 'un'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" /> {data}
                  {abast.operador && <span>· {abast.operador}</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={busy} onClick={() => onConfirm(abast)}>
                {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Confirmar baixa
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onCancel(abast)}>
                <X className="w-4 h-4 mr-1" />
                Cancelar
              </Button>
            </div>
          </Card>
        );
      })}

      <Dialog open={!!fotoAmpliada} onOpenChange={(o) => !o && setFotoAmpliada(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="sr-only">Foto do painel</DialogTitle>
          {fotoAmpliada && <img src={fotoAmpliada} alt="Painel do abastecedor" className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
