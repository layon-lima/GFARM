import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Infinity as InfinityIcon,
  Pencil,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import SearchSelect from '@/components/SearchSelect';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { parseQtd } from '@/lib/format';
import {
  calcTotalKg,
  calcValorTotal,
  formatKg,
  formatMoeda,
  nextPedidoNumber,
  round3,
  somaLiquidoTickets,
} from '@/lib/pesagem';

const EMPTY = {
  cliente_id: '',
  produto_id: '',
  peso_saca_kg: '60',
  valor_saca: '0',
  qtd_sacas: '0',
  transportadora_ids: [],
  observacao: '',
  sem_limite: false,
};

export default function PedidoFormDialog({
  open,
  onClose,
  onSaved,
  pessoas = [],
  produtos = [],
  transportadoras = [],
  pedido = null,
  duplicarDe = null,
  tickets = [],
  pedidos = [],
}) {
  const isEdit = !!pedido;
  const isDuplicate = !isEdit && !!duplicarDe;
  const fonte = pedido || duplicarDe;

  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;

    if (fonte) {
      setForm({
        cliente_id: fonte.cliente_id || '',
        produto_id: fonte.produto_id || '',
        peso_saca_kg: String(fonte.peso_saca_kg ?? '60'),
        valor_saca: String(fonte.valor_saca ?? '0'),
        qtd_sacas: String(fonte.qtd_sacas ?? '0'),
        transportadora_ids: String(fonte.transportadora_ids || '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
        observacao: isDuplicate
          ? fonte.observacao
            ? `Duplicado de ${fonte.numero || 'pedido'} — ${fonte.observacao}`
            : `Duplicado de ${fonte.numero || 'pedido'}`
          : fonte.observacao || '',
        sem_limite: !!fonte.sem_limite,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, fonte?.id, isDuplicate]);

  const clientes = pessoas.filter((p) => p.is_cliente);
  const produtosVenda = produtos.filter((p) => p.venda);

  const totalKg = useMemo(
    () => calcTotalKg(form.qtd_sacas, form.peso_saca_kg),
    [form.qtd_sacas, form.peso_saca_kg]
  );

  const valorTotal = useMemo(
    () => calcValorTotal(form.qtd_sacas, form.valor_saca),
    [form.qtd_sacas, form.valor_saca]
  );

  const carregadoKg = isEdit
    ? somaLiquidoTickets(tickets, pedido.id)
    : 0;

  const possuiTickets = isEdit
    ? tickets.some((t) => t.pedido_id === pedido.id)
    : false;

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.cliente_id) {
      toast({
        variant: 'destructive',
        title: 'Selecione um cliente',
      });
      return;
    }

    if (!form.produto_id) {
      toast({
        variant: 'destructive',
        title: 'Selecione um produto',
      });
      return;
    }

    if (
      !form.sem_limite &&
      (
        parseQtd(form.qtd_sacas) <= 0 ||
        parseQtd(form.peso_saca_kg) <= 0
      )
    ) {
      toast({
        variant: 'destructive',
        title: 'Quantidade e peso da saca devem ser maiores que zero',
      });
      return;
    }

    if (
      !form.sem_limite &&
      isEdit &&
      totalKg < carregadoKg - 0.001
    ) {
      toast({
        variant: 'destructive',
        title: 'Total menor que o já entregue',
        description: `Já foram pesados ${formatKg(carregadoKg)} em tickets vinculados.`,
      });
      return;
    }

    setSaving(true);

    try {
      const transportadoraIds = form.transportadora_ids || [];

      const transportadoraNomes = transportadoraIds
        .map(
          (id) =>
            transportadoras.find((t) => t.id === id)?.nome
        )
        .filter(Boolean)
        .join(', ');

      const semLimite = !!form.sem_limite;

      const payload = {
        cliente_id: form.cliente_id,
        produto_id: form.produto_id,
        sem_limite: semLimite,
        peso_saca_kg: parseQtd(form.peso_saca_kg),
        valor_saca: parseQtd(form.valor_saca),
        qtd_sacas: semLimite
          ? 0
          : parseQtd(form.qtd_sacas),
        total_kg: semLimite ? 0 : totalKg,
        valor_total: semLimite ? 0 : valorTotal,
        transportadora_ids: transportadoraIds.join(','),
        transportadora_nomes: transportadoraNomes,
        observacao: form.observacao.trim(),
      };

      if (isEdit) {
        payload.saldo_kg = semLimite
          ? 0
          : round3(totalKg - carregadoKg);

        payload.status = pedido.status || 'aberto';

        await api.entities.PedidoPesagem.update(
          pedido.id,
          payload
        );

        toast({
          title: 'Pedido atualizado',
          description: pedido.numero || '',
        });
      } else {
        payload.saldo_kg = semLimite ? 0 : totalKg;
        payload.status = 'aberto';
        payload.numero = nextPedidoNumber(pedidos);

        const created =
          await api.entities.PedidoPesagem.create(payload);

        toast({
          title: isDuplicate
            ? 'Pedido duplicado'
            : 'Pedido criado',
          description: created?.numero || payload.numero,
        });
      }

      await onSaved?.();
      onClose?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar pedido',
        description: String(error?.message || error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !saving) onClose?.();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <Pencil className="h-5 w-5 text-primary" />
            ) : isDuplicate ? (
              <Copy className="h-5 w-5 text-primary" />
            ) : (
              <Plus className="h-5 w-5 text-primary" />
            )}

            {isEdit
              ? `Editar ${pedido.numero || 'pedido'}`
              : isDuplicate
                ? `Duplicar ${duplicarDe.numero || 'pedido'}`
                : 'Novo Pedido de Venda'}
          </DialogTitle>

          <DialogDescription>
            {isEdit
              ? 'Altere os dados comerciais do pedido. Campos de identidade ficam travados quando já existem tickets vinculados.'
              : 'Cadastre o pedido que ficará disponível para os tickets de venda.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cliente *</Label>
              <SearchSelect
                value={form.cliente_id}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    cliente_id: value,
                  }))
                }
                options={clientes
                  .map((c) => ({
                    value: c.id,
                    label: `${c.nome}${c.documento ? ` — ${c.documento}` : ''}`,
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label))}
                placeholder="Buscar cliente..."
                disabled={possuiTickets}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Produto de venda *</Label>
              <SearchSelect
                value={form.produto_id}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    produto_id: value,
                  }))
                }
                options={produtosVenda
                  .map((p) => ({
                    value: p.id,
                    label: `${p.codigo ? `${p.codigo} — ` : ''}${p.nome}`,
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label))}
                placeholder="Buscar produto..."
                disabled={possuiTickets}
              />
            </div>
          </div>

          {possuiTickets && (
            <p className="text-xs text-muted-foreground">
              Cliente e produto não podem ser alterados porque este pedido já possui tickets vinculados.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/15 p-3">
            <div className="flex items-center gap-2">
              <InfinityIcon className="h-4 w-4 text-sky-600" />
              <div>
                <Label className="cursor-pointer">
                  Pedido sem limite
                </Label>
                <p className="text-xs text-muted-foreground">
                  Não bloqueia por saldo; o sistema apenas acumula o peso entregue.
                </p>
              </div>
            </div>

            <Switch
              checked={form.sem_limite}
              onCheckedChange={(value) => {
                const next = {
                  ...form,
                  sem_limite: value,
                };

                if (
                  !value &&
                  isEdit &&
                  carregadoKg > 0
                ) {
                  const peso = parseQtd(form.peso_saca_kg);

                  if (peso > 0) {
                    next.qtd_sacas = String(
                      Math.round(
                        (carregadoKg / peso) * 1e6
                      ) / 1e6
                    );
                  }
                }

                setForm(next);
              }}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Peso de 1 saca (kg)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={form.peso_saca_kg}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    peso_saca_kg: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Valor da saca (R$)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={form.valor_saca}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    valor_saca: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Quantidade de sacas
                {form.sem_limite ? '' : ' *'}
              </Label>
              <Input
                type="text"
                inputMode="decimal"
                value={form.qtd_sacas}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    qtd_sacas: e.target.value,
                  }))
                }
                disabled={form.sem_limite}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Transportadoras autorizadas</Label>
            <p className="text-xs text-muted-foreground">
              Se houver mais de uma, o operador escolherá uma delas no ticket de venda.
            </p>

            {transportadoras.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Nenhuma transportadora cadastrada em Cadastros → Pessoas.
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-auto rounded-xl border p-2">
                {transportadoras
                  .slice()
                  .sort((a, b) =>
                    a.nome.localeCompare(b.nome)
                  )
                  .map((transportadora) => {
                    const checked =
                      form.transportadora_ids.includes(
                        transportadora.id
                      );

                    return (
                      <button
                        key={transportadora.id}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            transportadora_ids: checked
                              ? prev.transportadora_ids.filter(
                                  (id) =>
                                    id !== transportadora.id
                                )
                              : [
                                  ...prev.transportadora_ids,
                                  transportadora.id,
                                ],
                          }))
                        }
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                          checked
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-accent'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? 'border-primary bg-primary'
                              : 'border-input'
                          }`}
                        >
                          {checked && (
                            <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                          )}
                        </span>

                        <span className="truncate">
                          {transportadora.nome}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">
                Total equivalente
              </p>
              <p className="font-semibold">
                {form.sem_limite
                  ? 'Sem limite'
                  : formatKg(totalKg)}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">
                Valor do pedido
              </p>
              <p className="font-semibold">
                {form.sem_limite
                  ? '—'
                  : formatMoeda(valorTotal)}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">
                Já entregue
              </p>
              <p className="font-semibold">
                {isEdit
                  ? formatKg(carregadoKg)
                  : '0,00 kg'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea
              rows={3}
              value={form.observacao}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  observacao: e.target.value,
                }))
              }
              placeholder="Condições comerciais, orientação para a pesagem ou informação complementar..."
            />
          </div>

          <div className="flex gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              className="flex-1"
              disabled={saving}
            >
              {saving
                ? 'Salvando...'
                : isEdit
                  ? 'Salvar pedido'
                  : isDuplicate
                    ? 'Criar cópia'
                    : 'Criar pedido'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
