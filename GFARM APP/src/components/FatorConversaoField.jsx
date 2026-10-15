import { Input } from '@/components/ui/input';
import { parseQtd } from '@/lib/format';

// Campo para informar o fator de conversão customizado por produto.
// Exibe "1 {uCom} = [input] {paraUnidade}" — o usuário diz quantos da
// unidade-base (paraUnidade) equivalem a 1 unidade da NF-e (uCom).
export default function FatorConversaoField({ uCom, paraUnidade, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">1 {uCom} =</span>
      <Input
        type="text"
        inputMode="decimal"
        className="h-7 w-16 tabular-nums text-xs"
        value={value ? String(value).replace('.', ',') : ''}
        onChange={(e) => onChange(parseQtd(e.target.value))}
        placeholder="0,00"
      />
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{paraUnidade}</span>
    </div>
  );
}