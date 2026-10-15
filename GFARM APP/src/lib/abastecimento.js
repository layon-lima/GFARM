import { api } from '@/api/apiClient';
import { estoqueApi } from '@/api/estoqueClient';
import {
  construirItensSaida,
  sincronizarProdutoLocal,
} from '@/lib/estoqueOperacoes';


export function findSetorCombustivel(setores) {
  return (setores || []).find(
    (setor) =>
      String(setor?.nome || '')
        .toLowerCase()
        .includes('combust')
  );
}


export function produtosCombustivel(
  produtos,
  setorId
) {
  if (!setorId) return [];

  return (produtos || []).filter(
    (produto) =>
      produto.setor_id === setorId
  );
}


export async function registrarAbastecimentoPendente({
  maquina,
  produto,
  quantidade,
  observacao,
  operador,
  foto_url,
}) {
  const qtd = Number(quantidade);

  if (!(qtd > 0)) {
    throw new Error(
      'Informe uma quantidade maior que zero.'
    );
  }

  return api.entities.Abastecimento.create({
    data: new Date().toISOString(),
    maquina_id: maquina.id,
    produto_id: produto.id,
    quantidade: qtd,
    unidade: produto.unidade || 'un',
    operador: operador || '',
    observacao: observacao || '',
    foto_url: foto_url || '',
    status: 'pendente',
  });
}


export async function confirmarAbastecimento({
  abast,
  maquina,
  produto,
  confirmado_por,
}) {
  const qtd = Number(
    abast.quantidade
  );

  if (!(qtd > 0)) {
    throw new Error(
      'Quantidade inválida.'
    );
  }

  if (
    abast.status !== 'pendente'
  ) {
    throw new Error(
      'Este abastecimento já foi processado.'
    );
  }

  const alocacao =
    await construirItensSaida({
      produto,
      quantidadeBase: qtd,
      depositoId:
        produto.deposito_id || '',
      gavetaId:
        produto.gaveta_id || '',
      somenteDeposito: false,
      somenteGaveta: false,
      observacao:
        abast.observacao ||
        `Abastecimento — ${
          maquina?.nome ||
          maquina?.codigo ||
          ''
        }`,
    });

  if (!alocacao.suficiente) {
    throw new Error(
      `Saldo insuficiente. Disponível: ${alocacao.totalDisponivel} ${produto.unidade || 'un'}.`
    );
  }

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        'ABASTECIMENTO',
      origem_modulo:
        'abastecimento',
      documento_origem_id:
        abast.id,
      referencia_externa:
        maquina?.codigo ||
        abast.id,
      observacao:
        abast.observacao ||
        `Abastecimento — ${
          maquina?.nome ||
          maquina?.codigo ||
          ''
        }`,
      itens: alocacao.itens,
    });

  const documento =
    resposta.documento;

  await api.entities
    .Abastecimento
    .update(
      abast.id,
      {
        status: 'confirmado',
        confirmado_por:
          confirmado_por || '',
        data_confirmacao:
          new Date().toISOString(),
        numero_mov:
          documento.numero || '',
      }
    );

  await sincronizarProdutoLocal(
    produto
  );

  return documento;
}


export async function cancelarAbastecimento(
  abastId
) {
  return api.entities
    .Abastecimento
    .update(
      abastId,
      {
        status: 'cancelado',
      }
    );
}