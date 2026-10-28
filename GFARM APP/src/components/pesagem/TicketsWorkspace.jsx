import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  FileText,
  LockKeyhole,
  Package,
  Play,
  Printer,
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import ConfirmacaoPesagemAutomatica from '@/components/pesagem/ConfirmacaoPesagemAutomatica';
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
import { formatQtd, formatInputQtd, parseQtd } from '@/lib/format';
import { chaveRascunhoPesagem, existeRascunhoPesagem, lerRascunhoPesagem, salvarRascunhoPesagem } from '@/lib/pesagemRascunho';
import { atualizarTipoTicket, etapaCapturaPesagem, recapturaPrimeiraValida } from '@/lib/pesagemCaptureFlow';

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

const AUTO_PESO_MINIMO_KG = 40;
const AUTO_ESTABILIDADE_MS = 2000;
const AUTO_CONFIRMACAO_MS = 10000;
const AUTO_ESPERA_NOVA_TENTATIVA_MS = 3000;
const AUTO_LEITURA_VALIDADE_MS = 2500;
const AUTO_PREF_KEY = 'gfarm_pesagem_captura_auto';

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
  const primeiraInputRef = useRef(null);
  const segundaInputRef = useRef(null);
  const rascunhoInicialRef = useRef(null);
  if (rascunhoInicialRef.current === null) {
    rascunhoInicialRef.current = lerRascunhoPesagem(user);
  }
  const inicial = rascunhoInicialRef.current;
  const chaveRascunho = chaveRascunhoPesagem(user);
  const [chaveHidratada, setChaveHidratada] = useState(chaveRascunho);
  const anteriorTicketRef = useRef(inicial.ticketAtivoId);
  const preservarSegundaAoCriarRef = useRef('');
  const autoPopupRef = useRef(null);
  const confirmarAutoRef = useRef(null);
  const autoRef = useRef({
    peso: null,
    desde: 0,
    chave: '',
    leituraEstavelDesde: '',
    aguardandoZerar: false,
    disparando: false,
    confirmando: false,
  });

  const {
    status: statusBalanca,
    ultimaLeitura,
    leituraRemota,
    formatarPeso,
    lerPeso,
    lendo,
    diagnostico: diagnosticoSerial,
    statusPublicacao,
    erroPublicacao,
    atualizarEstadoMonitor,
    registrarEventoMonitor,
  } = useBalanca();

  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...inicial.form }));
  const [ticketAtivoId, setTicketAtivoId] = useState(inicial.ticketAtivoId);
  const [ticketConsultaId, setTicketConsultaId] = useState(inicial.ticketConsultaId);
  const [ticketLocal, setTicketLocal] = useState(null);
  const [pesoDigitado1, setPesoDigitado1] = useState(inicial.pesoDigitado1);
  const [pesoDigitado2, setPesoDigitado2] = useState(inicial.pesoDigitado2);
  const [etapaManual, setEtapaManual] = useState(inicial.etapaManual);
  const [confirmarCorrecao, setConfirmarCorrecao] = useState(null);
  const [confirmarNovoTicket, setConfirmarNovoTicket] = useState(false);
  const [etapaSelecionada, setEtapaSelecionada] = useState(0);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [segundaPesagem, setSegundaPesagem] = useState(inicial.segundaPesagem);
  const [segundaRegistradaEm, setSegundaRegistradaEm] = useState(inicial.segundaRegistradaEm);
  const [transportadoraFechamento, setTransportadoraFechamento] = useState(inicial.transportadoraFechamento);
  const [buscaAbertos, setBuscaAbertos] = useState('');
  const [pesquisaAberta, setPesquisaAberta] = useState(false);
  const [ticketPreviewId, setTicketPreviewId] = useState('');
  const [saving, setSaving] = useState(false);
  const [excluirTicket, setExcluirTicket] = useState(null);
  const [autoAtivo, setAutoAtivo] = useState(() => {
    try { return localStorage.getItem(AUTO_PREF_KEY) !== 'false'; }
    catch { return true; }
  });
  const [autoRestante, setAutoRestante] = useState(null);
  const [autoAguardandoZerar, setAutoAguardandoZerar] = useState(false);
  const [autoCapturando, setAutoCapturando] = useState(false);
  const [autoPopup, setAutoPopup] = useState(null);
  const [autoPopupSegundos, setAutoPopupSegundos] = useState(10);
  const [autoRetentativaAte, setAutoRetentativaAte] = useState(0);
  const [autoRetentativaSegundos, setAutoRetentativaSegundos] = useState(0);
  const [autoOscilou, setAutoOscilou] = useState(false);
  const [autoSemLeitura, setAutoSemLeitura] = useState(false);
  const [statusAutoLocal, setStatusAutoLocal] = useState({
    estado: 'iniciando',
    detalhe: 'Verificando se a automação está pronta.',
    segundos: null,
    peso_candidato: null,
  });

  function alterarPopupAuto(proximo) {
    // Ref síncrono: evita dois cliques/confirmações causados pelo timer.
    autoPopupRef.current = proximo;
    setAutoPopup(proximo);
  }

  useEffect(() => {
    try { localStorage.setItem(AUTO_PREF_KEY, String(autoAtivo)); } catch {}
  }, [autoAtivo]);

  // Quando a sessão passa de "carregando" para usuário autenticado, hidratar
  // antes de gravar. Isso impede sobrescrever o rascunho com formulário vazio.
  useEffect(() => {
    if (chaveRascunho === chaveHidratada) return;
    const restaurado = lerRascunhoPesagem(user);
    anteriorTicketRef.current = restaurado.ticketAtivoId;
    setForm({ ...EMPTY_FORM, ...restaurado.form });
    setTicketAtivoId(restaurado.ticketAtivoId);
    setTicketConsultaId(restaurado.ticketConsultaId);
    setSegundaPesagem(restaurado.segundaPesagem);
    setSegundaRegistradaEm(restaurado.segundaRegistradaEm);
    setTransportadoraFechamento(restaurado.transportadoraFechamento);
    setPesoDigitado1(restaurado.pesoDigitado1);
    setPesoDigitado2(restaurado.pesoDigitado2);
    setEtapaManual(restaurado.etapaManual);
    setChaveHidratada(chaveRascunho);
  }, [chaveRascunho, chaveHidratada, user]);

  useEffect(() => {
    if (!chaveRascunho || chaveRascunho !== chaveHidratada) return;
    salvarRascunhoPesagem(user, {
      form, ticketAtivoId, ticketConsultaId, segundaPesagem,
      segundaRegistradaEm, transportadoraFechamento, pesoDigitado1,
      pesoDigitado2, etapaManual,
    });
  }, [
    chaveRascunho, chaveHidratada, user?.id, user?.username,
    form, ticketAtivoId, ticketConsultaId, segundaPesagem,
    segundaRegistradaEm, transportadoraFechamento,
    pesoDigitado1, pesoDigitado2, etapaManual,
  ]);

  const rascunhoTemDados = existeRascunhoPesagem({
    form, ticketAtivoId, segundaPesagem, pesoDigitado1, pesoDigitado2,
  });
  const digitacaoPendente = Boolean(
    pesoDigitado1.trim() || pesoDigitado2.trim() || etapaManual !== 0
  );

  const ticketAtivo =
    (ticketLocal?.id === ticketAtivoId ? ticketLocal : null) ||
    tickets.find((ticket) => ticket.id === ticketAtivoId);
  const ticketPreview = ticketPreviewId
    ? tickets.find((ticket) => ticket.id === ticketPreviewId)
      || (ticketLocal?.id === ticketPreviewId ? ticketLocal : null)
    : null;

  const ticketConsulta = tickets.find((ticket) => ticket.id === ticketConsultaId) || ticketAtivo;
  const consultaSeparada = Boolean(ticketConsultaId && ticketConsultaId !== ticketAtivo?.id);

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
    const atualId = ticketAtivo?.id || '';
    if (!atualId) return;
    if (anteriorTicketRef.current === atualId) return;
    const preservarPendente = preservarSegundaAoCriarRef.current === atualId;
    anteriorTicketRef.current = atualId;
    preservarSegundaAoCriarRef.current = '';
    setTransportadoraFechamento(ticketAtivo.transportadora_id || '');
    if (!preservarPendente) {
      setSegundaPesagem(0);
      setSegundaRegistradaEm('');
    }
    setEtapaSelecionada(0);
    setEtapaManual(0);
  }, [ticketAtivo?.id]);

  const primeiraPesagem = useMemo(() => {
    if (!ticketAtivo) return 0;

    const tara = Number(ticketAtivo.peso_tara) || 0;
    const bruto = Number(ticketAtivo.peso_bruto) || 0;

    if (tara > 0) return tara;
    if (bruto > 0) return bruto;
    return 0;
  }, [ticketAtivo]);

  const ticketFechado = ticketAtivo?.status === 'fechado';
  const segundaExibida = ticketFechado
    ? ((Number(ticketAtivo?.peso_tara) || 0) === primeiraPesagem
      ? Number(ticketAtivo?.peso_bruto) || 0
      : Number(ticketAtivo?.peso_tara) || 0)
    : segundaPesagem;
  const pesoConsulta1 = (Number(ticketConsulta?.peso_tara) || 0) || (Number(ticketConsulta?.peso_bruto) || 0);
  const pesoConsulta2 = consultaSeparada
    ? (ticketConsulta?.status === 'fechado' ? ((Number(ticketConsulta?.peso_tara) || 0) === pesoConsulta1 ? Number(ticketConsulta?.peso_bruto) || 0 : Number(ticketConsulta?.peso_tara) || 0) : 0)
    : segundaExibida;
  const isInverted =
    !!ticketAtivo &&
    (Number(ticketAtivo.peso_bruto) || 0) > 0 &&
    (Number(ticketAtivo.peso_tara) || 0) === 0;

  const liquido = useMemo(() => {
    if (!ticketAtivo || !(segundaPesagem > 0)) return 0;
    return isInverted
      ? calcLiquido(ticketAtivo.peso_bruto || 0, segundaPesagem)
      : calcLiquido(segundaPesagem, ticketAtivo.peso_tara || 0);
  }, [ticketAtivo, segundaPesagem, isInverted]);

  const liquidoExibido = ticketFechado
    ? Number(ticketAtivo?.peso_liquido) || 0
    : liquido;
  const liquidoConsulta = consultaSeparada ? Number(ticketConsulta?.peso_liquido) || 0 : liquidoExibido;

  // Automaticamente 1ª → 2ª; após a segunda, clique no campo
  // correspondente para refazer uma leitura incorreta.
  const etapaCaptura = etapaCapturaPesagem({
    ticketAberto: !!ticketAtivo,
    segundaRegistrada: segundaPesagem > 0,
    etapaSelecionada,
  });

  const balancaConectada = statusBalanca === 'conectado';
  const remotoAoVivo = Boolean(leituraRemota?.online
    && leituraRemota?.peso_kg != null
    && Number.isFinite(Number(leituraRemota.peso_kg)));
  const mostrandoRemoto = !balancaConectada && remotoAoVivo;
  // A leitura via VPS é estritamente visual. Toda captura, inclusive
  // automática, continua usando somente a porta serial local.
  const leituraBalanca = ultimaLeitura?.peso;
  const displayPeso = balancaConectada && leituraBalanca != null
    && Number.isFinite(Number(leituraBalanca))
    ? formatarPeso(Number(leituraBalanca))
    : mostrandoRemoto
      ? formatarPeso(Number(leituraRemota.peso_kg))
      : '0,00';

  const abertos = useMemo(
    () =>
      tickets
        .filter((ticket) =>
          ['aberto', 'fechado'].includes(ticket.status)
          && (filtroStatus === 'todos' || ticket.status === filtroStatus)
        )
        .sort(
          (a, b) =>
            new Date(b.data_abertura || 0) -
            new Date(a.data_abertura || 0)
        ),
    [tickets, filtroStatus]
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
    setTicketPreviewId('');
    setTicketAtivoId('');
    setTicketConsultaId('');
    setTicketLocal(null);
    setForm(EMPTY_FORM);
    setPesoDigitado1('');
    setPesoDigitado2('');
    setEtapaManual(0);
    anteriorTicketRef.current = '';
    preservarSegundaAoCriarRef.current = '';
    setEtapaSelecionada(0);
    setSegundaPesagem(0);
    setSegundaRegistradaEm('');
    setTransportadoraFechamento('');
  }

  function solicitarNovoTicket() {
    if (saving || autoCapturando || autoPopupRef.current) return;
    if (rascunhoTemDados) setConfirmarNovoTicket(true);
    else resetNovoTicket();
  }

  function selecionarTicket(ticket) {
    if (!ticket || saving || autoCapturando || autoPopupRef.current) return;
    // Primeiro clique: fecha a Pesquisa e exibe consulta no RESUMO.
    // Não muda o ticket de operação nem inicia a leitura automática.
    setTicketPreviewId(ticket.id);
    setTicketConsultaId(ticket.id);
    setPesquisaAberta(false);
  }

  function continuarPesagem(ticket) {
    if (!ticket || ticket.status !== 'aberto' || saving || autoCapturando) return;
    // Segundo clique: confirmado no resumo; só então carrega o formulário.
    setTicketPreviewId('');
    setPesquisaAberta(false);
    setTicketLocal(null);
    setTicketAtivoId(ticket.id);
    setTicketConsultaId(ticket.id);
    setPesoDigitado1('');
    setPesoDigitado2('');
    setEtapaManual(0);
    anteriorTicketRef.current = ticket.id;
    setEtapaSelecionada(0);
    setSegundaPesagem(0);
    setSegundaRegistradaEm('');
  }

  function imprimirTicket(ticket = ticketAtivo, visualizar = false, formato = 'a4') {
    if (!ticket) return;
    const primeira = (Number(ticket.peso_tara) || 0) || (Number(ticket.peso_bruto) || 0);
    if (!(primeira > 0) && !visualizar) return;

    const segunda = ticket.status === 'fechado'
      ? ((Number(ticket.peso_tara) || 0) === primeira
        ? Number(ticket.peso_bruto) || 0 : Number(ticket.peso_tara) || 0)
      : (ticket.id === ticketAtivo?.id ? segundaPesagem : 0);
    const liquidoImpresso = ticket.status === 'fechado'
      ? Number(ticket.peso_liquido) || 0
      : (segunda > 0 ? Math.abs(segunda - primeira) : 0);
    const pedido = pedidos.find((item) => item.id === ticket.pedido_id);
    const pessoa = pessoas.find((item) => item.id === (ticket.cliente_id || pedido?.cliente_id));
    const produto = produtos.find((item) => item.id === (ticket.produto_id || pedido?.produto_id));
    const transp = transportadoras.find((item) => item.id === ticket.transportadora_id);
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const exibicao = (value) => escape(value || '—');
    const dataAbertura = formatDateTime(ticket.data_abertura);
    const dataFechamento = ticket.data_fechamento ? formatDateTime(ticket.data_fechamento) : '';
    const dataPrimeira = ticket.data_primeira_pesagem || ticket.data_pesagem_1 || '';
    const dataSegunda = ticket.data_segunda_pesagem || ticket.data_pesagem_2 || '';
    const hora = (value) => {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };
    const status = ticket.status === 'fechado' ? 'FECHADO' : 'EM ANDAMENTO';
    const dados = [
      ['MOTORISTA', ticket.motorista],
      ['PLACA', formatPlaca(ticket.placa)],
      ['PRODUTO', produto?.nome || ticket.produto_nome],
      ['CLIENTE / FORNECEDOR', pessoa?.nome || ticket.cliente_nome],
      ['TRANSPORTADORA', transp?.nome || ticket.transportadora_nome],
      ['ORIGEM / DESTINO', [ticket.origem, ticket.destino].filter(Boolean).join(' / ')],
      ['DATA / HORA', dataFechamento || dataAbertura],
      ['OBSERVAÇÕES', ticket.observacao || ''],
    ];
    const linhas = dados
      .filter(([nome, valor]) => nome === 'OBSERVAÇÕES' || Boolean(valor))
      .map(([nome, valor]) =>
        '<div class="data-row"><span class="data-label">' + escape(nome) +
        '</span><strong>' + exibicao(valor) + '</strong></div>'
      ).join('');
    const blocoPeso = (nome, valor, horario) =>
      '<div class="weight"><span>' + escape(nome) +
      '</span><strong>' + (valor > 0 ? escape(formatKg(valor)) : 'PENDENTE') +
      '</strong><small>' + (horario ? escape(horario) : '&nbsp;') + '</small></div>';
    const pesos = blocoPeso('1ª PESAGEM (kg)', primeira, hora(dataPrimeira)) +
      blocoPeso('2ª PESAGEM (kg)', segunda, hora(dataSegunda)) +
      blocoPeso('PESO LÍQUIDO (kg)', liquidoImpresso, '');
    const via = (numero, destinatario) =>
      '<section class="ticket">' +
        '<div class="topline"><div class="brand">' +
          '<img src="/icons/ticket-logo.svg" alt="Fazenda Novo Horizonte" />' +
          '<div><h1>FAZENDA NOVO HORIZONTE</h1><p>TICKET DE PESAGEM RODOVIÁRIA</p></div>' +
        '</div><span class="copy">' + numero + 'ª VIA · ' + destinatario + '</span></div>' +
        '<div class="ticket-head"><div><span>TICKET Nº</span><strong>' + exibicao(ticket.numero) +
        '</strong></div><div><span>TIPO</span><strong>' + escape(tipoLabel(ticket.tipo)) +
        '</strong></div><span class="status">' + status + '</span></div>' +
        '<div class="data-grid">' + linhas + '</div>' +
        '<div class="weights">' + pesos + '</div>' +
        '<div class="signatures"><div><span></span>Assinatura do Motorista</div>' +
        '<div><span></span>Assinatura do Balanceiro</div></div>' +
      '</section>';

    const viaTermica = (numero, destinatario) =>
      '<section class="thermal-ticket">' +
        '<header class="thermal-brand"><img src="/icons/ticket-logo.svg" alt="" />' +
        '<div><h1>FAZENDA NOVO HORIZONTE</h1><p>TICKET DE PESAGEM</p></div></header>' +
        '<div class="thermal-copy">' + numero + 'ª VIA - ' + destinatario + '</div>' +
        '<div class="thermal-head">TICKET Nº <b>' + exibicao(ticket.numero) +
        '</b><span>' + escape(tipoLabel(ticket.tipo)) + ' · ' + status + '</span></div>' +
        '<div class="thermal-data">' + linhas + '</div>' +
        '<div class="thermal-weights">' + pesos + '</div>' +
        '<div class="thermal-signatures"><div>________________________________<br/>Assinatura do Motorista</div>' +
        '<div>________________________________<br/>Assinatura do Balanceiro</div></div>' +
      '</section>';
    const termica = formato === 'termica';
    const estilosTermicos = '@page{size:80mm auto;margin:3mm}' +
      '@media screen{body{background:#eee;padding:12px}.sheet{width:80mm;max-width:80mm;margin:auto;padding:3mm;background:#fff;box-shadow:0 3px 18px #0002}}' +
      '@media print{body{margin:0;padding:0;background:#fff}.sheet{width:74mm;max-width:74mm;padding:0;box-shadow:none}.preview-actions{display:none!important}}' +
      '.thermal-ticket{font-family:Arial,sans-serif;color:#000;font-size:10px;break-inside:avoid;padding:3mm 0 5mm}' +
      '.thermal-brand{display:flex;align-items:center;gap:6px;text-align:left;border-bottom:1px solid #000;padding-bottom:6px}' +
      '.thermal-brand img{width:34px;height:34px;object-fit:contain}.thermal-brand h1{font-size:11px;margin:0}.thermal-brand p{font-size:9px;margin:2px 0}' +
      '.thermal-copy{text-align:center;font-size:10px;font-weight:700;padding:7px 0;border-bottom:1px dashed #000}' +
      '.thermal-head{display:flex;flex-wrap:wrap;gap:4px;justify-content:space-between;padding:7px 0;font-size:10px;border-bottom:1px solid #000}' +
      '.thermal-head span{width:100%;font-size:9px}' +
      '.thermal-data .data-row{display:grid;grid-template-columns:26mm minmax(0,1fr);gap:3px;padding:4px 0;border-bottom:1px dotted #888}' +
      '.thermal-data .data-label{font-size:9px;font-weight:700}.thermal-data strong{font-size:10px;overflow-wrap:anywhere}' +
      '.thermal-weights{margin-top:9px}.thermal-weights .weight{display:flex;flex-direction:row;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px;border:0;border-bottom:1px solid #000;border-radius:0;padding:6px 0;text-align:left}' +
      '.thermal-weights .weight span{font-size:10px;font-weight:700}.thermal-weights .weight strong{font-size:15px}.thermal-weights .weight small{width:100%;text-align:right;font-size:9px}' +
      '.thermal-signatures{display:flex;flex-direction:column;gap:15px;text-align:center;margin-top:22px;font-size:9px;line-height:1.5}' +
      '.thermal-cut{border-top:1px dashed #000;text-align:center;margin:5mm 0;padding-top:2mm;font-size:9px}';

    const janela = window.open('', '_blank', 'width=900,height=950');
    if (!janela) {
      toast({ variant: 'destructive', title: 'Permita janelas pop-up para visualizar ou imprimir o ticket.' });
      return;
    }
    janela.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ticket ' +
      exibicao(ticket.numero) + ' - 2 vias</title><style>' +
      (termica ? estilosTermicos : '@page{size:A4 portrait;margin:8mm 10mm}') +
      '*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;background:white}body *{color:#000!important}' +
      '.preview-actions{display:flex;justify-content:center;gap:10px;padding:10px;margin-bottom:8px}' +
      '.preview-actions button{font:600 13px Arial,sans-serif;color:#000;background:#fff;border:1px solid #555;border-radius:5px;padding:10px 22px;cursor:pointer}' +
      '.preview-actions button:first-child{background:#eaf1ed}' +
      '.sheet{width:100%;display:flex;flex-direction:column}' +
      '.ticket{height:127mm;display:flex;flex-direction:column;padding:3mm 2mm 2mm;break-inside:avoid;page-break-inside:avoid;min-width:0}' +
      '.topline{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #000;padding-bottom:7px;min-width:0}' +
      '.brand{display:flex;align-items:center;gap:9px;min-width:0}.brand img{width:46px;height:46px;object-fit:contain;flex-shrink:0;border:0;outline:0;box-shadow:none;background:transparent}' +
      'h1{font-size:13px;margin:0;letter-spacing:.2px}p{margin:3px 0 0;font-size:9px;letter-spacing:.3px}' +
      '.copy{font-size:9px;font-weight:700;white-space:nowrap}' +
      '.ticket-head{display:grid;grid-template-columns:120px minmax(0,1fr) 85px;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #bbb;min-width:0}' +
      '.ticket-head div{display:flex;gap:5px;align-items:baseline;min-width:0;flex-wrap:wrap}.ticket-head div:nth-child(2){min-width:0}' +
      '.ticket-head span:not(.status){font-size:9px;font-weight:700}' +
      '.ticket-head strong{font-size:11px;overflow-wrap:anywhere}.status{font-size:9px;font-weight:700;border:1px solid #aaa;padding:4px 5px;border-radius:4px;text-align:center}' +
      '.data-grid{margin-top:2px;min-width:0}.data-row{display:grid;grid-template-columns:125px minmax(0,1fr);gap:8px;align-items:start;padding:5px 2px;border-bottom:1px solid #ddd;min-width:0}' +
      '.data-label{font-size:9px;font-weight:700}.data-row strong{font-size:10px;line-height:1.25;overflow-wrap:anywhere;min-width:0}' +
      '.weights{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:9px;min-width:0}' +
      '.weight{border:1px solid #aaa;border-radius:5px;text-align:center;padding:7px 3px 5px;display:flex;flex-direction:column;gap:3px;min-width:0}' +
      '.weight span{font-size:9px;font-weight:700}.weight strong{font-size:17px;letter-spacing:-.3px;overflow-wrap:anywhere}.weight small{font-size:9px}' +
      '.signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:auto;padding:10px 15px 2px;text-align:center;font-size:9px}' +
      '.signatures span{display:block;border-top:1px solid #000;margin-bottom:5px}' +
      '.cut{height:8mm;display:flex;align-items:center;gap:8px;font-size:9px;white-space:nowrap}' +
      '.cut:before,.cut:after{content:"";border-top:1px dashed #777;flex:1}' +
      (termica ? '' : '@media screen{body{background:#eee;padding:20px}.sheet{background:white;max-width:210mm;margin:auto;padding:8mm 10mm;box-shadow:0 5px 25px #0002}}') +
      '@media print{html,body{width:100%;height:auto}.preview-actions{display:none!important}.sheet{padding:0;box-shadow:none}}' +
      '</style></head><body>' +
      (visualizar ? '<nav class="preview-actions"><button type="button" onclick="window.print()">Imprimir ticket</button><button type="button" onclick="window.close()">Fechar</button></nav>' : '') +
      '<main class="sheet">' +
      (termica ? viaTermica(1, 'FAZENDA') + '<div class="thermal-cut">RECORTAR AQUI</div>' + viaTermica(2, 'MOTORISTA') : via(1, 'FAZENDA') + '<div class="cut">✂ &nbsp; RECORTAR AQUI</div>' + via(2, 'MOTORISTA')) + '</main>' +
      (visualizar ? '' : '<script>window.addEventListener("load",()=>{window.focus();setTimeout(()=>window.print(),350)});<\/script>') +
      '</body></html>');
    janela.document.close();
  }

  function trocarTipo(value) {
    if (ticketAtivo) return;

    setForm((prev) => atualizarTipoTicket(prev, value));
    setEtapaSelecionada(0);
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

    setEtapaManual(0);
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

      preservarSegundaAoCriarRef.current = created.id;
      setTicketLocal(created);
      setTicketAtivoId(created.id);
      setTicketConsultaId(created.id);
      setTransportadoraFechamento(created.transportadora_id || '');

      toast({
        title: '1ª pesagem registrada',
        description: `${numero} • ${formatKg(pesoConfirmado)}`,
      });

      // O ticket JÁ foi criado. Se a atualização da lista falhar,
      // jamais informar que a pesagem não foi registrada.
      try { await onReload?.(); }
      catch (erroRefresh) {
        console.warn('[Pesagem] Ticket salvo, mas a lista não atualizou:', erroRefresh);
      }
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

    if (primeiraPesagem > 0 && Math.abs(pesoConfirmado - primeiraPesagem) < 0.0001) {
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

  // Os dois campos são editáveis para usuários autorizados em qualquer
  // ordem. O valor só é registrado após confirmar no botão inferior.
  function editarPesoNoCampo(etapa) {
    if (!podeDigitar || saving || lendo || ticketFechado || !tipoAtual
      || pesquisaAberta || ticketPreviewId || autoPopupRef.current) return;
    setEtapaManual(etapa);
    setEtapaSelecionada(0);
    const atual = etapa === 1 ? primeiraPesagem : segundaPesagem;
    const valor = atual > 0
      ? Number(atual).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false,
      })
      : '';
    if (etapa === 1) setPesoDigitado1((anterior) => anterior || valor);
    else setPesoDigitado2((anterior) => anterior || valor);
  }

  function cancelarDigitacao(etapa) {
    if (etapa === 1) setPesoDigitado1('');
    else setPesoDigitado2('');
    setEtapaManual(0);
    setEtapaSelecionada(0);
  }

  function selecionarEtapa(etapa) {
    if (saving || lendo || ticketFechado || !tipoAtual || autoPopupRef.current) return;
    if (podeDigitar) {
      editarPesoNoCampo(etapa);
      (etapa === 1 ? primeiraInputRef : segundaInputRef).current?.focus();
      return;
    }
    if (etapa === 2 && !ticketAtivo) return;
    setEtapaSelecionada(etapa);
  }

  function confirmarPesoSelecionado() {
    const etapa = podeDigitar && etapaManual ? etapaManual : etapaCaptura;
    const texto = etapa === 1 ? pesoDigitado1 : pesoDigitado2;
    if (podeDigitar && etapaManual && texto.trim()) {
      const valor = parseQtd(texto);
      if (!(valor > 0) || !Number.isFinite(valor)) {
        toast({ variant: 'destructive', title: 'Informe um peso válido, maior que zero.' });
        return;
      }
      const anterior = etapa === 1 ? primeiraPesagem : segundaPesagem;
      if (anterior > 0 && Math.abs(anterior - valor) >= 0.0001) {
        setConfirmarCorrecao({ etapa, anterior, valor });
        return;
      }
    }
    capturarPeso(null, etapa);
  }

  async function capturarPeso(pesoAutomatico = null) {
    // Nunca gravar peso enquanto a Pesquisa ou consulta prévia está aberta:
    // o operador ainda não confirmou qual ticket irá continuar.
    if (pesquisaAberta || ticketPreviewId) return false;
    if (saving || lendo || ticketFechado || etapaCaptura === 0) return false;
    if (!pesoAutomatico && autoPopupRef.current) return false;

    const automatico = pesoAutomatico && typeof pesoAutomatico === 'object';
    if (automatico) {
      const idade = Date.now() - Date.parse(ultimaLeitura?.timestamp || '');
      // O peso foi validado ao abrir o popup e fica CONGELADO durante
      // os 10 segundos. Oscilações posteriores (vento) não alteram o
      // número confirmado; exigimos apenas fonte serial recente e
      // o mesmo ticket/etapa para evitar um registro no veículo errado.
      const inicioEstavel = Date.parse(pesoAutomatico.estavelDesde || '');
      const momentoCaptura = Date.parse(pesoAutomatico.criadoEm || '');
      if (!autoAtivo || !balancaConectada
        || !Number.isFinite(idade) || idade < 0 || idade > AUTO_LEITURA_VALIDADE_MS
        || !Number.isFinite(inicioEstavel) || !Number.isFinite(momentoCaptura)
        || momentoCaptura - inicioEstavel < AUTO_ESTABILIDADE_MS
        || !Number.isFinite(pesoAutomatico.peso)
        || pesoAutomatico.contexto !== autoContexto
        || pesoAutomatico.etapa !== etapaCaptura
        || pesoAutomatico.peso < AUTO_PESO_MINIMO_KG
        || pesoAtual.trim()) return false;
    }

    setSaving(true);
    try {
      const manual = !automatico && podeDigitar && pesoAtual.trim()
        ? parseQtd(pesoAtual)
        : null;
      const valor = automatico
        ? pesoAutomatico.peso
        : (manual ?? (balancaConectada ? await lerPeso() : null));

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

      const pesoLido = Number(valor);
      const capturadoEm = new Date().toISOString();

      if (etapaCaptura === 1 && ticketAtivo) {
        // Confere o estado atualizado no servidor antes de refazer a 1ª,
        // para não modificar ticket fechado em outra estação.
        const servidor = await api.entities.TicketPesagem.get(ticketAtivo.id);
        if (!recapturaPrimeiraValida({
          statusTicket: servidor.status,
          primeiraNova: pesoLido,
          segundaRegistrada: segundaPesagem > 0,
          segundaPeso: segundaPesagem,
        })) {
          toast({
            variant: 'destructive',
            title: 'Não foi possível refazer a 1ª pesagem',
            description: servidor.status !== 'aberto'
              ? 'Este ticket já foi fechado.'
              : 'A primeira e a segunda pesagem devem ser diferentes.',
          });
          return;
        }

        // O registro original permanece, com alteração auditável do peso
        // no mesmo ticket em aberto, sem gerar nova movimentação de estoque.
        const campoPeso = isInverted ? 'peso_bruto' : 'peso_tara';
        const atualizado = await api.entities.TicketPesagem.update(
          ticketAtivo.id,
          { [campoPeso]: pesoLido }
        );
        setTicketLocal({ ...servidor, ...atualizado, [campoPeso]: pesoLido });
        setEtapaSelecionada(0);
        setPesoAtual('');
        toast({
          title: '1ª pesagem atualizada',
          description: formatKg(pesoLido),
        });
        try { await onReload?.(); }
        catch (erroRefresh) {
          console.warn('[Pesagem] Peso atualizado, mas a lista não recarregou:', erroRefresh);
        }
        autoRef.current.aguardandoZerar = true;
        setAutoAguardandoZerar(true);
        registrarEventoMonitor({
          tipo: 'primeira_gravada',
          descricao: `1ª pesagem corrigida e salva no servidor (${automatico ? 'auto' : 'manual'}).`,
          etapa: 1,
          peso_kg: pesoLido,
          registro: 'servidor',
          ticket: String(ticketAtivo?.numero || ''),
        });
        return true;
      }

      if (etapaCaptura === 1) {
        const criado = await registrarPrimeiraPesagem(
          pesoLido,
          capturadoEm
        );
        if (criado) {
          setEtapaSelecionada(0);
          setPesoAtual('');
          autoRef.current.aguardandoZerar = true;
          setAutoAguardandoZerar(true);
          registrarEventoMonitor({
            tipo: 'primeira_gravada',
            descricao: `1ª pesagem gravada no servidor (${automatico ? 'auto' : 'manual'}).`,
            etapa: 1,
            peso_kg: pesoLido,
            registro: 'servidor',
            ticket: String(criado?.numero || ''),
          });
          return true;
        }
        return false;
      }

      if (
        etapaCaptura === 2 &&
        registrarSegundaPesagem(pesoLido, capturadoEm)
      ) {
        setEtapaSelecionada(0);
        setPesoAtual('');
        autoRef.current.aguardandoZerar = true;
        setAutoAguardandoZerar(true);
        registrarEventoMonitor({
          tipo: 'segunda_capturada',
          descricao: `2ª pesagem confirmada no PC (${automatico ? 'auto' : 'manual'}). Aguardando fechamento do ticket.`,
          etapa: 2,
          peso_kg: pesoLido,
          registro: 'pc_aguarda_fechamento',
          ticket: String(ticketAtivo?.numero || ''),
        });
        return true;
      }
      return false;
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao capturar peso',
        description: String(error?.message || error),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function fecharTicketAtual() {
    if (!ticketAtivo || !(segundaPesagem > 0) || !(liquido > 0)) {
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
        correcaoPesoKg: 0,
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

      registrarEventoMonitor({
        tipo: 'ticket_fechado',
        descricao: 'Ticket fechado e gravado no servidor.',
        etapa: 2,
        peso_kg: segundaPesagem,
        registro: 'servidor',
        ticket: String(fechado?.numero || ticketAtivo?.numero || ''),
      });
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

  // Só inicia a contagem depois que o formulário da 1ª pesagem está
  // completo. Na 2ª, utiliza exclusivamente um ticket aberto carregado.
  const transportadorasPedidoAuto = String(pedidoSel?.transportadora_ids || '')
    .split(',').map((id) => id.trim()).filter(Boolean);
  const transportadoraVendaPronta = transportadorasPedidoAuto.length <= 1
    || transportadorasPedidoAuto.includes(form.transportadora_id);
  const autoDadosProntos = ticketAtivo
    ? ticketAtivo.status === 'aberto'
    : Boolean(form.tipo && form.motorista.trim()
      && normalizePlaca(form.placa).length === 7
      && (form.tipo === 'venda'
        ? pedidoSel?.status === 'aberto' && transportadoraVendaPronta
        : form.produto_id && form.transportadora_id));

  // Mudar motorista, placa, pedido ou etapa reinicia a estabilidade de 2 s.
  const autoContexto = ticketAtivo
    ? `aberto|${ticketAtivo.id}|${etapaCaptura}`
    : [
      'novo', form.tipo, form.motorista.trim(), normalizePlaca(form.placa),
      form.pedido_id, form.produto_id, form.cliente_id, form.transportadora_id,
    ].join('|');

  // Este estado é enviado pelo PC da Toledo a cada publicação serial.
  // O monitor ADM mostra POR QUE a automação não capturou, mesmo quando
  // a balança já tem um peso acima de 40 kg.
  useEffect(() => {
    return () => {
      atualizarEstadoMonitor({
        tela_ativa: false,
        auto_ativa: false,
        etapa: 0,
        estado: 'tela_fechada',
        detalhe: 'A aba Tickets não está aberta no PC da balança.',
        segundos: null,
        peso_candidato: null,
        ticket: '',
      });
    };
  }, [atualizarEstadoMonitor]);

  useEffect(() => {
    const agora = Date.now();
    const peso = ultimaLeitura?.peso == null ? null : Number(ultimaLeitura.peso);
    const idade = agora - Date.parse(ultimaLeitura?.timestamp || '');
    const leituraValida = balancaConectada && peso !== null
      && Number.isFinite(peso) && Number.isFinite(idade)
      && idade >= 0 && idade <= AUTO_LEITURA_VALIDADE_MS;
    const numero = String(ticketAtivo?.numero || form.placa || '');
    let estado = 'aguardando_peso';
    let detalhe = 'Aguardando um peso estável na Toledo.';
    let segundos = null;
    let candidato = null;

    if (pesquisaAberta) {
      estado = 'pesquisa_aberta';
      detalhe = 'Pesquisa aberta. Captura automática pausada enquanto a lista está visível.';
    } else if (ticketPreviewId) {
      estado = 'consulta_ticket';
      detalhe = 'Ticket selecionado para consulta. Confirme Continuar pesagem no Resumo para liberar o formulário.';
    } else if (autoCapturando) {
      estado = 'registrando';
      detalhe = 'PC está enviando a confirmação do peso para o sistema.';
      candidato = autoPopup?.peso ?? null;
    } else if (autoPopup?.fase === 'confirmar') {
      estado = 'popup_aberto';
      detalhe = 'Peso identificado: popup de confirmação aberto no PC.';
      segundos = autoPopupSegundos;
      candidato = autoPopup.peso;
    } else if (autoPopup?.fase === 'opcoes') {
      estado = 'peso_cancelado';
      detalhe = 'Peso cancelado. PC aguardando Pesar novamente ou Cancelar automação.';
      candidato = autoPopup.peso;
    } else if (!autoAtivo) {
      estado = 'manual';
      detalhe = 'Captura automática desligada no PC: somente pesagem manual.';
    } else if (autoRetentativaSegundos > 0) {
      estado = 'pausa_retentativa';
      detalhe = 'Nova tentativa solicitada. Aguardando 3 s antes de buscar estabilidade.';
      segundos = autoRetentativaSegundos;
    } else if (!balancaConectada) {
      estado = 'sem_serial';
      detalhe = 'Serial Toledo não está conectada no PC.';
    } else if (!leituraValida || autoSemLeitura) {
      estado = 'sem_leitura';
      detalhe = String(diagnosticoSerial || 'Porta serial conectada, mas sem peso válido recente da Toledo.').slice(0, 240);
    } else if (!autoDadosProntos) {
      estado = 'cadastro_incompleto';
      if (!form.tipo && !ticketAtivo) detalhe = 'Selecione o tipo de ticket.';
      else if (!form.motorista.trim() && !ticketAtivo) detalhe = 'Preencha o motorista.';
      else if (normalizePlaca(form.placa).length !== 7 && !ticketAtivo) detalhe = 'Preencha a placa completa.';
      else if (form.tipo === 'venda' && !pedidoSel && !ticketAtivo) detalhe = 'Selecione um pedido de venda aberto.';
      else if (form.tipo === 'venda' && !transportadoraVendaPronta && !ticketAtivo) detalhe = 'Selecione uma transportadora válida.';
      else if (!ticketAtivo && !form.produto_id) detalhe = 'Selecione o produto.';
      else if (!ticketAtivo && !form.transportadora_id) detalhe = 'Selecione a transportadora.';
      else detalhe = 'Complete os campos obrigatórios do ticket.';
    } else if (etapaCaptura === 0 || ticketFechado) {
      estado = 'aguardando_ticket';
      detalhe = 'Etapa finalizada. Aguarde outro ticket ou feche o atual.';
    } else if (etapaSelecionada !== 0) {
      estado = 'recaptura_manual';
      detalhe = 'Uma etapa foi selecionada manualmente para refazer o peso. Volte à etapa automática para rearmar a captura.';
    } else if (autoAguardandoZerar) {
      estado = 'aguardando_zera';
      detalhe = 'Peso capturado. Aguarde cair abaixo de 40 kg para liberar a próxima etapa.';
    } else if (document.visibilityState !== 'visible') {
      estado = 'aba_oculta';
      detalhe = 'A aba do GFARM precisa estar visível no PC para a captura automática.';
    } else if (saving || lendo || pesoAtual.trim()) {
      estado = 'ocupada';
      detalhe = 'Captura automática pausada: existe uma operação ou peso manual em andamento.';
    } else if (peso < AUTO_PESO_MINIMO_KG) {
      estado = 'abaixo_minimo';
      detalhe = 'Aguardando pelo menos 40 kg na Toledo.';
    } else if (etapaCaptura === 2 && Math.abs(peso - primeiraPesagem) < 0.0001) {
      estado = 'peso_igual';
      detalhe = 'A 2ª pesagem deve ser diferente da 1ª.';
    } else if (autoRestante !== null) {
      estado = autoOscilou ? 'oscilando' : 'estabilizando';
      detalhe = autoOscilou
        ? 'O peso variou. Contagem de 2 s foi reiniciada.'
        : 'Peso detectado. Aguardando completar 2 s sem variação.';
      segundos = autoRestante;
      candidato = peso;
    }

    const novoStatus = {
      tela_ativa: true,
      auto_ativa: autoAtivo,
      etapa: etapaCaptura,
      estado,
      detalhe,
      segundos,
      peso_candidato: candidato,
      ticket: numero.slice(0, 100),
    };
    atualizarEstadoMonitor(novoStatus);
    // Exibir exatamente o mesmo diagnóstico também no PC, mesmo quando
    // o envio à VPS falhar, para ninguém ficar sem sinal do que acontece.
    setStatusAutoLocal((anterior) => (
      anterior.estado === estado &&
      anterior.detalhe === detalhe &&
      anterior.segundos === segundos &&
      anterior.peso_candidato === candidato
        ? anterior : novoStatus
    ));
  }, [
    atualizarEstadoMonitor, autoAtivo, autoCapturando, autoPopup,
    autoPopupSegundos, autoRetentativaSegundos, autoAguardandoZerar,
    autoDadosProntos, autoRestante, autoOscilou, balancaConectada,
    ultimaLeitura?.peso, ultimaLeitura?.timestamp, autoSemLeitura, etapaCaptura,
    ticketFechado, primeiraPesagem, ticketAtivo?.numero, form.tipo,
    form.motorista, form.placa, form.produto_id, form.transportadora_id,
    pedidoSel, transportadoraVendaPronta, saving, lendo, pesoAtual,
    etapaSelecionada, diagnosticoSerial, pesquisaAberta, ticketPreviewId,
  ]);

  function limparContagemAutomatica() {
    const estado = autoRef.current;
    estado.peso = null;
    estado.desde = 0;
    estado.chave = '';
    estado.leituraEstavelDesde = '';
    setAutoRestante((atual) => atual === null ? atual : null);
  }

  // O prazo de 10 s é de decisão. Sem intervenção, confirma o peso que foi
  // congelado no popup após 2 s de estabilidade.
  async function confirmarCapturaAutomatica(captura = autoPopupRef.current) {
    const estado = autoRef.current;
    if (!captura || captura.fase !== 'confirmar'
      || autoPopupRef.current !== captura || estado.confirmando || estado.disparando) return;
    estado.confirmando = true;
    estado.disparando = true;
    setAutoCapturando(true);
    registrarEventoMonitor({
      tipo: 'confirmacao_iniciada',
      descricao: 'PC iniciou gravação do peso mostrado no popup.',
      etapa: captura.etapa,
      peso_kg: captura.peso,
      ticket: String(ticketAtivo?.numero || ''),
    });
    try {
      const registrado = await capturarPeso(captura);
      if (autoPopupRef.current !== captura) return;
      if (registrado === true) {
        estado.aguardandoZerar = true;
        setAutoAguardandoZerar(true);
        setAutoOscilou(false);
        alterarPopupAuto(null);
      } else {
        registrarEventoMonitor({
          tipo: 'falha_captura',
          descricao: 'Popup confirmou, mas o PC não registrou o peso. Verifique o ticket e a serial.',
          etapa: captura.etapa,
          peso_kg: captura.peso,
          ticket: String(ticketAtivo?.numero || ''),
        });
        alterarPopupAuto({
          ...captura,
          fase: 'opcoes',
          motivo: 'Não foi possível registrar o peso automaticamente. Confira a conexão e o ticket, depois escolha como continuar.',
        });
      }
    } catch (error) {
      console.error('[Pesagem] Erro na confirmação automática:', error);
      registrarEventoMonitor({
        tipo: 'falha_captura',
        descricao: 'Falha ao registrar peso no PC: ' + String(error?.message || error).slice(0, 130),
        etapa: captura.etapa,
        peso_kg: captura.peso,
        ticket: String(ticketAtivo?.numero || ''),
      });
      if (autoPopupRef.current === captura) {
        alterarPopupAuto({
          ...captura,
          fase: 'opcoes',
          motivo: 'Erro ao registrar a pesagem. Você pode tentar novamente ou assumir o controle manual.',
        });
      }
    } finally {
      estado.confirmando = false;
      estado.disparando = false;
      setAutoCapturando(false);
    }
  }

  // O interval abaixo não pode usar um callback antigo após re-render.
  useEffect(() => {
    confirmarAutoRef.current = confirmarCapturaAutomatica;
  });

  function cancelarPrimeiraConfirmacao() {
    const captura = autoPopupRef.current;
    if (!captura || captura.fase !== 'confirmar' || autoRef.current.confirmando) return;
    registrarEventoMonitor({
      tipo: 'cancelado',
      descricao: 'Operador cancelou o peso sugerido no popup.',
      etapa: captura.etapa,
      peso_kg: captura.peso,
      ticket: String(ticketAtivo?.numero || ''),
    });
    alterarPopupAuto({
      ...captura,
      fase: 'opcoes',
      motivo: 'Você cancelou este peso. Deseja pesar novamente ou cancelar a automação?',
    });
  }

  function pesarNovamenteAutomatico() {
    if (!autoPopupRef.current || autoPopupRef.current.fase !== 'opcoes'
      || autoRef.current.confirmando) return;
    registrarEventoMonitor({
      tipo: 'nova_tentativa',
      descricao: 'Operador pediu nova pesagem: pausa de 3 s antes da estabilidade de 2 s.',
      etapa: autoPopupRef.current.etapa,
      peso_kg: autoPopupRef.current.peso,
      ticket: String(ticketAtivo?.numero || ''),
    });
    alterarPopupAuto(null);
    limparContagemAutomatica();
    setAutoOscilou(false);
    const ate = Date.now() + AUTO_ESPERA_NOVA_TENTATIVA_MS;
    setAutoRetentativaAte(ate);
    setAutoRetentativaSegundos(Math.ceil(AUTO_ESPERA_NOVA_TENTATIVA_MS / 1000));
  }

  function encerrarCapturaAutomatica() {
    if (autoRef.current.confirmando) return;
    registrarEventoMonitor({
      tipo: 'auto_desligada',
      descricao: 'Operador desativou a captura automática: processo agora é manual.',
      etapa: etapaCaptura,
      ticket: String(ticketAtivo?.numero || ''),
    });
    alterarPopupAuto(null);
    limparContagemAutomatica();
    setAutoRetentativaAte(0);
    setAutoRetentativaSegundos(0);
    setAutoOscilou(false);
    setAutoAtivo(false);
    toast({
      title: 'Captura automática desativada',
      description: 'A pesagem pode ser registrada pelo botão manual. Para reativar, clique em Auto desligada.',
    });
  }

  function alternarCapturaAutomatica() {
    if (autoRef.current.confirmando) return;
    if (autoAtivo) {
      encerrarCapturaAutomatica();
      return;
    }
    // Se houve captura manual/automática, preservar a trava até a
    // plataforma ficar abaixo de 40 kg, mesmo após reativar o modo Auto.
    setAutoRetentativaAte(0);
    setAutoRetentativaSegundos(0);
    setAutoOscilou(false);
    limparContagemAutomatica();
    setAutoAtivo(true);
    registrarEventoMonitor({
      tipo: 'auto_ligada',
      descricao: 'Automação reativada no PC da Toledo.',
      etapa: etapaCaptura,
      ticket: String(ticketAtivo?.numero || ''),
    });
  }

  useEffect(() => {
    if (!autoPopup || autoPopup.fase !== 'confirmar') return undefined;
    const atualizar = () => {
      const captura = autoPopupRef.current;
      if (captura !== autoPopup || captura?.fase !== 'confirmar') return;
      const restante = Math.max(0, captura.expiresAt - Date.now());
      setAutoPopupSegundos(Math.ceil(restante / 1000));
      if (restante <= 0) confirmarAutoRef.current?.(captura);
    };
    atualizar();
    const timer = setInterval(atualizar, 200);
    return () => clearInterval(timer);
  }, [autoPopup]);

  // Se o usuário alterar o ticket ou selecionar outra etapa, nunca
  // confirma um peso identificado para o ticket anterior.
  useEffect(() => {
    const captura = autoPopupRef.current;
    // Durante o POST da 1ª pesagem, o ticket muda naturalmente de
    // "novo" para "aberto". Não interprete essa transição como cancelamento.
    if (captura?.fase === 'confirmar' && !autoRef.current.confirmando
      && (captura.contexto !== autoContexto || captura.etapa !== etapaCaptura)) {
      alterarPopupAuto({
        ...captura,
        fase: 'opcoes',
        motivo: 'O ticket ou a etapa de pesagem mudou. Esta leitura não será registrada.',
      });
    }
  }, [autoContexto, etapaCaptura]);

  useEffect(() => {
    const timer = setInterval(() => {
      const estado = autoRef.current;
      const agora = Date.now();
      const peso = ultimaLeitura?.peso == null ? NaN : Number(ultimaLeitura.peso);
      const dataLeitura = Date.parse(ultimaLeitura?.timestamp || '');
      const inicioEstavelNaBalanca = ultimaLeitura?.estavelDesde || '';
      const leituraRecente = balancaConectada
        && Number.isFinite(peso) && Number.isFinite(dataLeitura)
        && agora >= dataLeitura
        && agora - dataLeitura <= AUTO_LEITURA_VALIDADE_MS;
      setAutoSemLeitura(balancaConectada && !leituraRecente);

      if (estado.aguardandoZerar && leituraRecente && peso < AUTO_PESO_MINIMO_KG) {
        estado.aguardandoZerar = false;
        setAutoAguardandoZerar(false);
        setAutoOscilou(false);
        limparContagemAutomatica();
      }

      // Nenhuma leitura gera captura enquanto existir confirmação/opções
      // pendentes ou enquanto uma gravação anterior estiver em andamento.
      if (autoPopupRef.current || estado.confirmando || estado.disparando) {
        limparContagemAutomatica();
        return;
      }

      if (autoRetentativaAte > agora) {
        setAutoRetentativaSegundos(Math.ceil((autoRetentativaAte - agora) / 1000));
        limparContagemAutomatica();
        return;
      }
      if (autoRetentativaSegundos !== 0) setAutoRetentativaSegundos(0);

      const podeIniciar = autoAtivo && !pesquisaAberta && !ticketPreviewId
        && !estado.aguardandoZerar
        && autoDadosProntos
        && etapaSelecionada === 0 && (etapaCaptura === 1 || etapaCaptura === 2)
        && !ticketFechado && !saving && !lendo && !pesoAtual.trim()
        && document.visibilityState === 'visible' && leituraRecente
        && Number.isFinite(Date.parse(inicioEstavelNaBalanca))
        && peso >= AUTO_PESO_MINIMO_KG
        && (etapaCaptura !== 2 || Math.abs(peso - primeiraPesagem) >= 0.0001);

      if (!podeIniciar) {
        limparContagemAutomatica();
        if (!leituraRecente || peso < AUTO_PESO_MINIMO_KG) setAutoOscilou(false);
        return;
      }

      if (estado.peso !== peso || estado.chave !== autoContexto
        || estado.leituraEstavelDesde !== inicioEstavelNaBalanca || !estado.desde) {
        // Exibe que a contagem foi reiniciada por oscilação de leitura.
        if (estado.peso !== null && estado.chave === autoContexto
          && (estado.peso !== peso
            || estado.leituraEstavelDesde !== inicioEstavelNaBalanca)) {
          setAutoOscilou(true);
        }
        estado.peso = peso;
        // O relógio começa no primeiro frame serial com esse peso,
        // NÃO quando o React montou/recriou seu intervalo. Isso evita
        // exigir mais 2 segundos além do tempo já estável na Toledo.
        estado.desde = Date.parse(inicioEstavelNaBalanca);
        estado.chave = autoContexto;
        estado.leituraEstavelDesde = inicioEstavelNaBalanca;
        setAutoRestante(Math.ceil(Math.max(0, AUTO_ESTABILIDADE_MS - (agora - estado.desde)) / 1000));
        return;
      }

      const faltamMs = Math.max(0, AUTO_ESTABILIDADE_MS - (agora - estado.desde));
      if (faltamMs > 0) {
        const segundos = Math.ceil(faltamMs / 1000);
        setAutoRestante((atual) => atual === segundos ? atual : segundos);
        return;
      }

      // Não salva aqui. Constrói uma fotografia imutável do peso e
      // espera até 10 s por Confirmar/Cancelar. Sem ação, confirma.
      const captura = {
        fase: 'confirmar',
        peso,
        etapa: etapaCaptura,
        contexto: autoContexto,
        estavelDesde: inicioEstavelNaBalanca,
        criadoEm: new Date(agora).toISOString(),
        expiresAt: agora + AUTO_CONFIRMACAO_MS,
      };
      setAutoOscilou(false);
      setAutoPopupSegundos(Math.ceil(AUTO_CONFIRMACAO_MS / 1000));
      registrarEventoMonitor({
        tipo: 'peso_identificado',
        descricao: 'Peso estável por 2 s. Popup aberto no PC aguardando decisão por 10 s.',
        etapa: etapaCaptura,
        peso_kg: peso,
        ticket: String(ticketAtivo?.numero || ''),
      });
      limparContagemAutomatica();
      alterarPopupAuto(captura);
    }, 250);

    return () => clearInterval(timer);
  }, [
    autoAtivo, autoDadosProntos, autoContexto, balancaConectada,
    etapaSelecionada, etapaCaptura, ticketFechado, primeiraPesagem,
    saving, lendo, pesoAtual, ultimaLeitura?.peso, ultimaLeitura?.timestamp,
    ultimaLeitura?.estavelDesde, autoRetentativaAte, autoRetentativaSegundos,
    pesquisaAberta, ticketPreviewId,
  ]);

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

  // A pesquisa permite visualizar o Resumo sem trocar o ticket em operação.
  const resumoTicket = ticketPreview || ticketAtivo;
  const resumoPedido = pedidos.find((p) => p.id === resumoTicket?.pedido_id);
  const resumoCliente = pessoas.find((p) => p.id === (resumoTicket?.cliente_id || resumoPedido?.cliente_id));
  const resumoProduto = produtos.find((p) => p.id === (resumoTicket?.produto_id || resumoPedido?.produto_id));
  const resumoTransportadora = transportadoras.find((t) => t.id === resumoTicket?.transportadora_id);
  const resumoPrimeira = resumoTicket
    ? (Number(resumoTicket.peso_tara) || Number(resumoTicket.peso_bruto) || 0) : 0;
  const resumoSegunda = ticketPreview
    ? (ticketPreview.status === 'fechado'
      ? ((Number(ticketPreview.peso_tara) || 0) === resumoPrimeira
        ? Number(ticketPreview.peso_bruto) || 0 : Number(ticketPreview.peso_tara) || 0)
      : ticketPreview.id === ticketAtivo?.id ? segundaPesagem : 0)
    : segundaExibida;
  const resumoLiquido = ticketPreview
    ? (ticketPreview.status === 'fechado'
      ? Number(ticketPreview.peso_liquido) || 0
      : ticketPreview.id === ticketAtivo?.id ? liquido : 0)
    : liquidoExibido;

  return (
    <div className="flex min-h-0 flex-col gap-2 lg:h-full lg:overflow-hidden">
      <div className="grid min-h-0 min-w-0 flex-1 items-stretch gap-3 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(270px,0.85fr)]">
          <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border shadow-none">
            <div className="shrink-0 border-b bg-muted/15 px-3 py-2">
              <div className="flex items-center gap-2">
                <TipoIcon className="h-4 w-4 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold">
                    Dados do Ticket
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {ticketPreview
                      ? 'Ticket selecionado para consulta. Continue pelo Resumo.'
                      : ticketAtivo
                        ? 'Ticket em aberto pronto para a 2ª pesagem.'
                        : 'Preencha os dados antes de capturar e confirmar o peso.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {ticketPreview ? (
                <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/15 p-4 text-center">
                  <FileText className="h-9 w-9 text-primary" />
                  <h3 className="text-base font-bold">{ticketPreview.numero}</h3>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    O formulário foi recolhido. Confira este ticket no Resumo.
                    Para carregá-lo, clique em <strong>Continuar pesagem</strong> no Resumo.
                  </p>
                  {ticketPreview.status === 'fechado' && (
                    <p className="text-xs font-semibold text-amber-700">
                      Este ticket já está fechado e só pode ser consultado.
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTicketPreviewId('');
                      setTicketConsultaId(ticketAtivo?.id || '');
                    }}
                  >
                    Voltar ao formulário
                  </Button>
                </div>
              ) : (
              <div className="space-y-3">
            <div className="mb-3 flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center">
              <div className="sm:min-w-[95px]">
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
              <fieldset
                disabled={!tipoAtual}
                className="min-w-0 space-y-3 disabled:opacity-55"
                aria-label="Dados do ticket: escolha o tipo antes de preencher"
              >
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

              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-2">
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
              </fieldset>
              </div>
              )}
            </div>
          </Card>


        <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border shadow-none">
          <div className="shrink-0 border-b bg-muted/15 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-primary" />
                Resumo do Ticket
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 font-bold"
                onClick={() => setPesquisaAberta(true)}
                disabled={saving || autoCapturando || !!autoPopup}
                aria-label="PESQUISA"
              >
                <Search className="h-4 w-4" /> PESQUISA
              </Button>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {ticketPreview
                ? 'Ticket selecionado. Confira o resumo antes de continuar.'
                : 'Resumo do ticket atual e acesso à pesquisa.'}
            </p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {ticketPreview && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">
                1º clique realizado: ticket em consulta. Para carregar no formulário, use o botão abaixo.
              </div>
            )}
            <div className="space-y-1.5 rounded-lg bg-muted/20 p-2.5 text-xs">
              {[
                ['Ticket', resumoTicket?.numero || 'Novo ticket'],
                ['Status', resumoTicket?.status === 'fechado'
                  ? 'Fechado' : resumoTicket ? 'Aberto' : 'Novo'],
                ['Tipo', tipoLabel(resumoTicket?.tipo || tipoAtual)],
                ['Motorista', resumoTicket ? resumoTicket.motorista || '—' : form.motorista || '—'],
                ['Placa', formatPlaca(resumoTicket ? resumoTicket.placa : form.placa) || '—'],
                ['Transportadora', resumoTicket
                  ? resumoTransportadora?.nome || resumoTicket.transportadora_nome || '—'
                  : transportadoraAtual?.nome || '—'],
                ['Cliente / Fornecedor', resumoTicket
                  ? resumoCliente?.nome || resumoTicket.cliente_nome || '—'
                  : clienteAtual?.nome || '—'],
                ['Produto', resumoTicket
                  ? resumoProduto?.nome || resumoTicket.produto_nome || '—'
                  : produtoAtual?.nome || '—'],
                ['Origem / Destino', resumoTicket
                  ? `${resumoTicket.origem || '—'} / ${resumoTicket.destino || '—'}`
                  : `${form.origem || '—'} / ${form.destino || '—'}`],
              ].map(([label, value]) => (
                <div key={label} className="grid min-w-0 grid-cols-[105px_minmax(0,1fr)] gap-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="min-w-0 break-words font-medium">{value}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2 rounded-lg border p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span>1ª Pesagem</span>
                <span className="font-semibold">
                  {resumoTicket ? formatKg(resumoPrimeira) : '—'}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {resumoTicket ? 'Registrada' : 'Aguardando captura'}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span>2ª Pesagem</span>
                <span className="font-semibold">
                  {resumoSegunda > 0 ? formatKg(resumoSegunda) : '—'}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {resumoSegunda > 0 ? 'Capturada' : 'Aguardando captura'}
              </p>
              <div className="flex items-center justify-between gap-2 border-t pt-2 font-semibold">
                <span>Peso Líquido</span>
                <span className="text-base text-primary">
                  {resumoSegunda > 0 ? formatKg(resumoLiquido) : '—'}
                </span>
              </div>
            </div>
            </div>

            <div className="shrink-0 space-y-2 border-t pt-2">
            {ticketPreview ? (
              <>
                {ticketPreview.status === 'aberto' ? (
                  <Button
                    type="button"
                    className="mt-auto h-10 w-full gap-2"
                    disabled={saving || autoCapturando}
                    onClick={() => continuarPesagem(ticketPreview)}
                  >
                    <Play className="h-4 w-4" /> Continuar pesagem
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="mt-auto h-10 w-full gap-2"
                    variant="outline"
                    onClick={() => imprimirTicket(ticketPreview, true)}
                  >
                    <FileText className="h-4 w-4" /> Visualizar ticket fechado
                  </Button>
                )}
              </>
            ) : (
              <>
                {ticketAtivo?.tipo === 'venda' && pedidoSel && !pedidoSel.sem_limite &&
                  liquido > (Number(pedidoSel.saldo_kg) || 0) && (
                    <p className="text-xs font-semibold text-destructive">
                      Peso líquido acima do saldo disponível do pedido.
                    </p>
                  )}
                {ticketAtivo?.status === 'aberto' &&
                  ((Number(ticketAtivo.peso_tara) || 0) > 0 || (Number(ticketAtivo.peso_bruto) || 0) > 0) && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-auto h-9 w-full gap-2"
                    onClick={() => imprimirTicket(ticketAtivo)}
                  >
                    <Printer className="h-4 w-4" /> Imprimir Ticket
                  </Button>
                )}
                {ticketAtivo?.status === 'aberto' && (
                  <Button
                    type="button"
                    className="h-10 w-full gap-2"
                    disabled={saving || ticketFechado || !ticketAtivo || !(segundaPesagem > 0) || !(liquido > 0)}
                    onClick={fecharTicketAtual}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {saving ? 'Processando...' : 'Fechar e Salvar Ticket'}
                  </Button>
                )}
              </>
            )}
            </div>
          </div>
        </Card>

        <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border shadow-none">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Weight className="h-4 w-4 text-primary" />
              Pesagem
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={autoAtivo}
                title="Captura automática: peso a partir de 40 kg estável por 2 segundos, seguido de popup de 10 segundos"
                disabled={autoCapturando}
                onClick={alternarCapturaAutomatica}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${autoAtivo
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-border bg-muted/30 text-muted-foreground'}`}
              >
                Auto {autoAtivo ? 'ligada' : 'desligada'}
              </button>
              <Badge
                variant="outline"
                className={balancaConectada
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : mostrandoRemoto
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-red-200 bg-red-50 text-red-700'}
              >
                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${balancaConectada ? 'bg-emerald-500' : mostrandoRemoto ? 'bg-sky-500' : 'bg-red-500'}`} />
                {balancaConectada ? 'Serial local' : mostrandoRemoto ? 'Monitor remoto' : 'Balança desconectada'}
              </Badge>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="mb-1 text-xs text-muted-foreground">
                {mostrandoRemoto ? 'Peso em tempo real pela VPS — SOMENTE CONSULTA' : 'Peso em tempo real'}
              </p>
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 text-right text-3xl font-bold tabular-nums 2xl:text-4xl">
                  {displayPeso}
                </span>
                <span className="text-sm text-muted-foreground">kg</span>
              </div>
            </div>

            {mostrandoRemoto && (
              <p className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] text-sky-800">
                Este peso vem do computador da balança. Não é usado para capturar nem registrar tickets neste PC.
              </p>
            )}

            <div
              role="status"
              aria-live="polite"
              className={`rounded-lg border px-3 py-2.5 text-xs ${
                ['sem_serial', 'sem_leitura', 'cadastro_incompleto', 'aba_oculta'].includes(statusAutoLocal.estado)
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : ['popup_aberto', 'registrando', 'estabilizando'].includes(statusAutoLocal.estado)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-border bg-muted/20'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[12px]">DIAGNÓSTICO DA CAPTURA NO PC</strong>
                <span className="font-semibold">
                  {autoAtivo ? 'Auto ligada · 2 s' : 'Auto desligada'}
                </span>
              </div>
              <p className="mt-1 font-medium">{statusAutoLocal.detalhe}</p>
              {statusAutoLocal.segundos != null && (
                <p className="mt-1 font-bold tabular-nums">
                  Contagem: {statusAutoLocal.segundos} s
                  {statusAutoLocal.peso_candidato != null
                    ? ` · Peso: ${formatKg(statusAutoLocal.peso_candidato)}` : ''}
                </p>
              )}
              {!balancaConectada && diagnosticoSerial && (
                <p className="mt-1 text-[11px]">
                  Serial: {diagnosticoSerial}
                </p>
              )}
              {balancaConectada && statusAutoLocal.estado === 'sem_leitura' && diagnosticoSerial && (
                <p className="mt-1 text-[11px]">Diagnóstico Toledo: {diagnosticoSerial}</p>
              )}
              {['erro', 'outra_estacao'].includes(statusPublicacao) && (
                <p className="mt-1 text-[11px]">
                  Monitor remoto: {statusPublicacao === 'outra_estacao'
                    ? 'outra estação está transmitindo'
                    : erroPublicacao || 'não está conseguindo publicar na VPS'}
                </p>
              )}
            </div>

            {autoAtivo && (
              <p className="px-1 text-[11px] text-muted-foreground" role="status">
                {autoCapturando
                  ? 'Confirmando e registrando o peso capturado...'
                  : autoPopup?.fase === 'confirmar'
                    ? `Peso identificado: ${formatKg(autoPopup.peso)}. Confirmação automática em ${autoPopupSegundos} s, se ninguém cancelar.`
                    : autoPopup?.fase === 'opcoes'
                      ? 'Peso cancelado. Escolha Pesar novamente ou Cancelar automação no popup.'
                      : autoRetentativaSegundos > 0
                        ? `Nova tentativa em ${autoRetentativaSegundos} s; depois serão necessários 2 s de peso estável.`
                        : autoAguardandoZerar
                          ? 'Pesagem registrada. Aguarde o peso cair abaixo de 40 kg antes de uma nova captura automática.'
                          : !balancaConectada
                            ? 'Automação parada: balança serial desconectada ou reconectando.'
                            : !autoDadosProntos
                              ? 'Captura automática aguardando preenchimento do ticket.'
                              : etapaCaptura === 0
                                ? 'Pesagens registradas. Feche o ticket para concluir.'
                                : autoSemLeitura
                                  ? 'Sem leitura recente válida da Toledo. Verifique a conexão serial: não é oscilação, faltam dados.'
                                  : etapaCaptura === 2 && Number(ultimaLeitura?.peso) === primeiraPesagem
                                    ? 'A 2ª pesagem exige um peso diferente da 1ª. Aguardando nova leitura.'
                                    : autoRestante !== null
                                      ? `${autoOscilou ? 'Peso oscilou; contagem reiniciada. ' : ''}Buscando estabilidade: ${autoRestante} s restantes.`
                                      : 'Aguardando peso de 40 kg ou mais, sem variação durante 2 s.'}
              </p>
            )}

            {podeDigitar && (
              <div className="rounded-lg border border-dashed border-primary/30 bg-muted/10 px-3 py-2.5">
                <label htmlFor="peso-manual-pesagem" className="mb-1.5 block text-xs font-semibold">
                  Peso manual (ADM)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="peso-manual-pesagem"
                    ref={pesoInputRef}
                    aria-label="Peso manual em quilogramas"
                    inputMode="decimal"
                    type="text"
                    autoComplete="off"
                    value={pesoAtual}
                    onChange={(event) => setPesoAtual(event.target.value)}
                    placeholder="Informe o peso em kg"
                    disabled={saving || lendo || ticketFechado || !tipoAtual}
                    className="h-10 min-w-0 flex-1 bg-background text-right text-lg font-semibold tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">kg</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Opcional. Quando preenchido, o peso digitado será registrado no lugar da leitura da balança.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => selecionarEtapa(1)}
              disabled={saving || lendo || !tipoAtual}
              aria-pressed={etapaCaptura === 1}
              title="Selecionar primeira pesagem para capturar novamente"
              className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-70 ${
                etapaCaptura === 1
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-muted/20 hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold">1ª Pesagem</span>
                <span className={ticketAtivo ? 'text-emerald-700' : 'text-muted-foreground'}>
                  {ticketAtivo ? 'Registrada' : 'Aguardando'}
                </span>
              </div>
              <div className="mt-1 text-right text-3xl font-bold tabular-nums 2xl:text-4xl">
                {ticketAtivo ? formatKg(primeiraPesagem) : '—'}
              </div>
              {ticketAtivo && (
                <span className="block text-right text-[11px] text-muted-foreground">
                  Clique para refazer
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => selecionarEtapa(2)}
              disabled={saving || lendo || ticketFechado || !ticketAtivo}
              aria-pressed={etapaCaptura === 2}
              title="Selecionar segunda pesagem para capturar novamente"
              className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-70 ${
                etapaCaptura === 2
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-muted/20 hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold">2ª Pesagem</span>
                <span className={segundaPesagem > 0 ? 'text-emerald-700' : 'text-muted-foreground'}>
                  {segundaPesagem > 0 ? 'Registrada' : 'Aguardando'}
                </span>
              </div>
              <div className="mt-1 text-right text-3xl font-bold tabular-nums 2xl:text-4xl">
                {segundaPesagem > 0 ? formatKg(segundaPesagem) : '—'}
              </div>
              {segundaPesagem > 0 && (
                <span className="block text-right text-[11px] text-muted-foreground">
                  Clique para refazer
                </span>
              )}
            </button>

            <div className="rounded-lg border bg-muted/25 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Peso Líquido</span>
                <span className="text-3xl font-bold tabular-nums text-primary 2xl:text-4xl">
                  {segundaPesagem > 0 && ticketAtivo
                    ? formatKg(liquido)
                    : '—'}
                </span>
              </div>
            </div>

            <Button
              type="button"
              className="mt-auto h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={saving || lendo || ticketFechado || !tipoAtual || etapaCaptura === 0}
              onClick={() => capturarPeso()}
            >
              <Play className="mr-2 h-4 w-4" />
              {saving || lendo
                ? 'Aguarde...'
                : etapaCaptura === 0
                  ? 'Selecione a pesagem para refazer'
                  : `${podeDigitar && pesoAtual.trim() ? 'Registrar peso digitado' : 'Capturar'} ${etapaCaptura}ª Pesagem`}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              {podeDigitar
                ? 'Captura o peso da balança; se informar um peso manual, registra o valor digitado.'
                : 'Um clique registra o peso. Para corrigir, selecione a pesagem acima.'}
            </p>
          </div>
        </Card>

      </div>
      <Sheet open={pesquisaAberta} onOpenChange={setPesquisaAberta}>
        <SheetContent
          side="bottom"
          className="flex h-[78dvh] max-h-[calc(100dvh-6px)] w-full flex-col gap-0 overflow-hidden rounded-t-xl border-t border-slate-300 bg-background p-0 shadow-2xl"
        >
          <div className="shrink-0 border-b bg-slate-50 px-4 py-3 pr-14">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-primary" /> PESQUISA DE TICKETS
              </SheetTitle>
              <SheetDescription className="text-xs">
                Escolha um ticket com um clique: a Pesquisa fecha e o Resumo mostra os dados.
                Para retomar a pesagem, confirme no Resumo.
              </SheetDescription>
            </SheetHeader>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{abertosFiltrados.length}</span>
              tickets encontrados
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <select
                aria-label="Filtrar tickets por status"
                value={filtroStatus}
                onChange={(event) => setFiltroStatus(event.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-xs"
              >
                <option value="todos">Todos os status</option>
                <option value="aberto">Abertos</option>
                <option value="fechado">Fechados</option>
              </select>
              <div className="relative w-full sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={buscaAbertos}
                  onChange={(event) => setBuscaAbertos(event.target.value)}
                  placeholder="Ticket, motorista, placa, cliente, produto..."
                  aria-label="Pesquisar tickets"
                  className="h-9 pl-9"
                />
              </div>
            </div>
          </div>

            {abertosFiltrados.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
                Nenhum ticket encontrado.
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                <table className="w-full min-w-[1260px] border-collapse text-[12px] leading-tight [&_th]:border [&_th]:border-slate-300 [&_td]:border [&_td]:border-slate-200">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-800">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Ticket</th>
                      <th className="px-3 py-2.5 text-left">Tipo</th>
                      <th className="px-3 py-2.5 text-left">Motorista</th>
                      <th className="px-3 py-2.5 text-left">Placa</th>
                      <th className="px-3 py-2.5 text-left">Cliente / Fornecedor</th>
                      <th className="px-3 py-2.5 text-left">Produto</th>
                      <th className="px-3 py-2.5 text-right">1ª Pesagem</th>
                      <th className="px-3 py-2.5 text-right">2ª Pesagem</th>
                      <th className="px-3 py-2.5 text-right">Peso Líquido</th>
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

                      const selected = ticket.id === ticketPreviewId || ticket.id === ticketAtivo?.id;

                      return (
                        <tr
                          key={ticket.id}
                          onClick={() => selecionarTicket(ticket)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              selecionarTicket(ticket);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          title="Clique para consultar este ticket no Resumo"
                          className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                            selected ? 'bg-sky-100' : 'odd:bg-white even:bg-slate-50 hover:bg-sky-50'
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
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {ticket.peso_bruto && ticket.peso_tara
                              ? formatKg((Number(ticket.peso_tara) || 0) === primeira ? ticket.peso_bruto : ticket.peso_tara)
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                            {ticket.status === 'fechado' ? formatKg(ticket.peso_liquido || 0) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge className={ticket.status === 'fechado'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                              : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50'}>
                              {ticket.status === 'fechado' ? 'Fechado' : 'Aguardando 2ª pesagem'}
                            </Badge>
                          </td>
                          <td
                            className="px-3 py-2.5 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {primeira > 0 && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Imprimir ticket"
                                onClick={(event) => { event.stopPropagation(); imprimirTicket(ticket); }}>
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {ticket.status === 'aberto' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Excluir ticket aberto"
                                onClick={() => setExcluirTicket(ticket)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          <div className="shrink-0 border-t bg-slate-50 px-3 py-2 text-[11px] text-muted-foreground">
            Selecione uma linha para consultar. Cabeçalho fixo; role apenas dentro da tabela.
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmacaoPesagemAutomatica
        captura={autoPopup}
        segundos={autoPopupSegundos}
        salvando={autoCapturando || saving}
        onConfirmar={() => confirmarCapturaAutomatica()}
        onCancelar={cancelarPrimeiraConfirmacao}
        onPesarNovamente={pesarNovamenteAutomatico}
        onEncerrar={encerrarCapturaAutomatica}
      />

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
