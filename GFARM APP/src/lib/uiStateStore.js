// Armazena estado de UI por rota durante a sessão (evita reset ao navegar entre abas no mobile).
const store = new Map();

export function readUiState(key) {
  return store.get(key);
}

export function writeUiState(key, value) {
  store.set(key, value);
}