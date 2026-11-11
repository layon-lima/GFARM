import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, PackagePlus, Search, X } from 'lucide-react';
import { sugerirProdutosDaNota } from '@/lib/correspondenciaProdutoNfe';

/**
 * Um único campo para pesquisa e seleção; entradas de nome parecido ficam
 * como sugestão, nunca são vinculadas silenciosamente à NF-e.
 */
export default function EscolherProdutoDaNota({
  dados, produtos = [], setores = [],
  selecionado = null, busca, identificacao,
  onSearch, onSelect, onClear, onCreate, podeCadastrar = false,
}) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Começar com o nome da nota, mesmo quando ainda não existe vínculo:
  // o operador vê o produto pesquisado e abre sugestões em um único clique.
  const texto = busca !== undefined ? busca : (selecionado?.nome || String(dados.produto || ''));
  const opcoes = useMemo(
    () => sugerirProdutosDaNota(dados, produtos, texto, 12),
    [dados, produtos, texto],
  );

  useEffect(() => {
    function aoClicarFora(event) {
      if (!containerRef.current?.contains(event.target)) setAberto(false);
    }
    document.addEventListener('pointerdown', aoClicarFora);
    return () => document.removeEventListener('pointerdown', aoClicarFora);
  }, []);

  function escolher(produto) {
    onSelect(produto);
    setAberto(false);
    setAtivo(0);
  }

  function teclado(event) {
    if (event.key === 'Escape') {
      setAberto(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAberto(true);
      setAtivo(atual => Math.min(atual + 1, Math.max(opcoes.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAberto(true);
      setAtivo(atual => Math.max(atual - 1, 0));
      return;
    }
    if (event.key === 'Enter' && aberto && opcoes[ativo]) {
      event.preventDefault();
      escolher(opcoes[ativo].produto);
    }
  }

  return <div ref={containerRef} className="relative min-w-0 space-y-1">
    <div className="text-xs font-medium">Produto no GFARM</div>
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-label="Pesquisar e selecionar produto do GFARM"
        aria-autocomplete="list"
        aria-expanded={aberto}
        aria-controls={aberto ? 'opcoes-produto-' + String(dados.origem_id || dados.numero_nota || 'nfe') : undefined}
        className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-16 text-sm outline-none focus:ring-2 focus:ring-ring"
        placeholder={dados.produto ? 'Procurar ' + dados.produto + '...' : 'Nome ou código do produto'}
        value={texto}
        onFocus={event => { setAberto(true); setAtivo(0); event.target.select(); }}
        onChange={event => {
          onSearch(event.target.value);
          setAtivo(0);
          setAberto(true);
        }}
        onKeyDown={teclado}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
        {selecionado ? (
          <button type="button" title="Trocar produto" aria-label="Trocar produto"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={() => {
              onClear();
              inputRef.current?.focus();
              setAberto(true);
            }}>
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <button type="button" title="Mostrar produtos" aria-label="Mostrar produtos"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={() => { setAberto(prev => !prev); inputRef.current?.focus(); }}>
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
    {selecionado ? (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-700">
        <Check className="h-3.5 w-3.5" />
        <span className="font-semibold">
          {identificacao === 'automatico' ? 'Identificado automaticamente' : 'Produto selecionado'}
        </span>
        <span className="text-muted-foreground">
          · {selecionado.unidade || dados.unidade}
          {selecionado.setor_id
            ? ' · ' + (setores.find(s => s.id === selecionado.setor_id)?.nome || 'Setor')
            : ''}
        </span>
      </div>
    ) : (
      <div className="text-[11px] text-muted-foreground">
        {opcoes.length ? 'Confira as correspondências sugeridas' : 'Nenhuma correspondência segura no cadastro'}
      </div>
    )}
    {aberto && (
      <div className="absolute left-0 right-0 top-[60px] z-50 overflow-hidden rounded-lg border bg-popover shadow-lg"
        style={{ minWidth: 'min(100%, 280px)' }}>
        <div className="max-h-56 overflow-y-auto p-1"
          id={'opcoes-produto-' + String(dados.origem_id || dados.numero_nota || 'nfe')}
          role="listbox" aria-label="Produtos encontrados">
          {opcoes.length ? opcoes.map(({ produto, score }, idx) => (
            <button type="button" role="option" aria-selected={produto.id === selecionado?.id}
              key={produto.id}
              className={'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm ' +
                (idx === ativo ? 'bg-muted' : 'hover:bg-muted')}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setAtivo(idx)}
              onClick={() => escolher(produto)}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{produto.nome}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {produto.codigo || 'Sem código'} · {produto.unidade || 'Unidade não definida'}
                  {produto.setor_id ? ' · ' + (setores.find(s => s.id === produto.setor_id)?.nome || 'Setor') : ''}
                </span>
              </span>
              {produto.id === selecionado?.id ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> :
                score >= 100 ? <span className="shrink-0 text-[10px] text-muted-foreground">Nome igual</span> : null}
            </button>
          )) : (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              Nenhum produto com esse nome ou código.
            </div>
          )}
        </div>
        {podeCadastrar ? (
          <button type="button"
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs font-semibold text-primary hover:bg-muted"
            onMouseDown={event => event.preventDefault()}
            onClick={() => { setAberto(false); onCreate(); }}>
            <PackagePlus className="h-4 w-4" /> Cadastrar novo produto usando a NF-e
          </button>
        ) : null}
      </div>
    )}
    {!selecionado && podeCadastrar && (
      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        onClick={() => { setAberto(false); onCreate(); }}>
        <PackagePlus className="h-3.5 w-3.5" /> Não encontrou? Cadastrar usando a NF-e
      </button>
    )}
    {!selecionado && !podeCadastrar && (
      <p className="text-[11px] text-muted-foreground">Solicite o cadastro a quem tem acesso a Cadastros.</p>
    )}
  </div>;
}
