import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatQtd, parseQtd } from '@/lib/format';
import { parseItens, saldoProduto } from '@/lib/osAplicacao';

// Distribui um total proporcionalmente aos previstos de cada OS (3 casas).
function distribuirProduto(entries, total) {
  const T = parseQtd(total);
  const n = entries.length;
  if (n === 0) return [];
  const previstos = entries.map((e) => parseQtd(e.previsto));
  const S = previstos.reduce((a, b) => a + b, 0);
  let raw;
  if (S > 0) {
    raw = previstos.map((p) => (p / S) * T);
  } else {
    // Sem previsto em nenhuma Aplicações: divide igualmente.
    raw = previstos.map(() => T / n);
  }
  let rounded = raw.map((r) => Math.round(r * 1000) / 1000);
  const diff = Math.round((T - rounded.reduce((a, b) => a + b, 0)) * 1000) / 1000;
  if (Math.abs(diff) >= 0.001) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[maxIdx]) maxIdx = i;
    rounded[maxIdx] = Math.round((rounded[maxIdx] + diff) * 1000) / 1000;
  }
  return rounded;
}

export default function AutobaixaDialog({ open, onOpenChange, ordens, produtos, saldos, onConfirm, saving }) {
  const [totais, setTotais] = useState({});
  const [erro, setErro] = useState('');

  // Agrupa produtos de todas as aplicações selecionadas e soma o previsto.
  const grupos = useMemo(() => {
    const map = {};
    for (const os of ordens || []) {
      for (const it of parseItens(os.itens)) {
        const pid = it.produto_id;
        if (!pid) continue;
        if (!map[pid]) map[pid] = { produto_id: pid, nome: it.nome, unidade: it.unidade || 'un', previstoTotal: 0, entries: [] };
        const prev = parseQtd(it.previsto);
        map[pid].previstoTotal += prev;
        map[pid].entries.push({ osId: os.id, osNumero: os.numero, previsto: prev });
      }
    }
    return Object.values(map);
  }, [ordens]);

  useEffect(() => {
    if (open) {
      const init = {};
      for (const g of grupos) init[g.produto_id] = String(g.previstoTotal);
      setTotais(init);
      setErro('');
    }
  }, [open, grupos]);

  // Pré-visualização da distribuição por produto.
  const preview = useMemo(() => {
    const m = {};
    for (const g of grupos) {
      m[g.produto_id] = distribuirProduto(g.entries, totais[g.produto_id] ?? g.previstoTotal);
    }
    return m;
  }, [grupos, totais]);

  function buildDistribuicao() {
    const dist = {}; // osId -> { produto_id: realizado }
    for (const g of grupos) {
      const realizados = distribuirProduto(g.entries, totais[g.produto_id] ?? g.previstoTotal);
      g.entries.forEach((e, i) => {
        if (!dist[e.osId]) dist[e.osId] = {};
        dist[e.osId][g.produto_id] = realizados[i];
      });
    }
    const result = {};
    for (const os of ordens || []) {
      result[os.id] = parseItens(os.itens).map((it) => ({
        ...it,
        realizado: dist[os.id]?.[it.produto_id] ?? 0,
      }));
    }
    return result;
  }

  function preValidar() {
    const dist = buildDistribuicao();
    const saldoMap = {};
    for (const s of saldos || []) {
      const k = `${s.produto_id}|${s.deposito_id}`;
      saldoMap[k] = (saldoMap[k] || 0) + (s.quantidade || 0);
    }
    for (const os of ordens || []) {
      for (const it of dist[os.id] || []) {
        const r = parseQtd(it.realizado);
        if (r <= 0) continue;
        const produto = (produtos || []).find((p) => p.id === it.produto_id);
        const dep = it.deposito_id || produto?.deposito_id || '';
        if (!dep) return `Depósito obrigatório para ${produto?.nome || it.nome} (OS ${os.numero}).`;
        const k = `${it.produto_id}|${dep}`;
        if ((saldoMap[k] || 0) < r) return `Saldo insuficiente de ${produto?.nome || it.nome} (OS ${os.numero}).`;
        saldoMap[k] -= r;
      }
    }
    return null;
  }

  function handleConfirm() {
    const err = preValidar();
    if (err) {
      setErro(err);
      return;
    }
    setErro('');
    onConfirm?.(buildDistribuicao());
  }

  if (!open) return null;
  if (!ordens || ordens.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" /> Autobaixa — {ordens.length} aplicações selecionadas
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Informe o total real utilizado de cada produto. O sistema distribui esse total entre as aplicações
          proporcionalmente ao que cada uma pedia (previsto) e baixa o estoque de todas de uma vez.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="glass-pill rounded-md px-2.5 py-1">Aplicações: <b className="text-foreground">{ordens.length}</b></span>
          <span className="glass-pill rounded-md px-2.5 py-1">Área total: <b className="text-foreground">{formatQtd((ordens || []).reduce((s, o) => s + (Number(o.hectares) || 0), 0))}</b></span>
        </div>

        <div className="border rounded-xl overflow-x-auto scrollbar-thin">
          <table className="min-w-full w-auto text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left whitespace-nowrap">Produto</th>
                <th className="p-2 text-right whitespace-nowrap">Previsto Total</th>
                <th className="p-2 text-right whitespace-nowrap">Saldo Disp.</th>
                <th className="p-2 text-right whitespace-nowrap">Realizado Total *</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const saldo = saldoProduto(g.produto_id, saldos);
                const T = parseQtd(totais[g.produto_id] ?? g.previstoTotal);
                const insuficiente = T > saldo;
                const dist = preview[g.produto_id] || [];
                return (
                  <Fragment key={g.produto_id}>
                    <tr className="border-t">
                      <td className="p-2 whitespace-nowrap">
                        <span className="font-medium">{g.nome}</span>
                        <span className="text-xs text-muted-foreground ml-1">({g.unidade})</span>
                      </td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatQtd(g.previstoTotal)}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">{formatQtd(saldo)}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <Input
                          type="text"
                          inputMode="decimal"
                          className={`h-8 w-32 text-right ${insuficiente ? 'border-destructive text-destructive' : ''}`}
                          value={totais[g.produto_id] ?? ''}
                          onChange={(e) => setTotais((prev) => ({ ...prev, [g.produto_id]: e.target.value }))}
                        />
                        {insuficiente && (
                          <span className="flex items-center gap-1 text-xs text-destructive mt-0.5 justify-end">
                            <AlertTriangle className="w-3 h-3" /> Saldo insuficiente
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr className="bg-muted/20">
                      <td colSpan={4} className="p-2">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Distribuição:</span>
                          {g.entries.map((e, i) => (
                            <span key={e.osId} className="tabular-nums">
                              {e.osNumero}: <b className="text-foreground">{formatQtd(dist[i] || 0)}</b>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {erro && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{erro}</span>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Processando…' : `Confirmar baixa em lote (${ordens.length} OS)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}