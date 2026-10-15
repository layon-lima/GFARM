import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { PackageSearch } from 'lucide-react';
import FilterBar from '@/components/FilterBar';
import ProductsTable from '@/components/ProductsTable';
import SearchBar from '@/components/SearchBar';
import { useEntidades } from '@/lib/useEntidades';
import { filterProdutos, matchTerm } from '@/lib/estoqueFilters';

const FILTROS_INICIAIS = {
  setor_id: [],
  estoque: '',
  deposito_id: [],
  maquina_id: [],
  gaveta_id: [],
  unidade: [],
  codigo: '',
  referencia: '',
  quantidade_min: '',
  quantidade_max: '',
  valor_unit_min: '',
  valor_unit_max: '',
  valor_total_min: '',
  valor_total_max: '',
};

export default function Dashboard() {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [busca, setBusca] = useState('');

  const { data, loading } = useEntidades({
    Produto: {},
    Setor: {},
    Maquina: {},
    Gaveta: {},
    Deposito: {},
    Lote: {},
    SaldoEstoque: {},
  });

  const {
    Produto: produtos = [],
    Setor: setores = [],
    Maquina: maquinas = [],
    Gaveta: gavetas = [],
    Deposito: depositos = [],
    Lote: lotes = [],
    SaldoEstoque: saldos = [],
  } = data;

  const porFiltros = useMemo(
    () => filterProdutos(produtos, filtros, saldos),
    [produtos, filtros, saldos]
  );

  const filtered = useMemo(() => {
    const termos = busca
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (termos.length === 0) return porFiltros;

    return porFiltros.filter((produto) =>
      termos.every((termo) =>
        matchTerm(
          produto,
          termo,
          maquinas,
          gavetas,
          depositos,
          saldos,
          setores,
          lotes
        )
      )
    );
  }, [
    porFiltros,
    busca,
    maquinas,
    gavetas,
    depositos,
    saldos,
    setores,
    lotes,
  ]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-3 px-3 py-3 lg:px-4 xl:px-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <PackageSearch className="h-5 w-5" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
              Consulta de estoque
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
            Pesquisa de Estoque
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte produtos por qualquer informação cadastrada ou refine a busca com filtros sob demanda.
          </p>
        </div>

        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{filtered.length}</span>{' '}
          resultado(s)
        </div>
      </header>

      <Card className="rounded-2xl border p-3 shadow-none">
        <SearchBar
          value={busca}
          onChange={setBusca}
          produtos={porFiltros}
          maquinas={maquinas}
          gavetas={gavetas}
          depositos={depositos}
          saldos={saldos}
          setores={setores}
          lotes={lotes}
        />
      </Card>

      <FilterBar
        filtros={filtros}
        setFiltros={setFiltros}
        setores={setores}
        maquinas={maquinas}
        gavetas={gavetas}
        depositos={depositos}
        produtos={produtos}
      />

      <Card className="overflow-hidden rounded-2xl border shadow-none">
        <div className="flex flex-col gap-1 border-b bg-muted/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Produtos encontrados</h2>
            <p className="text-xs text-muted-foreground">
              A lista respeita a busca global e somente os filtros que você escolheu usar.
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {filtered.length} produto(s)
          </span>
        </div>

        <div className="p-3">
          <ProductsTable
            produtos={filtered}
            setores={setores}
            maquinas={maquinas}
            gavetas={gavetas}
            depositos={depositos}
          />
        </div>
      </Card>
    </div>
  );
}
