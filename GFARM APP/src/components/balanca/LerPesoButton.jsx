import { Scale, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBalanca } from '@/lib/balancaContext';
import { useToast } from '@/components/ui/use-toast';

export default function LerPesoButton({ onPesoLido, className }) {
  const { suportado, status, lendo, lerPeso, formatarPeso, conectarComAutoDeteccao, reconectar, erro } = useBalanca();
  const { toast } = useToast();

  async function handleClick() {
    if (!suportado) {
      toast({
        variant: 'destructive',
        title: 'Navegador não suportado',
        description: 'Use o Microsoft Edge ou Google Chrome no desktop para ler o peso da balança.',
      });
      return;
    }

    // Se a balança não está conectada, tenta reconectar com porta já autorizada;
    // se não houver, pede seleção da porta ao usuário
    if (status !== 'conectado') {
      let ok = await reconectar();
      if (!ok) {
        toast({
          title: 'Conectando balança...',
          description: 'Selecione a porta USB da balança na janela que abriu.',
        });
        ok = await conectarComAutoDeteccao();
      }
      if (!ok) {
        toast({
          variant: 'destructive',
          title: 'Não foi possível conectar',
          description: erro || 'Verifique se o driver USB do conversor serial está instalado neste PC e se o cabo está firme.',
        });
        return;
      }
    }

    const peso = await lerPeso();
    if (peso !== null && peso !== undefined) {
      const formatado = formatarPeso(peso);
      onPesoLido?.(formatado);
      toast({ title: 'Peso lido da balança', description: `${formatado} kg` });
    } else {
      toast({
        variant: 'destructive',
        title: 'Falha na leitura',
        description: erro || 'A balança não enviou dados reconhecíveis. Verifique se está ligada e com o protocolo Cougar p03 ativo.',
      });
    }
  }

  return (
    <Button
      type="button"
      variant="default"
      size="lg"
      onClick={handleClick}
      disabled={lendo}
      className={`shrink-0 gap-2 ${className || ''}`}
    >
      {lendo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Scale className="w-5 h-5" />}
      {lendo ? 'Lendo...' : 'Ler Peso'}
    </Button>
  );
}