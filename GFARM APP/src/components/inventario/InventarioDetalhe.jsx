import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Warehouse,
} from 'lucide-react';
import { formatQtd } from '@/lib/format';
import { parseInventarioCriterios } from '@/lib/inventario';

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function miniInfo(label, value) {
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value || '—'}</p>
    </div>
  );
}

export default function InventarioDetalhe({
  inventario,
  depositos = [],
  setores = [],
  open,
  onOpenChange,
}) {
  let itens = [];
  try {
    itens = inventario?.itens ? JSON.parse(inventario.itens) : [];
  } catch {
    itens = [];
  }

  const criterios = parseInventarioCriterios(inventario);
  const deposito = depositos.find((d) => d.id === criterios.deposito_id);
  const setor = setores.find((s) => s.id === (criterios.setor_id || inventario?.setor_id));
  const depositoNome = deposito
    ? `${deposito.numero || ''}${deposito.numero && deposito.nome ? ' · ' : ''}${deposito.nome || ''}`
    : criterios.deposito_id
      ? 'Depósito não encontrado'
      : 'Inventário legado';
  const setorNome = setor?.nome || inventario?.setor_nome || 'Todos os setores';
  const consistente = inventario?.resultado === 'consistente';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b bg-muted/20 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Documento de inventário
                </p>
                <DialogTitle className="mt-0.5 flex items-center gap-2 text-xl">
                  {inventario?.numero || 'Inventário'}
                </DialogTitle>
              </div>
            </div>

            {consistente ? (
              <Badge variant="outline" className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Consistente
              </Badge>
            ) : (
              <Badge variant="outline" className="w-fit border-amber-200 bg-amber-50 text-amber-700">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                Divergente
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="max-h-[calc(92vh-86px)] space-y-4 overflow-y-auto p-5 scrollbar-thin">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {miniInfo('Depósito', depositoNome)}
            {miniInfo('Setor', setorNome)}
            {miniInfo('Data', fmtData(inventario?.data))}
            {miniInfo('Responsável', inventario?.responsavel || '—')}
          </div>

          <Card className="overflow-hidden rounded-2xl border shadow-none">
            <div className="flex flex-col gap-2 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Resultado da contagem</h3>
                <p className="text-xs text-muted-foreground">{inventario?.criterios_descricao || '—'}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{Number(inventario?.total_itens) || 0} itens</Badge>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  {Number(inventario?.total_acertos) || 0} conferem
                </Badge>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  {Number(inventario?.total_divergencias) || 0} divergências
                </Badge>
              </div>
            </div>

            <div className="max-h-[52vh] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[260px]">Produto</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead className="text-right">Sistema</TableHead>
                    <TableHead className="text-right">Contado</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((item) => {
                    const acerto = item.status === 'acerto';
                    return (
                      <TableRow key={item.produto_id}>
                        <TableCell>
                          <p className="text-sm font-semibold">{item.nome || '—'}</p>
                          <p className="text-xs text-muted-foreground">{item.unidade || 'un'}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.codigo || '—'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatQtd(item.qtd_sistema)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums">
                          {formatQtd(item.qtd_contada)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={acerto ? 'text-muted-foreground' : 'font-semibold text-amber-700'}>
                            {item.divergencia > 0 ? '+' : ''}{formatQtd(item.divergencia)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {acerto ? (
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Confere
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                              <AlertTriangle className="mr-1 h-3 w-3" /> Divergência
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>

          <div className="flex items-center gap-2 rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <Warehouse className="h-4 w-4 shrink-0" />
            O inventário foi fechado no escopo informado e o histórico permanece disponível para auditoria.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
