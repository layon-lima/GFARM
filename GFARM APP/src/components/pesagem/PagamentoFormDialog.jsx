import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
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
import SearchSelect from '@/components/SearchSelect';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { formatQtd, parseQtd } from '@/lib/format';
import {
  formatMoeda,
  nextPagamentoNumber,
  round3,
} from '@/lib/pesagem';

const FORMAS = [
  { value: 'pix', label: 'Pix' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'outro', label: 'Outro' },
];

function nowLocalDateTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const EMPTY = {
  pedido_id: '',
  valor: '',
  forma_pagamento: 'pix',
  data_pagamento: nowLocalDateTime(),
  observacao: '',
};

function valorPesadoDoPedido(pedido, tickets) {
  const pesoSaca = Number(pedido?.peso_saca_kg) || 0;
  const valorSaca = Number(pedido?.valor_saca) || 0;

  const liquidoKg = (tickets || [])
    .filter(
      (ticket) =>
        ticket.pedido_id === pedido?.id &&
        ticket.status === 'fechado'
    )
    .reduce(
      (sum, ticket) =>
        sum + (Number(ticket.peso_liquido) || 0),
      0
    );

  if (!(pesoSaca > 0) || !(valorSaca > 0)) {
    return {
      liquidoKg,
      sacasPesadas: 0,
      valorPesado: 0,
    };
  }

  const sacasPesadas = liquidoKg / pesoSaca;

  return {
    liquidoKg,
    sacasPesadas,
    valorPesado: round3(sacasPesadas * valorSaca),
  };
}

function valorFinanceiroPedido(pedido, tickets) {
  const contratado = Number(pedido?.valor_total) || 0;

  if (!pedido?.sem_limite && contratado > 0) {
    return contratado;
  }

  return valorPesadoDoPedido(pedido, tickets).valorPesado;
}

