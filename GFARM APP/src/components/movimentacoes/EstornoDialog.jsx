import { useState } from 'react';
import { Undo2, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatQtd } from '@/lib/format';
import { estornarMovimentacao } from '@/lib/movimentacoes';

const TIPO_LABEL = { entrada: 'Entrada', saida: 'Saída', estorno: 'Estorno' };

function checar(m) {
  if (!m || !m.id) return { ok: false, msg: 'Movimentação inválida ou inexistente.' };
  if (m.tipo === 'estorno') return { ok: false, msg: 'Não é possível estornar uma movimentação de estorno.' };
  if (m.estornada === true) return { ok: false, msg: 'Esta movimentação já foi estornada.' };
  return { ok: true };
}

export default function EstornoDialog({ alvo, produtos, lotes, saldos, movimentacoes, onClose, onDone }) {
  const open = !!alvo;
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  const checagem = checar(alvo);
  const prod = alvo ? produtos.find((p) => p.id === alvo.produto_id) : null;

  async function handleConfirm() {
    if (!alvo) return;
    setErro('');
    setSaving(true);
    try {
      await estornarMovimentacao(alvo, { produtos, lotes, saldos, movimentacoes });
      onDone?.();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setErro(''); onClose?.(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Undo2 className="w-5 h-5 text-amber-600" /> Estornar Movimentação</DialogTitle>
          <DialogDescription>Reverte o efeito no estoque e registra uma movimentação de estorno vinculada ao ID original.</DialogDescription>
        </DialogHeader>

        {alvo && (
          <div className="space-y-3">
            <div className="rounded-lg border p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Nº (ID):</span><span className="font-mono font-semibold">{alvo.numero || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tipo:</span><Badge variant="outline">{TIPO_LABEL[alvo.tipo] || alvo.tipo}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Produto:</span><span className="font-medium truncate ml-2">{alvo.nome_produto || prod?.nome || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Quantidade:</span><span className="font-semibold tabular-nums">{formatQtd(alvo.quantidade || 0)} {prod?.unidade || ''}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Data:</span><span>{alvo.data ? new Date(alvo.data).toLocaleString('pt-BR') : '—'}</span></div>
              {alvo.numero_nf && <div className="flex justify-between"><span className="text-muted-foreground">NF:</span><span className="font-mono text-xs">{alvo.numero_nf}</span></div>}
            </div>

            {!checagem.ok ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{checagem.msg}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>O estoque será revertido (saldo e lotes) e a movimentação marcada como estornada. Uma nova movimentação de estorno será criada. Esta ação não pode ser desfeita.</span>
              </div>
            )}

            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!checagem.ok || saving} className="bg-amber-600 hover:bg-amber-700">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Estornando…</> : <><Undo2 className="w-4 h-4 mr-2" /> Confirmar Estorno</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}