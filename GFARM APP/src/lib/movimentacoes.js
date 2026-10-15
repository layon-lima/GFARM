import { estoqueApi } from '@/api/estoqueClient';
import { parseQtd } from '@/lib/format';
import {
  construirItensSaida,
  documentoIdDaMovimentacao,
  sincronizarProdutoLocal,
} from '@/lib/estoqueOperacoes';


const SUBTIPOS_ENTRADA = new Set([
  'ENTRADA_COMPRA',
  'DEVOLUCAO_ENTRADA',
  'AJUSTE_POSITIVO',
  'ENTRADA_SALDO_ADMIN',
]);


const SUBTIPOS_SAIDA = new Set([
  'SAIDA_CONSUMO',
  'DEVOLUCAO_SAIDA',
  'AJUSTE_NEGATIVO',
]);


export function maxNumeroMovimento(listaMovs) {
  let max = 0;

  for (const mov of listaMovs || []) {
    const match = String(
      mov?.numero || ''
    ).match(/(\d+)\s*$/);

    if (match) {
      max = Math.max(
        max,
        parseInt(match[1], 10)
      );
    }
  }

  return max;
}


export function formatarNumeroMov(n) {
  return `MOV-${String(n).padStart(6, '0')}`;
}


export async function liberarGavetaSeZerado() {
  // O cadastro do produto guarda apenas um local padrão.
  // O motor ERP é o único responsável pelo saldo físico.
  return undefined;
}


export async function reverterEstoqueMov(
  mov,
  { produtos = [] } = {}
) {
  const documentoId =
    documentoIdDaMovimentacao(mov);

  if (!documentoId) {
    throw new Error(
      'ESTORNO_NAO_EXISTE'
    );
  }

  const resposta =
    await estoqueApi.estornarDocumento(
      documentoId,
      `Estorno de ${mov?.numero || documentoId}`
    );

  const produto =
    (produtos || []).find(
      (item) =>
        item.id === mov?.produto_id
    );

  if (produto) {
    await sincronizarProdutoLocal(
      produto
    );
  }

  if (mov) {
    mov.estornada = true;
  }

  return resposta?.documento;
}


