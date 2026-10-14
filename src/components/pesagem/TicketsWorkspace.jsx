import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  CircleDot,
  FileText,
  LockKeyhole,
  Package,
  Play,
  RefreshCw,
  Search,
  ShoppingCart,
  Sprout,
  Trash2,
  Truck,
  Weight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import SearchSelect from '@/components/SearchSelect';
import { useBalanca } from '@/lib/balancaContext';
import { useAuth } from '@/lib/AuthContext';
import { podeDigitarPeso } from '@/lib/permissions';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/api/apiClient';
import { safeDelete } from '@/lib/entityOps';
import {
  calcLiquido,
  fecharTicket,
  formatKg,
  formatPlaca,
  nextTicketNumber,
  normalizePlaca,
  statusPorSaldo,
} from '@/lib/pesagem';
import { formatQtd, parseQtd } from '@/lib/format';

const EMPTY_FORM = {
  tipo: '',
  pedido_id: '',
  motorista: '',
  placa: '',
  produto_id: '',
  cliente_id: '',
  transportadora_id: '',
  origem: '',
  destino: '',
  observacao: '',
};

const TIPOS = [
  { value: 'venda', label: 'Venda', icon: ShoppingCart },
  { value: 'lavoura', label: 'Saída para Lavoura', icon: Sprout },
  { value: 'compra', label: 'Entrada por Compra', icon: Truck },
  { value: 'entrada_saida', label: 'Entrada e Saída', icon: ArrowLeftRight },
];

function tipoLabel(tipo) {
  return TIPOS.find((item) => item.value === tipo)?.label || tipo || '—';
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR');
}

