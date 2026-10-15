import { ArrowDownCircle, ArrowUpCircle, Undo2, Hash, Truck, KeyRound, Layers, CalendarClock, MapPin, NotebookPen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getNome } from '@/lib/estoqueFilters';
import { formatQtd } from '@/lib/format';
import ValidadeBadge from '@/components/ValidadeBadge';

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-2 w-40 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className="text-sm flex-1 break-words">{children ?? '—'}</div>
    </div>
  );
}

export default function MovimentacaoDetalhe({ mov, produtos, setores, maquinas, gavetas, lotes }) {
  if (!mov) return null;
  const prod = produtos.find((p) => p.id === mov.produto_id);
  const unidade = prod?.unidade || '';
  const consumidos = mov.lotes_consumidos ? safeParse(mov.lotes_consumidos) : [];

  return (
    <Card className="p-5 mt-4 border-primary/30">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Detalhes da Movimentação</h3>
        {mov.tipo === 'entrada' ? (
          <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
            <ArrowDownCircle className="w-3.5 h-3.5" /> Entrada
          </Badge>
        ) : mov.tipo === 'saida' ? (
          <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
            <ArrowUpCircle className="w-3.5 h-3.5" /> Saída
          </Badge>
        ) : (
          <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
            <Undo2 className="w-3.5 h-3.5" /> Estorno
          </Badge>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6">
        <Row icon={Hash} label="Movimento nº"><span className="font-mono text-xs">{mov.numero || '—'}</span></Row>
        <Row label="Data/Hora">{mov.data ? new Date(mov.data).toLocaleString('pt-BR') : '—'}</Row>
        <Row label="Produto">{mov.nome_produto || prod?.nome || '—'}</Row>
        <Row label="Quantidade">
          <span className="font-semibold tabular-nums">{formatQtd(mov.quantidade || 0)} {unidade}</span>
        </Row>
        <Row label="Código"><span className="font-mono text-xs">{mov.codigo || '—'}</span></Row>
        <Row icon={MapPin} label="Setor">{getNome(mov.setor_id, setores)}</Row>
        <Row icon={MapPin} label="Máquina">{getNome(mov.maquina_id, maquinas)}</Row>
        <Row icon={MapPin} label="Gaveta">{getNome(mov.gaveta_id, gavetas, 'codigo')}</Row>

        {mov.tipo === 'entrada' && (
          <>
            <Row icon={Hash} label="Número da NF">{mov.numero_nf || '—'}</Row>
            <Row icon={Truck} label="Fornecedor">{mov.fornecedor || '—'}</Row>
            <Row icon={KeyRound} label="Chave de Acesso">
              {mov.chave_acesso ? <span className="font-mono text-xs break-all">{mov.chave_acesso}</span> : '—'}
            </Row>
          </>
        )}

        {mov.lote_id && (
          <Row icon={Layers} label="Lote">{resolveLote(mov.lote_id, lotes) || '—'}</Row>
        )}
        {mov.data_validade && (
          <Row icon={CalendarClock} label="Validade"><ValidadeBadge dataValidade={mov.data_validade} /></Row>
        )}
        {consumidos.length > 0 && (
          <Row icon={Layers} label="Lotes consumidos (FEFO)">
            <div className="space-y-1">
              {consumidos.map((c, i) => (
                <div key={i} className="text-xs">
                  {resolveLote(c.lote_id, lotes)} — {formatQtd(c.quantidade)} {unidade}
                </div>
              ))}
            </div>
          </Row>
        )}
        <Row icon={NotebookPen} label="Observação">{mov.observacao || '—'}</Row>
      </div>
    </Card>
  );
}

function safeParse(str) {
  try { return JSON.parse(str) || []; } catch { return []; }
}
function resolveLote(id, lotes) {
  const l = lotes.find((x) => x.id === id);
  return l?.codigo_lote || id || '';
}