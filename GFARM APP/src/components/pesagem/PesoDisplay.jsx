import { Label } from '@/components/ui/label';
import LerPesoButton from '@/components/balanca/LerPesoButton';

export default function PesoDisplay({ label, value, onChange, onPesoLido, podeDigitar, placeholder = '0,00', autoFocus }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{label}</Label>
      <div className="flex gap-2 items-stretch">
        <div className="relative flex-1 rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            readOnly={!podeDigitar}
            autoFocus={autoFocus}
            className="w-full h-16 bg-transparent text-center text-3xl font-bold text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground pointer-events-none select-none">kg</span>
        </div>
        <LerPesoButton onPesoLido={onPesoLido} className="h-16 px-6 text-base" />
      </div>
      {!podeDigitar && <p className="text-xs text-muted-foreground">Peso preenchido pela balança. Digitação manual liberada apenas para usuários autorizados.</p>}
    </div>
  );
}