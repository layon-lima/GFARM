import { useCallback } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

// Estado persistido por tabela: `order` é a lista de chaves VISÍVEIS na ordem
// de exibição. Colunas ocultas ficam de fora de `order`. Arrastar reordena
// `order`; o toggle adiciona/remov a chave de `order`.
export function useColumnConfig(storageKey, defaultOrder) {
  const [order, setOrder] = usePersistentState(storageKey, defaultOrder);

  const toggle = useCallback((key) => {
    setOrder((prev) => {
      const p = Array.isArray(prev) ? prev : defaultOrder;
      return p.includes(key) ? p.filter((k) => k !== key) : [...p, key];
    });
  }, [defaultOrder, setOrder]);

  const reorder = useCallback((from, to) => {
    setOrder((prev) => {
      const p = [...(Array.isArray(prev) ? prev : defaultOrder)];
      if (from < 0 || from >= p.length || to < 0 || to >= p.length) return p;
      const [moved] = p.splice(from, 1);
      p.splice(to, 0, moved);
      return p;
    });
  }, [defaultOrder, setOrder]);

  return { order: Array.isArray(order) ? order : defaultOrder, toggle, reorder };
}
