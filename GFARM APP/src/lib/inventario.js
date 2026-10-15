import { estoqueApi } from '@/api/estoqueClient';
import { parseQtd } from '@/lib/format';
import { construirItensSaida } from '@/lib/estoqueOperacoes';
import { invalidateEntidade } from '@/lib/useEntidades';

export function nextInventarioNumber(inventarios = []) {
  let max = 0;
  inventarios.forEach((i) => {
    const m = String(i.numero || '').match(/INV-(\d+)/i);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  });
  return `INV-${String(max + 1).padStart(6, '0')}`;
}

export function parseInventarioCriterios(inventario) {
  if (!inventario?.criterios) {
    return {
      deposito_id: '',
      setor_id: inventario?.setor_id || '',
      gaveta_id: '',
      maquina_id: '',
    };
  }

  try {
    const parsed = JSON.parse(inventario.criterios);
    return {
      deposito_id: parsed?.deposito_id || '',
      setor_id: parsed?.setor_id || inventario?.setor_id || '',
      gaveta_id: parsed?.gaveta_id || '',
      maquina_id: parsed?.maquina_id || '',
    };
  } catch {
    return {
      deposito_id: '',
      setor_id: inventario?.setor_id || '',
      gaveta_id: '',
      maquina_id: '',
    };
  }
}

export function criteriosKey(criterios = {}) {
  return JSON.stringify({
    deposito_id: criterios.deposito_id || '',
    setor_id: criterios.setor_id || '',
    gaveta_id: criterios.gaveta_id || '',
    maquina_id: criterios.maquina_id || '',
  });
}

function saldoPertenceAoEscopo(saldo, criterios = {}) {
  if (!saldo) return false;
  if ((saldo.tipo_estoque || 'livre') !== 'livre') return false;
  if (criterios.deposito_id && saldo.deposito_id !== criterios.deposito_id) return false;
  if (criterios.gaveta_id && (saldo.gaveta_id || '') !== criterios.gaveta_id) return false;
  return true;
}

