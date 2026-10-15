// Cache central das entidades: navegação instantânea + tempo real + pré-carga no login.
// Substitui os useEffect + .list() manuais das telas por um único hook reativo.
import { useEffect, useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '@/api/apiClient';
import { queryClientInstance } from '@/lib/query-client';
// Ordem/limite padrão de cada entidade (espelha o que as telas já usavam).
export const DEFAULTS = {
  Produto: {},
  Setor: {},
  Maquina: {},
  Gaveta: {},
  Lote: {},
  Deposito: {},
  SaldoEstoque: {},
  Pessoa: { sort: '-created_date', limit: 500 },
  Movimentacao: { sort: '-data', limit: 100 },
  Abastecimento: { sort: '-data', limit: 200 },
  Inventario: { sort: '-data', limit: 200 },
  PedidoPesagem: { sort: '-created_date', limit: 500 },
  TicketPesagem: { sort: '-data_abertura', limit: 500 },
  User: {},
  InventarioItem: {},
  Cultura: {},
  Lavoura: {},
  OrdemServicoAplicacao: { sort: '-data', limit: 500 },
};

// Entidades pré-carregadas já no login (as mais usadas entre telas).
export const PREFETCH = [
  'Produto', 'Setor', 'Maquina', 'Gaveta', 'Lote',
  'Pessoa', 'PedidoPesagem', 'TicketPesagem', 'Movimentacao', 'Deposito', 'SaldoEstoque',
];


const PREFETCH_PAGES = {
  Produto: [
    'dashboard', 'movimentacoes', 'abastecimento',
    'pesagem', 'aplicacao', 'cadastros', 'inventario',
  ],
  Setor: [
    'dashboard', 'movimentacoes', 'abastecimento',
    'aplicacao', 'cadastros', 'inventario',
  ],
  Maquina: [
    'dashboard', 'movimentacoes', 'abastecimento',
    'cadastros', 'inventario',
  ],
  Gaveta: [
    'dashboard', 'movimentacoes', 'cadastros', 'inventario',
  ],
  Lote: [
    'dashboard', 'movimentacoes', 'abastecimento',
    'aplicacao', 'cadastros', 'inventario',
  ],
  Pessoa: [
    'movimentacoes', 'pesagem', 'cadastros',
  ],
  PedidoPesagem: [
    'pesagem',
  ],
  TicketPesagem: [
    'pesagem',
  ],
  Movimentacao: [
    'movimentacoes', 'abastecimento', 'aplicacao',
  ],
  Deposito: [
    'dashboard', 'movimentacoes', 'abastecimento',
    'aplicacao', 'cadastros', 'inventario',
  ],
  SaldoEstoque: [
    'dashboard', 'movimentacoes', 'abastecimento',
    'pesagem', 'aplicacao', 'cadastros', 'inventario',
  ],
};

const MOBILE_PREFETCH = new Set([
  'Produto',
  'Setor',
  'Maquina',
  'Gaveta',
  'Lote',
  'Pessoa',
  'Movimentacao',
  'Deposito',
  'SaldoEstoque',
]);

function podePrefetch(user, name) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const paginas = user.paginas_permitidas;

  if (!Array.isArray(paginas)) {
    return true;
  }

  const necessarias =
    PREFETCH_PAGES[name] || [];

  if (
    necessarias.some(
      (pagina) =>
        paginas.includes(pagina)
    )
  ) {
    return true;
  }

  const setores =
    user.setores_permitidos;

  return (
    MOBILE_PREFETCH.has(name)
    && Array.isArray(setores)
    && setores.length > 0
  );
}

export const keyOf = (name, opts = {}) => ['ent', name, opts.sort ?? null, opts.limit ?? null];

const subscribed = new Set();
function ensureSubscribe(name) {
  if (subscribed.has(name)) return;
  const entity = api.entities[name];
  if (!entity || typeof entity.subscribe !== 'function') return;
  try {
    entity.subscribe(() => {
      queryClientInstance.invalidateQueries({ queryKey: ['ent', name] });
    });
    // só marca como assinada se o subscribe realmente funcionou —
    // em caso de falha, uma próxima chamada tentará de novo (websocket pode ter caído).
    subscribed.add(name);
  } catch {
    // falhas de subscribe não derrubam o app — o cache + refetch cobrem.
    // Não adiciona ao Set, permitindo nova tentativa depois.
  }
}

function fetcher(name, opts) {
  return async () => {
    const entity = api.entities[name];
    if (!entity) return [];
    const { sort, limit } = opts;
    if (sort && limit != null) return entity.list(sort, limit);
    if (sort) return entity.list(sort);
    return entity.list();
  };
}

/**
 * Hook de cache multi-entidade.
 * @param {Record<string, {sort?:string, limit?:number}>} config
 * @returns {{ data: Record<string, any[]>, loading: boolean, reload: () => void }}
 */
export function useEntidades(config = {}) {
  const names = Object.keys(config);
  const resolved = names.map((n) => ({ name: n, opts: { ...DEFAULTS[n], ...config[n] } }));

  const queries = useQueries({
    queries: resolved.map(({ name, opts }) => ({
      queryKey: keyOf(name, opts),
      queryFn: fetcher(name, opts),
      staleTime: 0,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      enabled: !!api.entities[name],
    })),
  });

  useEffect(() => {
    names.forEach(ensureSubscribe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join('|')]);

  const data = {};
  let loading = false;
  resolved.forEach(({ name, opts }, i) => {
    const r = queries[i];
    data[name] = r.data || [];
    if (r.isLoading) loading = true;
  });

  const reload = useCallback(() => {
    resolved.forEach(({ name }) => {
      queryClientInstance.invalidateQueries({ queryKey: ['ent', name] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join('|')]);

  return { data, loading, reload };
}

/** Pré-carrega as entidades principais em paralelo (chamar após o login). */
export function prefetchEntidades(user) {
  PREFETCH
    .filter(
      (name) =>
        podePrefetch(user, name)
    )
    .forEach((name) => {
      const opts = DEFAULTS[name];

      queryClientInstance.prefetchQuery({
        queryKey: keyOf(name, opts),
        queryFn: fetcher(name, opts),
        staleTime: 60_000,
      });

      ensureSubscribe(name);
    });
}

/** Invalida o cache de uma entidade após mutações locais. */
export function invalidateEntidade(name) {
  return queryClientInstance.invalidateQueries({ queryKey: ['ent', name] });
}

// Entidades que compõem o "estoque" — afetadas por qualquer movimentação.
const STOCK_ENTITIES = ['SaldoEstoque', 'Movimentacao', 'Produto', 'Lote', 'Abastecimento'];

/** Invalida globalmente o cache de todas as entidades de estoque.
 *  Chamar após qualquer mutação que altere saldo, para que TODAS as telas
 *  (Dashboard, Relatórios, Movimentações, Abastecimento…) refetchem imediatamente,
 *  independentemente do websocket em tempo real. */
export function invalidateEstoque() {
  for (const name of STOCK_ENTITIES) {
    queryClientInstance.invalidateQueries({ queryKey: ['ent', name] });
  }
}