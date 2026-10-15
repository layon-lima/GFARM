import { FileCheck2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Badge visual indicando se o ticket possui NF-e vinculada.
// Mostra apenas o flag — os detalhes da NF ficam no dialog de detalhe do ticket.
export default function NfeBadge({ ticket, size = 'sm' }) {
  if (!ticket?.nfe_importada) return null;

  const sizeClass = size === 'xs'
    ? 'text-[9px] py-0 px-1 gap-0.5'
    : 'text-[10px] gap-1';

  return (
    <Badge className={`bg-emerald-100 text-emerald-700 border-emerald-300 ${sizeClass}`} title="Nota fiscal vinculada">
      <FileCheck2 className={size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      NF
    </Badge>
  );
}