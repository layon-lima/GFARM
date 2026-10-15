// Códigos de tipo de movimento (estilo SAP) e quantidade sinalizada para exibição.
// A regra de sinal é SOMENTE de exibição — nada é persistido com sinal negativo.

// Mapeamento tipo + modulo -> código SAP de 3 dígitos.
export function codigoMovimento(mov) {
  if (!mov) return '';
  const tipo = mov.tipo;
  const modulo = mov.modulo || '';
  const obs = mov.observacao || '';

  if (tipo === 'estorno') return '202';
  // Transferência: marcada via observação ("Transferência →/← ..."), origem movimentacoes ou cadastros.
  if (/^Transferência\s*[←→]/i.test(obs)) return '303';
  if (modulo === 'inventario') return '404';
  if (modulo === 'abastecimento') return '401';
  if (modulo === 'aplicacao') return '402';
  if (modulo === 'pesagem') return tipo === 'entrada' ? '301' : '302';
  if (modulo === 'nfe') return '101';
  // Entrada/saída manual (modulos movimentacoes, cadastros ou vazio).
  return tipo === 'entrada' ? '102' : '201';
}

// Descrição legível do tipo de movimento (acompanha o código SAP).
export function descricaoMovimento(mov) {
  if (!mov) return '';
  const tipo = mov.tipo;
  const modulo = mov.modulo || '';
  const obs = mov.observacao || '';

  if (tipo === 'estorno') return 'Estorno';
  if (/^Transferência\s*[←→]/i.test(obs)) return 'Transferência';
  if (modulo === 'inventario') return 'Baixa/Ajuste inventário';
  if (modulo === 'abastecimento') return 'Abastecimento';
  if (modulo === 'aplicacao') return 'Aplicação (OS)';
  if (modulo === 'pesagem') return tipo === 'entrada' ? 'Entrada por compra' : 'Saída por venda';
  if (modulo === 'nfe') return 'Entrada NF-e';
  return tipo === 'entrada' ? 'Entrada manual' : 'Saída manual';
}

// Quantidade com sinal para exibição em listas/relatórios.
// entrada -> +qtd; saida -> -qtd; estorno -> inverte o sinal do movimento original
// (estorno de entrada fica negativo; estorno de saída fica positivo — padrão SAP).
// `lista` (opcional) resolve o estorno_de; se não encontrar, assume reversão de entrada (negativo).
export function quantidadeSinalizada(mov, lista) {
  if (!mov) return 0;
  const qtd = Number(mov.quantidade || 0);
  if (mov.tipo === 'entrada') return qtd;
  if (mov.tipo === 'saida') return -qtd;
  if (mov.tipo === 'estorno') {
    const original = (lista || []).find((m) => m.id === mov.estorno_de);
    if (!original) return -qtd; // fallback: estorno padrão reverte entrada
    return original.tipo === 'saida' ? qtd : -qtd;
  }
  return qtd;
}