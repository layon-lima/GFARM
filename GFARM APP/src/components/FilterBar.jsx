import { useEffect, useMemo, useState } from 'react';
import {
  Filter, Plus, RotateCcw, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SearchSelect from '@/components/SearchSelect';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';

const STORAGE_KEY = 'pesquisaEstoque:filtrosVisiveis:v1';

const CAMPOS = [
  { key: 'setor_id', label: 'Setor', type: 'multi' },
  { key: 'deposito_id', label: 'Depósito', type: 'multi' },
  { key: 'maquina_id', label: 'Máquina', type: 'multi' },
  { key: 'gaveta_id', label: 'Gaveta', type: 'multi' },
  { key: 'unidade', label: 'Unidade', type: 'multi' },
  { key: 'estoque', label: 'Status do estoque', type: 'single' },
  { key: 'codigo', label: 'Código', type: 'text' },
  { key: 'referencia', label: 'Referência', type: 'text' },
  { key: 'quantidade', label: 'Faixa de quantidade', type: 'range' },
  { key: 'valor_unit', label: 'Faixa de valor unitário', type: 'range' },
  { key: 'valor_total', label: 'Faixa de valor total', type: 'range' },
];

function loadVisible() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function FilterBar({
  filtros,
  setFiltros,
  setores = [],
  maquinas = [],
  gavetas = [],
  depositos = [],
  produtos = [],
}) {
  const [visiveis, setVisiveis] = useState(loadVisible);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visiveis));
    }
  }, [visiveis]);

  const unidades = useMemo(
    () =>
      [...new Set(
        (produtos || [])
          .map((p) => String(p.unidade || '').trim())
          .filter(Boolean)
      )]
        .sort((a, b) => a.localeCompare(b))
        .map((u) => ({ value: u, label: u })),
    [produtos]
  );

  const disponiveis = CAMPOS.filter((campo) => !visiveis.includes(campo.key));

  function addFilter(key) {
    setVisiveis((prev) => [...prev, key]);
    setPickerOpen(false);
  }

  function clearValue(key) {
    if (['setor_id', 'deposito_id', 'maquina_id', 'gaveta_id', 'unidade'].includes(key)) {
      setFiltros((prev) => ({ ...prev, [key]: [] }));
      return;
    }

    if (key === 'quantidade') {
      setFiltros((prev) => ({
        ...prev,
        quantidade_min: '',
        quantidade_max: '',
      }));
      return;
    }

    if (key === 'valor_unit') {
      setFiltros((prev) => ({
        ...prev,
        valor_unit_min: '',
        valor_unit_max: '',
      }));
      return;
    }

    if (key === 'valor_total') {
      setFiltros((prev) => ({
        ...prev,
        valor_total_min: '',
        valor_total_max: '',
      }));
      return;
    }

    setFiltros((prev) => ({ ...prev, [key]: '' }));
  }

  function removeFilter(key) {
    clearValue(key);
    setVisiveis((prev) => prev.filter((item) => item !== key));
  }

  function resetValues() {
    setFiltros((prev) => ({
      ...prev,
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
    }));
  }

  function updateMulti(key, value) {
    setFiltros((prev) => ({ ...prev, [key]: value }));
  }

  function updateSingle(key, value) {
    setFiltros((prev) => ({
      ...prev,
      [key]: value === 'all' ? '' : value,
    }));
  }

  function renderField(key) {
    if (key === 'setor_id') {
      return (
        <SearchSelect
          multi
          value={filtros.setor_id || []}
          onChange={(value) => updateMulti('setor_id', value)}
          allLabel="Todos"
          placeholder="Selecionar..."
          className="h-8 min-w-[180px]"
          options={setores
            .map((s) => ({ value: s.id, label: s.nome }))
            .sort((a, b) => a.label.localeCompare(b.label))}
        />
      );
    }

    if (key === 'deposito_id') {
      return (
        <SearchSelect
          multi
          value={filtros.deposito_id || []}
          onChange={(value) => updateMulti('deposito_id', value)}
          allLabel="Todos"
          placeholder="Selecionar..."
          className="h-8 min-w-[210px]"
          options={depositos
            .map((d) => ({
              value: d.id,
              label: `${d.numero || ''}${d.nome ? ` — ${d.nome}` : ''}`.trim(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label))}
        />
      );
    }

    if (key === 'maquina_id') {
      return (
        <SearchSelect
          multi
          value={filtros.maquina_id || []}
          onChange={(value) => updateMulti('maquina_id', value)}
          allLabel="Todas"
          placeholder="Selecionar..."
          className="h-8 min-w-[200px]"
          options={maquinas
            .map((m) => ({
              value: m.id,
              label: `${m.codigo || ''}${m.nome ? ` — ${m.nome}` : ''}`.trim(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label))}
        />
      );
    }

    if (key === 'gaveta_id') {
      return (
        <SearchSelect
          multi
          value={filtros.gaveta_id || []}
          onChange={(value) => updateMulti('gaveta_id', value)}
          allLabel="Todas"
          placeholder="Selecionar..."
          className="h-8 min-w-[170px]"
          options={gavetas
            .map((g) => ({
              value: g.id,
              label: `${g.codigo || ''}${g.descricao ? ` — ${g.descricao}` : ''}`.trim(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label))}
        />
      );
    }

    if (key === 'unidade') {
      return (
        <SearchSelect
          multi
          value={filtros.unidade || []}
          onChange={(value) => updateMulti('unidade', value)}
          allLabel="Todas"
          placeholder="Selecionar..."
          className="h-8 min-w-[140px]"
          options={unidades}
        />
      );
    }

    if (key === 'estoque') {
      return (
        <SearchSelect
          value={filtros.estoque || 'all'}
          onChange={(value) => updateSingle('estoque', value)}
          allLabel="Todos"
          placeholder="Selecionar..."
          className="h-8 min-w-[155px]"
          options={[
            { value: 'ALTO', label: 'Alto' },
            { value: 'BAIXO', label: 'Baixo' },
            { value: 'ZERADO', label: 'Zerado' },
          ]}
        />
      );
    }

    if (key === 'codigo') {
      return (
        <Input
          value={filtros.codigo || ''}
          onChange={(e) =>
            setFiltros((prev) => ({ ...prev, codigo: e.target.value }))
          }
          placeholder="Código..."
          className="h-8 w-[160px]"
        />
      );
    }

    if (key === 'referencia') {
      return (
        <Input
          value={filtros.referencia || ''}
          onChange={(e) =>
            setFiltros((prev) => ({ ...prev, referencia: e.target.value }))
          }
          placeholder="Referência..."
          className="h-8 w-[170px]"
        />
      );
    }

    const rangeMap = {
      quantidade: ['quantidade_min', 'quantidade_max'],
      valor_unit: ['valor_unit_min', 'valor_unit_max'],
      valor_total: ['valor_total_min', 'valor_total_max'],
    };

    const pair = rangeMap[key];
    if (pair) {
      return (
        <div className="flex items-center gap-1.5">
          <Input
            type="text"
            inputMode="decimal"
            value={filtros[pair[0]] || ''}
            onChange={(e) =>
              setFiltros((prev) => ({ ...prev, [pair[0]]: e.target.value }))
            }
            placeholder="Mín."
            className="h-8 w-[88px] text-right"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <Input
            type="text"
            inputMode="decimal"
            value={filtros[pair[1]] || ''}
            onChange={(e) =>
              setFiltros((prev) => ({ ...prev, [pair[1]]: e.target.value }))
            }
            placeholder="Máx."
            className="h-8 w-[88px] text-right"
          />
        </div>
      );
    }

    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-2">
              <Plus className="h-4 w-4" />
              Adicionar filtro
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-72 p-2">
            <div className="px-2 pb-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Escolher filtro
              </p>
            </div>

            <div className="max-h-80 overflow-auto">
              {disponiveis.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Todos os filtros já estão visíveis.
                </p>
              ) : (
                disponiveis.map((campo) => (
                  <button
                    key={campo.key}
                    type="button"
                    onClick={() => addFilter(campo.key)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span>{campo.label}</span>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {visiveis.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            {visiveis.length} filtro(s) disponível(is)
          </div>
        )}

        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetValues}
            className="h-9 gap-2 text-muted-foreground"
          >
            <RotateCcw className="h-4 w-4" />
            Limpar filtros
          </Button>
        </div>
      </div>

      {visiveis.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-2.5">
          {visiveis.map((key) => {
            const campo = CAMPOS.find((item) => item.key === key);
            if (!campo) return null;

            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5"
              >
                <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {campo.label}
                </span>

                {renderField(key)}

                <button
                  type="button"
                  onClick={() => removeFilter(key)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title={`Remover filtro ${campo.label}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
