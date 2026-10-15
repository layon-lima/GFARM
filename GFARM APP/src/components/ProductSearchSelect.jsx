import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { matchTerm } from '@/lib/estoqueFilters';

export default function ProductSearchSelect({ produtos, maquinas, gavetas, value, onChange, placeholder }) {
  const [busca, setBusca] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef(null);

  const produtoSelecionado = produtos.find((p) => p.id === value);

  const termos = busca.split(',').map((t) => t.trim()).filter(Boolean);

  const suggestions = useMemo(() => {
    if (termos.length === 0) return [];
    const matches = produtos.filter((p) => termos.every((termo) => matchTerm(p, termo, maquinas, gavetas)));
    return matches.slice(0, 8);
  }, [produtos, busca, maquinas, gavetas]);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [busca]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getMaquinaNome = (p) => {
    const m = maquinas?.find((m) => m.id === p.maquina_id);
    return m?.nome || '';
  };

  const getGavetaNome = (p) => {
    const g = gavetas?.find((g) => g.id === p.gaveta_id);
    return g?.codigo || '';
  };

  const handleSelect = (produto) => {
    onChange(produto.id);
    setBusca('');
    setShowSuggestions(false);
  };

  const handleClear = () => {
    onChange('');
    setBusca('');
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const displayValue = produtoSelecionado ? `${produtoSelecionado.codigo} — ${produtoSelecionado.nome}` : busca;

  return (
    <div className="relative" ref={containerRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
      <Input
        value={displayValue}
        onChange={(e) => {
          if (produtoSelecionado) onChange('');
          setBusca(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Buscar produto por nome, código, referência… (vírgulas combinam)'}
        className="pl-9 pr-9 h-10"
      />
      {(value || busca) && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
          {suggestions.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p)}
              className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 border-b border-border/50 last:border-0 hover:bg-accent transition-colors ${
                idx === highlightIndex ? 'bg-accent' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{p.nome}</span>
                <span className="text-xs text-muted-foreground shrink-0">{p.codigo}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {p.codigo_referencia && <span>Ref: {p.codigo_referencia}</span>}
                {getGavetaNome(p) && <span>Gav: {getGavetaNome(p)}</span>}
                {getMaquinaNome(p) && <span className="truncate">{getMaquinaNome(p)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}