// Gera o próximo código interno sequencial (ex.: P0001, P0002) com base
// no maior sufixo numérico encontrado entre os produtos existentes.
export function proximoCodigoInterno(produtosList) {
  let max = 0;
  for (const p of produtosList) {
    const m = String(p.codigo || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `P${String(max + 1).padStart(4, '0')}`;
}