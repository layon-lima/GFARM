// O rascunho é local ao navegador e exclusivo do usuário conectado.
// Um rascunho NUNCA é um ticket salvo; somente as APIs de Pesagem registram dados.
const VERSAO = 3;
const CAMPOS = [
  'tipo', 'pedido_id', 'motorista', 'placa', 'produto_id',
  'cliente_id', 'transportadora_id', 'origem', 'destino', 'observacao',
];

export const RASCUNHO_VAZIO = Object.freeze({
  form: {},
  ticketAtivoId: '',
  ticketConsultaId: '',
  primeiraPendente: 0,
  primeiraPendenteEm: '',
  segundaPesagem: 0,
  segundaRegistradaEm: '',
  transportadoraFechamento: '',
  pesoDigitado1: '',
  pesoDigitado2: '',
  etapaManual: 0,
});

export function chaveRascunhoPesagem(usuario) {
  const uid = String(usuario?.id || usuario?.username || '').trim();
  return uid ? `gfarm_pesagem_rascunho_v3_${uid}` : '';
}

export function lerRascunhoPesagem(usuario) {
  const chave = chaveRascunhoPesagem(usuario);
  if (!chave) return { ...RASCUNHO_VAZIO };
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return { ...RASCUNHO_VAZIO };
    const dados = JSON.parse(bruto);
    if (!dados || dados.versao !== VERSAO || typeof dados.form !== 'object') {
      return { ...RASCUNHO_VAZIO };
    }
    return {
      form: Object.fromEntries(CAMPOS.map((campo) => [
        campo,
        String(dados.form?.[campo] || '').slice(0, 3000),
      ])),
      ticketAtivoId: String(dados.ticketAtivoId || ''),
      ticketConsultaId: String(dados.ticketConsultaId || ''),
      primeiraPendente: Number.isFinite(Number(dados.primeiraPendente))
        ? Math.max(0, Number(dados.primeiraPendente)) : 0,
      primeiraPendenteEm: String(dados.primeiraPendenteEm || ''),
      segundaPesagem: Number.isFinite(Number(dados.segundaPesagem))
        ? Math.max(0, Number(dados.segundaPesagem)) : 0,
      segundaRegistradaEm: String(dados.segundaRegistradaEm || ''),
      transportadoraFechamento: String(dados.transportadoraFechamento || ''),
      pesoDigitado1: String(dados.pesoDigitado1 || ''),
      pesoDigitado2: String(dados.pesoDigitado2 || ''),
      etapaManual: [1, 2].includes(Number(dados.etapaManual))
        ? Number(dados.etapaManual) : 0,
    };
  } catch {
    return { ...RASCUNHO_VAZIO };
  }
}

export function existeRascunhoPesagem(rascunho) {
  const f = rascunho?.form || {};
  return CAMPOS.some((c) => String(f[c] || '').trim())
    || Boolean(rascunho?.ticketAtivoId)
    || Number(rascunho?.primeiraPendente) > 0
    || Number(rascunho?.segundaPesagem) > 0
    || Boolean(String(rascunho?.pesoDigitado1 || '').trim())
    || Boolean(String(rascunho?.pesoDigitado2 || '').trim());
}

export function salvarRascunhoPesagem(usuario, rascunho) {
  const chave = chaveRascunhoPesagem(usuario);
  if (!chave) return;
  try {
    if (!existeRascunhoPesagem(rascunho)) {
      localStorage.removeItem(chave);
      return;
    }
    localStorage.setItem(chave, JSON.stringify({
      versao: VERSAO,
      atualizadoEm: new Date().toISOString(),
      ...rascunho,
    }));
  } catch (error) {
    // Falha de storage não deve impedir pesagens ou capturas na balança.
    console.warn('[Pesagem] Não foi possível preservar o rascunho local:', error);
  }
}
