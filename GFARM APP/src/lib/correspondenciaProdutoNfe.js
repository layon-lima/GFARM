import { normalizarUnidade, convertQty } from './units.js';

/**
 * Identificação de produto comercial em uma NF-e.
 * A associação automática só é permitida quando a correspondência é ÚNICA,
 * o nome é exato e a unidade é compatível com o cadastro GFARM.
 * Sem vínculos silenciosos por similaridade aproximada.
 */
export function normalizarNomeProduto(texto) {
  return String(texto ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function chaveTexto(texto) {
  return normalizarNomeProduto(texto).replace(/\s/g, '');
}

export function unidadeCompatível(dados, produto) {
  const nota = String(dados?.unidade || '').trim();
  const base = String(produto?.unidade || '').trim();
  if (!nota || !base) return false;
  if (nota.toUpperCase() === base.toUpperCase()) return true;
  const alternativo = String(produto?.unidade_alt || '').trim();
  if (alternativo && alternativo.toUpperCase() === nota.toUpperCase()
      && Number(produto.fator_conversao) > 0) return true;
  const uNota = normalizarUnidade(nota);
  const uBase = normalizarUnidade(base) || base;
  if (!uNota) return false;
  const convertido = convertQty(1, uNota, uBase);
  // O motor GFARM somente faz essa conversão se houver unidade_alt;
  // igualdade canônica é segura se o código da nota for outro sinônimo.
  return convertido !== null && Number.isFinite(convertido) &&
    (nota.toUpperCase() === base.toUpperCase() || !!alternativo);
}

function scoreTermos(alvo, candidato) {
  if (!alvo || !candidato) return 0;
  if (alvo === candidato) return 100;
  if (candidato.startsWith(alvo + ' ') || alvo.startsWith(candidato + ' ')) return 78;
  if (alvo.length >= 2 && candidato.startsWith(alvo)) return 76;
  if (alvo.length >= 2 && candidato.includes(alvo)) return 58;
  const termosAlvo = alvo.split(' ').filter(t => t.length >= 3);
  const termosCandidato = new Set(candidato.split(' '));
  const intersecao = termosAlvo.filter(t => termosCandidato.has(t)).length;
  if (intersecao && intersecao === termosAlvo.length) return 62;
  if (termosAlvo.length && intersecao / termosAlvo.length >= .6) return 40;
  return 0;
}

function pontuar(produto, dados, consulta) {
  const nome = normalizarNomeProduto(produto.nome);
  const codigo = chaveTexto(produto.codigo);
  const referencia = chaveTexto(produto.codigo_referencia);
  const consultaNormal = normalizarNomeProduto(consulta);
  const nomeNota = normalizarNomeProduto(dados.produto);
  const codigoNota = chaveTexto(dados.codigo_produto);
  if (!nome) return 0;

  let score = scoreTermos(consultaNormal || nomeNota, nome);
  if (!consultaNormal && nome === nomeNota) score = 100;
  if (!consultaNormal && codigoNota && codigoNota === referencia) score = Math.max(score, 90);
  if (consultaNormal) {
    const digits = chaveTexto(consultaNormal);
    if (digits && digits === codigo) score = Math.max(score, 90);
    if (digits && digits === referencia) score = Math.max(score, 90);
    if (digits.length > 2 &&
        (codigo.includes(digits) || referencia.includes(digits))) score = Math.max(score, 58);
  }
  if (score > 0 && unidadeCompatível(dados, produto)) score += 5;
  return score;
}

/** Retorna opções completas para UI, em ordem de relevância, sem limite artificial antes do ranking. */
export function sugerirProdutosDaNota(dados, produtos, consulta = '', limite = 10) {
  return (Array.isArray(produtos) ? produtos : [])
    .map(produto => ({ produto, score: pontuar(produto, dados, consulta) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score ||
      String(a.produto.nome).localeCompare(String(b.produto.nome), 'pt-BR'))
    .slice(0, limite);
}

/** Somente um nome comercial exato e unidade compatível podem preencher automaticamente. */
export function encontrarProdutoExatoDaNota(dados, produtos) {
  const nome = normalizarNomeProduto(dados?.produto);
  if (!nome) return null;
  const encontrados = (Array.isArray(produtos) ? produtos : [])
    .filter(produto => normalizarNomeProduto(produto.nome) === nome);
  if (encontrados.length !== 1) return null;
  return unidadeCompatível(dados, encontrados[0]) ? encontrados[0] : null;
}
