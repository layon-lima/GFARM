// Ordena gavetas em ordem crescente pelo código (suporte a números: gaveta 2 antes de 10)
export function sortGavetas(list) {
  return [...list].sort((a, b) =>
    String(a.codigo || '').localeCompare(
      String(b.codigo || ''),
      undefined,
      { numeric: true, sensitivity: 'base' }
    )
  );
}