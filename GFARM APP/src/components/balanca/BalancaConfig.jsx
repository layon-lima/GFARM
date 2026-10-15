import { Settings, Info } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import { useBalanca } from '@/lib/balancaContext';

const BAUD_OPTIONS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const DATABITS_OPTIONS = [7, 8];
const STOPBITS_OPTIONS = [1, 2];
const PARITY_OPTIONS = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'even', label: 'Par (Even)' },
  { value: 'odd', label: 'Ímpar (Odd)' },
];
const CASAS_OPTIONS = [0, 1, 2, 3];

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50';

export default function BalancaConfig() {
  const {
    status, baudRate, dataBits, stopBits, parity, casasDecimais,
    trocarBaudRate, trocarDataBits, trocarStopBits, trocarParity, trocarCasasDecimais,
    desconectar,
  } = useBalanca();

  const conectado = status === 'conectado';

  async function trocar(trocarFn, valor, atual) {
    if (valor === atual) return;
    if (conectado) await desconectar();
    trocarFn(valor);
  }

  return (
    <div className="glass-tinted rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Configuração Serial</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Ajuste os parâmetros da porta serial caso a balança não responda. Alterações exigem reconexão.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Baud rate</label>
          <SearchSelect
            value={String(baudRate)}
            onChange={(v) => trocar(trocarBaudRate, parseInt(v, 10), baudRate)}
            placeholder="Baud rate"
            options={BAUD_OPTIONS.map((b) => ({ value: String(b), label: String(b) }))}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Data bits</label>
          <SearchSelect
            value={String(dataBits)}
            onChange={(v) => trocar(trocarDataBits, parseInt(v, 10), dataBits)}
            placeholder="Data bits"
            options={DATABITS_OPTIONS.map((d) => ({ value: String(d), label: String(d) }))}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Stop bits</label>
          <SearchSelect
            value={String(stopBits)}
            onChange={(v) => trocar(trocarStopBits, parseInt(v, 10), stopBits)}
            placeholder="Stop bits"
            options={STOPBITS_OPTIONS.map((s) => ({ value: String(s), label: String(s) }))}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Paridade</label>
          <SearchSelect
            value={parity}
            onChange={(v) => trocar(trocarParity, v, parity)}
            placeholder="Paridade"
            options={PARITY_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Máx. decimais</label>
          <SearchSelect
            value={String(casasDecimais)}
            onChange={(v) => trocar(trocarCasasDecimais, parseInt(v, 10), casasDecimais)}
            placeholder="Máx. decimais"
            options={CASAS_OPTIONS.map((c) => ({ value: String(c), label: String(c) }))}
          />
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border rounded-md p-3">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div>
          <p><strong>Configuração típica Toledo Prix:</strong> 4800 baud, 8 data bits, 1 stop bit, paridade Nenhuma, CKS habilitado.</p>
          <p className="mt-1"><strong>Máx. decimais:</strong> define o ponto decimal do peso lido da balança. Se o visor mostra "436,3", ajuste para 1. Se mostra "43.630" (inteiro), ajuste para 0.</p>
        </div>
      </div>
    </div>
  );
}