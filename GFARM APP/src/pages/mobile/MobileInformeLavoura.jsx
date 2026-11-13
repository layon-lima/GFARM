import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronDown, ClipboardList, Loader2,
  Pencil, Plus, RefreshCw, Search, Send, ShieldCheck,
  Sprout, Trash2, X,
} from 'lucide-react';

import { informesLavouraApi } from '@/api/informesLavouraClient';
import SearchSelect from '@/components/SearchSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { invalidateEntidade, invalidateEstoque } from '@/lib/useEntidades';

const novoItem = () => ({ key: crypto.randomUUID(), produto_id: '', quantidade: '' });
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (value) => value ? new Date(value).toLocaleString('pt-BR') : '';

function parseNumero(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(n) ? n : 0;
}

function ItensEditor({ itens, onChange, produtos, bloqueado = false }) {
  const produtosMap = useMemo(
    () => new Map(produtos.map((produto) => [produto.id, produto])),
    [produtos]
  );
  const options = useMemo(
    () => produtos.map((produto) => ({
      value: produto.id, label: produto.nome + (produto.codigo ? ` · ${produto.codigo}` : ''),
    })),
    [produtos]
  );
  function patch(key, campo, valor) {
    onChange(itens.map((item) => item.key !== key ? item : {
      ...item,
      [campo]: valor,
      ...(campo === 'produto_id' ? { deposito_id: '', gaveta_id: '' } : {}),
    }));
  }
  return (
    <div className="space-y-3">
      {itens.map((item, indice) => (
        <div key={item.key} className="space-y-2 rounded-xl border bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Produto {indice + 1}</span>
            {itens.length > 1 && (
              <button type="button" aria-label="Remover produto" disabled={bloqueado}
                onClick={() => onChange(itens.filter((entrada) => entrada.key !== item.key))}
                className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <SearchSelect
            value={item.produto_id || 'all'}
            onChange={(value) => patch(item.key, 'produto_id', value === 'all' ? '' : value)}
            allLabel="Selecionar defensivo ou adubo"
            placeholder="Buscar produto"
            options={options}
            disabled={bloqueado}
          />
          {(produtosMap.get(item.produto_id)?.locais || []).length > 1 && (
            <div className="space-y-1.5">
              <Label>Local de retirada</Label>
              <SearchSelect
                value={item.deposito_id
                  ? [item.deposito_id, item.gaveta_id || ''].join('|') : 'all'}
                onChange={(value) => {
                  const [deposito_id, gaveta_id] = value === 'all' ? ['', ''] : value.split('|');
                  onChange(itens.map((linha) => linha.key === item.key
                    ? { ...linha, deposito_id, gaveta_id } : linha));
                }}
                disabled={bloqueado}
                allLabel="Selecionar depósito/gaveta"
                options={produtosMap.get(item.produto_id).locais.map((loc) => ({
                  value: [loc.deposito_id, loc.gaveta_id || ''].join('|'),
                  label: loc.nome,
                }))}
              />
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label>Quantidade retirada</Label>
              <Input inputMode="decimal" placeholder="0,000" className="h-11 rounded-xl text-base"
                value={item.quantidade} disabled={bloqueado}
                onChange={(event) => patch(item.key, 'quantidade', event.target.value)} />
            </div>
            <span className="w-16 pb-3 text-right text-xs font-semibold text-muted-foreground">
              {produtosMap.get(item.produto_id)?.unidade || '—'}
            </span>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="h-11 w-full gap-2 rounded-xl"
        disabled={bloqueado || itens.length >= 50}
        onClick={() => onChange([...itens, novoItem()])}>
        <Plus className="h-4 w-4" /> Adicionar outro produto
      </Button>
    </div>
  );
}

function validarFormulario(form, produtos) {
  if (!form.lavoura_id) throw new Error('Selecione a lavoura.');
  if (!form.itens?.length) throw new Error('Informe ao menos um produto.');
  const ids = new Set();
  const validos = form.itens.map((item) => {
    const produto = produtos.find((p) => p.id === item.produto_id);
    const qtd = parseNumero(item.quantidade);
    if (!produto) throw new Error('Selecione um produto válido em todas as linhas.');
    if (ids.has(produto.id)) throw new Error('Produto repetido. Some as quantidades na mesma linha.');
    if (qtd <= 0 || Number(qtd.toFixed(3)) !== qtd) {
      throw new Error('Quantidade deve ser positiva e ter até três casas decimais.');
    }
    if ((produto.locais || []).length > 1 && !item.deposito_id) {
      throw new Error(`Escolha o local de retirada do produto ${produto.nome}.`);
    }
    ids.add(produto.id);
    return {
      produto_id: produto.id, quantidade: qtd,
      deposito_id: item.deposito_id || null,
      gaveta_id: item.gaveta_id || null,
    };
  });
  return {
    lavoura_id: form.lavoura_id,
    observacao: String(form.observacao || '').trim(),
    itens: validos,
  };
}

export default function MobileInformeLavoura() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const podeSolicitar = hasPermission(user, 'mobile.informe_lavoura.solicitar');
  const podeRevisar = hasPermission(user, 'admin.informe_lavoura.revisar');
  const admTotal = user?.role === 'admin';

  const [aba, setAba] = useState(podeSolicitar ? 'solicitar' : 'revisar');
  const [referencias, setReferencias] = useState({ lavouras: [], produtos: [] });
  const [minhas, setMinhas] = useState([]);
  const [fila, setFila] = useState([]);
  const [custos, setCustos] = useState({ lavouras: [], informes: {} });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('PENDENTE');
  const [form, setForm] = useState({
    chave: crypto.randomUUID(), lavoura_id: '', itens: [novoItem()], observacao: '',
  });
  const [editando, setEditando] = useState(null);
  const [confirmarId, setConfirmarId] = useState('');
  const [recusarId, setRecusarId] = useState('');
  const [motivo, setMotivo] = useState('');

  const lavouras = referencias.lavouras || [];
  const produtos = referencias.produtos || [];
  const lavouraAtual = lavouras.find((x) => x.id === form.lavoura_id);
  const lavourasFiltradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return lavouras.filter((l) =>
      !termo || [l.nome, l.numero].join(' ').toLocaleLowerCase('pt-BR').includes(termo)
    );
  }, [lavouras, busca]);

  async function carregar() {
    setLoading(true);
    try {
      const [refs, meus, lista, totais] = await Promise.all([
        podeSolicitar ? informesLavouraApi.referencias() : Promise.resolve({ lavouras: [], produtos: [] }),
        podeSolicitar ? informesLavouraApi.minhas() : Promise.resolve([]),
        podeRevisar ? informesLavouraApi.listaAdmin() : Promise.resolve([]),
        admTotal ? informesLavouraApi.custosAdmin() : Promise.resolve({ lavouras: [], informes: {} }),
      ]);
      if (podeRevisar && !podeSolicitar) {
        // Revisor sem permissão de solicitação recebe referências de edição
        // pela mesma rota, autorizada no backend para revisão.
        const publicas = await informesLavouraApi.referencias();
        setReferencias(publicas);
      } else {
        setReferencias(refs);
      }
      setMinhas(meus);
      setFila(lista);
      setCustos(totais);
    } catch (error) {
      setAviso({ erro: true, texto: error.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (podeSolicitar || podeRevisar) carregar(); }, [podeSolicitar, podeRevisar, admTotal]);

  async function enviar(event) {
    event.preventDefault();
    let payload;
    try { payload = validarFormulario(form, produtos); }
    catch (error) { setAviso({ erro: true, texto: error.message }); return; }
    setBusy(true);
    setAviso(null);
    try {
      await informesLavouraApi.solicitar({ chave: form.chave, ...payload });
      setForm({ chave: crypto.randomUUID(), lavoura_id: '', itens: [novoItem()], observacao: '' });
      setBusca('');
      setMinhas(await informesLavouraApi.minhas());
      setAviso({ erro: false, texto: 'Informe enviado! Aguardando análise do ADM. O estoque não foi alterado.' });
    } catch (error) {
      setAviso({ erro: true, texto: error.message });
    } finally { setBusy(false); }
  }

  function iniciarEdicao(item) {
    setEditando({
      id: item.id, lavoura_id: item.lavoura_id, observacao: item.observacao || '',
      itens: (item.itens || []).map((it) => ({
        key: crypto.randomUUID(), produto_id: it.produto_id, quantidade: it.quantidade,
        deposito_id: it.deposito_id || '', gaveta_id: it.gaveta_id || '',
      })),
    });
    setConfirmarId('');
    setRecusarId('');
    setAviso(null);
  }

  async function executar(acao, item) {
    if (busy) return;
    setBusy(true);
    setAviso(null);
    try {
      let mensagem;
      if (acao === 'editar') {
        const body = validarFormulario(editando, produtos);
        await informesLavouraApi.editar(item.id, body);
        mensagem = 'Informe editado. Continua pendente, sem alterar estoque.';
        setEditando(null);
      } else if (acao === 'aprovar') {
        await informesLavouraApi.aprovar(item.id);
        await Promise.all([invalidateEntidade('Produto'), invalidateEstoque()]);
        mensagem = 'Baixa autorizada e registrada pelo motor oficial.';
        setConfirmarId('');
      } else {
        if (motivo.trim().length < 3) throw new Error('Informe o motivo da recusa.');
        await informesLavouraApi.recusar(item.id, motivo.trim());
        mensagem = 'Solicitação recusada. Nenhuma baixa realizada.';
        setRecusarId('');
        setMotivo('');
      }
      const [lista, totais] = await Promise.all([
        informesLavouraApi.listaAdmin(),
        admTotal ? informesLavouraApi.custosAdmin() : Promise.resolve({ lavouras: [], informes: {} }),
      ]);
      setFila(lista);
      setCustos(totais);
      setAviso({ erro: false, texto: mensagem });
    } catch (error) {
      setAviso({ erro: true, texto: error.message });
    } finally { setBusy(false); }
  }

  if (!podeSolicitar && !podeRevisar) return <Navigate to="/" replace />;

  return (
    <div className="mobile-page space-y-3 pb-8">
      <header className="flex items-center gap-3">
        <button type="button" aria-label="Voltar" onClick={() => navigate('/')}
          className="flex h-10 w-10 items-center justify-center rounded-xl border bg-card">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">GFARM · Lavouras</p>
          <h1 className="truncate text-lg font-bold">Informe de Saída</h1>
        </div>
        <button type="button" aria-label="Atualizar" disabled={busy || loading}
          onClick={carregar} className="rounded-xl border bg-card p-2.5">
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
        {[
          ...(podeSolicitar ? [{ key: 'solicitar', label: 'Informar' }] : []),
          ...(podeRevisar ? [{ key: 'revisar', label: 'Revisar' }] : []),
          ...(admTotal ? [{ key: 'custos', label: 'Custos' }] : []),
        ].map((tab) => (
          <button key={tab.key} type="button"
            onClick={() => { setAba(tab.key); setAviso(null); }}
            className={'min-w-0 flex-1 rounded-lg px-2 py-2.5 text-xs font-semibold ' +
              (aba === tab.key ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
            {tab.label}
          </button>
        ))}
      </div>

      {aviso && (
        <div role="status" className={'rounded-xl border px-3 py-3 text-sm ' +
          (aviso.erro ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
          {aviso.texto}
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : aba === 'solicitar' && podeSolicitar ? (
        <>
          {!form.lavoura_id ? (
            <section className="space-y-3 rounded-2xl border bg-card p-3">
              <div className="relative">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input className="h-11 rounded-xl pl-9" placeholder="Pesquisar lavoura..."
                  value={busca} onChange={(event) => setBusca(event.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {lavourasFiltradas.map((lavoura) => (
                  <button key={lavoura.id} type="button"
                    onClick={() => setForm((prev) => ({ ...prev, lavoura_id: lavoura.id }))}
                    className="flex min-h-[106px] flex-col items-start justify-between gap-2 rounded-2xl border border-primary/15 bg-primary/5 p-3 text-left active:bg-primary/10">
                    <Sprout className="h-5 w-5 text-primary" />
                    <div className="min-w-0">
                      <strong className="block break-words text-sm leading-tight">{lavoura.nome}</strong>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {lavoura.numero || ''}{lavoura.hectares ? ` · ${lavoura.hectares} ha` : ''}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {!lavourasFiltradas.length && (
                <p className="p-5 text-center text-xs text-muted-foreground">Nenhuma lavoura encontrada.</p>
              )}
            </section>
          ) : (
            <form onSubmit={enviar} className="space-y-3">
              <div className="rounded-2xl border bg-card p-3.5">
                <button type="button" className="mb-3 flex items-center gap-2 text-xs text-primary"
                  onClick={() => setForm((prev) => ({ ...prev, lavoura_id: '' }))}>
                  <ArrowLeft className="h-4 w-4" /> Alterar lavoura
                </button>
                <div className="flex items-center gap-2">
                  <Sprout className="h-5 w-5 text-primary" />
                  <h2 className="break-words text-base font-bold">{lavouraAtual?.nome}</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Produtos destinados a esta lavoura</p>
              </div>
              <ItensEditor itens={form.itens} produtos={produtos}
                bloqueado={busy} onChange={(itens) => setForm((prev) => ({ ...prev, itens }))} />
              <div className="rounded-xl border bg-card p-3">
                <Label>Observação (opcional)</Label>
                <Textarea rows={2} className="mt-2 resize-none rounded-xl"
                  placeholder="Ex.: responsável pela retirada ou observações"
                  disabled={busy} value={form.observacao}
                  onChange={(e) => setForm((prev) => ({ ...prev, observacao: e.target.value }))} />
              </div>
              <Button type="submit" disabled={busy} className="h-12 w-full gap-2 rounded-xl text-base font-semibold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar solicitação de baixa
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                O estoque será baixado somente após a aprovação administrativa.
              </p>
            </form>
          )}
          <section className="rounded-2xl border bg-card p-3">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4" /> Meus últimos informes
            </h3>
            {!minhas.length && <p className="text-xs text-muted-foreground">Nenhuma solicitação enviada.</p>}
            {minhas.slice(0, 6).map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 border-t py-2 text-xs first:border-0">
                <div className="min-w-0">
                  <strong className="block truncate">{item.lavoura_nome}</strong>
                  <span className="text-muted-foreground">{item.itens?.length || 0} produto(s) · {dataBR(item.created_date)}</span>
                  {item.motivo_recusa && <span className="block text-red-700">Recusa: {item.motivo_recusa}</span>}
                </div>
                <span className="shrink-0 font-semibold">
                  {item.status === 'APROVADO' ? 'Aprovado' : item.status === 'RECUSADO' ? 'Recusado' : 'Pendente'}
                </span>
              </div>
            ))}
          </section>
        </>
      ) : aba === 'revisar' && podeRevisar ? (
        <section className="space-y-3">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/40 p-1">
            {[
              { key: 'PENDENTE', label: 'Pendentes' },
              { key: 'APROVADO', label: 'Aprovados' },
              { key: 'RECUSADO', label: 'Recusados' },
            ].map((tab) => (
              <button key={tab.key} type="button" onClick={() => {
                setFiltro(tab.key); setEditando(null); setConfirmarId(''); setRecusarId('');
              }} className={'rounded-lg px-1 py-2.5 text-xs font-semibold ' +
                (filtro === tab.key ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
                {tab.label} ({fila.filter((x) =>
                  x.status === tab.key || (tab.key === 'PENDENTE' && x.status === 'PROCESSANDO')).length})
              </button>
            ))}
          </div>
          {fila.filter((x) => x.status === filtro || (filtro === 'PENDENTE' && x.status === 'PROCESSANDO')).map((item) => (
            <article key={item.id} className="space-y-3 rounded-2xl border bg-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{item.lavoura_nome}</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {item.solicitante_nome} · {dataBR(item.created_date)}
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-primary">{item.status}</span>
              </div>
              {editando?.id === item.id ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Lavoura</Label>
                    <SearchSelect value={editando.lavoura_id}
                      onChange={(value) => setEditando((prev) => ({ ...prev, lavoura_id: value }))}
                      options={lavouras.map((l) => ({ value: l.id, label: l.nome }))}
                      allLabel="Selecionar lavoura" />
                  </div>
                  <ItensEditor itens={editando.itens} produtos={produtos} bloqueado={busy}
                    onChange={(itens) => setEditando((prev) => ({ ...prev, itens }))} />
                  <div className="space-y-1.5">
                    <Label>Observação</Label>
                    <Textarea rows={2} value={editando.observacao}
                      onChange={(event) => setEditando((prev) => ({ ...prev, observacao: event.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setEditando(null)}>Cancelar</Button>
                    <Button type="button" disabled={busy} onClick={() => executar('editar', item)}>
                      {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                      Salvar edição
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Salvar a edição não movimenta o estoque.</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {(item.itens || []).map((prod, indice) => (
                      <div key={indice} className="flex justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
                        <span className="min-w-0 break-words">{prod.produto_nome}</span>
                        <strong className="shrink-0">{prod.quantidade} {prod.unidade}</strong>
                      </div>
                    ))}
                  </div>
                  {item.observacao && <p className="text-xs text-muted-foreground">{item.observacao}</p>}
                  {item.motivo_recusa && <p className="text-xs text-red-700">Motivo: {item.motivo_recusa}</p>}
                  {item.status === 'APROVADO' && (
                    <div className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">
                      Contabilizado pelo motor oficial. {admTotal && custos.informes?.[item.id] !== undefined &&
                        <strong> Custo: {money(custos.informes[item.id])}</strong>}
                    </div>
                  )}
                  {item.status === 'PROCESSANDO' && (
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-900">
                        Esta aprovação foi interrompida. A recuperação consulta o documento oficial para impedir baixa duplicada.
                      </p>
                      <Button type="button" variant="outline" className="w-full" disabled={busy}
                        onClick={() => executar('aprovar', item)}>
                        Verificar aprovação
                      </Button>
                    </div>
                  )}
                  {item.status === 'PENDENTE' && confirmarId !== item.id && recusarId !== item.id && (
                    <div className="grid grid-cols-3 gap-2">
                      <Button type="button" variant="outline" className="px-1 text-xs" disabled={busy}
                        onClick={() => iniciarEdicao(item)}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar</Button>
                      <Button type="button" className="px-1 text-xs" disabled={busy}
                        onClick={() => { setConfirmarId(item.id); setRecusarId(''); }}>
                        <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                      </Button>
                      <Button type="button" variant="outline" className="px-1 text-xs text-destructive" disabled={busy}
                        onClick={() => { setRecusarId(item.id); setConfirmarId(''); }}>
                        <X className="mr-1 h-3.5 w-3.5" /> Recusar
                      </Button>
                    </div>
                  )}
                  {confirmarId === item.id && (
                    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-sm font-semibold">Confirmar baixa no estoque?</p>
                      <p className="text-xs">O motor validará o saldo, lotes e custo oficial. Não é possível editar depois de aprovada.</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmarId('')}>Voltar</Button>
                        <Button type="button" disabled={busy} onClick={() => executar('aprovar', item)}>
                          {busy ? 'Processando...' : 'Confirmar'}
                        </Button>
                      </div>
                    </div>
                  )}
                  {recusarId === item.id && (
                    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                      <Label>Motivo da recusa</Label>
                      <Textarea rows={2} maxLength={2000} value={motivo}
                        onChange={(event) => setMotivo(event.target.value)} placeholder="Justifique a recusa" />
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant="outline" disabled={busy} onClick={() => setRecusarId('')}>Voltar</Button>
                        <Button type="button" variant="destructive" disabled={busy || motivo.trim().length < 3}
                          onClick={() => executar('recusar', item)}>Recusar</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </article>
          ))}
          {!fila.some((item) => item.status === filtro || (filtro === 'PENDENTE' && item.status === 'PROCESSANDO')) && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhum informe nesta situação.
            </div>
          )}
        </section>
      ) : aba === 'custos' && admTotal ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <p className="text-xs text-muted-foreground">
              Custos reservados ao Administrador Total. Valores do documento oficial do motor.
            </p>
          </div>
          {[...custos.lavouras].sort((a, b) => b.custo_total - a.custo_total).map((item) => (
            <div key={item.lavoura_id} className="rounded-2xl border bg-card p-4">
              <h3 className="text-sm font-bold">{item.lavoura_nome}</h3>
              <strong className="mt-2 block text-xl tabular-nums">{money(item.custo_total)}</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.quantidade_informes} saída(s) aprovadas
              </p>
            </div>
          ))}
          {!custos.lavouras.length && <p className="rounded-xl border p-6 text-center text-xs text-muted-foreground">Nenhuma saída aprovada ainda.</p>}
        </section>
      ) : null}
    </div>
  );
}
