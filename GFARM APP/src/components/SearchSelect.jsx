import { useState, useRef, useMemo } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

// Combobox genérico baseado no Popover nativo do Radix. Suporta seleção
// única (padrão) ou múltipla (multi), com caixas de seleção e sem fechar ao
// marcar — ideal para filtros combináveis.
export default function SearchSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Buscar...',
  allLabel,
  className,
  disabled,
  multi = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const selectedArr = multi ? (Array.isArray(value) ? value : value ? [value] : []) : [];
  const selectedSingle = !multi ? options.find((o) => o.value === value) : null;
  const isAll = !multi ? value === 'all' : selectedArr.length === 0;

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function pick(v) {
    if (!multi) {
      onChange(v);
      setOpen(false);
      setQuery('');
      return;
    }
    if (v === 'all' || v === '') {
      onChange([]);
      setQuery('');
      return;
    }
    const next = selectedArr.includes(v)
      ? selectedArr.filter((x) => x !== v)
      : [...selectedArr, v];
    onChange(next);
  }

  function clear(e) {
    e.stopPropagation();
    if (!multi) {
      onChange(allLabel ? 'all' : '');
      setOpen(false);
      setQuery('');
    } else {
      onChange([]);
    }
  }

  const triggerLabel = !multi
    ? selectedSingle
      ? selectedSingle.label
      : value === 'all' && allLabel
      ? allLabel
      : placeholder
    : selectedArr.length === 0
    ? allLabel || placeholder
    : selectedArr.length === 1
    ? options.find((o) => o.value === selectedArr[0])?.label || '1 selecionado'
    : `${selectedArr.length} selecionados`;

  const showClear = multi ? selectedArr.length > 0 : Boolean(selectedSingle);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent/40',
            className
          )}
        >
          <span className={cn('truncate text-left flex-1 min-w-0', isAll && !allLabel && 'text-muted-foreground')}>
            {triggerLabel}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {showClear && (
              <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" onClick={clear} />
            )}
            <ChevronDown className="w-4 h-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar..."
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-60 overflow-auto scrollbar-thin py-1">
          {allLabel && (
            <button
              type="button"
              onClick={() => pick('all')}
              className={cn(
                'flex items-center justify-between w-full px-3 py-1.5 text-sm text-left hover:bg-accent',
                isAll && 'bg-accent'
              )}
            >
              <span>{allLabel}</span>
              {isAll && <Check className="w-4 h-4" />}
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado.</p>
          ) : (
            filtered.map((o) => {
              const checked = !multi ? value === o.value : selectedArr.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  className={cn(
                    'flex items-center justify-between w-full px-3 py-1.5 text-sm text-left hover:bg-accent',
                    checked && 'bg-accent'
                  )}
                >
                  <span className="truncate flex items-center gap-2">
                    {multi && (
                      <span
                        className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                          checked ? 'bg-primary border-primary' : 'border-input'
                        )}
                      >
                        {checked && <Check className="w-3 h-3 text-primary-foreground" />}
                      </span>
                    )}
                    {o.label}
                  </span>
                  {!multi && checked && <Check className="w-4 h-4 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}