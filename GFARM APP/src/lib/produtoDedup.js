// Anti-duplicidade de produtos pelo código interno (único globalmente).

const norm = (v) => String(v ?? '').trim();
const normDate = (d) => String(d ?? '').slice(0, 10);

// Busca produto existente com mesmo código interno.
// excludeId ignora o próprio registro em edições.
export function findProdutoDuplicado({ produtos, dados, excludeId = null }) {
  const codigo = norm(dados.codigo);
  if (!codigo) return null;
  return (
    produtos.find(
      (p) => p.id !== excludeId && norm(p.codigo) === codigo
    ) || null
  );
}

// Busca lote existente vinculado a um produto com mesmo código de lote + validade.
export function findLoteDuplicado({ lotes, produtoId, loteInfo }) {
  if (!loteInfo || !norm(loteInfo.codigo_lote) || !normDate(loteInfo.data_validade)) return null;
  return (
    lotes.find(
      (l) =>
        l.produto_id === produtoId &&
        norm(l.codigo_lote) === norm(loteInfo.codigo_lote) &&
        normDate(l.data_validade) === normDate(loteInfo.data_validade)
    ) || null
  );
}