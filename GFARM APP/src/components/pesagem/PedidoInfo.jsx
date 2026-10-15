import { Badge } from '@/components/ui/badge';
import { Infinity as InfinityIcon } from 'lucide-react';
import { formatKg, formatMoeda } from '@/lib/pesagem';
import { formatQtd } from '@/lib/format';

// Exibição padronizada de um pedido: número, cliente, produto, limite/'Sem limite' e valor da saca.
// variant 'block'   -> conteúdo para itens de seletor (sem wrapper/botão)
// variant 'summary' -> bloco resumo em caixa (pedido selecionado)
export default function PedidoInfo({ pedido, clienteNome, produtoNome, variant = 'block' }) {
  if (!pedido) return null;
  const semLimite = !!pedido.sem_limite;
  const pesoSaca = pedido.peso_saca_kg || 0;
  const totalSacas = pesoSaca > 0 ? (pedido.total_kg || 0) / pesoSaca : 0;

  const Numero = pedido.numero ? (
    <span className="font-mono text-[11px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{pedido.numero}</span>
  ) : null;
  const SemLimiteBadge = semLimite ? (
    <Badge className="bg-sky-100 text-sky-700 text-[10px] gap-1"><InfinityIcon className="w-3 h-3" /> Sem limite</Badge>
  ) : null;

  if (variant === 'summary') {
    return (
      <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 space-y-2 shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">{Numero}{SemLimiteBadge}</div>
          {!semLimite && <span className="text-xs text-muted-foreground">Limite {formatQtd(totalSacas)} sacas · {formatKg(pedido.total_kg)}</span>}
        </div>
        <div>
          <p className="font-semibold text-base truncate leading-tight">{clienteNome(pedido.cliente_id)}</p>
          <p className="text-sm text-muted-foreground truncate">{produtoNome(pedido.produto_id)}</p>
          {pedido.observacao ? (
            <p className="text-sm text-muted-foreground italic truncate pt-0.5">Obs: {pedido.observacao}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-between gap-2 pt-1 text-xs">
          <span className="text-muted-foreground">Limite: <b className="text-foreground">{semLimite ? 'Sem limite' : `${formatQtd(pedido.qtd_sacas || 0)} sacas`}</b></span>
          <span className="text-muted-foreground">Valor/saca: <b className="text-foreground">{formatMoeda(pedido.valor_saca)}</b></span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">{Numero}{SemLimiteBadge}</div>
      <p className="font-medium truncate">{clienteNome(pedido.cliente_id)}</p>
      <p className="text-xs text-muted-foreground truncate">{produtoNome(pedido.produto_id)}</p>
      {pedido.observacao ? (
        <p className="text-xs text-muted-foreground italic truncate">Obs: {pedido.observacao}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">Valor/saca: <b className="text-foreground">{formatMoeda(pedido.valor_saca)}</b></p>
    </div>
  );
}