import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Edit3, Replace, Trash2, PlusCircle } from 'lucide-react';
import { parseQtd } from '@/lib/format';
import { parseItens } from '@/lib/osAplicacao';

// Edição em massa dos itens das OS selecionadas:
// substituir, remover ou adicionar produtos de uma só vez.
export default function EdicaoMassaDialog({ open, onOpenChange, ordens, produtos, onConfirm, saving }) {
  const [modo, setModo] = useState('substituir');
  const [produtoAtualId, setProdutoAtualId] = useState('');
  const [produtoNovoId, setProdutoNovoId] = useState('');
  const [produtoRemoverId, setProdutoRemoverId] = useState('');
  const [produtoAddId, setProdutoAddId] = useState('');
  const [dose, setDose] = useState('');

  // Produtos presentes nas OS selecionadas (para substituir/remover).
  const produtosPresentes = useMemo(() => {
    const map = {};
    for (const os of ordens || []) {
      for (const it of parseItens(os.itens)) {
        if (!map[it.produto_id]) map[it.produto_id] = { produto_id: it.produto_id, nome: it.nome, unidade: it.unidade };
      }
    }
    return Object.values(map);
  }, [ordens]);

  useEffect(() => {
    if (open) {
      setModo('substituir');
      setProdutoAtualId('');
      setProdutoNovoId('');
      setProdutoRemoverId('');
      setProdutoAddId('');
      setDose('');
    }
  }, [open]);

  if (!open) return null;

  // Conta OS afetadas conforme o modo.
  const osAfetadas = (() => {
    if (modo === 'substituir') return (ordens || []).filter((o) => parseItens(o.itens).some((it) => it.produto_id === produtoAtualId)).length;
    if (modo === 'remover') return (ordens || []).filter((o) => parseItens(o.itens).some((it) => it.produto_id === produtoRemoverId)).length;
    if (modo === 'adicionar') return (ordens || []).filter((o) => !parseItens(o.itens).some((it) => it.produto_id === produtoAddId)).length;
    return 0;
  })();

  function buildDistribuicao() {
    const result = {};
    for (const os of ordens || []) {
      let itens = parseItens(os.itens);
      if (modo === 'substituir' && produtoAtualId && produtoNovoId) {
        const novo = (produtos || []).find((p) => p.id === produtoNovoId);
        itens = itens.map((it) =>
          it.produto_id === produtoAtualId
            ? { ...it, produto_id: novo.id, codigo: novo.codigo, nome: novo.nome, unidade: novo.unidade, deposito_id: novo.deposito_id || it.deposito_id || '' }
            : it
        );
      } else if (modo === 'remover' && produtoRemoverId) {
        itens = itens.filter((it) => it.produto_id !== produtoRemoverId);
      } else if (modo === 'adicionar' && produtoAddId) {
        if (!itens.some((it) => it.produto_id === produtoAddId)) {
          const novo = (produtos || []).find((p) => p.id === produtoAddId);
          const previsto = parseQtd(dose) * (Number(os.hectares) || 0);
          itens = [...itens, {
            produto_id: novo.id, codigo: novo.codigo, nome: novo.nome, unidade: novo.unidade,
            dose_por_hect: parseQtd(dose), previsto, deposito_id: novo.deposito_id || '',
            realizado: 0, custo_unitario: Number(novo.custo_unitario) || 0,
          }];
        }
      }
      result[os.id] = itens;
    }
    return result;
  }

  function podeConfirmar() {
    if (modo === 'substituir') return produtoAtualId && produtoNovoId && produtoNovoId !== produtoAtualId;
    if (modo === 'remover') return !!produtoRemoverId;
    if (modo === 'adicionar') return !!produtoAddId && parseQtd(dose) > 0;
    return false;
  }

  function handleConfirm() {
    if (!podeConfirmar()) return;
    onConfirm?.(buildDistribuicao());
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-primary" /> Edição em massa — {ordens?.length || 0} OS
          </DialogTitle>
        </DialogHeader>

        <Tabs value={modo} onValueChange={setModo}>
          <TabsList className="w-full">
            <TabsTrigger value="substituir" className="flex-1"><Replace className="w-3.5 h-3.5 mr-1.5" />Substituir</TabsTrigger>
            <TabsTrigger value="remover" className="flex-1"><Trash2 className="w-3.5 h-3.5 mr-1.5" />Remover</TabsTrigger>
            <TabsTrigger value="adicionar" className="flex-1"><PlusCircle className="w-3.5 h-3.5 mr-1.5" />Adicionar</TabsTrigger>
          </TabsList>

          <TabsContent value="substituir" className="space-y-3 mt-3">
            <p className="text-sm text-muted-foreground">Troca um produto por outro em todas as OS que o contêm (mantém dose e previsto).</p>
            <div>
              <Label className="mb-1">Produto atual</Label>
              <select className="w-full h-9 glass-input rounded-md px-2 text-sm" value={produtoAtualId} onChange={(e) => setProdutoAtualId(e.target.value)}>
                <option value="">Selecione…</option>
                {produtosPresentes.map((p) => <option key={p.produto_id} value={p.produto_id}>{p.nome} ({p.unidade})</option>)}
              </select>
            </div>
            <div>
              <Label className="mb-1">Novo produto</Label>
              <select className="w-full h-9 glass-input rounded-md px-2 text-sm" value={produtoNovoId} onChange={(e) => setProdutoNovoId(e.target.value)}>
                <option value="">Selecione…</option>
                {(produtos || []).map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.unidade})</option>)}
              </select>
            </div>
          </TabsContent>

          <TabsContent value="remover" className="space-y-3 mt-3">
            <p className="text-sm text-muted-foreground">Remove o produto de todas as OS selecionadas que o contêm.</p>
            <div>
              <Label className="mb-1">Produto a remover</Label>
              <select className="w-full h-9 glass-input rounded-md px-2 text-sm" value={produtoRemoverId} onChange={(e) => setProdutoRemoverId(e.target.value)}>
                <option value="">Selecione…</option>
                {produtosPresentes.map((p) => <option key={p.produto_id} value={p.produto_id}>{p.nome} ({p.unidade})</option>)}
              </select>
            </div>
          </TabsContent>

          <TabsContent value="adicionar" className="space-y-3 mt-3">
            <p className="text-sm text-muted-foreground">Adiciona um produto a todas as OS (pula as que já o contêm). Previsto = dose × hectares da OS.</p>
            <div>
              <Label className="mb-1">Produto</Label>
              <select className="w-full h-9 glass-input rounded-md px-2 text-sm" value={produtoAddId} onChange={(e) => setProdutoAddId(e.target.value)}>
                <option value="">Selecione…</option>
                {(produtos || []).map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.unidade})</option>)}
              </select>
            </div>
            <div>
              <Label className="mb-1">Dose (por hectare)</Label>
              <Input type="text" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="0" />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap gap-3 text-sm font-medium text-muted-foreground">
          <span>Aplicações afetadas: <span className="text-foreground">{osAfetadas}</span></span>
          <span>Área total: <span className="text-foreground">{(ordens || []).reduce((s, o) => s + (Number(o.hectares) || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleConfirm} disabled={!podeConfirmar() || saving}>
            {saving ? 'Salvando…' : 'Aplicar alterações'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}