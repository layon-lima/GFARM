// Formatação e parse de quantidades no padrão pt-BR (ex.: 1.234,56)

import { convertQty, normalizarUnidade } from '@/lib/units';

export function formatQtd(n) {
  const num = Number(n);
  if (!isFinite(num)) return '0,00';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formata valor monetário no padrão BRL (R$ 1.234,56).
export function formatMoeda(n) {
  const num = Number(n);
  if (!isFinite(num)) return 'R$ 0,00';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Formata a dose/ha com até 4 casas decimais, aceitando vírgula decimal (pt-BR).
// Necessário porque a dose é digitada como texto e pode conter vírgula (ex.: "0,5").
export function formatDose(v) {
  return (parseQtd(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

// Formato para campos de entrada: 2 decimais, sem separador de milhar (ex.: 1500,00).
export function formatInputQtd(n) {
  const num = Number(n);
  if (!isFinite(num)) return '';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

// Converte string pt-BR ('1.234,56', '0,5', '1,5') em Number.
// Também aceita formatos com ponto decimal ('1.5') por robustez.
export function parseQtd(str) {
  if (typeof str === 'number') return str;
  if (str == null) return 0;
  const s = String(str).trim();
  if (s === '') return 0;
  // Se há vírgula: trata como separador decimal pt-BR (pontos = milhar)
  if (s.includes(',')) {
    const limpo = s.replace(/\./g, '').replace(',', '.');
    const n = Number(limpo);
    return isFinite(n) ? n : 0;
  }
  // Sem vírgula: em pt-BR o ponto é separador de milhar.
  // - Múltiplos pontos → milhar (ex.: "1.234.567" → 1234567)
  // - Ponto único seguido de exatamente 3 dígitos → milhar (ex.: "2.400" → 2400)
  //   (evita que o visor da balança "2.400" seja lido como 2,4 ao gravar o ticket)
  // - Demais casos (ex.: "1.5", "2.40") → decimal, por robustez
  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      const limpo = s.replace(/\./g, '');
      const n = Number(limpo);
      return isFinite(n) ? n : 0;
    }
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// Formata uma quantidade convertendo da unidade de origem para a unidade de destino.
// Retorna um objeto { texto, mudou } onde `texto` já vem no formato pt-BR + unidade.
// `mudou` indica se houve conversão real (unidades diferentes e conversíveis).
// Usado em todos os pontos de exibição onde a quantidade pode entrar em unidade
// diferente da cadastrada no produto (ex.: NF-e em "ton" para produto em "kg").
export function formatQtdConvertida(qtd, deUnidade, paraUnidade) {
  const de = normalizarUnidade(deUnidade);
  const para = paraUnidade || '';
  if (!de || !para) {
    return { texto: `${formatQtd(qtd)} ${deUnidade || ''}`.trim(), mudou: false };
  }
  if (de === para) {
    return { texto: `${formatQtd(qtd)} ${para}`.trim(), mudou: false };
  }
  const conv = convertQty(qtd, de, para);
  if (conv === null || !isFinite(conv)) {
    return { texto: `${formatQtd(qtd)} ${de}`.trim(), mudou: false };
  }
  return { texto: `${formatQtd(conv)} ${para}`, mudou: true, convertido: conv };
}