export default function PagamentoFormDialog({
  open,
  onClose,
  onSaved,
  pagamento,
  pedidoInicialId = '',
  pedidos = [],
  pessoas = [],
  tickets = [],
  pagamentos = [],
}) {
  const isEdit = !!pagamento;
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;

    if (pagamento) {
      const dt = pagamento.data_pagamento
        ? new Date(pagamento.data_pagamento)
        : new Date();

      dt.setMinutes(
        dt.getMinutes() - dt.getTimezoneOffset()
      );

      setForm({
        pedido_id: pagamento.pedido_id || '',
        valor: String(pagamento.valor ?? ''),
        forma_pagamento:
          pagamento.forma_pagamento || 'pix',
        data_pagamento: dt
          .toISOString()
          .slice(0, 16),
        observacao: pagamento.observacao || '',
      });

      return;
    }

    setForm({
      ...EMPTY,
      pedido_id: pedidoInicialId || '',
      data_pagamento: nowLocalDateTime(),
    });
  }, [open, pagamento, pedidoInicialId]);

  const pedidoSel = pedidos.find(
    (pedido) => pedido.id === form.pedido_id
  );

  const clienteNome = (id) =>
    pessoas.find((p) => p.id === id)?.nome || '—';

  const pedidosDisponiveis = useMemo(
    () =>
      pedidos
        .filter(
          (pedido) => pedido.status !== 'cancelado'
        )
        .sort(
          (a, b) =>
            new Date(b.created_date || 0) -
            new Date(a.created_date || 0)
        ),
    [pedidos]
  );

  const resumo = useMemo(() => {
    if (!pedidoSel) return null;

    const pesado = valorPesadoDoPedido(
      pedidoSel,
      tickets
    );

    const valorPedido = valorFinanceiroPedido(
      pedidoSel,
      tickets
    );

    const totalPago = round3(
      (pagamentos || [])
        .filter(
          (item) =>
            item.pedido_id === pedidoSel.id &&
            (!isEdit || item.id !== pagamento?.id)
        )
        .reduce(
          (sum, item) =>
            sum + (Number(item.valor) || 0),
          0
        )
    );

    return {
      ...pesado,
      valorPedido,
      totalPago,
      saldo: round3(
        Math.max(0, valorPedido - totalPago)
      ),
    };
  }, [
    pedidoSel,
    tickets,
    pagamentos,
    isEdit,
    pagamento?.id,
  ]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.pedido_id) {
      toast({
        variant: 'destructive',
        title: 'Selecione um pedido',
      });
      return;
    }

    if (parseQtd(form.valor) <= 0) {
      toast({
        variant: 'destructive',
        title: 'Valor inválido',
        description:
          'Informe um valor maior que zero.',
      });
      return;
    }

    setSaving(true);

    try {
      const payload = {
        pedido_id: form.pedido_id,
        cliente_id: pedidoSel?.cliente_id || '',
        valor: parseQtd(form.valor),
        forma_pagamento: form.forma_pagamento,
        data_pagamento: new Date(
          form.data_pagamento
        ).toISOString(),
        observacao: form.observacao.trim(),
      };

      if (isEdit) {
        await api.entities.Pagamento.update(
          pagamento.id,
          payload
        );

        toast({
          title: 'Pagamento atualizado',
          description: pagamento.numero || '',
        });
      } else {
        payload.numero =
          nextPagamentoNumber(pagamentos);

        const created =
          await api.entities.Pagamento.create(
            payload
          );

        toast({
          title: 'Pagamento registrado',
          description:
            created?.numero || payload.numero,
        });
      }

      await onSaved?.();
      onClose?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar pagamento',
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
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <Pencil className="h-5 w-5 text-primary" />
            ) : (
              <Plus className="h-5 w-5 text-primary" />
            )}

            {isEdit
              ? 'Editar Pagamento'
              : 'Registrar Pagamento'}
          </DialogTitle>

          <DialogDescription>
            {isEdit
              ? 'Altere os dados do pagamento registrado.'
              : 'Registre um recebimento vinculado a um pedido de venda.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label>Pedido de Venda *</Label>

            <SearchSelect
              value={form.pedido_id}
              onChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  pedido_id: value,
                }))
              }
              placeholder="Buscar pedido..."
              disabled={isEdit}
              options={pedidosDisponiveis.map(
                (pedido) => ({
                  value: pedido.id,
                  label: `${pedido.numero ? `${pedido.numero} · ` : ''}${clienteNome(pedido.cliente_id)}`,
                })
              )}
            />
          </div>

          {resumo && (
            <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  Cliente
                </p>
                <p className="font-medium">
                  {clienteNome(pedidoSel.cliente_id)}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Valor do pedido
                </p>
                <p className="font-semibold">
                  {formatMoeda(resumo.valorPedido)}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Já recebido
                </p>
                <p className="font-semibold text-emerald-700">
                  {formatMoeda(resumo.totalPago)}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Saldo a receber
                </p>
                <p className="font-semibold">
                  {formatMoeda(resumo.saldo)}
                </p>
              </div>

              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">
                  Peso já concluído
                </p>
                <p className="font-medium">
                  {formatQtd(resumo.liquidoKg)} kg
                  {resumo.sacasPesadas > 0
                    ? ` · ${formatQtd(resumo.sacasPesadas)} sacas`
                    : ''}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pg-valor">
                Valor recebido (R$) *
              </Label>

              <Input
                id="pg-valor"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={form.valor}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    valor: e.target.value,
                  }))
                }
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Forma de pagamento</Label>

              <SearchSelect
                value={form.forma_pagamento}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    forma_pagamento: value,
                  }))
                }
                placeholder="Forma..."
                options={FORMAS}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pg-data">
              Data do Pagamento *
            </Label>

            <Input
              id="pg-data"
              type="datetime-local"
              value={form.data_pagamento}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  data_pagamento: e.target.value,
                }))
              }
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pg-obs">
              Observação
            </Label>

            <Textarea
              id="pg-obs"
              rows={3}
              value={form.observacao}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  observacao: e.target.value,
                }))
              }
              placeholder="Informações sobre este recebimento..."
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
                  ? 'Salvar alteração'
                  : 'Registrar Pagamento'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
