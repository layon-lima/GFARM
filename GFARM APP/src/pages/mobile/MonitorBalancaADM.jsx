import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, ShieldCheck, Wifi, WifiOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { podeMonitorarBalancaADM } from '@/lib/permissions';
import { Button } from '@/components/ui/button';

const INITIAL = { status: 'sem_sinal', fonte_atual: false, online: false,
  peso_kg: null, estado_automacao: {}, eventos_automacao: [], ultima_captura: null };
const NOME = {
  tela_fechada: 'Tickets não está aberta no PC',
  manual: 'Captura automática desligada',
  registrando: 'PC gravando o peso',
  popup_aberto: 'Popup de confirmação aberto',
  peso_cancelado: 'Peso cancelado',
  pausa_retentativa: 'Aguardando nova tentativa',
  sem_serial: 'Serial desconectada',
  sem_leitura: 'Sem leitura válida',
  cadastro_incompleto: 'Cadastro do ticket incompleto',
  aguardando_ticket: 'Aguardando próximo ticket',
  recaptura_manual: 'Modo de recaptura manual selecionado',
  aguardando_zera: 'Aguardando esvaziar a balança',
  aba_oculta: 'Aba do GFARM em segundo plano',
  ocupada: 'Operação em andamento',
  abaixo_minimo: 'Peso abaixo de 40 kg',
  peso_igual: '2ª pesagem igual à 1ª',
  oscilando: 'Peso oscilando',
  estabilizando: 'Buscando estabilidade',
  aguardando_peso: 'Aguardando peso',
};
const pesoFmt = (v) => v == null || !Number.isFinite(Number(v))
  ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const horario = (v) => v && !Number.isNaN(Date.parse(v))
  ? new Date(v).toLocaleString('pt-BR') : '—';