export function filterProdutosParaInventario(produtos = [], saldos = [], criterios = {}) {
  if (!criterios.deposito_id) return [];

  const idsComSaldo = new Set(
    (saldos || [])
      .filter((saldo) => saldoPertenceAoEscopo(saldo, criterios))
      .map((saldo) => saldo.produto_id)
      .filter(Boolean)
  );

  return (produtos || [])
    .filter((produto) => {
      const pertenceAoDeposito =
        produto.deposito_id === criterios.deposito_id || idsComSaldo.has(produto.id);

      if (!pertenceAoDeposito) return false;
      if (criterios.setor_id && produto.setor_id !== criterios.setor_id) return false;
      if (criterios.maquina_id && produto.maquina_id !== criterios.maquina_id) return false;

      if (criterios.gaveta_id) {
        const saldoNaGaveta = (saldos || []).some(
          (saldo) =>
            saldo.produto_id === produto.id &&
            saldoPertenceAoEscopo(saldo, criterios)
        );
        if (!saldoNaGaveta && (produto.gaveta_id || '') !== criterios.gaveta_id) return false;
      }

      return true;
    })
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

export function qtdSistema(produto, saldos = [], criterios = {}) {
  if (!produto?.id || !criterios.deposito_id) return 0;

  return (saldos || [])
    .filter(
      (saldo) =>
        saldo.produto_id === produto.id &&
        saldoPertenceAoEscopo(saldo, criterios)
    )
    .reduce((acc, saldo) => acc + (Number(saldo.quantidade) || 0), 0);
}

export function buildCriteriosDescricao(
  criterios,
  depositos = [],
  setores = [],
  maquinas = [],
  gavetas = []
) {
  const parts = [];

  if (criterios?.deposito_id) {
    const d = depositos.find((x) => x.id === criterios.deposito_id);
    parts.push(`Depósito: ${d ? (d.nome ? `${d.numero || ''} · ${d.nome}`.trim() : d.numero || '—') : '—'}`);
  }

  if (criterios?.setor_id) {
    const s = setores.find((x) => x.id === criterios.setor_id);
    parts.push(`Setor: ${s?.nome || '—'}`);
  }

  if (criterios?.gaveta_id) {
    const g = gavetas.find((x) => x.id === criterios.gaveta_id);
    parts.push(`Gaveta: ${g?.codigo || '—'}`);
  }

  if (criterios?.maquina_id) {
    const m = maquinas.find((x) => x.id === criterios.maquina_id);
    parts.push(`Máquina: ${m ? `${m.codigo || ''}${m.codigo && m.nome ? ' · ' : ''}${m.nome || ''}` : '—'}`);
  }

  return parts.join(' | ') || 'Escopo não informado';
}

function escolherGavetaDestino({ produto, criterios, livres, depositoId }) {
  if (criterios?.gaveta_id) return criterios.gaveta_id;

  if (produto?.deposito_id === depositoId && produto?.gaveta_id) {
    return produto.gaveta_id;
  }

  const posicaoExistente = (livres || []).find(
    (saldo) => saldo.deposito_id === depositoId && !!saldo.gaveta_id
  );

  return posicaoExistente?.gaveta_id || '';
}

export async function aplicarAjusteInventario({
  inventario,
  itens,
  produtos,
  setores = [],
  criterios,
}) {
  const escopo = criterios || parseInventarioCriterios(inventario);

  if (!escopo.deposito_id) {
    throw new Error('DEPÓSITO_OBRIGATÓRIO:Inventário sem depósito definido.');
  }

  const divergentes = (itens || []).filter(
    (item) => Math.abs(parseQtd(item.divergencia)) > 0.0001
  );

  if (divergentes.length === 0) {
    return { aplicados: 0, total: 0, documentos: [] };
  }

  const positivos = [];
  const negativos = [];
  let aplicados = 0;

  const invLabel = inventario?.numero || '';
  const origemBase = inventario?.id || inventario?.numero;

  if (!origemBase) {
    throw new Error('Inventário sem identificador.');
  }

  for (const item of divergentes) {
    const produto = (produtos || []).find((p) => p.id === item.produto_id);
    if (!produto) continue;

    const diff = parseQtd(item.divergencia);
    const quantidade = Math.abs(diff);
    const depositoId = escopo.deposito_id;

    const saldos = await estoqueApi.listarSaldos({ produto_id: produto.id });
    const livres = (saldos || []).filter(
      (saldo) =>
        (saldo.tipo_estoque || 'livre') === 'livre' &&
        saldo.deposito_id === depositoId
    );

    const gavetaId = escolherGavetaDestino({
      produto,
      criterios: escopo,
      livres,
      depositoId,
    });

    const setorProduto = (setores || []).find((s) => s.id === produto.setor_id);
    const controlaValidade = !!setorProduto?.controla_validade;

    if (diff > 0) {
      let loteId = '';

      if (controlaValidade) {
        const posicaoLote = livres.find(
          (saldo) =>
            (!gavetaId || (saldo.gaveta_id || '') === gavetaId) &&
            !!saldo.lote_id
        );

        loteId = posicaoLote?.lote_id || '';

        if (!loteId) {
          throw new Error(`VALIDADE_OBRIGATORIA:${produto.nome}`);
        }
      }

      positivos.push({
        produto_id: produto.id,
        quantidade,
        unidade: produto.unidade || 'un',
        deposito_destino_id: depositoId,
        gaveta_destino_id: gavetaId,
        lote_destino_id: loteId || undefined,
        custo_unitario: Number(produto.custo_unitario) || 0,
        observacao: `Ajuste de inventário — ${invLabel}`,
      });

      aplicados++;
      continue;
    }

    const alocacao = await construirItensSaida({
      produto,
      quantidadeBase: quantidade,
      depositoId,
      gavetaId: escopo.gaveta_id || '',
      somenteDeposito: true,
      somenteGaveta: !!escopo.gaveta_id,
      observacao: `Ajuste de inventário — ${invLabel}`,
    });

    if (!alocacao.suficiente) {
      throw new Error(`SALDO_INSUFICIENTE:${alocacao.totalDisponivel}:${produto.nome}`);
    }

    negativos.push(...alocacao.itens);
    aplicados++;
  }

  const documentos = [];

  if (positivos.length > 0) {
    const resposta = await estoqueApi.movimentar({
      tipo_movimento: 'AJUSTE_POSITIVO',
      origem_modulo: 'inventario',
      documento_origem_id: `${origemBase}:positivo`,
      referencia_externa: invLabel || undefined,
      observacao: `Ajuste positivo do inventário ${invLabel}`,
      itens: positivos,
    });
    documentos.push(resposta.documento);
  }

  if (negativos.length > 0) {
    const resposta = await estoqueApi.movimentar({
      tipo_movimento: 'AJUSTE_NEGATIVO',
      origem_modulo: 'inventario',
      documento_origem_id: `${origemBase}:negativo`,
      referencia_externa: invLabel || undefined,
      observacao: `Ajuste negativo do inventário ${invLabel}`,
      itens: negativos,
    });
    documentos.push(resposta.documento);
  }

  invalidateEntidade('SaldoEstoque');
  invalidateEntidade('Movimentacao');
  invalidateEntidade('Produto');
  invalidateEntidade('Lote');

  return {
    aplicados,
    total: divergentes.length,
    documentos,
  };
}
