import { useState, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

// Combobox de fornecedor baseado no Popover nativo do Radix. O Popover se
// registra como "ramo" do DismissableLayer do Dialog pai, permitindo que os
// itens sejam clicados normalmente dentro de um Dialog modal.
export default function FornecedorCombobox({
  value,
  onChange,
  suggestions = [],
  placeholder,
  id,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = (query || '').toLowerCase().trim();
    if (!q) return suggestions.slice(0, 50);
    return suggestions.filter((s) => s && s.toLowerCase().includes(q)).slice(0, 50);
  }, [suggestions, query]);

  function pick(s) {
    onChange(s);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery(value || '');
      }}
    >
      <PopoverTrigger asChild>
        <Input
          id={id}
          className={cn('cursor-pointer', className)}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
        />
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
            placeholder="Buscar fornecedor..."
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-60 overflow-auto scrollbar-thin py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado.</p>
          ) : (
            filtered.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => pick(s)}
                className={cn(
                  'flex items-center w-full px-3 py-1.5 text-sm text-left hover:bg-accent truncate',
                  s === value && 'bg-accent'
                )}
              >
                {s}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}