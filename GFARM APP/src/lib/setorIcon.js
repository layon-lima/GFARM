// Catálogo de ícones por setor + inferência automática pelo nome.

export const SETOR_ICONS = [
  { key: 'layers', label: 'Estoque (padrão)' },
  { key: 'fuel', label: 'Combustível' },
  { key: 'tractor', label: 'Máquinas / Peças' },
  { key: 'flask', label: 'Defensivos / Agroquímicos' },
  { key: 'fertilizer', label: 'Fertilizantes / Sementes' },
  { key: 'droplets', label: 'Lubrificantes / Líquidos' },
  { key: 'wrench', label: 'Ferramentas' },
  { key: 'hardhat', label: 'EPI / Segurança' },
  { key: 'wheat', label: 'Grãos / Cereais' },
  { key: 'package', label: 'Embalagens / Geral' },
  { key: 'truck', label: 'Logística' },
  { key: 'leaf', label: 'Vegetação / Verde' },
];

// Infere um ícone a partir do nome do setor quando nenhum foi definido.
export function inferSetorIcon(nome = '') {
  const n = String(nome || '').toLowerCase();
  if (/(combust|diesel|gasolin|gasol|etanol)/.test(n)) return 'fuel';
  if (/(maquina|maq|peca|peça|trator|tractor|implemento)/.test(n)) return 'tractor';
  if (/(defens|agrotox|agroquim|veneno|praguicida|herbicida|fungicida|inseticida)/.test(n)) return 'flask';
  if (/(fertiliz|adubo|semente|sement|muda|planta)/.test(n)) return 'fertilizer';
  if (/(lubrif|oleo|óleo|graxa|\blub\b)/.test(n)) return 'droplets';
  if (/(ferrament|ferra)/.test(n)) return 'wrench';
  if (/(epi|seguran|protecao|proteção)/.test(n)) return 'hardhat';
  if (/(grao|grão|cere|milho|soja|trigo|arroz)/.test(n)) return 'wheat';
  if (/(logist|expedi|carga|carreg|transport)/.test(n)) return 'truck';
  if (/(verde|horta|florest|mato|pasto)/.test(n)) return 'leaf';
  if (/(embalag|\bcx\b|caixa|geral|diverso)/.test(n)) return 'package';
  return 'layers';
}

// Resolve o ícone final: explícito no setor, ou inferido pelo nome.
export function resolveSetorIcon(setor) {
  if (setor?.icon) return setor.icon;
  return inferSetorIcon(setor?.nome || '');
}