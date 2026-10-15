function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseNumeroFiltro(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function asArr(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function getCustoAtualProduto(
  produto,
  saldos = []
) {
  const posicoes = (saldos || []).filter(
    (saldo) =>
      saldo.produto_id === produto?.id
  );

  const quantidade = posicoes.reduce(
    (total, saldo) =>
      total +
      (Number(saldo.quantidade) || 0),
    0
  );

  if (quantidade > 0) {
    const valor = posicoes.reduce(
      (total, saldo) => {
        const qtd =
          Number(saldo.quantidade) || 0;

        const valorSaldo =
          Number(saldo.valor_total);

        if (
          Number.isFinite(valorSaldo)
          && valorSaldo !== 0
        ) {
          return total + valorSaldo;
        }

        return (
          total +
          qtd *
            (Number(saldo.custo_medio) || 0)
        );
      },
      0
    );

    return valor / quantidade;
  }

  return Number(
    produto?.custo_unitario
  ) || 0;
}

export function getQtdNoDeposito(
  produtoId,
  depositoId,
  gavetaId = '',
  saldos = []
) {
  if (!depositoId) return 0;

  return (saldos || [])
    .filter(
      (s) =>
        s.produto_id === produtoId &&
        s.deposito_id === depositoId &&
        (!gavetaId || (s.gaveta_id || '') === gavetaId)
    )
    .reduce((sum, s) => sum + (Number(s.quantidade) || 0), 0);
}

export function getStatusEstoque(qtd, media) {
  const quantidade = Number(qtd) || 0;

  if (quantidade <= 0) return 'ZERADO';
  if (quantidade >= media) return 'ALTO';
  return 'BAIXO';
}

export function filterProdutos(produtos, filtros, saldos = []) {
  const setorFilter = asArr(filtros.setor_id);
  const depFilter = asArr(filtros.deposito_id);
  const gavFilter = asArr(filtros.gaveta_id);
  const maqFilter = asArr(filtros.maquina_id);
  const unidadeFilter = asArr(filtros.unidade);

  const codigo = normalizeText(filtros.codigo);
  const referencia = normalizeText(filtros.referencia);

  const qtdMin = parseNumeroFiltro(filtros.quantidade_min);
  const qtdMax = parseNumeroFiltro(filtros.quantidade_max);
  const valorUnitMin = parseNumeroFiltro(filtros.valor_unit_min);
  const valorUnitMax = parseNumeroFiltro(filtros.valor_unit_max);
  const valorTotalMin = parseNumeroFiltro(filtros.valor_total_min);
  const valorTotalMax = parseNumeroFiltro(filtros.valor_total_max);

  let base = [...(produtos || [])];

  if (setorFilter.length) {
    base = base.filter((p) => setorFilter.includes(p.setor_id));
  }

  if (maqFilter.length) {
    base = base.filter((p) => maqFilter.includes(p.maquina_id));
  }

  if (unidadeFilter.length) {
    base = base.filter((p) => unidadeFilter.includes(p.unidade));
  }

  if (codigo) {
    base = base.filter((p) =>
      normalizeText(p.codigo).includes(codigo)
    );
  }

  if (referencia) {
    base = base.filter((p) =>
      normalizeText(p.codigo_referencia).includes(referencia)
    );
  }

  const temSaldos = (saldos || []).length > 0;
  const filtraPosicao = depFilter.length > 0 || gavFilter.length > 0;

  let rows = [];

  for (const produto of base) {
    const posicoes = temSaldos
      ? (saldos || []).filter((s) => s.produto_id === produto.id)
      : [];

    const custoAtual =
      getCustoAtualProduto(
        produto,
        saldos
      );

    if (filtraPosicao) {
      const filtradas = posicoes.filter((s) => {
        if (depFilter.length && !depFilter.includes(s.deposito_id)) {
          return false;
        }

        if (gavFilter.length && !gavFilter.includes(s.gaveta_id || '')) {
          return false;
        }

        return true;
      });

      if (filtradas.length > 0) {
        for (const saldo of filtradas) {
          rows.push({
            ...produto,
            quantidade: Number(saldo.quantidade) || 0,
            quantidade_reservada: Number(saldo.quantidade_reservada) || 0,
            quantidade_disponivel:
              saldo.quantidade_disponivel !== undefined
                ? Number(saldo.quantidade_disponivel) || 0
                : (Number(saldo.quantidade) || 0) -
                  (Number(saldo.quantidade_reservada) || 0),
            custo_unitario: custoAtual,
            custo_medio: custoAtual,
            valor_total:
              (Number(saldo.quantidade) || 0) *
              custoAtual,
            tipo_estoque: saldo.tipo_estoque || 'livre',
            deposito_id: saldo.deposito_id || produto.deposito_id || '',
            gaveta_id: saldo.gaveta_id || '',
            lote_id: saldo.lote_id || '',
            _deposito_ids: unique([saldo.deposito_id]),
            _gaveta_ids: unique([saldo.gaveta_id]),
            _lote_ids: unique([saldo.lote_id]),
            _rowKey: `${produto.id}:${saldo.id || ''}`,
          });
        }
      } else if (
        !temSaldos &&
        (!depFilter.length || depFilter.includes(produto.deposito_id)) &&
        (!gavFilter.length || gavFilter.includes(produto.gaveta_id))
      ) {
        rows.push({
          ...produto,
          quantidade: Number(produto.quantidade) || 0,
          _deposito_ids: unique([produto.deposito_id]),
          _gaveta_ids: unique([produto.gaveta_id]),
          _lote_ids: [],
          custo_unitario: custoAtual,
        _rowKey: `${produto.id}:LEGACY`,
        });
      }

      continue;
    }

    if (temSaldos) {
      const quantidade = posicoes.reduce(
        (sum, s) => sum + (Number(s.quantidade) || 0),
        0
      );
      const reservada = posicoes.reduce(
        (sum, s) => sum + (Number(s.quantidade_reservada) || 0),
        0
      );
      const disponivel = posicoes.reduce(
        (sum, s) =>
          sum +
          (
            s.quantidade_disponivel !== undefined
              ? Number(s.quantidade_disponivel) || 0
              : (Number(s.quantidade) || 0) -
                (Number(s.quantidade_reservada) || 0)
          ),
        0
      );
      const valorTotal =
        quantidade * custoAtual;

      rows.push({
        ...produto,
        custo_unitario: custoAtual,
        quantidade,
        quantidade_reservada: reservada,
        quantidade_disponivel: disponivel,
        custo_medio: custoAtual,
        valor_total: valorTotal,
        _deposito_ids: unique(posicoes.map((s) => s.deposito_id)),
        _gaveta_ids: unique(posicoes.map((s) => s.gaveta_id)),
        _lote_ids: unique(posicoes.map((s) => s.lote_id)),
        _rowKey: `${produto.id}:TOTAL`,
      });
    } else {
      rows.push({
        ...produto,
        quantidade: Number(produto.quantidade) || 0,
        _deposito_ids: unique([produto.deposito_id]),
        _gaveta_ids: unique([produto.gaveta_id]),
        _lote_ids: [],
        _rowKey: `${produto.id}:LEGACY`,
      });
    }
  }

  if (qtdMin !== null) {
    rows = rows.filter((p) => (Number(p.quantidade) || 0) >= qtdMin);
  }

  if (qtdMax !== null) {
    rows = rows.filter((p) => (Number(p.quantidade) || 0) <= qtdMax);
  }

  if (valorUnitMin !== null || valorUnitMax !== null) {
    rows = rows.filter((p) => {
      const value =
        Number(p.custo_unitario) || 0;

      if (valorUnitMin !== null && value < valorUnitMin) return false;
      if (valorUnitMax !== null && value > valorUnitMax) return false;
      return true;
    });
  }

  if (valorTotalMin !== null || valorTotalMax !== null) {
    rows = rows.filter((p) => {
      const unit =
        Number(p.custo_unitario) || 0;

      const value =
        (Number(p.quantidade) || 0) * unit;

      if (valorTotalMin !== null && value < valorTotalMin) return false;
      if (valorTotalMax !== null && value > valorTotalMax) return false;
      return true;
    });
  }

  if (filtros.estoque) {
    const positivos = rows.filter((p) => (Number(p.quantidade) || 0) > 0);
    const media =
      positivos.reduce(
        (sum, p) => sum + (Number(p.quantidade) || 0),
        0
      ) / (positivos.length || 1);

    rows = rows.filter(
      (p) =>
        getStatusEstoque(p.quantidade, media) === filtros.estoque
    );
  }

  return rows;
}

export function getNome(id, lista, field = 'nome') {
  const item = lista?.find((i) => i.id === id);
  return item?.[field] || '—';
}

function collectRelatedText(
  produto,
  maquinas,
  gavetas,
  depositos,
  saldos,
  setores,
  lotes
) {
  const maquina = maquinas?.find((m) => m.id === produto.maquina_id);
  const setor = setores?.find((s) => s.id === produto.setor_id);

  const depIds = produto._deposito_ids?.length
    ? produto._deposito_ids
    : unique([
        produto.deposito_id,
        ...(saldos || [])
          .filter((s) => s.produto_id === produto.id)
          .map((s) => s.deposito_id),
      ]);

  const gavIds = produto._gaveta_ids?.length
    ? produto._gaveta_ids
    : unique([
        produto.gaveta_id,
        ...(saldos || [])
          .filter((s) => s.produto_id === produto.id)
          .map((s) => s.gaveta_id),
      ]);

  const loteIds = produto._lote_ids?.length
    ? produto._lote_ids
    : unique([
        produto.lote_id,
        ...(saldos || [])
          .filter((s) => s.produto_id === produto.id)
          .map((s) => s.lote_id),
      ]);

  const deps = depIds
    .map((id) => depositos?.find((d) => d.id === id))
    .filter(Boolean);

  const gavs = gavIds
    .map((id) => gavetas?.find((g) => g.id === id))
    .filter(Boolean);

  const lotesRelacionados = loteIds
    .map((id) => lotes?.find((l) => l.id === id))
    .filter(Boolean);

  const related = [
    setor?.nome,
    setor?.descricao,
    maquina?.codigo,
    maquina?.nome,
    maquina?.descricao,
    ...deps.flatMap((d) => [d.numero, d.nome, d.descricao]),
    ...gavs.flatMap((g) => [g.codigo, g.descricao]),
    ...lotesRelacionados.flatMap((l) => [
      l.codigo_lote,
      l.codigo_referencia,
      l.data_validade,
      l.tipo_estoque,
    ]),
  ];

  return related.filter((value) => value !== null && value !== undefined);
}

export function matchTerm(
  produto,
  termo,
  maquinas,
  gavetas,
  depositos,
  saldos = [],
  setores = [],
  lotes = []
) {
  const t = normalizeText(termo);
  if (!t) return false;

  const related = collectRelatedText(
    produto,
    maquinas,
    gavetas,
    depositos,
    saldos,
    setores,
    lotes
  );

  const rawValues = Object.entries(produto || {})
    .filter(([key, value]) => {
      if (key.startsWith('_')) return false;
      return ['string', 'number', 'boolean'].includes(typeof value);
    })
    .flatMap(([, value]) => {
      const normal = String(value);
      const comma =
        typeof value === 'number'
          ? String(value).replace('.', ',')
          : normal;

      return [normal, comma];
    });

  const blob = normalizeText(
    [...rawValues, ...related]
      .filter((value) => value !== null && value !== undefined)
      .join(' | ')
  );

  if (t.startsWith('deposito ') || t.startsWith('depósito ')) {
    const rest = normalizeText(t.replace(/^dep[oó]sito\s*/, ''));
    const depBlob = normalizeText(
      collectRelatedText(
        produto,
        [],
        [],
        depositos,
        saldos,
        [],
        []
      ).join(' | ')
    );
    return depBlob.includes(rest);
  }

  if (t.startsWith('gaveta ')) {
    const rest = normalizeText(t.replace(/^gaveta\s*/, ''));
    const gavBlob = normalizeText(
      collectRelatedText(
        produto,
        [],
        gavetas,
        [],
        saldos,
        [],
        []
      ).join(' | ')
    );
    return gavBlob.includes(rest);
  }

  return blob.includes(t);
}

export function getEstoqueStatus(produto, avg) {
  return getStatusEstoque(produto?.quantidade || 0, avg).toLowerCase();
}
