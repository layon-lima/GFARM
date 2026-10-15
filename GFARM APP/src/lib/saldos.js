import { estoqueApi } from '@/api/estoqueClient';
import {
  construirItensSaida,
  documentoIdDaMovimentacao,
  totalFisico,
} from '@/lib/estoqueOperacoes';


function valorParcela(saldo) {
  if (
    saldo?.valor_total !== undefined &&
    saldo?.valor_total !== null
  ) {
    return Number(
      saldo.valor_total
    ) || 0;
  }

  const quantidade =
    Number(
      saldo?.quantidade
    ) || 0;

  const custo =
    Number(
      saldo?.custo_medio ??
      saldo?.custo_unitario
    ) || 0;

  return quantidade * custo;
}


export async function recalcProdutoQuantidade(
  produtoId,
  saldos
) {
  const lista =
    saldos ||
    await estoqueApi.listarSaldos({
      produto_id: produtoId,
    });

  return totalFisico(
    lista.filter(
      (saldo) =>
        saldo.produto_id === produtoId
    )
  );
}


export async function getOrCreateSaldo({
  produtoId,
  depositoId,
  gavetaId = '',
  loteId = '',
  saldos,
}) {
  const lista =
    saldos ||
    await estoqueApi.listarSaldos({
      produto_id: produtoId,
      deposito_id: depositoId,
    });

  const existente =
    (lista || []).find(
      (saldo) =>
        saldo.produto_id
          === produtoId &&
        saldo.deposito_id
          === depositoId &&
        (saldo.gaveta_id || '')
          === (gavetaId || '') &&
        (saldo.lote_id || '')
          === (loteId || '')
    );

  if (existente) {
    return existente;
  }

  return {
    id: '',
    produto_id: produtoId,
    deposito_id: depositoId,
    gaveta_id: gavetaId || '',
    lote_id: loteId || '',
    quantidade: 0,
    quantidade_reservada: 0,
    quantidade_disponivel: 0,
    custo_medio: 0,
    valor_total: 0,
    tipo_estoque: 'livre',
  };
}


export async function entrarSaldo({
  produto,
  depositoId,
  gavetaId = '',
  loteId = '',
  quantidade,
  custoUnitario,
  unidade = 'un',
}) {
  if (!depositoId) {
    throw new Error(
      'DEPOSITO_OBRIGATORIO'
    );
  }

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        'AJUSTE_POSITIVO',
      origem_modulo:
        'compat_saldos',
      observacao:
        'Entrada pela camada de compatibilidade',
      itens: [
        {
          produto_id:
            produto.id,
          quantidade:
            Number(quantidade),
          unidade:
            unidade ||
            produto.unidade ||
            'un',
          deposito_destino_id:
            depositoId,
          gaveta_destino_id:
            gavetaId || '',
          lote_destino_id:
            loteId || undefined,
          custo_unitario:
            Number(
              custoUnitario ??
              produto.custo_unitario ??
              0
            ) || 0,
        },
      ],
    });

  const saldosNovos =
    await estoqueApi.listarSaldos({
      produto_id: produto.id,
      deposito_id: depositoId,
    });

  return (
    saldosNovos.find(
      (saldo) =>
        (saldo.gaveta_id || '')
          === (gavetaId || '') &&
        (saldo.lote_id || '')
          === (loteId || '')
    )
    ||
    resposta.documento
  );
}


