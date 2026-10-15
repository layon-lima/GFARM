// Lógica de matching entre dados extraídos de uma NF-e e tickets de pesagem de venda.
import { normalizePlaca } from '@/lib/pesagem';
import { normalizeNome } from '@/lib/nfeVendaParser';

const PESO_TOLERANCIA_KG = 0.5;

/**
 * Compara nomes de motorista de forma tolerante (ignora acentos, case, espaços).
 * Retorna true se um nome contém o outro (parcial) ou se são iguais após normalização.
 */
function nomesCompativeis(nomeA, nomeB) {
  const a = normalizeNome(nomeA);
  const b = normalizeNome(nomeB);
  if (!a || !b) return false;
  if (a === b) return true;
  // Aceita match parcial (um nome contém o outro)
  return a.includes(b) || b.includes(a);
}

/**
 * Tenta identificar a qual ticket uma NF-e pertence.
 *
 * Estratégia:
 * 1. Se o XML trouxer o número do ticket no infCpl, busca exata por numero.
 * 2. Fallback: busca tickets de venda fechados com a mesma placa (normalizada)
 *    e peso líquido dentro da tolerância (diferença < 0,5 kg). Se o nome do
 *    motorista também for compatível, o candidato ganha prioridade.
 *
 * Retorna:
 *   { status: 'unique', ticket }     — match único, pode marcar automaticamente
 *   { status: 'ambiguous', candidates } — múltiplos candidatos, usuário decide
 *   { status: 'none' }               — nenhum ticket encontrado
 *   { status: 'duplicate' }          — já existe um ticket com esta chave de NF-e
 */
export function matchNfeToTicket(nfeData, tickets) {
  // Verifica duplicidade: se já existe um ticket com a mesma chave de NF-e
  if (nfeData.chave) {
    const jaImportado = tickets.find((t) => t.nfe_chave === nfeData.chave);
    if (jaImportado) {
      return { status: 'duplicate', ticket: jaImportado };
    }
  }

  // 1. Match por número do ticket extraído do infCpl
  //    Busca em TODOS os tickets — o número explícito na nota é o sinal mais
  //    forte de matching, independente do tipo/status do ticket.
  if (nfeData.numeroTicket) {
    const porNumero = tickets.filter(
      (t) => t.numero === nfeData.numeroTicket
    );
    if (porNumero.length === 1) {
      return { status: 'unique', ticket: porNumero[0] };
    }
    if (porNumero.length > 1) {
      return { status: 'ambiguous', candidates: porNumero };
    }
    // Não encontrou por número — cai para o fallback de placa + peso
  }

  // Filtros de fallback consideram apenas tickets de venda fechados
  const candidatos = tickets.filter(
    (t) => t.status === 'fechado' && t.tipo === 'venda'
  );

  // 2. Fallback: placa + peso líquido (com tolerância), reforçado por motorista
  const placaNfe = normalizePlaca(nfeData.placa);
  const pesoNfe = Number(nfeData.pesoLiquido) || 0;

  if (!placaNfe || !pesoNfe) {
    return { status: 'none' };
  }

  const porPlacaPeso = candidatos.filter((t) => {
    const placaMatch = normalizePlaca(t.placa) === placaNfe;
    if (!placaMatch) return false;
    const pesoTicket = Number(t.peso_liquido) || 0;
    if (!pesoTicket) return false;
    return Math.abs(pesoTicket - pesoNfe) <= PESO_TOLERANCIA_KG;
  });

  if (porPlacaPeso.length === 0) {
    return { status: 'none' };
  }

  // Se houver apenas 1 candidato, é único
  if (porPlacaPeso.length === 1) {
    return { status: 'unique', ticket: porPlacaPeso[0] };
  }

  // Múltiplos candidatos: tenta refinar pelo nome do motorista se disponível na NF
  if (nfeData.motorista) {
    const comMotorista = porPlacaPeso.filter((t) =>
      nomesCompativeis(t.motorista, nfeData.motorista)
    );
    if (comMotorista.length === 1) {
      return { status: 'unique', ticket: comMotorista[0] };
    }
    if (comMotorista.length > 1) {
      return { status: 'ambiguous', candidates: comMotorista };
    }
  }

  // Não conseguiu desempatar — lista todos para confirmação manual
  return { status: 'ambiguous', candidates: porPlacaPeso };
}