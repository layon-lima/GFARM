import { useState, useEffect } from 'react';
import { readUiState, writeUiState } from '@/lib/uiStateStore';

// Estado que sobrevive à desmontagem/remontagem da rota durante a sessão.
// Usado para preservar scroll, seleção e fluxos em andamento no mobile.
export function usePersistentState(key, initial) {
  const [state, setState] = useState(() => {
    const saved = readUiState(key);
    return saved !== undefined ? saved : (typeof initial === 'function' ? initial() : initial);
  });

  useEffect(() => {
    writeUiState(key, state);
  }, [key, state]);

  return [state, setState];
}