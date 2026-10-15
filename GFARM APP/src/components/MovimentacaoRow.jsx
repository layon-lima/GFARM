import { useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { ArrowDownCircle, ArrowUpCircle, Undo2, Trash2 } from 'lucide-react';
import {
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getNome } from '@/lib/estoqueFilters';
import { formatQtd } from '@/lib/format';
import ValidadeBadge from '@/components/ValidadeBadge';

const THRESHOLD = -90;

export default function MovimentacaoRow({
  mov,
  isSelected,
  onSelect,
  onSwipeDelete,
  produtos,
  setores,
  maquinas,
  gavetas,
  usuarios,
}) {
  const x = useMotionValue(0);
  const tint = useTransform(x, [THRESHOLD, 0], ['inset 0 0 0 9999px rgba(254, 226, 226, 0.95)', 'inset 0 0 0 0 rgba(0,0,0,0)']);
  const hintOpacity = useTransform(x, [THRESHOLD, -25], [1, 0]);
  const draggedRef = useRef(false);
  const isNeg = mov.tipo === 'saida' || mov.tipo === 'estorno';

  function handleClick() {
    if (draggedRef.current) return;
    onSelect();
  }

  return (
    <motion.tr
      drag="x"
      style={{ x, boxShadow: tint }}
      dragConstraints={{ left: THRESHOLD, right: 0 }}
      dragElastic={0.06}
      dragSnapToOrigin
      onDragStart={() => { draggedRef.current = true; }}
      onDragEnd={(e, info) => {
        if (info.offset.x < THRESHOLD) {
          onSwipeDelete(mov);
        }
        setTimeout(() => { draggedRef.current = false; }, 60);
      }}
      onClick={handleClick}
      className={`cursor-pointer transition-colors ${isSelected ? 'bg-accent' : isNeg ? 'bg-red-50/70 hover:bg-red-100/70 text-red-700' : 'hover:bg-muted/50'}`}
    >
      <TableCell className="text-sm whitespace-nowrap relative">
        {mov.data ? new Date(mov.data).toLocaleDateString('pt-BR') : '—'}
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
        {mov.data ? new Date(mov.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {(() => {
          const u = usuarios?.find((x) => x.id === mov.created_by_id);
          if (!u) return '—';
          return u.full_name || u.email || '—';
        })()}
      </TableCell>
      <TableCell className="font-medium text-sm">{mov.nome_produto || '—'}</TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {formatQtd(mov.quantidade || 0)}{' '}
        <span className="text-xs text-muted-foreground font-normal">{produtos.find((p) => p.id === mov.produto_id)?.unidade || ''}</span>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{mov.codigo}</TableCell>
      <TableCell className="text-xs">
        {mov.numero_nf ? (
          <span className="font-mono" title={mov.chave_acesso ? `Chave: ${mov.chave_acesso}` : undefined}>NF {mov.numero_nf}</span>
        ) : null}
        {mov.fornecedor ? <span className="block text-muted-foreground truncate max-w-[140px]">{mov.fornecedor}</span> : null}
        {!mov.numero_nf && !mov.fornecedor ? '—' : null}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          {mov.tipo === 'entrada' ? (
            <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 w-fit">
              <ArrowDownCircle className="w-3 h-3" /> Entrada NF
            </Badge>
          ) : mov.tipo === 'saida' ? (
            <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 w-fit">
              <ArrowUpCircle className="w-3 h-3" /> Baixa Estoque
            </Badge>
          ) : (
            <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 w-fit">
              <Undo2 className="w-3 h-3" /> Estorno
            </Badge>
          )}
          {mov.estornada === true && (
            <span className="text-[10px] text-amber-600 font-medium">estornada</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm">{getNome(mov.setor_id, setores)}</TableCell>
      <TableCell><ValidadeBadge dataValidade={mov.data_validade} /></TableCell>
      <TableCell className="text-center relative">
        {isSelected ? (
          <Undo2 className="w-4 h-4 text-destructive mx-auto" />
        ) : (
          <motion.div style={{ opacity: hintOpacity }} className="flex items-center justify-center gap-1 text-destructive text-xs whitespace-nowrap">
            <Trash2 className="w-3.5 h-3.5" /> arraste ←
          </motion.div>
        )}
      </TableCell>
    </motion.tr>
  );
}