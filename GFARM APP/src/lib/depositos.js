// Utilitários do módulo de Depósitos.

// Gera o próximo número sequencial global de depósito (DEP-000001) com base na lista existente.
export function nextDepositoNumber(depositos = []) {
  let max = 0;
  depositos.forEach((d) => {
    const m = String(d.numero || '').match(/DEP-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return `DEP-${String(max + 1).padStart(6, '0')}`;
}

// Rótulo amigável de um depósito: "DEP-000001 · Nome" (ou só número).
export function depositoLabel(d) {
  if (!d) return '—';
  return d.nome ? `${d.numero} · ${d.nome}` : d.numero || '—';
}