export default function TicketsWorkspace({
  tickets = [],
  pedidos = [],
  pessoas = [],
  produtos = [],
  transportadoras = [],
  onReload,
  initialPedidoId = '',
  onInitialPedidoConsumed,
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const podeDigitar = podeDigitarPeso(user);

  const {
    status: statusBalanca,
    ultimaLeitura,
    formatarPeso,
    lerPeso,
    lendo,
  } = useBalanca();

  const [form, setForm] = useState(EMPTY_FORM);
  const [ticketAtivoId, setTicketAtivoId] = useState('');
  const [ticketLocal, setTicketLocal] = useState(null);
  const [pesoAtual, setPesoAtual] = useState('');
  const [capturaPendente, setCapturaPendente] = useState(null);
  const [correcaoPeso, setCorrecaoPeso] = useState('0,00');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [segundaPesagem, setSegundaPesagem] = useState(0);
  const [segundaRegistradaEm, setSegundaRegistradaEm] = useState('');
  const [transportadoraFechamento, setTransportadoraFechamento] = useState('');
  const [buscaAbertos, setBuscaAbertos] = useState('');
  const [saving, setSaving] = useState(false);
  const [excluirTicket, setExcluirTicket] = useState(null);

  const ticketAtivo =
    tickets.find((ticket) => ticket.id === ticketAtivoId) ||
    (ticketLocal?.id === ticketAtivoId ? ticketLocal : null);

  const motoristas = useMemo(
    () => pessoas.filter((p) => p.is_motorista),
    [pessoas]
  );

  const clientes = useMemo(
    () => pessoas.filter((p) => p.is_cliente),
    [pessoas]
  );

  const fornecedores = useMemo(
    () => pessoas.filter((p) => p.is_fornecedor),
    [pessoas]
  );

  const pedidosAbertos = useMemo(
    () => pedidos.filter((p) => p.status === 'aberto'),
    [pedidos]
  );

  const tipoAtual = ticketAtivo?.tipo || form.tipo;
  const isVenda = tipoAtual === 'venda';

  const pedidoIdAtual = ticketAtivo?.pedido_id || form.pedido_id;
  const pedidoSel = pedidos.find((p) => p.id === pedidoIdAtual);

  const transpsDoPedido = useMemo(() => {
    if (!pedidoSel) return [];

    const ids = String(pedidoSel.transportadora_ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    return ids
      .map((id) => transportadoras.find((t) => t.id === id))
      .filter(Boolean);
  }, [pedidoSel, transportadoras]);

  useEffect(() => {
    if (!ticketAtivo) {
      setTransportadoraFechamento('');
      return;
    }

    setTransportadoraFechamento(ticketAtivo.transportadora_id || '');
    setSegundaPesagem(0);
    setSegundaRegistradaEm('');
    setPesoAtual('');
    setCapturaPendente(null);
    setCorrecaoPeso(formatQtd(ticketAtivo?.correcao_peso_kg || 0));
  }, [ticketAtivo?.id]);

  const primeiraPesagem = useMemo(() => {
    if (!ticketAtivo) return 0;

    const tara = Number(ticketAtivo.peso_tara) || 0;
    const bruto = Number(ticketAtivo.peso_bruto) || 0;

    if (tara > 0) return tara;
    if (bruto > 0) return bruto;
    return 0;
  }, [ticketAtivo]);

  const isInverted =
    !!ticketAtivo &&
    (Number(ticketAtivo.peso_bruto) || 0) > 0 &&
    (Number(ticketAtivo.peso_tara) || 0) === 0;

  const pesoLiquidoBruto = useMemo(() => {
    if (!ticketAtivo || !(segundaPesagem > 0)) return 0;
    return isInverted
      ? calcLiquido(ticketAtivo.peso_bruto || 0, segundaPesagem)
      : calcLiquido(segundaPesagem, ticketAtivo.peso_tara || 0);
  }, [ticketAtivo, segundaPesagem, isInverted]);

  // Correção assinada: positiva acrescenta, negativa desconta, sem
  // modificar as leituras originais da balança.
  const correcaoAtual = parseQtd(correcaoPeso);
  const liquido = Math.round((pesoLiquidoBruto + correcaoAtual) * 1000) / 1000;
  const etapaCaptura = ticketAtivo
    ? (segundaPesagem > 0 ? 0 : 2)
    : 1;
  const aguardaConfirmacao =
    capturaPendente?.etapa === etapaCaptura && etapaCaptura !== 0;

  const leituraBalanca = Number(ultimaLeitura?.peso);
  const pesoDisponivel =
    parseQtd(pesoAtual) > 0
      ? parseQtd(pesoAtual)
      : Number.isFinite(leituraBalanca)
        ? leituraBalanca
        : 0;

  const displayPeso =
    pesoAtual ||
    (
      Number.isFinite(leituraBalanca)
        ? formatarPeso(leituraBalanca)
        : '0,00'
    );

  const balancaConectada = statusBalanca === 'conectado';

  const abertos = useMemo(
    () =>
      tickets
        .filter((t) => t.status === 'aberto')
        .sort(
          (a, b) =>
            new Date(b.data_abertura || 0) -
            new Date(a.data_abertura || 0)
        ),
    [tickets]
  );

  const abertosFiltrados = useMemo(() => {
    const q = buscaAbertos.toLowerCase().trim();
    if (!q) return abertos;

    return abertos.filter((ticket) => {
      const pedido = pedidos.find((p) => p.id === ticket.pedido_id);
      const produto = produtos.find(
        (p) => p.id === (ticket.produto_id || pedido?.produto_id)
      );
      const cliente = pessoas.find(
        (p) => p.id === (ticket.cliente_id || pedido?.cliente_id)
      );

      return [
        ticket.numero,
        ticket.motorista,
        ticket.placa,
        tipoLabel(ticket.tipo),
        produto?.nome,
        cliente?.nome,
        pedido?.numero,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [abertos, buscaAbertos, pedidos, produtos, pessoas]);

  const taraSugerida = useMemo(() => {
    if (ticketAtivo) return null;

    const placaNorm = normalizePlaca(form.placa);
    if (!placaNorm) return null;

    const ultimo = [...tickets]
      .filter(
        (t) =>
          t.status === 'fechado' &&
          normalizePlaca(t.placa) === placaNorm
      )
      .sort(
        (a, b) =>
          new Date(b.data_abertura || 0) -
          new Date(a.data_abertura || 0)
      )[0];

    if (!ultimo) return null;

    const valores = [
      Number(ultimo.peso_tara) || 0,
      Number(ultimo.peso_bruto) || 0,
    ].filter((value) => value > 0);

    if (!valores.length) return null;
    return Math.min(...valores);
  }, [form.placa, ticketAtivo, tickets]);

  const clienteIdAtual = isVenda
    ? (pedidoSel?.cliente_id || ticketAtivo?.cliente_id || '')
    : (ticketAtivo?.cliente_id || form.cliente_id);

  const produtoIdAtual = isVenda
    ? (pedidoSel?.produto_id || ticketAtivo?.produto_id || '')
    : (ticketAtivo?.produto_id || form.produto_id);

  const transportadoraIdAtual = ticketAtivo
    ? (transportadoraFechamento || ticketAtivo.transportadora_id || '')
    : form.transportadora_id;

  const clienteAtual = pessoas.find((p) => p.id === clienteIdAtual);
  const produtoAtual = produtos.find((p) => p.id === produtoIdAtual);
  const transportadoraAtual = transportadoras.find(
    (p) => p.id === transportadoraIdAtual
  );

  function resetNovoTicket() {
    setTicketAtivoId('');
    setTicketLocal(null);
    setForm(EMPTY_FORM);
    setPesoAtual('');
    setCapturaPendente(null);
    setCorrecaoPeso('0,00');
    setSegundaPesagem(0);
    setSegundaRegistradaEm('');
    setTransportadoraFechamento('');
  }

  function selecionarTicket(ticket) {
    setTicketLocal(null);
    setTicketAtivoId(ticket.id);
    setPesoAtual('');
    setCapturaPendente(null);
    setCorrecaoPeso(formatQtd(ticket.correcao_peso_kg || 0));
    setSegundaPesagem(0);
    setSegundaRegistradaEm('');
  }

  function trocarTipo(value) {
    if (ticketAtivo) return;

    setForm({
      ...EMPTY_FORM,
      tipo: value,
    });
    setPesoAtual('');
    setCapturaPendente(null);
  }

  function escolherPedido(value) {
    const id = value === 'all' ? '' : value;
    const pedido = pedidos.find((p) => p.id === id);

    if (!pedido) {
      setForm((prev) => ({
        ...prev,
        pedido_id: '',
        cliente_id: '',
        produto_id: '',
        transportadora_id: '',
      }));
      return;
    }

    const idsTransportadora = String(pedido.transportadora_ids || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    setForm((prev) => ({
      ...prev,
      pedido_id: pedido.id,
      cliente_id: pedido.cliente_id || '',
      produto_id: pedido.produto_id || '',
      transportadora_id:
        idsTransportadora.length === 1
          ? idsTransportadora[0]
          : '',
    }));
  }

  useEffect(() => {
    if (!initialPedidoId || ticketAtivo) return;

    const pedido = pedidos.find(
      (item) => item.id === initialPedidoId
    );

    if (!pedido || pedido.status !== 'aberto') {
      toast({
        variant: 'destructive',
        title: 'Pedido indisponível',
        description:
          'O pedido selecionado não está mais disponível para gerar um ticket de venda.',
      });
      onInitialPedidoConsumed?.();
      return;
    }

    if (
      !pedido.sem_limite &&
      (Number(pedido.saldo_kg) || 0) <= 0
    ) {
      toast({
        variant: 'destructive',
        title: 'Pedido sem saldo',
        description:
          'Este pedido já foi atendido e não pode gerar outro ticket.',
      });
      onInitialPedidoConsumed?.();
      return;
    }

    const idsTransportadora = String(
      pedido.transportadora_ids || ''
    )
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    setForm({
      ...EMPTY_FORM,
      tipo: 'venda',
      pedido_id: pedido.id,
      cliente_id: pedido.cliente_id || '',
      produto_id: pedido.produto_id || '',
      transportadora_id:
        idsTransportadora.length === 1
          ? idsTransportadora[0]
          : '',
    });

    setPesoAtual('');
    onInitialPedidoConsumed?.();
  }, [initialPedidoId, ticketAtivo?.id, pedidos]);

  async function obterPedidoAtualizado(id) {
    if (!id) return null;

    try {
      return await api.entities.PedidoPesagem.get(id);
    } catch {
      return pedidos.find((p) => p.id === id) || null;
    }
  }

  async function registrarPrimeiraPesagem(pesoConfirmado, capturadoEm) {
    if (ticketAtivo) return;

    if (!form.tipo) {
      toast({
        variant: 'destructive',
        title: 'Selecione o tipo de ticket',
      });
      return;
    }

    if (!form.motorista.trim()) {
      toast({
        variant: 'destructive',
        title: 'Selecione o motorista',
      });
      return;
    }

    const placa = normalizePlaca(form.placa);
    if (!placa) {
      toast({
        variant: 'destructive',
        title: 'Informe a placa',
      });
      return;
    }

    if (!(pesoConfirmado > 0)) {
      toast({
        variant: 'destructive',
        title: 'Primeiro capture um peso válido na balança.',
      });
      return null;
    }

    let pedidoVenda = null;
    let produtoId = form.produto_id;
    let clienteId = form.cliente_id;
    let transportadoraId = form.transportadora_id;

    if (form.tipo === 'venda') {
      if (!form.pedido_id) {
        toast({
          variant: 'destructive',
          title: 'Pedido obrigatório',
          description: 'Venda só pode ser aberta a partir de um pedido em aberto.',
        });
        return;
      }

      pedidoVenda = await obterPedidoAtualizado(form.pedido_id);

      if (!pedidoVenda || pedidoVenda.status !== 'aberto') {
        toast({
          variant: 'destructive',
          title: 'Pedido indisponível',
          description: 'O pedido selecionado não está mais em aberto.',
        });
        await onReload?.();
        return;
      }

      produtoId = pedidoVenda.produto_id || '';
      clienteId = pedidoVenda.cliente_id || '';

      const transportadorasPermitidas = String(
        pedidoVenda.transportadora_ids || ''
      )
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

      if (transportadorasPermitidas.length === 1) {
        transportadoraId = transportadorasPermitidas[0];
      } else if (
        transportadorasPermitidas.length > 1 &&
        !transportadorasPermitidas.includes(transportadoraId)
      ) {
        toast({
          variant: 'destructive',
          title: 'Selecione a transportadora',
          description: 'Escolha uma das transportadoras autorizadas no pedido.',
        });
        return;
      }
    } else {
      if (!produtoId) {
        toast({
          variant: 'destructive',
          title: 'Selecione o produto',
        });
        return;
      }

      if (!transportadoraId) {
        toast({
          variant: 'destructive',
          title: 'Selecione a transportadora',
        });
        return;
      }
    }

    setSaving(true);

    try {
      let ticketsAtuais = tickets;

      try {
        ticketsAtuais = await api.entities.TicketPesagem.list(
          '-created_date',
          1000
        );
      } catch {
        ticketsAtuais = tickets;
      }

      const duplicado = ticketsAtuais.some(
        (ticket) =>
          ticket.status === 'aberto' &&
          normalizePlaca(ticket.placa) === placa
      );

      if (duplicado) {
        toast({
          variant: 'destructive',
          title: 'Já existe ticket aberto para esta placa',
          description: 'Carregue o ticket existente antes de iniciar outra pesagem.',
        });
        return;
      }

      const numero = nextTicketNumber(ticketsAtuais);
      const cliente = pessoas.find((p) => p.id === clienteId);
      const transportadora = transportadoras.find(
        (p) => p.id === transportadoraId
      );

      const created = await api.entities.TicketPesagem.create({
        numero,
        tipo: form.tipo,
        data_abertura: capturadoEm || new Date().toISOString(),
        motorista: form.motorista.trim(),
        placa,
        produto_id: produtoId || '',
        cliente_id: clienteId || '',
        cliente_nome: cliente?.nome || '',
        transportadora_id: transportadoraId || '',
        transportadora_nome: transportadora?.nome || '',
        pedido_id:
          form.tipo === 'venda'
            ? (pedidoVenda?.id || form.pedido_id)
            : '',
        origem: form.origem.trim(),
        destino:
          form.tipo === 'venda'
            ? ''
            : form.destino.trim(),
        peso_tara: pesoConfirmado,
        peso_bruto: 0,
        peso_liquido: 0,
        status: 'aberto',
        observacao: form.observacao.trim(),
      });

      setTicketLocal(created);
      setTicketAtivoId(created.id);
      setTransportadoraFechamento(created.transportadora_id || '');
      setPesoAtual('');

      toast({
        title: '1ª pesagem registrada',
        description: `${numero} • ${formatKg(pesoConfirmado)}`,
      });

      await onReload?.();
      return created;
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao abrir ticket',
        description: String(error?.message || error),
      });
    } finally {
      setSaving(false);
    }
  }

  function registrarSegundaPesagem(pesoConfirmado, capturadoEm) {
    if (!ticketAtivo) {
      toast({
        variant: 'destructive',
        title: 'Carregue um ticket em aberto',
      });
      return;
    }

    if (!(pesoConfirmado > 0)) {
      toast({
        variant: 'destructive',
        title: 'Primeiro capture o peso da 2ª pesagem.',
      });
      return false;
    }

    if (Math.abs(pesoConfirmado - primeiraPesagem) < 0.0001) {
      toast({
        variant: 'destructive',
        title: 'Pesagens iguais',
        description: 'A 2ª pesagem precisa ser diferente da 1ª.',
      });
      return;
    }

    setSegundaPesagem(pesoConfirmado);
    setSegundaRegistradaEm(capturadoEm || new Date().toISOString());

    toast({
      title: '2ª pesagem registrada',
      description: formatKg(pesoConfirmado),
    });
    return true;
  }

  async function capturarOuConfirmar() {
    if (saving || lendo || etapaCaptura === 0) return;

    if (aguardaConfirmacao) {
      if (etapaCaptura === 1) {
        const salvo = await registrarPrimeiraPesagem(
          capturaPendente.peso,
          capturaPendente.capturadoEm
        );
        if (salvo) setCapturaPendente(null);
      } else if (
        registrarSegundaPesagem(
          capturaPendente.peso,
          capturaPendente.capturadoEm
        )
      ) {
        setCapturaPendente(null);
      }
      return;
    }

    setSaving(true);
    try {
      // Leitura manual somente para o perfil autorizado. Para os demais,
      // a leitura fresca vem obrigatoriamente do contexto da balança.
      const manual = podeDigitar && pesoAtual.trim()
        ? parseQtd(pesoAtual)
        : null;
      const valor = manual ?? (
        balancaConectada ? await lerPeso() : null
      );

      if (!(Number(valor) > 0) || !Number.isFinite(Number(valor))) {
        toast({
          variant: 'destructive',
          title: 'Peso indisponível',
          description: podeDigitar
            ? 'Conecte a balança ou informe um peso manual válido.'
            : 'Conecte a balança e aguarde uma leitura válida.',
        });
        return;
      }

      if (
        etapaCaptura === 2 &&
        Math.abs(Number(valor) - primeiraPesagem) < 0.0001
      ) {
        toast({
          variant: 'destructive',
          title: 'Pesagens iguais',
          description: 'A segunda pesagem deve ser diferente da primeira.',
        });
        return;
      }

      setCapturaPendente({
        etapa: etapaCaptura,
        peso: Number(valor),
        capturadoEm: new Date().toISOString(),
      });
      setPesoAtual('');
    } finally {
      setSaving(false);
    }
  }

  async function fecharTicketAtual() {
    if (!ticketAtivo || !(segundaPesagem > 0) || capturaPendente || !(liquido > 0)) {
      return;
    }

    if (!/^[+\-]?[\d.,]+$/.test(String(correcaoPeso).trim())) {
      toast({ variant: 'destructive', title: 'Correção de peso inválida' });
      return;
    }

    setSaving(true);

    try {
      let pedidoVenda = null;
      let transportadoraId = transportadoraIdAtual;

      if (ticketAtivo.tipo === 'venda') {
        if (!ticketAtivo.pedido_id) {
          throw new Error(
            'Venda sem pedido vinculado. Regularize o pedido antes de fechar.'
          );
        }

        pedidoVenda = await obterPedidoAtualizado(ticketAtivo.pedido_id);

        if (!pedidoVenda) {
          throw new Error(
            'Pedido da venda não foi encontrado.'
          );
        }

        if (pedidoVenda.status !== 'aberto') {
          throw new Error(
            'O pedido vinculado não está mais em aberto.'
          );
        }

        const idsTransportadora = String(
          pedidoVenda.transportadora_ids || ''
        )
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);

        if (idsTransportadora.length === 1) {
          transportadoraId = idsTransportadora[0];
        } else if (
          idsTransportadora.length > 1 &&
          !idsTransportadora.includes(transportadoraId)
        ) {
          throw new Error(
            'Selecione uma transportadora autorizada no pedido.'
          );
        }

        if (
          !pedidoVenda.sem_limite &&
          liquido > (Number(pedidoVenda.saldo_kg) || 0)
        ) {
          throw new Error(
            `O peso líquido de ${formatKg(liquido)} excede o saldo do pedido de ${formatKg(pedidoVenda.saldo_kg || 0)}.`
          );
        }
      }

      const clienteNome = (id) =>
        pessoas.find((p) => p.id === id)?.nome || '—';

      const transpNome = (id) =>
        transportadoras.find((p) => p.id === id)?.nome || '—';

      const { ticket: fechado, baixaError } = await fecharTicket({
        ticket: ticketAtivo,
        pesoBruto: segundaPesagem,
        isInverted,
        liquido,
        correcaoPesoKg: correcaoAtual,
        isVenda: ticketAtivo.tipo === 'venda',
        pedidoId: ticketAtivo.pedido_id || '',
        transportadoraId,
        observacao: ticketAtivo.observacao || '',
        pedidoSel: pedidoVenda,
        clienteNome,
        transpNome,
        produtos,
      });

      if (
        pedidoVenda &&
        !pedidoVenda.sem_limite
      ) {
        const novoSaldo =
          Math.round(
            (
              (Number(pedidoVenda.saldo_kg) || 0) -
              liquido
            ) * 1000
          ) / 1000;

        await api.entities.PedidoPesagem.update(
          pedidoVenda.id,
          {
            status: statusPorSaldo(
              novoSaldo,
              pedidoVenda.total_kg,
              pedidoVenda.status
            ),
          }
        );
      }

      if (baixaError) {
        toast({
          variant: 'destructive',
          title: 'Ticket fechado com atenção no estoque',
          description:
            baixaError.startsWith('SALDO_INSUFICIENTE')
              ? `A pesagem foi fechada, mas o saldo físico do produto foi insuficiente para a baixa.`
              : `A pesagem foi fechada, mas houve falha na baixa de estoque: ${baixaError}`,
        });
      } else {
        toast({
          title: 'Ticket fechado',
          description: `${fechado.numero} • Líquido ${formatKg(liquido)}`,
        });
      }

      resetNovoTicket();
      await onReload?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível fechar o ticket',
        description: String(error?.message || error),
      });
    } finally {
      setSaving(false);
    }
  }

  async function excluirAberto() {
    if (!excluirTicket) return;

    setSaving(true);

    try {
      await safeDelete('TicketPesagem', excluirTicket.id);

      if (ticketAtivoId === excluirTicket.id) {
        resetNovoTicket();
      }

      toast({
        title: 'Ticket aberto excluído',
        description: excluirTicket.numero,
      });

      setExcluirTicket(null);
      await onReload?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir ticket',
        description: String(error?.message || error),
      });
    } finally {
      setSaving(false);
    }
  }

  const pedidoOptions = pedidosAbertos
    .map((pedido) => {
      const cliente = pessoas.find((p) => p.id === pedido.cliente_id);
      const produto = produtos.find((p) => p.id === pedido.produto_id);

      const saldo =
        pedido.sem_limite
          ? 'sem limite'
          : formatKg(pedido.saldo_kg || 0);

      return {
        value: pedido.id,
        label: `${pedido.numero || 'PED'} — ${cliente?.nome || 'Cliente'} — ${produto?.nome || 'Produto'} — saldo ${saldo}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const pessoasParaTipo =
    tipoAtual === 'compra'
      ? fornecedores
      : clientes;

  const activeTransportadoraOptions =
    isVenda
      ? transpsDoPedido.map((t) => ({
          value: t.id,
          label: t.nome,
        }))
      : transportadoras.map((t) => ({
          value: t.id,
          label: t.nome,
        }));

  const tipoIcon =
    TIPOS.find((item) => item.value === tipoAtual)?.icon ||
    FileText;

  const TipoIcon = tipoIcon;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="rounded-2xl border p-4 shadow-none">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="min-w-[130px]">
                <p className="text-sm font-semibold">Tipo de ticket</p>
              </div>

              <div className="relative flex-1">
                <select
                  value={tipoAtual || ''}
                  onChange={(e) => trocarTipo(e.target.value)}
                  disabled={!!ticketAtivo}
                  className="h-10 w-full rounded-md border bg-background px-3 pr-9 text-sm font-medium disabled:cursor-not-allowed disabled:bg-muted/40"
                >
                  <option value="">Selecione o tipo...</option>
                  {TIPOS.map((tipo) => (
                    <option key={tipo.value} value={tipo.value}>
                      {tipo.label}
                    </option>
                  ))}
                  {ticketAtivo?.tipo === 'avulsa' && (
                    <option value="avulsa">Avulsa</option>
                  )}
                </select>
              </div>

              {ticketAtivo && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="gap-1.5 whitespace-nowrap"
                  >
                    <LockKeyhole className="h-3.5 w-3.5" />
                    {ticketAtivo.numero}
                  </Badge>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetNovoTicket}
                  >
                    Novo ticket
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card className="rounded-2xl border shadow-none">
            <div className="border-b bg-muted/15 px-4 py-3">
              <div className="flex items-center gap-2">
                <TipoIcon className="h-4 w-4 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold">
                    Dados do Ticket
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {ticketAtivo
                      ? 'Ticket em aberto carregado para a 2ª pesagem.'
                      : 'Preencha os dados e registre a 1ª pesagem.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4">
              {isVenda && (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px]">
                  <div className="space-y-1.5">
                    <Label>Pedido de Venda *</Label>

                    {ticketAtivo ? (
                      <Input
                        value={
                          pedidoSel
                            ? `${pedidoSel.numero || ''} — ${clienteAtual?.nome || ''}`
                            : ticketAtivo.pedido_id || 'Pedido não encontrado'
                        }
                        readOnly
                        className="bg-muted/30"
                      />
                    ) : (
                      <SearchSelect
                        value={form.pedido_id || 'all'}
                        onChange={escolherPedido}
                        allLabel="Selecionar pedido..."
                        placeholder="Buscar pedido..."
                        options={pedidoOptions}
                      />
                    )}

                    {!ticketAtivo && pedidosAbertos.length === 0 && (
                      <p className="text-xs text-destructive">
                        Nenhum pedido em aberto disponível para venda.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Saldo do pedido</Label>
                    <div className="flex h-9 items-center rounded-md border bg-muted/20 px-3 text-sm font-semibold">
                      {pedidoSel
                        ? (
                          pedidoSel.sem_limite
                            ? 'Sem limite'
                            : formatKg(pedidoSel.saldo_kg || 0)
                        )
                        : '—'}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Motorista *</Label>

                  {ticketAtivo ? (
                    <Input
                      value={ticketAtivo.motorista || ''}
                      readOnly
                      className="bg-muted/30"
                    />
                  ) : (
                    <SearchSelect
                      value={form.motorista || 'all'}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          motorista: value === 'all' ? '' : value,
                        }))
                      }
                      allLabel="Selecionar motorista..."
                      placeholder="Buscar motorista..."
                      options={motoristas
                        .map((m) => ({
                          value: m.nome,
                          label: m.nome,
                        }))
                        .sort((a, b) =>
                          a.label.localeCompare(b.label)
                        )}
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Placa *</Label>
                  <Input
                    value={
                      ticketAtivo
                        ? formatPlaca(ticketAtivo.placa)
                        : form.placa
                    }
                    readOnly={!!ticketAtivo}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        placa: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="ABC1D23"
                    className={ticketAtivo ? 'bg-muted/30' : ''}
                  />

                  {!ticketAtivo && taraSugerida && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() =>
                        setPesoAtual(formatQtd(taraSugerida))
                      }
                    >
                      Usar última tara conhecida: {formatKg(taraSugerida)}
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Transportadora{!isVenda ? ' *' : ''}</Label>

                  {ticketAtivo ? (
                    isVenda && transpsDoPedido.length > 1 ? (
                      <SearchSelect
                        value={transportadoraFechamento || 'all'}
                        onChange={(value) =>
                          setTransportadoraFechamento(
                            value === 'all' ? '' : value
                          )
                        }
                        allLabel="Selecionar transportadora..."
                        placeholder="Transportadora..."
                        options={activeTransportadoraOptions}
                      />
                    ) : (
                      <Input
                        value={transportadoraAtual?.nome || '—'}
                        readOnly
                        className="bg-muted/30"
                      />
                    )
                  ) : isVenda ? (
                    transpsDoPedido.length > 1 ? (
                      <SearchSelect
                        value={form.transportadora_id || 'all'}
                        onChange={(value) =>
                          setForm((prev) => ({
                            ...prev,
                            transportadora_id:
                              value === 'all' ? '' : value,
                          }))
                        }
                        allLabel="Selecionar transportadora..."
                        placeholder="Transportadora..."
                        options={activeTransportadoraOptions}
                      />
                    ) : (
                      <Input
                        value={transpsDoPedido[0]?.nome || '—'}
                        readOnly
                        className="bg-muted/30"
                      />
                    )
                  ) : (
                    <SearchSelect
                      value={form.transportadora_id || 'all'}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          transportadora_id:
                            value === 'all' ? '' : value,
                        }))
                      }
                      allLabel="Selecionar transportadora..."
                      placeholder="Buscar transportadora..."
                      options={activeTransportadoraOptions}
                    />
                  )}
                </div>

                {isVenda ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>Cliente</Label>
                      <Input
                        value={clienteAtual?.nome || '—'}
                        readOnly
                        className="bg-muted/30"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Produto</Label>
                      <Input
                        value={produtoAtual?.nome || '—'}
                        readOnly
                        className="bg-muted/30"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Origem</Label>
                      <Input
                        value={
                          ticketAtivo
                            ? (ticketAtivo.origem || '')
                            : form.origem
                        }
                        readOnly={!!ticketAtivo}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            origem: e.target.value,
                          }))
                        }
                        placeholder="Ex.: Sede"
                        className={ticketAtivo ? 'bg-muted/30' : ''}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>
                        {tipoAtual === 'compra'
                          ? 'Fornecedor'
                          : 'Cliente'}
                      </Label>

                      {ticketAtivo ? (
                        <Input
                          value={clienteAtual?.nome || '—'}
                          readOnly
                          className="bg-muted/30"
                        />
                      ) : (
                        <SearchSelect
                          value={form.cliente_id || 'all'}
                          onChange={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              cliente_id:
                                value === 'all' ? '' : value,
                            }))
                          }
                          allLabel={
                            tipoAtual === 'compra'
                              ? 'Selecionar fornecedor...'
                              : 'Selecionar cliente...'
                          }
                          placeholder="Buscar..."
                          options={pessoasParaTipo
                            .map((p) => ({
                              value: p.id,
                              label: p.nome,
                            }))
                            .sort((a, b) =>
                              a.label.localeCompare(b.label)
                            )}
                        />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label>Produto *</Label>

                      {ticketAtivo ? (
                        <Input
                          value={produtoAtual?.nome || '—'}
                          readOnly
                          className="bg-muted/30"
                        />
                      ) : (
                        <SearchSelect
                          value={form.produto_id || 'all'}
                          onChange={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              produto_id:
                                value === 'all' ? '' : value,
                            }))
                          }
                          allLabel="Selecionar produto..."
                          placeholder="Buscar produto..."
                          options={produtos
                            .map((p) => ({
                              value: p.id,
                              label: p.nome,
                            }))
                            .sort((a, b) =>
                              a.label.localeCompare(b.label)
                            )}
                        />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label>Origem</Label>
                      <Input
                        value={
                          ticketAtivo
                            ? (ticketAtivo.origem || '')
                            : form.origem
                        }
                        readOnly={!!ticketAtivo}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            origem: e.target.value,
                          }))
                        }
                        placeholder={
                          tipoAtual === 'compra'
                            ? 'Ex.: Fornecedor'
                            : 'Ex.: Sede'
                        }
                        className={ticketAtivo ? 'bg-muted/30' : ''}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Destino</Label>
                      <Input
                        value={
                          ticketAtivo
                            ? (ticketAtivo.destino || '')
                            : form.destino
                        }
                        readOnly={!!ticketAtivo}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            destino: e.target.value,
                          }))
                        }
                        placeholder={
                          tipoAtual === 'lavoura'
                            ? 'Ex.: Talhão 07'
                            : tipoAtual === 'compra'
                              ? 'Ex.: Armazém'
                              : 'Destino'
                        }
                        className={ticketAtivo ? 'bg-muted/30' : ''}
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                  <Label>Observação</Label>
                  <Textarea
                    rows={2}
                    value={
                      ticketAtivo
                        ? (ticketAtivo.observacao || '')
                        : form.observacao
                    }
                    readOnly={!!ticketAtivo}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        observacao: e.target.value,
                      }))
                    }
                    placeholder="Informações adicionais..."
                    className={ticketAtivo ? 'bg-muted/30' : ''}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden rounded-2xl border shadow-none">
            <div className="flex flex-col gap-2 border-b bg-muted/15 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <CircleDot className="h-4 w-4 text-amber-500" />
                  Tickets em Aberto
                </h2>
                <p className="text-xs text-muted-foreground">
                  Clique em um ticket para carregá-lo na área de pesagem.
                </p>
              </div>

              <div className="relative w-full md:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={buscaAbertos}
                  onChange={(e) => setBuscaAbertos(e.target.value)}
                  placeholder="Buscar ticket, motorista, placa, cliente..."
                  className="h-9 pl-9"
                />
              </div>
            </div>

            {abertosFiltrados.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nenhum ticket em aberto.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-[1050px] w-full text-xs">
                  <thead className="bg-muted/35">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Ticket</th>
                      <th className="px-3 py-2.5 text-left">Tipo</th>
                      <th className="px-3 py-2.5 text-left">Motorista</th>
                      <th className="px-3 py-2.5 text-left">Placa</th>
                      <th className="px-3 py-2.5 text-left">Cliente / Fornecedor</th>
                      <th className="px-3 py-2.5 text-left">Produto</th>
                      <th className="px-3 py-2.5 text-right">1ª Pesagem</th>
                      <th className="px-3 py-2.5 text-center">Status</th>
                      <th className="w-20 px-3 py-2.5 text-center">Ações</th>
                    </tr>
                  </thead>

                  <tbody>
                    {abertosFiltrados.map((ticket) => {
                      const pedido = pedidos.find(
                        (p) => p.id === ticket.pedido_id
                      );
                      const cliente = pessoas.find(
                        (p) =>
                          p.id ===
                          (ticket.cliente_id || pedido?.cliente_id)
                      );
                      const produto = produtos.find(
                        (p) =>
                          p.id ===
                          (ticket.produto_id || pedido?.produto_id)
                      );
                      const primeira =
                        (Number(ticket.peso_tara) || 0) ||
                        (Number(ticket.peso_bruto) || 0);

                      const selected = ticket.id === ticketAtivo?.id;

                      return (
                        <tr
                          key={ticket.id}
                          onClick={() => selecionarTicket(ticket)}
                          className={`cursor-pointer border-t transition-colors ${
                            selected
                              ? 'bg-primary/5'
                              : 'hover:bg-muted/30'
                          }`}
                        >
                          <td className="px-3 py-2.5 font-mono font-semibold">
                            {ticket.numero}
                          </td>
                          <td className="px-3 py-2.5">
                            {tipoLabel(ticket.tipo)}
                          </td>
                          <td className="px-3 py-2.5">
                            {ticket.motorista || '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            {formatPlaca(ticket.placa)}
                          </td>
                          <td className="px-3 py-2.5">
                            {cliente?.nome || ticket.cliente_nome || '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {produto?.nome || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                            {formatKg(primeira)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                              Aguardando 2ª pesagem
                            </Badge>
                          </td>
                          <td
                            className="px-3 py-2.5 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Excluir ticket aberto"
                              onClick={() => setExcluirTicket(ticket)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card className="h-fit rounded-2xl border shadow-none xl:sticky xl:top-4">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Weight className="h-5 w-5 text-primary" />
              Pesagem
            </h2>

            <Badge
              variant="outline"
              className={
                balancaConectada
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }
            >
              <span
                className={`mr-1.5 h-2 w-2 rounded-full ${
                  balancaConectada ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              />
              {balancaConectada
                ? 'Balança conectada'
                : 'Balança desconectada'}
            </Badge>
          </div>

          <div className="space-y-4 p-4">
            <div className="rounded-xl border-2 border-primary/25 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />

                {podeDigitar ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pesoAtual}
                    onChange={(e) => setPesoAtual(e.target.value)}
                    placeholder={displayPeso}
                    className="h-16 min-w-0 flex-1 bg-transparent text-right text-4xl font-bold tracking-tight outline-none placeholder:text-foreground"
                  />
                ) : (
                  <div className="flex-1 text-right text-4xl font-bold tracking-tight">
                    {displayPeso}
                  </div>
                )}

                <span className="text-base font-semibold text-muted-foreground">
                  kg
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <LerPesoButton
                onPesoLido={setPesoAtual}
                className="h-11 w-full px-4 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setPesoAtual('')}
                disabled={!pesoAtual}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Limpar
              </Button>
            </div>

            <div className="border-t pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  1ª Pesagem
                </span>
                <span className="text-xs text-muted-foreground">
                  {ticketAtivo
                    ? formatDateTime(ticketAtivo.data_abertura)
                    : 'Aguardando'}
                </span>
              </div>

              <div className="mb-2 rounded-lg bg-muted/35 px-3 py-3 text-right text-2xl font-semibold tabular-nums">
                {ticketAtivo
                  ? formatKg(primeiraPesagem)
                  : '0,00 kg'}
              </div>

              <Button
                type="button"
                variant={ticketAtivo ? 'outline' : 'default'}
                className="w-full"
                disabled={saving || !!ticketAtivo}
                onClick={registrarPrimeiraPesagem}
              >
                <Play className="mr-2 h-4 w-4" />
                Registrar 1ª Pesagem
              </Button>
            </div>

            <div className="border-t pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  2ª Pesagem
                </span>
                <span className="text-xs text-muted-foreground">
                  {segundaRegistradaEm
                    ? formatDateTime(segundaRegistradaEm)
                    : 'Aguardando'}
                </span>
              </div>

              <div className="mb-2 rounded-lg bg-muted/35 px-3 py-3 text-right text-2xl font-semibold tabular-nums">
                {segundaPesagem > 0
                  ? formatKg(segundaPesagem)
                  : '0,00 kg'}
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full border-primary text-primary hover:bg-primary/5"
                disabled={saving || !ticketAtivo}
                onClick={registrarSegundaPesagem}
              >
                <Play className="mr-2 h-4 w-4" />
                Registrar 2ª Pesagem
              </Button>
            </div>

            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-semibold">
                Peso Líquido
              </p>

              <div className="rounded-lg bg-muted/35 px-3 py-4 text-right text-3xl font-bold tabular-nums">
                {formatKg(liquido)}
              </div>
            </div>

            {ticketAtivo?.tipo === 'venda' &&
              pedidoSel &&
              !pedidoSel.sem_limite &&
              liquido > (Number(pedidoSel.saldo_kg) || 0) && (
                <p className="text-xs font-medium text-destructive">
                  O peso líquido excede o saldo atual do pedido.
                </p>
              )}

            <Button
              type="button"
              className="h-11 w-full gap-2"
              disabled={
                saving ||
                !ticketAtivo ||
                !(segundaPesagem > 0) ||
                !(liquido > 0)
              }
              onClick={fecharTicketAtual}
            >
              <CheckCircle2 className="h-4 w-4" />
              {saving ? 'Processando...' : 'Fechar Ticket'}
            </Button>
          </div>
        </Card>
      </div>

      <AlertDialog
        open={!!excluirTicket}
        onOpenChange={(open) => {
          if (!open) setExcluirTicket(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ticket em aberto?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluirTicket
                ? `O ticket ${excluirTicket.numero} será removido. Como ele ainda não foi fechado, nenhum saldo de pedido ou estoque foi consumido.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={excluirAberto}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? 'Excluindo...' : 'Excluir ticket'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
