import { estoqueApi } from '@/api/estoqueClient';


export function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}


export async function saldosDoProduto(produtoId) {
  if (!produtoId) return [];
  return estoqueApi.listarSaldos({
    produto_id: produtoId,
  });
}


export function totalFisico(saldos = []) {
  return (saldos || []).reduce(
    (soma, saldo) =>
      soma + numero(saldo.quantidade),
    0
  );
}


export function totalDisponivel(saldos = []) {
  return (saldos || []).reduce(
    (soma, saldo) =>
      soma + numero(
        saldo.quantidade_disponivel
      ),
    0
  );
}


export async function sincronizarProdutoLocal(
  produto
) {
  if (!produto?.id) return produto;

  const saldos = await saldosDoProduto(
    produto.id
  );

  produto.quantidade = totalFisico(
    saldos
  );

  return produto;
}


export async function construirItensSaida({
  produto,
  quantidadeBase,
  depositoId = '',
  gavetaId = '',
  somenteDeposito = false,
  somenteGaveta = false,
  observacao = '',
}) {
  if (!produto?.id) {
    throw new Error(
      'PRODUTO_NAO_ENCONTRADO'
    );
  }

  const quantidade =
    numero(quantidadeBase);

  if (!(quantidade > 0)) {
    throw new Error(
      'Quantidade inválida.'
    );
  }

  const saldos =
    await saldosDoProduto(
      produto.id
    );

  let candidatos = (saldos || [])
    .filter(
      (saldo) =>
        (saldo.tipo_estoque || 'livre')
          === 'livre' &&
        numero(
          saldo.quantidade_disponivel
        ) > 0
    );

  if (
    somenteDeposito &&
    depositoId
  ) {
    candidatos = candidatos.filter(
      (saldo) =>
        saldo.deposito_id
          === depositoId
    );
  }

  if (somenteGaveta) {
    candidatos = candidatos.filter(
      (saldo) =>
        (saldo.gaveta_id || '')
          === (gavetaId || '')
    );
  }

  const grupos = new Map();

  for (const saldo of candidatos) {
    const dep = saldo.deposito_id || '';
    const gav = saldo.gaveta_id || '';
    const chave = `${dep}::${gav}`;

    if (!grupos.has(chave)) {
      grupos.set(chave, {
        deposito_id: dep,
        gaveta_id: gav,
        disponivel: 0,
      });
    }

    grupos.get(chave).disponivel +=
      numero(
        saldo.quantidade_disponivel
      );
  }

  const posicoes =
    [...grupos.values()]
      .sort((a, b) => {
        const score = (posicao) => {
          if (
            depositoId &&
            posicao.deposito_id
              === depositoId &&
            (posicao.gaveta_id || '')
              === (gavetaId || '')
          ) {
            return 0;
          }

          if (
            depositoId &&
            posicao.deposito_id
              === depositoId
          ) {
            return 1;
          }

          if (
            gavetaId &&
            (posicao.gaveta_id || '')
              === gavetaId
          ) {
            return 2;
          }

          return 3;
        };

        return score(a) - score(b);
      });

  const disponivel =
    posicoes.reduce(
      (soma, posicao) =>
        soma + posicao.disponivel,
      0
    );

  if (disponivel + 0.0005 < quantidade) {
    return {
      itens: [],
      totalDisponivel: disponivel,
      suficiente: false,
      saldos,
    };
  }

  let restante = quantidade;
  const itens = [];

  for (const posicao of posicoes) {
    if (restante <= 0.0005) {
      break;
    }

    const consumir = Math.min(
      restante,
      posicao.disponivel
    );

    if (consumir <= 0) {
      continue;
    }

    itens.push({
      produto_id: produto.id,
      quantidade: consumir,
      unidade: produto.unidade || 'un',
      deposito_origem_id:
        posicao.deposito_id,
      gaveta_origem_id:
        posicao.gaveta_id || '',
      observacao: observacao || undefined,
    });

    restante =
      Math.max(
        0,
        restante - consumir
      );
  }

  return {
    itens,
    totalDisponivel: disponivel,
    suficiente:
      restante <= 0.0005,
    saldos,
  };
}


export function documentoIdDaMovimentacao(
  mov
) {
  if (mov?.documento_id) {
    return String(
      mov.documento_id
    );
  }

  if (mov?.id) {
    return String(mov.id)
      .split(':')[0];
  }

  return '';
}


export async function buscarDocumentoAtivoPorOrigem({
  origemModulo,
  documentoOrigemId,
  tipoMovimento,
}) {
  if (
    !origemModulo ||
    !documentoOrigemId
  ) {
    return null;
  }

  const documentos =
    await estoqueApi.buscarDocumentos({
      origem_modulo: origemModulo,
      documento_origem_id:
        documentoOrigemId,
      tipo_movimento:
        tipoMovimento || undefined,
      status: 'contabilizado',
      limit: 20,
    });

  return documentos?.[0] || null;
}


export async function estornarDocumentoAtivoPorOrigem({
  origemModulo,
  documentoOrigemId,
  tipoMovimento,
  motivo,
}) {
  const documento =
    await buscarDocumentoAtivoPorOrigem({
      origemModulo,
      documentoOrigemId,
      tipoMovimento,
    });

  if (!documento) {
    return null;
  }

  const resposta =
    await estoqueApi.estornarDocumento(
      documento.id,
      motivo ||
        `Estorno de ${documento.numero}`
    );

  return resposta?.documento || null;
}