import { useState, useRef, useMemo } from 'react';
import { ChevronDown, Check, PlusCircle, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

const NONE = 'none';
const NEW = 'new';


export default function ProdutoCombobox({
  value,
  onChange,
  produtos = [],
  placeholder = 'Buscar produto…',
  className,
  allowCreateNew = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);


  const selectedLabel = useMemo(() => {
    if (value === NEW) {
      return allowCreateNew
        ? 'Criar novo produto'
        : '';
    }

    if (
      value === NONE ||
      !value
    ) {
      return '';
    }

    const p = produtos.find(
      (o) => o.id === value
    );

    return p
      ? `${p.codigo} — ${p.nome}`
      : '';
  }, [
    value,
    produtos,
    allowCreateNew,
  ]);


  const filtered = useMemo(() => {
    const q =
      query
        .toLowerCase()
        .trim();

    if (!q) {
      return produtos;
    }

    return produtos.filter(
      (p) => {
        const label =
          `${p.codigo} ${p.nome}`
            .toLowerCase();

        return label.includes(q);
      }
    );
  }, [
    produtos,
    query,
  ]);


  function pick(v) {
    if (
      v === NEW &&
      !allowCreateNew
    ) {
      return;
    }

    onChange(v);
    setOpen(false);
    setQuery('');
  }


  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);

        if (!o) {
          setQuery('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm cursor-pointer hover:bg-accent/40 transition-colors',
            className
          )}
        >
          <span
            className={cn(
              'truncate text-left',
              value === NEW &&
                allowCreateNew &&
                'text-primary font-medium',

              !value &&
                'text-muted-foreground'
            )}
          >
            {value === NEW &&
            allowCreateNew ? (
              <span className="flex items-center gap-1">
                <PlusCircle className="w-3.5 h-3.5" />
                Criar novo produto
              </span>
            ) : (
              selectedLabel ||
              placeholder
            )}
          </span>

          <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
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
            onChange={(e) =>
              setQuery(e.target.value)
            }
            placeholder="Buscar produto…"
            className="h-8 text-xs"
          />
        </div>


        <div className="max-h-60 overflow-auto scrollbar-thin py-1">

          <button
            type="button"
            onClick={() => pick(NONE)}
            className={cn(
              'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent',

              value === NONE &&
                'bg-accent'
            )}
          >
            <Ban className="w-3.5 h-3.5 opacity-60" />

            <span className="text-muted-foreground">
              — Nenhum —
            </span>

            {value === NONE && (
              <Check className="w-4 h-4 ml-auto" />
            )}
          </button>


          {allowCreateNew && (
            <button
              type="button"
              onClick={() => pick(NEW)}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent text-primary font-medium',

                value === NEW &&
                  'bg-accent'
              )}
            >
              <PlusCircle className="w-3.5 h-3.5" />

              <span>
                Criar novo produto
              </span>

              {value === NEW && (
                <Check className="w-4 h-4 ml-auto" />
              )}
            </button>
          )}


          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum resultado.
            </p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  pick(p.id)
                }
                className={cn(
                  'flex items-center justify-between w-full px-3 py-1.5 text-xs text-left hover:bg-accent',

                  value === p.id &&
                    'bg-accent'
                )}
              >
                <span className="truncate">
                  {p.codigo} — {p.nome}
                </span>

                {value === p.id && (
                  <Check className="w-4 h-4 shrink-0" />
                )}
              </button>
            ))
          )}

        </div>
      </PopoverContent>
    </Popover>
  );
}
