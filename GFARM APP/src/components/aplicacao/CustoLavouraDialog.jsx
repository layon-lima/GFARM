import { useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatQtd } from '@/lib/format';
import { custoPorLavoura } from '@/lib/osAplicacao';

// Relatório de custo detalhado por lavoura: agrega todas as aplicação baixadas.
export default function CustoLavouraDialog({ open, onOpenChange, lavoura, ordens }) {
  const dados = useMemo(() => {
    if (!lavoura) return null;
    return custoPorLavoura(lavoura.id, ordens);
  }, [lavoura, ordens]);

  if (!lavoura || !dados) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Custo da Lavoura — {lavoura.nome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {lavoura.numero && <Badge variant="secondary">Nº {lavoura.numero}</Badge>}
            <Badge variant="secondary">{formatQtd(lavoura.hectares || 0)} ha</Badge>
            <Badge variant="secondary">{dados.qtdOS} aplicação(ões) baixada(s)</Badge>
            <Badge className="bg-primary text-primary-foreground">Custo Total: R$ {dados.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Badge>
            {lavoura.hectares > 0 && (
              <Badge className="bg-primary/15 text-primary border-transparent">
                R$ {(dados.custoTotal / lavoura.hectares).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /ha
              </Badge>
            )}
          </div>

          {dados.produtos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma aplicação baixada para esta lavoura ainda.</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto scrollbar-thin">
              <table className="min-w-full w-auto text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left whitespace-nowrap">Produto</th>
                    <th className="p-2 text-center whitespace-nowrap">Un.</th>
                    <th className="p-2 text-right whitespace-nowrap">Previsto</th>
                    <th className="p-2 text-right whitespace-nowrap">Realizado</th>
                    <th className="p-2 text-right whitespace-nowrap">Custo Unit.</th>
                    <th className="p-2 text-right whitespace-nowrap">Custo Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.produtos.map((p) => (
                    <tr key={p.produto_id} className="border-t">
                      <td className="p-2 whitespace-nowrap font-medium">{p.nome}</td>
                      <td className="p-2 text-center whitespace-nowrap text-muted-foreground">{p.unidade}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatQtd(p.previsto)}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums font-semibold">{formatQtd(p.realizado)}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">
                        {p.custo > 0 && p.realizado > 0 ? `R$ ${(p.custo / p.realizado).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums font-semibold">
                        R$ {p.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-bold bg-muted/30">
                    <td className="p-2 whitespace-nowrap" colSpan={5}>Total</td>
                    <td className="p-2 text-right whitespace-nowrap tabular-nums">
                      R$ {dados.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}