export default function MonitorBalancaADM() {
  const { user } = useAuth();
  const permitido = podeMonitorarBalancaADM(user);
  const [dados, setDados] = useState(INITIAL);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const consultar = useCallback(async () => {
    try {
      const resp = await api.balanca.consultarMonitorADM();
      setDados(resp);
      setErro('');
    } catch (e) {
      setDados((antigo) => ({ ...antigo, fonte_atual: false, online: false, peso_kg: null }));
      setErro(e?.status === 403 ? 'Acesso exclusivo da conta ADM.' : 'Falha de comunicação com a VPS.');
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    if (!permitido) return undefined;
    let ativo = true, ocupado = false;
    const atualizar = async () => {
      if (!ativo || ocupado || document.visibilityState === 'hidden') return;
      ocupado = true;
      try { await consultar(); } finally { ocupado = false; }
    };
    atualizar();
    const timer = setInterval(atualizar, 1200);
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('online', atualizar);
    return () => {
      ativo = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', atualizar);
      window.removeEventListener('online', atualizar);
    };
  }, [permitido, consultar]);
  if (!permitido) return <Navigate to="/" replace />;

  const online = Boolean(dados.fonte_atual);
  const leitura = online && dados.online && dados.peso_kg != null;
  const estado = dados.estado_automacao || {};
  const eventos = Array.isArray(dados.eventos_automacao) ? dados.eventos_automacao : [];
  const captura = dados.ultima_captura;
  const titulo = !online ? 'PC sem sinal'
    : !estado.tela_ativa ? 'Aba Tickets fechada'
      : NOME[estado.estado] || 'Aguardando diagnóstico';
  const statusPeso = leitura ? 'PESO AO VIVO'
    : !online ? 'SEM SINAL'
      : dados.status === 'desconectada' ? 'SERIAL DESCONECTADA' : 'SEM LEITURA VÁLIDA';

  return (
    <div className="mobile-page mx-auto max-w-xl space-y-3 px-3 py-3 pb-8">
      <header className="flex items-center gap-3">
        <Link to="/mais" className="rounded-lg border p-2" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-muted-foreground">EXCLUSIVO ADM · SOMENTE CONSULTA</p>
          <h1 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5" /> MONITOR DA BALANÇA</h1>
        </div>
        <Button type="button" size="icon" variant="outline" onClick={consultar} aria-label="Atualizar">
          <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
        </Button>
      </header>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2 text-xs font-bold">
          <span>PESO ATUAL DA TOLEDO</span>
          <span className={leitura ? 'text-emerald-700' : 'text-red-700'}>
            {leitura ? <Wifi className="mr-1 inline h-4 w-4" /> : <WifiOff className="mr-1 inline h-4 w-4" />}
            {statusPeso}
          </span>
        </div>
        <div className="rounded-xl bg-muted/30 px-3 py-6 text-center">
          <p className="text-5xl font-bold tabular-nums text-primary">
            {leitura ? pesoFmt(dados.peso_kg) : '—'}
            {leitura && <span className="ml-1 text-base">kg</span>}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {!online ? 'Nenhum sinal recente do PC conectado à Toledo.'
            : !leitura ? (dados.status === 'desconectada'
      ? 'PC está online, mas a serial Toledo está desconectada.'
      : 'O PC está transmitindo, mas sem peso serial válido.') : 'Leitura recebida da VPS.'}
          {' '}Último envio: {horario(dados.atualizado_em)}.
        </p>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">PROCESSO NO PC</h2>
          <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">
            {online && estado.tela_ativa ? estado.auto_ativa ? 'Auto ligada' : 'Auto desligada' : 'Sem diagnóstico'}
          </span>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="font-semibold">{titulo}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {!online ? 'Sem envio da VPS não é possível verificar a captura.'
              : estado.detalhe || 'Abra Pesagem > Tickets no PC da balança.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border p-2">Etapa: <strong>{online && estado.tela_ativa && estado.etapa ? `${estado.etapa}ª` : '—'}</strong></div>
          <div className="rounded-lg border p-2">Contagem: <strong>{online && estado.tela_ativa && estado.segundos != null ? `${estado.segundos} s` : '—'}</strong></div>
          <div className="rounded-lg border p-2">Detectado: <strong>{online && estado.tela_ativa ? pesoFmt(estado.peso_candidato) : '—'} kg</strong></div>
          <div className="rounded-lg border p-2">Ticket: <strong>{online && estado.tela_ativa ? estado.ticket || '—' : '—'}</strong></div>
        </div>
        <p className="text-[11px] text-muted-foreground">Estabilidade: 2 segundos · Popup: 10 segundos · Peso mínimo: 40 kg</p>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">ÚLTIMO PESO CAPTURADO NO PC</h2>
        {captura ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <CheckCircle2 className="h-4 w-4" />
              {captura.tipo === 'segunda_capturada' ? '2ª capturada no PC'
                : captura.tipo === 'ticket_fechado' ? 'Ticket fechado no servidor'
                  : '1ª gravada no servidor'}
            </p>
            <p className="my-2 text-3xl font-bold text-emerald-900">{pesoFmt(captura.peso_kg)} kg</p>
            <p className="text-xs text-emerald-800">{horario(captura.horario)} · Ticket {captura.ticket || '—'}</p>
            {captura.tipo === 'segunda_capturada' && (
              <p className="mt-2 text-xs font-semibold text-amber-800">A 2ª ainda depende do fechamento do ticket para salvar no servidor.</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma captura confirmada foi transmitida até agora.</p>
        )}
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">EVENTOS DO COMPUTADOR</h2>
        {eventos.length ? eventos.map((e, i) => (
          <div key={e.id || i} className="border-b py-2 last:border-0">
            <p className="text-xs font-medium">{e.descricao}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{horario(e.horario)} · {e.peso_kg == null ? '—' : `${pesoFmt(e.peso_kg)} kg`}</p>
          </div>
        )) : (
          <p className="text-xs text-muted-foreground">Sem eventos. Confira se a aba Tickets está aberta no PC.</p>
        )}
      </section>
      {erro && <p className="flex items-center gap-2 text-xs font-semibold text-destructive"><AlertTriangle className="h-4 w-4" />{erro}</p>}
      <p className="text-center text-[11px] text-muted-foreground">Monitor restrito ao ADM. Não permite registrar ou alterar pesagens.</p>
    </div>
  );
}