export async function registrarMovimentacao({
  form,
  produto,
  controlaValidade,
}) {
  const qtd = parseQtd(
    form.quantidade
  );

  if (!(qtd > 0)) {
    throw new Error(
      'Quantidade inválida.'
    );
  }

  const depositoId =
    form.deposito_id ||
    produto?.deposito_id ||
    '';

  const gavetaId =
    form.gaveta_id ||
    produto?.gaveta_id ||
    '';

  if (!depositoId) {
    throw new Error(
      'DEPOSITO_OBRIGATORIO'
    );
  }

  if (
    form.tipo === 'entrada' &&
    controlaValidade &&
    !form.data_validade
  ) {
    throw new Error(
      'VALIDADE_OBRIGATORIA'
    );
  }

  const chaveAcesso =
    String(
      form.chave_acesso || ''
    ).trim();

  const subtipoEntrada =
    SUBTIPOS_ENTRADA.has(
      form.subtipo
    )
      ? form.subtipo
      : (
          chaveAcesso
          || form.numero_nf
            ? 'ENTRADA_COMPRA'
            : 'AJUSTE_POSITIVO'
        );

  const subtipoSaida =
    SUBTIPOS_SAIDA.has(
      form.subtipo
    )
      ? form.subtipo
      : 'SAIDA_CONSUMO';


  if (
    form.tipo === 'entrada'
    && subtipoEntrada === 'ENTRADA_COMPRA'
    && chaveAcesso
  ) {
    const existentes =
      await estoqueApi.buscarDocumentos({
        origem_modulo: 'nfe_manual',
        referencia_externa:
          chaveAcesso,
        tipo_movimento:
          'ENTRADA_COMPRA',
        status: 'contabilizado',
        limit: 10,
      });

    if (existentes.length > 0) {
      throw new Error(
        'NF_DUPLICADA'
      );
    }
  }

  let tipoMovimento;
  let itens;

  if (form.tipo === 'entrada') {
    tipoMovimento =
      subtipoEntrada;

    itens = [
      {
        produto_id: produto.id,
        quantidade: qtd,
        unidade:
          produto.unidade || 'un',
        deposito_destino_id:
          depositoId,
        gaveta_destino_id:
          gavetaId,
        custo_unitario:
          Number(
            form.custo_unitario ??
            produto.custo_unitario ??
            0
          ) || 0,
        data_validade:
          form.data_validade ||
          undefined,
        observacao:
          form.observacao ||
          undefined,
      },
    ];
  } else {
    tipoMovimento =
      subtipoSaida;

    const alocacao =
      await construirItensSaida({
        produto,
        quantidadeBase: qtd,
        depositoId,
        gavetaId,
        somenteDeposito: true,
        somenteGaveta: true,
        observacao:
          form.observacao || '',
      });

    if (!alocacao.suficiente) {
      throw new Error(
        `SALDO_INSUFICIENTE:${alocacao.totalDisponivel}`
      );
    }

    itens = alocacao.itens;
  }

  const movimentoFiscal =
    form.tipo === 'entrada'
    && tipoMovimento === 'ENTRADA_COMPRA'
    && (
      chaveAcesso
      || form.numero_nf
    );


  const origemModulo =
    movimentoFiscal
      ? 'nfe_manual'
      : (
          form.modulo ||
          'movimentacoes'
        );

  const documentoOrigemId =
    (
      movimentoFiscal
        ? chaveAcesso
        : form.documento_origem_id
    )
    || null;

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        tipoMovimento,
      origem_modulo:
        origemModulo,
      documento_origem_id:
        documentoOrigemId,
      referencia_externa:
        (
          movimentoFiscal
            ? (
                chaveAcesso
                || form.numero_nf
              )
            : (
                form.referencia_externa
                || undefined
              )
        ),
      observacao:
        form.observacao ||
        undefined,
      itens,
    });

  await sincronizarProdutoLocal(
    produto
  );

  return {
    produto,
    documento:
      resposta.documento,
  };
}


export async function registrarTransferencia({
  form,
  produto,
}) {
  const qtd = parseQtd(
    form.quantidade
  );

  if (!(qtd > 0)) {
    throw new Error(
      'Quantidade inválida.'
    );
  }

  if (
    !form.deposito_origem_id ||
    !form.deposito_destino_id
  ) {
    throw new Error(
      'DEPOSITO_OBRIGATORIO'
    );
  }

  const origem =
    await construirItensSaida({
      produto,
      quantidadeBase: qtd,
      depositoId:
        form.deposito_origem_id,
      gavetaId:
        form.gaveta_origem_id || '',
      somenteDeposito: true,
      somenteGaveta: true,
      observacao:
        form.observacao || '',
    });

  if (!origem.suficiente) {
    throw new Error(
      `SALDO_INSUFICIENTE:${origem.totalDisponivel}`
    );
  }

  const itens =
    origem.itens.map(
      (item) => ({
        ...item,
        deposito_destino_id:
          form.deposito_destino_id,
        gaveta_destino_id:
          form.gaveta_destino_id || '',
      })
    );

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        'TRANSFERENCIA',
      origem_modulo:
        'movimentacoes',
      observacao:
        form.observacao ||
        'Transferência interna',
      itens,
    });

  await sincronizarProdutoLocal(
    produto
  );

  return {
    produto,
    documento:
      resposta.documento,
  };
}


export async function relocarSaldoCadastro() {
  // Regra atual:
  // alterar o cadastro do produto NÃO movimenta estoque.
  return {
    movido: false,
    quantidade: 0,
  };
}


export async function estornarMovimentacao(
  mov,
  contexto = {}
) {
  if (!mov || !mov.id) {
    throw new Error(
      'ESTORNO_NAO_EXISTE'
    );
  }

  if (mov.tipo === 'estorno') {
    throw new Error(
      'ESTORNO_TIPO_ESTORNO'
    );
  }

  if (mov.estornada === true) {
    throw new Error(
      'ESTORNO_JA_ESTORNADA'
    );
  }

  return reverterEstoqueMov(
    mov,
    contexto
  );
}