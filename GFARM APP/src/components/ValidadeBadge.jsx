import { Badge } from '@/components/ui/badge';
import { statusValidade } from '@/lib/lotes';

const styles = {
  vencido: 'bg-red-100 text-red-700 border-red-200',
  '30': 'bg-orange-100 text-orange-700 border-orange-200',
  '60': 'bg-amber-100 text-amber-800 border-amber-200',
  '90': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  ok: 'bg-green-100 text-green-700 border-green-200',
  sem_validade: 'bg-muted text-muted-foreground border-border',
};

export default function ValidadeBadge({ dataValidade, now }) {
  if (!dataValidade) return <span className="text-xs text-muted-foreground">—</span>;
  const st = statusValidade({ data_validade: dataValidade }, now);
  return <Badge variant="outline" className={styles[st.key] || styles.sem_validade}>{st.label}</Badge>;
}