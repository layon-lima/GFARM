import { useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { pushBackEntry } from '@/lib/backHandler';

// Faz o botão/gesto de voltar do sistema (Android) chamar `onBack` enquanto
// `isActive` for verdadeiro, em vez de navegar/sair da rota. Mobile apenas.
//
// Use um hook por "camada" que deve ser recolhida. Instâncias ativas simultâneas
// são empilhadas em LIFO (ordem dos hooks no componente = prioridade).
export function useBackHandler(isActive, onBack) {
  const isMobile = useIsMobile();
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isMobile || !isActive) return;
    return pushBackEntry(() => onBackRef.current?.());
  }, [isActive, isMobile]);
}