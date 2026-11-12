/** Aplica retorno confirmado pela API em cada card, sem alterar outras notas. */
export function aplicarItensFiscaisXml(itens, atualizados) {
  if (!Array.isArray(itens) || !Array.isArray(atualizados)) return itens;
  const porOrigem = new Map(
    atualizados
      .filter(reg => reg?.origem_id && reg?.dados && typeof reg.dados === 'object')
      .map(reg => [reg.origem_id, reg.dados])
  );
  if (!porOrigem.size) return itens;
  return itens.map(item => porOrigem.has(item.origem_id)
    ? { ...item, dados: porOrigem.get(item.origem_id) }
    : item);
}
