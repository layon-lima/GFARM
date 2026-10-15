// Utilitários do módulo de Máquinas.

// Gera o próximo código sequencial global de máquina (MAQ-000001) com base na lista existente.
export function nextMaquinaCodigo(maquinas = []) {
  let max = 0;
  maquinas.forEach((m) => {
    const match = String(m.codigo || '').match(/MAQ-(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  });
  return `MAQ-${String(max + 1).padStart(6, '0')}`;
}