export async function sairSaldo({
  produto,
  depositoId,
  gavetaId = '',
  quantidade,
}) {
  if (!depositoId) {
    throw new Error(
      'DEPOSITO_OBRIGATORIO'
    );
  }

  const alocacao =
    await construirItensSaida({
      produto,
      quantidadeBase:
        Number(quantidade),
      depositoId,
      gavetaId,
      somenteDeposito: true,
      somenteGaveta: true,
      observacao:
        'Saída pela camada de compatibilidade',
    });

  if (!alocacao.suficiente) {
    throw new Error(
      `SALDO_INSUFICIENTE:${alocacao.totalDisponivel}`
    );
  }

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        'AJUSTE_NEGATIVO',
      origem_modulo:
        'compat_saldos',
      observacao:
        'Saída pela camada de compatibilidade',
      itens:
        alocacao.itens,
    });

  const consumidos =
    (resposta.documento?.itens || [])
      .map(
        (item) => ({
          lote_id:
            item.lote_origem_id || '',
          quantidade:
            Number(
              item.quantidade
            ) || 0,
          custo_unitario:
            Number(
              item.custo_unitario
            ) || 0,
        })
      );

  return {
    consumidos,
    totalDisponivel:
      alocacao.totalDisponivel,
    suficiente: true,
    documento:
      resposta.documento,
  };
}


export async function reverterSaldoMov(
  mov
) {
  const documentoId =
    documentoIdDaMovimentacao(mov);

  if (!documentoId) {
    throw new Error(
      'ESTORNO_NAO_EXISTE'
    );
  }

  return estoqueApi.estornarDocumento(
    documentoId,
    `Estorno de ${mov?.numero || documentoId}`
  );
}


export async function transferirSaldo({
  produto,
  depositoOrigemId,
  gavetaOrigemId = '',
  depositoDestinoId,
  gavetaDestinoId = '',
  quantidade,
}) {
  const alocacao =
    await construirItensSaida({
      produto,
      quantidadeBase:
        Number(quantidade),
      depositoId:
        depositoOrigemId,
      gavetaId:
        gavetaOrigemId,
      somenteDeposito: true,
      somenteGaveta: true,
      observacao:
        'Transferência pela camada de compatibilidade',
    });

  if (!alocacao.suficiente) {
    throw new Error(
      `SALDO_INSUFICIENTE:${alocacao.totalDisponivel}`
    );
  }

  const itens =
    alocacao.itens.map(
      (item) => ({
        ...item,
        deposito_destino_id:
          depositoDestinoId,
        gaveta_destino_id:
          gavetaDestinoId || '',
      })
    );

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        'TRANSFERENCIA',
      origem_modulo:
        'compat_saldos',
      itens,
    });

  return {
    consumidos:
      (resposta.documento?.itens || [])
        .map(
          (item) => ({
            lote_id:
              item.lote_origem_id ||
              '',
            quantidade:
              Number(
                item.quantidade
              ) || 0,
            custo_unitario:
              Number(
                item.custo_unitario
              ) || 0,
          })
        ),
    documento:
      resposta.documento,
  };
}


export function buildEstoqueTree(
  produtoId,
  {
    saldos = [],
    depositos = [],
    gavetas = [],
    lotes = [],
  }
) {
  const saldosProduto =
    saldos.filter(
      (saldo) =>
        saldo.produto_id === produtoId &&
        (saldo.quantidade || 0) > 0
    );

  const tree = {};

  for (const saldo of saldosProduto) {
    const deposito =
      depositos.find(
        (item) =>
          item.id === saldo.deposito_id
      );

    const depKey =
      saldo.deposito_id ||
      '_sem_deposito';

    if (!tree[depKey]) {
      tree[depKey] = {
        deposito_id:
          saldo.deposito_id || '',
        nome:
          deposito?.numero
            ? `${deposito.numero}${
                deposito.nome
                  ? ` · ${deposito.nome}`
                  : ''
              }`
            : 'Sem depósito',
        quantidade: 0,
        gavetas: {},
      };
    }

    tree[depKey].quantidade +=
      saldo.quantidade || 0;

    const gavKey =
      saldo.gaveta_id ||
      '_sem_gaveta';

    if (
      !tree[depKey].gavetas[gavKey]
    ) {
      const gaveta =
        gavetas.find(
          (item) =>
            item.id === saldo.gaveta_id
        );

      tree[depKey].gavetas[gavKey] = {
        gaveta_id:
          saldo.gaveta_id || '',
        nome:
          gaveta?.codigo ||
          'Sem gaveta',
        quantidade: 0,
        lotes: [],
      };
    }

    tree[depKey]
      .gavetas[gavKey]
      .quantidade +=
        saldo.quantidade || 0;

    const lote =
      lotes.find(
        (item) =>
          item.id === saldo.lote_id
      );

    tree[depKey]
      .gavetas[gavKey]
      .lotes
      .push({
        saldo_id: saldo.id,
        lote_id:
          saldo.lote_id || '',
        codigo_lote:
          lote?.codigo_lote || '',
        data_validade:
          lote?.data_validade || '',
        quantidade:
          saldo.quantidade || 0,
        unidade:
          saldo.unidade || 'un',
      });
  }

  return Object.values(tree)
    .map(
      (deposito) => ({
        ...deposito,
        gavetas:
          Object.values(
            deposito.gavetas
          ),
      })
    );
}


