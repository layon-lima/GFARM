import { Cloud, Radio, WifiOff } from 'lucide-react';
import { useBalanca } from '@/lib/balancaContext';

function hora(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleString('pt-BR');
}

// Exibe o peso publicado pelo computador da Toledo. É apenas consulta:
// a leitura remota nunca entra na captura física do ticket.
export default function BalancaMonitorRemoto() {
  const {
    leituraRemota,
    formatarPeso,
    status,
    statusPublicacao,
    erroPublicacao,
  } = useBalanca();

  const aoVivo = leituraRemota?.online
    && leituraRemota?.peso_kg != null
    && Number.isFinite(Number(leituraRemota.peso_kg));
  const semLeitura = leituraRemota?.status === 'sem_leitura';
  const desconectada = leituraRemota?.status === 'desconectada';

  const tituloStatus = aoVivo
    ? 'Ao vivo'
    : desconectada
      ? 'Serial desconectada'
      : semLeitura
        ? 'Sem peso válido'
        : 'Sem sinal';

  return (
    <section className="rounded-xl border bg-card p-4 shadow-none space-y-3" aria-label="Monitoramento remoto da balança">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Cloud className="h-4 w-4 text-primary" />
            MONITORAMENTO REMOTO — TOLEDO
          </h3>
          <p className="text-xs text-muted-foreground">
            Leitura recebida pela VPS. Disponível em qualquer PC autorizado do GFARM.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
          aoVivo
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-border bg-muted/30 text-muted-foreground'
        }`}>
          {aoVivo ? <Radio className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {tituloStatus}
        </span>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/20 px-3 py-5">
        {aoVivo ? (
          <>
            <span className="text-4xl font-bold tabular-nums text-primary sm:text-5xl">
              {formatarPeso(Number(leituraRemota.peso_kg))}
            </span>
            <span className="mt-1 text-xs font-semibold text-muted-foreground">kg</span>
          </>
        ) : (
          <>
            <span className="text-3xl font-bold text-muted-foreground">—</span>
            <span className="mt-1 text-xs text-muted-foreground">
              {desconectada
                ? 'O computador está online, mas a porta serial da Toledo está desconectada.'
                : semLeitura
                  ? 'PC da balança conectado, mas sem leitura recente válida.'
                  : 'Aguardando transmissão do computador conectado à Toledo.'}
            </span>
          </>
        )}
      </div>

      <div className="flex flex-wrap justify-between gap-1.5 text-xs text-muted-foreground">
        <span>Último sinal: {hora(leituraRemota?.atualizado_em)}</span>
        <span>Atualização automática · somente visualização</span>
      </div>

      {status === 'conectado' && (
        <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <strong>Transmissão deste PC: </strong>
          {statusPublicacao === 'transmitindo'
            ? 'enviando peso à VPS'
            : statusPublicacao === 'sem_leitura'
              ? 'conectado, aguardando peso válido'
              : statusPublicacao === 'outra_estacao'
                ? 'bloqueada: outro computador já está transmitindo'
                : statusPublicacao === 'erro'
                  ? 'falha ao enviar'
                  : 'aguardando publicação'}
          {erroPublicacao && <span className="mt-1 block text-destructive">{erroPublicacao}</span>}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Segurança: ver o peso remotamente não permite capturar, confirmar ou fechar
        tickets por meio dessa leitura. O PC da balança precisa permanecer ligado e com o GFARM aberto.
      </p>
    </section>
  );
}
