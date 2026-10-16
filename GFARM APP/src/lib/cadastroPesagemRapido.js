// Identidade da pessoa e do veículo: usa somente entidades oficiais (Pessoa/Veiculo).
export function normalizarNome(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizarDocumento(documento) {
  return String(documento || '').replace(/\D/g, '');
}

export function normalizarPlaca(placa) {
  return String(placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function localizarPessoaExistente(pessoas, nome, documento) {
  const doc = normalizarDocumento(documento);
  const nomeNormalizado = normalizarNome(nome);
  return (pessoas || []).filter((p) => {
    if (doc && normalizarDocumento(p.documento) === doc) return true;
    // Homônimos com dois documentos diferentes podem ser pessoas distintas.
    const docExistente = normalizarDocumento(p.documento);
    return nomeNormalizado !== ''
      && normalizarNome(p.nome) === nomeNormalizado
      && (!doc || !docExistente || doc === docExistente);
  });
}

export function localizarVeiculoExistente(veiculos, placa) {
  const chave = normalizarPlaca(placa);
  return chave ? (veiculos || []).find((v) => normalizarPlaca(v.placa) === chave) || null : null;
}

export function camposNovoPerfil(perfil, dados) {
  if (!['is_motorista', 'is_transportadora', 'is_fornecedor'].includes(perfil)) {
    throw new Error('Perfil não permitido');
  }
  return {
    nome: String(dados.nome || '').trim(),
    documento: String(dados.documento || '').trim(),
    telefone: String(dados.telefone || '').trim(),
    ...(perfil === 'is_motorista' ? { cnh: String(dados.cnh || '').trim() } : {}),
    is_cliente: false,
    is_motorista: perfil === 'is_motorista',
    is_transportadora: perfil === 'is_transportadora',
    is_fornecedor: perfil === 'is_fornecedor',
  };
}
