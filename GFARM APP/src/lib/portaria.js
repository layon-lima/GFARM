import { api } from '@/api/apiClient';


// Normalizações usadas apenas para localizar
// cadastros já existentes.
const normDoc = (s) =>
  (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const normPlaca = (s) =>
  (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const normNome = (s) =>
  (s || '')
    .trim()
    .toUpperCase();


async function loadPessoas() {
  try {
    return await api.entities.Pessoa.list(
      '-created_date',
      500
    );
  } catch {
    return [];
  }
}


export async function loadMotoristas() {
  const pessoas =
    await loadPessoas();

  return pessoas.filter(
    (p) => p.is_motorista
  );
}


export async function loadTransportadoras() {
  const pessoas =
    await loadPessoas();

  return pessoas.filter(
    (p) => p.is_transportadora
  );
}


export async function loadVeiculos() {
  try {
    return await api.entities.Veiculo.list(
      '-created_date',
      500
    );
  } catch {
    return [];
  }
}


//
// A PORTARIA NÃO CADASTRA MAIS.
//
// Estas funções permanecem temporariamente
// apenas para não quebrar componentes antigos.
// Elas somente procuram um cadastro existente.
//

export async function registrarMotorista(data) {
  const {
    nome,
    documento,
  } = data;

  const pessoas =
    await loadMotoristas();

  const docN =
    normDoc(documento);

  const nomeN =
    normNome(nome);

  const existente =
    pessoas.find(
      (p) =>
        (
          docN &&
          normDoc(p.documento) === docN
        )
        ||
        (
          nomeN &&
          normNome(p.nome) === nomeN
        )
    );

  if (!existente) {
    throw new Error(
      'MOTORISTA_NAO_CADASTRADO'
    );
  }

  return {
    action: 'reutilizado',
    record: existente,
  };
}


export async function registrarTransportadora(data) {
  const {
    nome,
    documento,
  } = data;

  const pessoas =
    await loadTransportadoras();

  const docN =
    normDoc(documento);

  const nomeN =
    normNome(nome);

  const existente =
    pessoas.find(
      (p) =>
        (
          docN &&
          normDoc(p.documento) === docN
        )
        ||
        (
          nomeN &&
          normNome(p.nome) === nomeN
        )
    );

  if (!existente) {
    throw new Error(
      'TRANSPORTADORA_NAO_CADASTRADA'
    );
  }

  return {
    action: 'reutilizado',
    record: existente,
  };
}


export async function registrarVeiculo(data) {
  const {
    placa,
  } = data;

  const veiculos =
    await loadVeiculos();

  const placaN =
    normPlaca(placa);

  const existente =
    veiculos.find(
      (v) =>
        normPlaca(v.placa)
        === placaN
    );

  if (!existente) {
    throw new Error(
      'VEICULO_NAO_CADASTRADO'
    );
  }

  return {
    action: 'reutilizado',
    record: existente,
  };
}
