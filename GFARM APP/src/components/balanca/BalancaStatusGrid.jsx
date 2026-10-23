import { CheckCircle2, XCircle, Loader2, Usb, Scale } from 'lucide-react';
import { useBalanca } from '@/lib/balancaContext';

function formatTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

function portaLabel(info) {
  if (!info) return '—';
  if (info.usbVendorId) {
    const vid = info.usbVendorId.toString(16).padStart(4, '0');
    const pid = (info.usbProductId || 0).toString(16).padStart(4, '0');
    return `USB ${vid}:${pid}`;
  }
  return 'Porta serial';
}

export default function BalancaStatusGrid() {
  const { suportado, status, portaInfo, baudRate, dataBits, stopBits, parity, ultimaLeitura, erro, lendo, formatarPeso, diagnostico, ultimoDadoEm, rawData } = useBalanca();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* Compatibilidade do navegador */}
      <div className="glass-tinted rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Navegador</span>
          {suportado ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-destructive" />}
        </div>
        <p className="text-sm font-medium">
          {suportado ? 'Web Serial suportado' : 'Não suportado'}
        </p>
        {!suportado && (
          <p className="text-xs text-muted-foreground">Use o Microsoft Edge ou Google Chrome.</p>
        )}
      </div>

      {/* Status da conexão */}
      <div className="glass-tinted rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Conexão</span>
          {status === 'conectado' ? (
            <Usb className="w-5 h-5 text-green-600" />
          ) : (status === 'conectando' || status === 'reconectando') ? (
            <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
          ) : (
            <XCircle className="w-5 h-5 text-destructive" />
          )}
        </div>
        <p className="text-sm font-medium">
          {status === 'nao_suportado'
            ? 'Não suportado'
            : status === 'conectado'
            ? 'Conectada'
            : status === 'conectando'
            ? 'Conectando...'
            : status === 'reconectando'
            ? 'Reconectando automaticamente...'
            : status === 'erro'
            ? 'Erro'
            : 'Desconectada'}
        </p>
        <p className="text-xs text-muted-foreground">{portaLabel(portaInfo)} · {baudRate} baud · {dataBits}{parity !== 'none' ? parity[0].toUpperCase() : 'N'}{stopBits}</p>
        {diagnostico && <p className="text-xs text-muted-foreground mt-1">{diagnostico}</p>}
        {erro && <p className="text-xs text-destructive mt-1">{erro}</p>}
        <p className="text-xs text-muted-foreground">Últimos dados da serial: {ultimoDadoEm ? formatTimestamp(ultimoDadoEm) : 'Nenhum dado recebido'}</p>
        {rawData && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Diagnóstico técnico (HEX)</summary>
            <code className="mt-1 block max-h-24 overflow-auto break-all rounded border bg-muted/30 p-2 text-[10px]">{rawData}</code>
          </details>
        )}
      </div>

      {/* Última leitura */}
      <div className="glass-tinted rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Última Leitura</span>
          <Scale className={`w-5 h-5 ${ultimaLeitura ? 'text-primary' : 'text-muted-foreground'} ${lendo ? 'animate-pulse' : ''}`} />
        </div>
        {ultimaLeitura ? (
          <>
            <p className="text-2xl font-bold text-primary tabular-nums">
              {formatarPeso(ultimaLeitura.peso)} <span className="text-sm font-medium">kg</span>
            </p>
            <p className="text-xs text-muted-foreground">{formatTimestamp(ultimaLeitura.timestamp)}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma leitura</p>
        )}
      </div>
    </div>
  );
}