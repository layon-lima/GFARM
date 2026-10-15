// Lógica de negócio das Ordens de Serviço de Aplicação (OS).
// Numeração sequencial, cálculo de previsto (dose × hectares),
// lançamento de consumo real com baixa de estoque (Movimentacao + SaldoEstoque).
import { api } from '@/api/apiClient';
import { estoqueApi } from '@/api/estoqueClient';
import { parseQtd } from '@/lib/format';
import { construirItensSaida } from '@/lib/estoqueOperacoes';

export function normalizarStatusAplicacao(status) {
  if (status === 'aberta') return 'pendente';
  if (status === 'executada') return 'baixada';
  if (status === 'cancelada') return 'cancelada';
  return status || 'pendente';
}


// Extrai o sufixo numérico de um número de OS (ex.: OSA-000012 -> 12).
export function maxNumeroOS(listaOS) {
  let max = 0;
  for (const o of listaOS || []) {
    const match = String(o?.numero || '').match(/(\d+)\s*$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max;
}

export function formatarNumeroOS(n) {
  return `OSA-${String(n).padStart(6, '0')}`;
}

// Dias que uma OS está em aberto (data de abertura até hoje).
// Usado para acionar o flag de alerta quando passa de 7 dias.
export function diasEmAberto(os, agora = new Date()) {
  if (!os?.data) return 0;
  const abertura = new Date(os.data);
  if (Number.isNaN(abertura.getTime())) return 0;
  return Math.max(0, Math.floor((agora - abertura) / 86400000));
}

// Calcula o previsto de um item: dose_por_hect × hectares.
export function calcularPrevisto(dosePorHect, hectares) {
  const dose = parseQtd(dosePorHect);
  const ha = Number(hectares) || 0;
  return dose * ha;
}

// Serializa/desserializa o array de itens da OS (armazenado como JSON string).
export function parseItens(itensStr) {
  if (!itensStr) return [];
  try {
    const arr = JSON.parse(itensStr);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function stringifyItens(itens) {
  return JSON.stringify(itens || []);
}

// Filtra produtos que podem ser usados em OS de aplicação:
// adubos/defensivos com saldo > 0. Para flexibilidade, considera qualquer
// produto com saldo positivo (o usuário escolhe quais adicionar na OS).
export function produtosParaAplicacao(produtos, saldos) {
  return (produtos || []).filter((p) => {
    const total = (saldos || [])
      .filter((s) => s.produto_id === p.id)
      .reduce((sum, s) => sum + (s.quantidade || 0), 0);
    return total > 0;
  });
}

// Saldo total de um produto.
export function saldoProduto(produtoId, saldos) {
  return (saldos || [])
    .filter((s) => s.produto_id === produtoId)
    .reduce((sum, s) => sum + (s.quantidade || 0), 0);
}

export function saldoProdutoDeposito(produtoId, depositoId, saldos) {
  if (!produtoId || !depositoId) return 0;
  return (saldos || [])
    .filter((s) => s.produto_id === produtoId && s.deposito_id === depositoId)
    .reduce((sum, s) => sum + (Number(s.quantidade) || 0), 0);
}

// Lança o consumo real da OS: para cada item, gera uma movimentação de saída
// e baixa o saldo (FEFO). Atualiza a OS com realizado, status e custo_total.
// `form` = { itens: [{ produto_id, realizado, deposito_id }] }.
// Lança 'SALDO_INSUFICIENTE:<disp>:<nome>' se faltar saldo.
export async function executarOS({
  os,
  produtos,
  responsavel,
}) {
  if (normalizarStatusAplicacao(os?.status) !== 'pendente') {
    throw new Error('APLICACAO_NAO_PENDENTE');
  }

  const itens = parseItens(os.itens);
  const now = new Date().toISOString();

  const itensMovimento = [];
  const itensAtivos = [];

  for (
    let indice = 0;
    indice < itens.length;
    indice++
  ) {
    const item = itens[indice];

    const produto =
      (produtos || []).find(
        (p) => p.id === item.produto_id
      );

    if (!produto) {
      continue;
    }

    const realizado =
      parseQtd(item.realizado);

    if (realizado <= 0) {
      continue;
    }

    const depositoId =
      item.deposito_id ||
      produto.deposito_id ||
      '';

    if (!depositoId) {
      throw new Error(
        `DEPOSITO_OBRIGATORIO:${produto.nome}`
      );
    }

    const marcador =
      `OSITEM:${indice}`;

    const alocacao =
      await construirItensSaida({
        produto,
        quantidadeBase:
          realizado,
        depositoId,
        gavetaId:
          produto.gaveta_id || '',
        somenteDeposito: true,
        somenteGaveta: false,
        observacao:
          `${marcador} | Aplicação ${os.numero || ''}`,
      });

    if (!alocacao.suficiente) {
      throw new Error(
        `SALDO_INSUFICIENTE:${alocacao.totalDisponivel}:${produto.nome}`
      );
    }

    itensMovimento.push(
      ...alocacao.itens
    );

    itensAtivos.push({
      indice,
      marcador,
      produto,
      realizado,
    });
  }

  if (itensMovimento.length === 0) {
    throw new Error(
      'Nenhum consumo informado para baixar a aplicação.'
    );
  }

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        'APLICACAO',
      origem_modulo:
        'aplicacao',
      documento_origem_id:
        os.id || os.numero,
      referencia_externa:
        os.numero || undefined,
      observacao:
        [
          `Aplicação ${os.numero || ''}`,
          os.lavoura_nome || '',
          responsavel || '',
        ]
          .filter(Boolean)
          .join(' — '),
      itens: itensMovimento,
    });

  const documento =
    resposta.documento;

  let custoTotal = 0;

  for (const ativo of itensAtivos) {
    const valorItem =
      (documento.itens || [])
        .filter(
          (movItem) =>
            String(
              movItem.observacao || ''
            ).includes(
              ativo.marcador
            )
        )
        .reduce(
          (soma, movItem) =>
            soma +
            (
              Number(
                movItem.valor_total
              ) || 0
            ),
          0
        );

    const custoUnitario =
      ativo.realizado > 0
        ? valorItem /
          ativo.realizado
        : 0;

    const item =
      itens[ativo.indice];

    item.realizado =
      ativo.realizado;

    item.custo_unitario =
      custoUnitario;

    item.custo_total =
      valorItem;

    item.mov_numero =
      documento.numero;

    custoTotal +=
      valorItem;
  }

  await api.entities
    .OrdemServicoAplicacao
    .update(
      os.id,
      {
        itens:
          stringifyItens(itens),
        status: 'baixada',
        data_execucao: now,
        custo_total:
          custoTotal,
      }
    );

  return {
    custoTotal,
    documento,
  };
}

// Calcula o custo detalhado de uma lavoura: agrega todas as aplicações baixadas
// daquela lavoura, somando por produto o previsto, realizado e custo.
export function custoPorLavoura(lavouraId, ordens) {
  const ordensLavoura = (ordens || []).filter(
    (o) => o.lavoura_id === lavouraId && normalizarStatusAplicacao(o.status) === 'baixada'
  );

  const porProduto = {};
  let custoTotalGeral = 0;

  for (const os of ordensLavoura) {
    const itens = parseItens(os.itens);
    for (const item of itens) {
      const realizado = Number(item.realizado) || 0;
      const previsto = Number(item.previsto) || 0;
      const custoUnit = Number(item.custo_unitario) || 0;
      const custo = Number(item.custo_total) || realizado * custoUnit;

      if (!porProduto[item.produto_id]) {
        porProduto[item.produto_id] = {
          produto_id: item.produto_id,
          nome: item.nome,
          codigo: item.codigo,
          unidade: item.unidade,
          previsto: 0,
          realizado: 0,
          custo: 0,
          qtd_os: 0,
        };
      }
      porProduto[item.produto_id].previsto += previsto;
      porProduto[item.produto_id].realizado += realizado;
      porProduto[item.produto_id].custo += custo;
      porProduto[item.produto_id].qtd_os += 1;
    }
    custoTotalGeral += Number(os.custo_total) || 0;
  }

  return {
    produtos: Object.values(porProduto).sort((a, b) => b.custo - a.custo),
    custoTotal: custoTotalGeral,
    qtdOS: ordensLavoura.length,
  };
}

// Recalcula o custo de todas as OS que contêm um produto, usando o novo
// custo unitário. Para aplicações baixadas usa o realizado; para as demais, o previsto.
// Atualiza custo_unitario/custo_total de cada item e custo_total da OS.
export async function recalcularCustosPorProduto(produtoId, novoCustoUnit) {
  const custo = Number(novoCustoUnit) || 0;
  const ordens = await api.entities.OrdemServicoAplicacao.list('-data', 1000);
  const afetadas = [];
  for (const o of ordens) {
    const itens = parseItens(o.itens);
    if (!itens.some((it) => it.produto_id === produtoId)) continue;
    let custoTotal = 0;
    for (const it of itens) {
      if (it.produto_id === produtoId) it.custo_unitario = custo;
      const base = normalizarStatusAplicacao(o.status) === 'baixada' ? Number(it.realizado) || 0 : Number(it.previsto) || 0;
      const cu = Number(it.custo_unitario) || 0;
      it.custo_total = base * cu;
      custoTotal += it.custo_total;
    }
    afetadas.push({ id: o.id, itens: stringifyItens(itens), custo_total: custoTotal });
  }
  if (afetadas.length) {
    await api.entities.OrdemServicoAplicacao.bulkUpdate(afetadas);
  }
  return afetadas.length;
}