export function saldoTotalProduto(
  produtoId,
  saldos = []
) {
  return (saldos || [])
    .filter(
      (saldo) =>
        saldo.produto_id === produtoId &&
        (saldo.quantidade || 0) > 0
    )
    .reduce(
      (soma, saldo) =>
        soma +
        (saldo.quantidade || 0),
      0
    );
}


export function depositosComSaldoDoProduto(
  produtoId,
  saldos = [],
  depositos = []
) {
  const ids =
    new Set(
      (saldos || [])
        .filter(
          (saldo) =>
            saldo.produto_id
              === produtoId &&
            (saldo.quantidade || 0) > 0
        )
        .map(
          (saldo) =>
            saldo.deposito_id
        )
        .filter(Boolean)
    );

  return (depositos || []).filter(
    (deposito) =>
      ids.has(deposito.id)
  );
}


export function gavetasComSaldoDoProduto(
  produtoId,
  depositoId,
  saldos = [],
  gavetas = []
) {
  const ids =
    new Set(
      (saldos || [])
        .filter(
          (saldo) =>
            saldo.produto_id
              === produtoId &&
            saldo.deposito_id
              === depositoId &&
            (saldo.quantidade || 0) > 0
        )
        .map(
          (saldo) =>
            saldo.gaveta_id
        )
        .filter(Boolean)
    );

  return (gavetas || []).filter(
    (gaveta) =>
      ids.has(gaveta.id)
  );
}


export function valorTotalProduto(
  produtoId,
  saldos = []
) {
  return (saldos || [])
    .filter(
      (saldo) =>
        saldo.produto_id === produtoId &&
        (saldo.quantidade || 0) > 0
    )
    .reduce(
      (soma, saldo) =>
        soma + valorParcela(saldo),
      0
    );
}


export function valorEstoqueConsolidado(
  saldos = [],
  produtos = []
) {
  const ativos =
    (saldos || []).filter(
      (saldo) =>
        (saldo.quantidade || 0) > 0
    );

  let totalGeral = 0;
  const porProduto = {};
  const porDeposito = {};
  const porSetor = {};

  for (const saldo of ativos) {
    const valor =
      valorParcela(saldo);

    totalGeral += valor;

    porProduto[saldo.produto_id] =
      (
        porProduto[
          saldo.produto_id
        ] || 0
      ) + valor;

    const depKey =
      saldo.deposito_id ||
      '_sem_deposito';

    porDeposito[depKey] =
      (
        porDeposito[depKey] || 0
      ) + valor;

    const produto =
      produtos.find(
        (item) =>
          item.id === saldo.produto_id
      );

    const setorKey =
      produto?.setor_id ||
      '_sem_setor';

    porSetor[setorKey] =
      (
        porSetor[setorKey] || 0
      ) + valor;
  }

  return {
    totalGeral,
    porProduto,
    porDeposito,
    porSetor,
  };
}