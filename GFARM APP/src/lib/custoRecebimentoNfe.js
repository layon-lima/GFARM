import { normalizarUnidade } from './units.js';

/**
 * Custo fiscal de um recebimento, apresentado na unidade-base do produto.
 * O valor vem da NF-e; o motor do GFARM recalcula com Decimal no servidor
 * durante a aprovação. O valor deste helper é apenas para apresentação.
 */
export function fatorParaUnidadeBase(dados, produto, fatorManual = '') {
  const informado = String(fatorManual ?? '').trim().replace(',', '.');
  if (informado) {
    const fator = Number(informado);
    return Number.isFinite(fator) && fator > 0 ? fator : null;
  }
  if (!produto) return 1;
  const original = String(dados?.unidade || '').trim().toUpperCase();
  const base = String(produto.unidade || '').trim().toUpperCase();
  if (!original || !base) return null;
  const unidadeFiscal = normalizarUnidade(original);
  const unidadeBase = normalizarUnidade(base);
  // TN, T, TON e TO representam a MESMA tonelada, sem fator extra.
  if (original === base || (unidadeFiscal && unidadeFiscal === unidadeBase)) return 1;
  const alternativo = String(produto.unidade_alt || '').trim().toUpperCase();
  if (original === alternativo || (
    unidadeFiscal && alternativo && unidadeFiscal === normalizarUnidade(alternativo)
  )) {
    const fator = Number(produto.fator_conversao);
    return Number.isFinite(fator) && fator > 0 ? fator : null;
  }
  return null;
}

export function precoFiscalNaUnidadeBase(dados, produto = null, fatorManual = '') {
  const fator = fatorParaUnidadeBase(dados, produto, fatorManual);
  if (!(fator > 0)) return null;
  let preco;
  if (dados?.valor_total !== null && dados?.valor_total !== undefined && dados?.valor_total !== '') {
    const quantidadeFiscal = Number(dados.quantidade);
    const valorTotal = Number(dados.valor_total);
    if (!(quantidadeFiscal > 0) || !Number.isFinite(valorTotal) || valorTotal < 0) return null;
    preco = valorTotal / quantidadeFiscal;
  } else if (dados?.valor_unitario !== null && dados?.valor_unitario !== undefined && dados?.valor_unitario !== '') {
    preco = Number(dados.valor_unitario);
  } else {
    return null;
  }
  if (!Number.isFinite(preco) || preco < 0) return null;
  return preco / fator;
}

/** Exibe o preço sem arredondar a centavos: custos em kg podem ter 6+ casas. */
export function precoFiscalParaInput(valor) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '';
  return Number(valor.toPrecision(14)).toString();
}
