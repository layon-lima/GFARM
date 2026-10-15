import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { matchTerm } from '@/lib/estoqueFilters';
import { formatQtd } from '@/lib/format';

export default function SearchBar({
  value,
  onChange,
  produtos = [],
  maquinas = [],
  gavetas = [],
  depositos = [],
  saldos = [],
  setores = [],
  lotes = [],
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef(null);

  const termos = value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const suggestions = useMemo(() => {
    if (termos.length === 0) return [];

    return produtos
      .filter((p) =>
        termos.every((termo) =>
          matchTerm(
            p,
            termo,
            maquinas,
            gavetas,
            depositos,
            saldos,
            setores,
            lotes
          )
        )
      )
      .slice(0, 8);
  }, [
    produtos,
    termos,
    maquinas,
    gavetas,
    depositos,
    saldos,
    setores,
    lotes,
  ]);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function depositoResumo(produto) {
    const ids = produto._deposito_ids?.length
      ? produto._deposito_ids
      : produto.deposito_id
        ? [produto.deposito_id]
        : [];

    if (ids.length > 1) return `${ids.length} depósitos`;

    const dep = depositos.find((d) => d.id === ids[0]);
    if (!dep) return '';

    return `${dep.numero || ''}${dep.nome ? ` — ${dep.nome}` : ''}`.trim();
  }

  function handleSelect(produto) {
    onChange(produto.nome);
    setShowSuggestions(false);
  }

  function handleKeyDown(event) {
    if (!showSuggestions || suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex(
        (i) => (i - 1 + suggestions.length) % suggestions.length
      );
    } else if (event.key === 'Enter' && highlightIndex >= 0) {
      event.preventDefault();
      handleSelect(suggestions[highlightIndex]);
    } else if (event.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full"
    >
      <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-muted-foreground" />

      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onKeyDown={handleKeyDown}
        placeholder="Pesquisar por nome, código, referência, setor, depósito, máquina, gaveta, lote, unidade, quantidade, valor ou qualquer outro dado..."
        className="h-12 bg-background pl-12 pr-11 text-sm"
      />

      {value && (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            onChange('');
            setShowSuggestions(false);
          }}
          className="absolute right-1.5 top-1/2 h-9 w-9 -translate-y-1/2"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {showSuggestions && value.trim() && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover shadow-xl">
          {suggestions.map((p, idx) => {
            const deposito = depositoResumo(p);

            return (
              <button
                key={p._rowKey || p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className={`flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent ${
                  idx === highlightIndex ? 'bg-accent' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.nome}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {p.codigo && <span>Cód. {p.codigo}</span>}
                    {p.codigo_referencia && <span>Ref. {p.codigo_referencia}</span>}
                    {deposito && <span>{deposito}</span>}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatQtd(p.quantidade || 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {p.unidade || ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
