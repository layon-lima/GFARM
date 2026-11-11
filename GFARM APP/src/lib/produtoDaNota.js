import { proximoCodigoInterno } from './produtoCodigo.js';
import { convertQty, normalizarUnidade } from './units.js';

/**
 * Dados do cadastro mestre, usando exclusivamente informações confirmadas.
 * A quantidade, o preço, o lote e a validade permanecem na nota pendente;
 * o motor de estoque só os aplica depois da aprovação.
 */
export function montarProdutoDaNota(dados, form, produtos, depositos, gavetas) {
  const nome = String(form.nome || '').trim();
  const unidade = String(form.unidade || '').trim();
  const setor = String(form.setor_id || '').trim();
  const referencia = String(form.codigo_referencia || '').trim();
  if (!nome || !unidade || !setor) {
    throw new Error('Informe nome, unidade e setor do produto.');
  }
  if (nome.length > 255 || referencia.length > 255) {
    throw new Error('Nome ou código de referência muito longo.');
  }

  const deposito = String(form.deposito_id || '');
  const gaveta = String(form.gaveta_id || '');
  if (deposito && !depositos.some(d => d.id === deposito && d.setor_id === setor)) {
    throw new Error('Depósito não pertence ao setor escolhido.');
  }
  if (gaveta && !gavetas.some(g => g.id === gaveta && g.deposito_id === deposito)) {
    throw new Error('Gaveta não pertence ao depósito escolhido.');
  }

  // O motor do GFARM exige igualdade literal da unidade-base OU
  // unidade_alt + fator. Mesmo os sinônimos LT / L, T / ton precisam ficar
  // configurados, senão a aprovação falha.
  const unidadeNfe = String(dados.unidade || '').trim();
  const unidadeIgual = unidadeNfe.toUpperCase() === unidade.toUpperCase();
  const unidadeCanonica = normalizarUnidade(unidadeNfe);
  const fatorAutomatico = unidadeCanonica ? convertQty(1, unidadeCanonica, unidade) : null;
  const fatorInformado = Number(String(form.fator_conversao || '').replace(',', '.'));
  const fator = unidadeIgual ? 0 :
    (fatorAutomatico !== null && Number.isFinite(fatorAutomatico) && fatorAutomatico > 0)
      ? fatorAutomatico : fatorInformado;
  if (!unidadeIgual && !(Number.isFinite(fator) && fator > 0)) {
    throw new Error(`Informe quantas unidades ${unidade} equivalem a 1 ${unidadeNfe}.`);
  }

  return {
    codigo: proximoCodigoInterno(produtos),
    nome,
    codigo_referencia: referencia || null,
    setor_id: setor,
    deposito_id: deposito || null,
    gaveta_id: gaveta || null,
    unidade,
    unidade_alt: unidadeIgual ? null : unidadeNfe,
    fator_conversao: unidadeIgual ? 0 : fator,
    estoque_minimo: 0,
    custo_unitario: 0,
    venda: false,
    // NÃO incluir quantidade: somente aprovação pelo motor de estoque.
  };
}
