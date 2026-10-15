// Unidades de medida suportadas, agrupadas por família.
// Cada unidade tem um fator relativo à unidade base da família
// (ex.: 1 ton = 1000 kg; 1 kg = 1000 g; 1 L = 1000 mL; 1 km = 1000 m).

export const UNIDADES = [
  {
    familia: 'Massa',
    itens: [
      { value: 'ton', label: 'tonelada (ton)' },
      { value: 'kg', label: 'quilograma (kg)' },
      { value: 'g', label: 'grama (g)' },
    ],
  },
  {
    familia: 'Volume',
    itens: [
      { value: 'L', label: 'litro (L)' },
      { value: 'mL', label: 'mililitro (mL)' },
    ],
  },
  {
    familia: 'Comprimento',
    itens: [
      { value: 'km', label: 'quilômetro (km)' },
      { value: 'm', label: 'metro (m)' },
      { value: 'cm', label: 'centímetro (cm)' },
      { value: 'mm', label: 'milímetro (mm)' },
    ],
  },
  {
    familia: 'Outros',
    itens: [
      { value: 'un', label: 'unidade (un)' },
    ],
  },
];

const FATORES = {
  Massa: { ton: 1000, kg: 1, g: 0.001 },
  Volume: { L: 1, mL: 0.001 },
  Comprimento: { km: 1000, m: 1, cm: 0.01, mm: 0.001 },
  Outros: { un: 1 },
};

function familiaDe(unidade) {
  for (const f of UNIDADES) {
    if (f.itens.some((i) => i.value === unidade)) return f.familia;
  }
  return null;
}

// Retorna true se `de` e `para` pertencem à mesma família (conversíveis).
export function isConversivel(de, para) {
  if (!de || !para || de === para) return false;
  const famDe = familiaDe(de);
  const famPara = familiaDe(para);
  return !!(famDe && famPara && famDe === famPara);
}

// Converte `value` da unidade `de` para `para`.
// Retorna null quando as unidades são de famílias diferentes.
export function convertQty(value, de, para) {
  if (!de || !para) return null;
  if (de === para) return Number(value) || 0;
  const famDe = familiaDe(de);
  const famPara = familiaDe(para);
  if (!famDe || !famPara || famDe !== famPara) return null;
  const fatorDe = FATORES[famDe][de];
  const fatorPara = FATORES[famPara][para];
  if (!fatorDe || !fatorPara) return null;
  const base = (Number(value) || 0) * fatorDe;
  return base / fatorPara;
}

// Mapeia códigos comuns da NF-e (uCom) para os códigos canônicos do sistema.
const MAPA_UNIDADES = {
  ton: 'ton', t: 'ton', tonelada: 'ton', toneladas: 'ton',
  kg: 'kg', quilograma: 'kg', quilos: 'kg', quilo: 'kg',
  g: 'g', grama: 'g', gr: 'g', gramas: 'g',
  l: 'L', lt: 'L', litro: 'L', litros: 'L',
  ml: 'mL', mililitro: 'mL',
  km: 'km', quilometro: 'km',
  m: 'm', metro: 'm', metros: 'm',
  cm: 'cm', centimetro: 'cm',
  mm: 'mm', milimetro: 'mm',
  un: 'un', unid: 'un', unidade: 'un', unidades: 'un', peca: 'un', pecas: 'un',
};

export function normalizarUnidade(str) {
  if (!str) return '';
  const key = String(str).trim().toLowerCase();
  return MAPA_UNIDADES[key] || '';
}

export function getUnidadeLabel(unidade) {
  for (const f of UNIDADES) {
    const item = f.itens.find((i) => i.value === unidade);
    if (item) return item.label;
  }
  return unidade || '';
}

// Verifica se a unidade da NF-e (uCom) exige conversão customizada,
// ou seja: não é igual à unidade-base do produto e não é conversível
// automaticamente (código não mapeado ou de família diferente).
export function precisaConversaoCustom(uCom, prodUnidade) {
  if (!uCom || !prodUnidade) return false;
  if (String(uCom).trim().toLowerCase() === String(prodUnidade).trim().toLowerCase()) return false;
  const de = normalizarUnidade(uCom);
  if (!de) return true; // código não mapeado (ex.: CX, GAL, FR)
  if (de === prodUnidade) return false;
  const conv = convertQty(1, de, prodUnidade);
  return conv === null || !isFinite(conv); // famílias diferentes
}

// Verifica se o produto já possui conversão customizada para a unidade da NF-e.
export function temConversaoCustom(produto, uCom) {
  if (!produto?.unidade_alt || !produto?.fator_conversao) return false;
  if (!uCom) return false;
  return String(produto.unidade_alt).trim().toLowerCase() === String(uCom).trim().toLowerCase();
}

// Converte a quantidade da NF-e para a unidade-base do produto.
// 1) Tenta a conversão automática (unidades mapeadas: kg, L, ton, etc.).
// 2) Se não for possível, aplica a conversão customizada salva no produto.
// Retorna { qtd, convertido, origem }.
export function convertQtyForProduto(value, uCom, produto) {
  const prodUnidade = produto?.unidade;
  if (!uCom || !prodUnidade) return { qtd: Number(value) || 0, convertido: false, origem: '' };
  const de = normalizarUnidade(uCom);
  if (de) {
    if (de === prodUnidade) return { qtd: Number(value) || 0, convertido: false, origem: '' };
    const conv = convertQty(value, de, prodUnidade);
    if (conv !== null && isFinite(conv)) {
      return { qtd: conv, convertido: true, origem: 'auto' };
    }
  }
  if (temConversaoCustom(produto, uCom)) {
    const fator = Number(produto.fator_conversao) || 0;
    if (fator > 0) {
      return { qtd: (Number(value) || 0) * fator, convertido: true, origem: 'custom' };
    }
  }
  return { qtd: Number(value) || 0, convertido: false, origem: '' };
}