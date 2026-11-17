import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, CheckCircle2, ChevronRight, CircleDollarSign,
  ClipboardCheck, Leaf, Loader2, Package, Pencil,
  Plus, RefreshCw, Search, ShieldAlert, Sprout, Trash2, X,
} from 'lucide-react';

import { informesLavouraApi } from '@/api/informesLavouraClient';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { invalidateEntidade, invalidateEstoque } from '@/lib/useEntidades';
import { useToast } from '@/components/ui/use-toast';
import HistoricoInforme from '@/components/aplicacao/HistoricoInforme';

const reais = (valor) => Number(valor || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL',
});
const quantidadeFormatada = (valor) => Number(valor || 0).toLocaleString('pt-BR', {
  maximumFractionDigits: 3,
});
const dataBR = (value) => {
  if (!value) return '—';
  const data = new Date(value);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short',
  });
};
const normalizar = (valor) => String(valor || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const statusNome = {
  PENDENTE: 'Pendente',
  PROCESSANDO: 'Em processamento',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
};
const statusEstilo = {
  PENDENTE: 'bg-amber-50 text-amber-800 border-amber-200',
  PROCESSANDO: 'bg-sky-50 text-sky-800 border-sky-200',
  APROVADO: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  RECUSADO: 'bg-rose-50 text-rose-800 border-rose-200',
};
const estiloCard = 'rounded-2xl border border-[#dce9e1] bg-white/85 shadow-[0_5px_20px_rgba(24,79,52,0.05)]';

function Estado({ status }) {
  return (
    <span className={`inline-flex max-w-full items-center rounded-lg border px-2 py-1 text-[11px] font-semibold ${statusEstilo[status] || 'bg-slate-50 border-slate-200'}`}>
      {statusNome[status] || status}
    </span>
  );
}

function novoItem() {
  return { key: crypto.randomUUID(), produto_id: '', quantidade: '', deposito_id: '', gaveta_id: '' };
}

function quantidadeNumero(valor) {
  const texto = String(valor ?? '').trim();
  const numero = Number(texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.') : texto);
  return Number.isFinite(numero) ? numero : NaN;
}

function validar(dados, produtos) {
  if (!dados.lavoura_id) throw new Error('Selecione a lavoura.');
  if (!dados.itens?.length) throw new Error('Informe ao menos um produto.');
  const ids = new Set();
  const itens = dados.itens.map((item) => {
    const produto = produtos.find((p) => p.id === item.produto_id);
    if (!produto) throw new Error('Selecione um produto válido.');
    if (ids.has(produto.id)) throw new Error('Existem produtos repetidos. Junte as quantidades.');
    ids.add(produto.id);
    const quantidade = quantidadeNumero(item.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0
      || Number(quantidade.toFixed(3)) !== quantidade) {
      throw new Error('A quantidade precisa ser positiva e ter até 3 casas decimais.');
    }
    if ((produto.locais || []).length > 1 && !item.deposito_id) {
      throw new Error(`Selecione o local de retirada de ${produto.nome}.`);
    }
    return {
      produto_id: produto.id, quantidade,
      deposito_id: item.deposito_id || null,
      gaveta_id: item.gaveta_id || null,
    };
  });
  return { lavoura_id: dados.lavoura_id, itens, observacao: dados.observacao || '' };
}

function FormularioEdicao({ form, onChange, referencias, busy, onSave, onCancel }) {
  const produtos = referencias.produtos || [];
  const lavouras = referencias.lavouras || [];
  const alterarItem = (key, valor) => onChange((atual) => ({
    ...atual,
    itens: atual.itens.map((i) => i.key === key ? { ...i, ...valor } : i),
  }));
  return (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-600" htmlFor="aplicacao-lavoura">Lavoura</label>
        <select id="aplicacao-lavoura" value={form.lavoura_id} disabled={busy}
          onChange={(event) => onChange((antigo) => ({ ...antigo, lavoura_id: event.target.value }))}
          className="h-10 w-full rounded-xl border border-[#d7e4da] bg-white px-3 text-sm outline-primary">
          <option value="">Escolher lavoura</option>
          {lavouras.map((lav) => <option key={lav.id} value={lav.id}>{lav.nome}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        {form.itens.map((item, indice) => {
          const produto = produtos.find((p) => p.id === item.produto_id);
          const locais = produto?.locais || [];
          return (
            <div key={item.key} className="space-y-2 rounded-xl border border-[#e1ece4] bg-[#f8fcf9] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">Produto {indice + 1}</span>
                {form.itens.length > 1 && (
                  <button type="button" disabled={busy} title="Remover produto"
                    className="rounded-lg p-1 text-rose-600 hover:bg-rose-50"
                    onClick={() => onChange((atual) => ({ ...atual, itens: atual.itens.filter((i) => i.key !== item.key) }))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <select value={item.produto_id} disabled={busy}
                aria-label={`Produto ${indice + 1}`}
                onChange={(event) => alterarItem(item.key, {
                  produto_id: event.target.value, deposito_id: '', gaveta_id: '',
                })}
                className="h-10 w-full min-w-0 rounded-xl border border-[#d7e4da] bg-white px-2 text-sm outline-primary">
                <option value="">Escolher produto</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}{p.codigo ? ` · ${p.codigo}` : ''}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <input type="text" inputMode="decimal" value={item.quantidade}
                  disabled={busy} aria-label="Quantidade retirada"
                  onChange={(event) => alterarItem(item.key, { quantidade: event.target.value })}
                  placeholder="Quantidade"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-[#d7e4da] bg-white px-3 text-sm outline-primary" />
                <span className="min-w-10 text-center text-xs font-semibold text-slate-500">{produto?.unidade || '—'}</span>
              </div>
              {locais.length > 1 && (
                <select aria-label="Local de retirada" disabled={busy}
                  className="h-10 w-full rounded-xl border border-[#d7e4da] bg-white px-2 text-xs outline-primary"
                  value={item.deposito_id ? [item.deposito_id, item.gaveta_id || ''].join('|') : ''}
                  onChange={(event) => {
                    const [deposito_id = '', gaveta_id = ''] = event.target.value.split('|');
                    alterarItem(item.key, { deposito_id, gaveta_id });
                  }}>
                  <option value="">Escolher depósito / gaveta</option>
                  {locais.map((loc) => (
                    <option key={`${loc.deposito_id}|${loc.gaveta_id || ''}`}
                      value={`${loc.deposito_id}|${loc.gaveta_id || ''}`}>{loc.nome}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        <button type="button" disabled={busy || form.itens.length >= 50}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#d5e6db] bg-[#edf7f0] px-3 py-2.5 text-xs font-semibold text-emerald-800 hover:bg-[#e2f2e7]"
          onClick={() => onChange((antigo) => ({ ...antigo, itens: [...antigo.itens, novoItem()] }))}>
          <Plus className="h-4 w-4" /> Adicionar produto
        </button>
      </div>
      <div className="flex gap-2 border-t pt-3">
        <button type="button" disabled={busy} onClick={onCancel}
          className="flex-1 rounded-xl border border-[#dbe7df] px-3 py-2.5 text-sm font-semibold hover:bg-slate-50">
          Cancelar
        </button>
        <button type="submit" disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#087c53] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#056745] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Salvar
        </button>
      </div>
    </form>
  );
}

export default function Aplicacao() {
  const { user } = useAuth();
  const { toast } = useToast();
  const podeRevisar = hasPermission(user, 'admin.informe_lavoura.revisar');
  const admTotal = user?.role === 'admin';
  const [aba, setAba] = useState('solicitacoes');
  const [filtro, setFiltro] = useState('PENDENTE');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState([]);
  const [referencias, setReferencias] = useState({ lavouras: [], produtos: [] });
  const [custos, setCustos] = useState({ lavouras: [], informes: {} });
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [historicoCarregando, setHistoricoCarregando] = useState(false);
  const [historicoErro, setHistoricoErro] = useState('');
  const [historicoVersao, setHistoricoVersao] = useState(0);
  const [lavouraSelecionada, setLavouraSelecionada] = useState(null);
  const [editando, setEditando] = useState(null);
  const [acao, setAcao] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async ({ silencioso = false } = {}) => {
    if (!podeRevisar) {
      setLoading(false);
      return;
    }
    if (!silencioso) setLoading(true);
    try {
      const [pendencias, refs, relatorio] = await Promise.all([
        informesLavouraApi.listaAdmin(),
        informesLavouraApi.referencias(),
        admTotal ? informesLavouraApi.custosAdmin() : Promise.resolve({ lavouras: [], informes: {} }),
      ]);
      setLista(pendencias);
      setReferencias(refs);
      setCustos(relatorio);
      setErro('');
    } catch (error) {
      setErro(error.message || 'Falha ao carregar a aplicação.');
    } finally {
      setLoading(false);
    }
  }, [podeRevisar, admTotal]);

  useEffect(() => { carregar(); }, [carregar]);

  // Acompanha novas solicitações do mobile sem criar um segundo fluxo
  // de baixa. Não atualiza enquanto há uma decisão/edição em andamento.
  useEffect(() => {
    if (!podeRevisar) return undefined;
    const verificar = () => {
      if (document.visibilityState !== 'visible' || busy || editando || acao) return;
      carregar({ silencioso: true });
    };
    const timer = window.setInterval(verificar, 45000);
    window.addEventListener('focus', verificar);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', verificar);
    };
  }, [podeRevisar, busy, editando, acao, carregar]);

  const contadores = useMemo(() => ({
    pendentes: lista.filter((i) => i.status === 'PENDENTE' || i.status === 'PROCESSANDO').length,
    aprovadas: lista.filter((i) => i.status === 'APROVADO').length,
    recusadas: lista.filter((i) => i.status === 'RECUSADO').length,
  }), [lista]);

  const listaFiltrada = useMemo(() => {
    const termo = normalizar(busca.trim());
    return lista.filter((item) => {
      if (filtro !== 'TODOS' && (filtro === 'PENDENTE' ? !['PENDENTE', 'PROCESSANDO'].includes(item.status) : item.status !== filtro)) {
        return false;
      }
      if (!termo) return true;
      return normalizar([
        item.lavoura_nome, item.solicitante_nome, item.observacao,
        ...(item.itens || []).map((p) => p.produto_nome),
      ].join(' ')).includes(termo);
    });
  }, [lista, filtro, busca]);
  const selecionado = listaFiltrada.find((i) => i.id === selecionadoId) || listaFiltrada[0] || null;
  const selecionadoHistoricoId = selecionado?.id || null;

  useEffect(() => {
    if (!podeRevisar || !selecionadoHistoricoId || aba !== 'solicitacoes') {
      setHistorico(null);
      setHistoricoErro('');
      return undefined;
    }
    let ativo = true;
    setHistorico(null);
    setHistoricoCarregando(true);
    setHistoricoErro('');
    informesLavouraApi.historicoAdmin(selecionadoHistoricoId)
      .then((resultado) => { if (ativo) setHistorico(resultado); })
      .catch((error) => { if (ativo) setHistoricoErro(error.message || 'Não foi possível consultar o histórico.'); })
      .finally(() => { if (ativo) setHistoricoCarregando(false); });
    return () => { ativo = false; };
  }, [podeRevisar, selecionadoHistoricoId, aba, historicoVersao]);
  const custoTotalNovo = custos.lavouras.reduce((acc, lav) => acc + Number(lav.custo_total || 0), 0);
  const custoTotalOS = custos.lavouras.reduce((acc, lav) => acc + Number(lav.custo_historico_os || 0), 0);
  const lavourasFiltradas = custos.lavouras.filter((lav) => normalizar(lav.lavoura_nome).includes(normalizar(busca)));
  const lavouraAberta = lavourasFiltradas.find((lav) => lav.lavoura_id === lavouraSelecionada) || lavourasFiltradas[0];

  function iniciarEdicao(item) {
    setAcao(null);
    setEditando({
      id: item.id,
      lavoura_id: item.lavoura_id,
      observacao: item.observacao || '',
      itens: (item.itens || []).map((i) => ({
        key: crypto.randomUUID(), produto_id: i.produto_id, quantidade: i.quantidade,
        deposito_id: i.deposito_id || '', gaveta_id: i.gaveta_id || '',
      })),
    });
  }

  async function executar(tipo, item) {
    if (busy || !item) return;
    setErro('');
    setBusy(true);
    try {
      if (tipo === 'editar') {
        await informesLavouraApi.editar(item.id, validar(editando, referencias.produtos));
        setEditando(null);
      } else if (tipo === 'aprovar') {
        await informesLavouraApi.aprovar(item.id);
        await Promise.all([
          invalidateEntidade('Produto'),
          invalidateEntidade('SaldoEstoque'),
          invalidateEntidade('Movimentacao'),
          invalidateEstoque(),
        ]);
      } else if (tipo === 'recusar') {
        if (motivo.trim().length < 3) throw new Error('Informe o motivo da recusa.');
        await informesLavouraApi.recusar(item.id, motivo.trim());
      }
      setAcao(null);
      setMotivo('');
      await carregar({ silencioso: true });
      setHistoricoVersao((versao) => versao + 1);
      toast({
        title: tipo === 'aprovar' ? 'Baixa contabilizada' : tipo === 'recusar' ? 'Solicitação recusada' : 'Solicitação atualizada',
        description: tipo === 'aprovar'
          ? 'O estoque foi atualizado pelo motor oficial.'
          : 'A solicitação foi atualizada no GFARM.',
      });
    } catch (error) {
      setErro(error.message || 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  }

  if (!podeRevisar) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className={`${estiloCard} flex items-center gap-3 p-5`}>
          <ShieldAlert className="h-6 w-6 text-amber-600" />
          <div>
            <h1 className="font-semibold">Aplicação</h1>
            <p className="text-sm text-muted-foreground">Seu usuário precisa da permissão Revisar saída para lavoura para acessar as solicitações.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full bg-[radial-gradient(ellipse_at_top_right,_rgba(70,170,110,0.09),_transparent_47%),#f6faf7] p-3 text-[#173b2d] lg:p-4 xl:p-5">
      <div className="mx-auto max-w-[1600px] space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e0f2e6] text-emerald-800">
              <Sprout className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold leading-tight">Aplicação</h1>
              <p className="text-xs text-slate-500">Saídas para lavoura</p>
            </div>
          </div>
          <button type="button" onClick={() => carregar()} disabled={busy || loading}
            className="flex h-9 items-center gap-2 rounded-xl border border-[#d5e7db] bg-white px-3 text-xs font-semibold text-emerald-800 hover:bg-[#edf8f1]">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </header>

        <div className="flex items-center gap-1 rounded-xl border border-[#e0eae2] bg-white/75 p-1">
          <button type="button" onClick={() => { setAba('solicitacoes'); setBusca(''); }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${aba === 'solicitacoes' ? 'bg-[#087c53] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
            <ClipboardCheck className="h-4 w-4" /> Solicitações
            {contadores.pendentes > 0 && <span className={`rounded-md px-1.5 text-[11px] ${aba === 'solicitacoes' ? 'bg-white/20' : 'bg-amber-100 text-amber-800'}`}>{contadores.pendentes}</span>}
          </button>
          {admTotal && (
            <button type="button" onClick={() => { setAba('custos'); setBusca(''); }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${aba === 'custos' ? 'bg-[#087c53] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
              <CircleDollarSign className="h-4 w-4" /> Custos por Lavoura
            </button>
          )}
        </div>

        {erro && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <span>{erro}</span>
            <button type="button" aria-label="Dispensar aviso" onClick={() => setErro('')}><X className="h-4 w-4" /></button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></div>
        ) : aba === 'solicitacoes' ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { status: 'PENDENTE', nome: 'Pendentes', valor: contadores.pendentes, color: 'text-amber-700' },
                { status: 'APROVADO', nome: 'Aprovadas', valor: contadores.aprovadas, color: 'text-emerald-700' },
                { status: 'RECUSADO', nome: 'Recusadas', valor: contadores.recusadas, color: 'text-rose-700' },
                { status: 'TODOS', nome: 'Histórico', valor: lista.length, color: 'text-[#146344]' },
              ].map((card) => (
                <button key={card.status} type="button" onClick={() => { setFiltro(card.status); setEditando(null); setAcao(null); }}
                  className={`${estiloCard} flex min-w-0 items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors ${filtro === card.status ? 'ring-2 ring-emerald-500/50' : 'hover:bg-[#f4fbf6]'}`}>
                  <span className="min-w-0 truncate text-xs font-semibold text-slate-500">{card.nome}</span>
                  <strong className={`text-lg tabular-nums ${card.color}`}>{card.valor}</strong>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-[11px] h-4 w-4 text-slate-400" />
              <input type="search" value={busca} onChange={(event) => setBusca(event.target.value)}
                placeholder="Pesquisar lavoura, funcionário ou produto"
                className="h-10 w-full rounded-xl border border-[#dce9e0] bg-white/90 pl-9 pr-3 text-sm outline-primary" />
            </div>

            <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
              <section className={`${estiloCard} min-w-0 overflow-hidden`}>
                <div className="flex items-center justify-between gap-2 border-b border-[#edf2ee] px-3 py-2.5">
                  <h2 className="text-sm font-semibold">{filtro === 'TODOS' ? 'Histórico de solicitações' : 'Solicitações'}</h2>
                  <span className="text-xs text-slate-500">{listaFiltrada.length} registro(s)</span>
                </div>
                {!listaFiltrada.length ? (
                  <div className="p-8 text-center text-sm text-slate-500">Nenhuma solicitação encontrada.</div>
                ) : (
                  <div className="divide-y divide-[#eaf0eb]">
                    {listaFiltrada.map((item) => (
                      <button type="button" key={item.id}
                        onClick={() => { setSelecionadoId(item.id); setEditando(null); setAcao(null); }}
                        className={`flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left hover:bg-[#f0f9f3] ${selecionado?.id === item.id ? 'bg-[#eaf6ee]' : ''}`}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e2f3e8] text-emerald-800">
                          <Leaf className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm">{item.lavoura_nome}</strong>
                          <span className="block truncate text-[11px] text-slate-500">
                            {item.solicitante_nome} · {dataBR(item.created_date)} · {(item.itens || []).length} produto(s)
                          </span>
                        </span>
                        <span className="hidden shrink-0 sm:inline-flex"><Estado status={item.status} /></span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <aside className={`${estiloCard} min-w-0 p-3.5`}>
                {!selecionado ? (
                  <div className="flex min-h-32 items-center justify-center text-center text-sm text-slate-500">
                    Selecione uma solicitação para visualizar os detalhes.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-bold">{selecionado.lavoura_nome}</h2>
                        <p className="text-xs text-slate-500">{selecionado.solicitante_nome} · {dataBR(selecionado.created_date)}</p>
                      </div>
                      <Estado status={selecionado.status} />
                    </div>

                    {editando?.id === selecionado.id ? (
                      <FormularioEdicao form={editando} onChange={setEditando}
                        referencias={referencias} busy={busy}
                        onSave={() => executar('editar', selecionado)}
                        onCancel={() => setEditando(null)} />
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          {(selecionado.itens || []).map((item, index) => (
                            <div key={index} className="flex min-w-0 items-center gap-2 rounded-xl bg-[#f3f9f5] px-3 py-2.5">
                              <Package className="h-4 w-4 shrink-0 text-emerald-700" />
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.produto_nome || item.produto_id}</span>
                              <strong className="shrink-0 text-xs tabular-nums">{quantidadeFormatada(item.quantidade)} {item.unidade || ''}</strong>
                            </div>
                          ))}
                        </div>

                        {selecionado.observacao && (
                          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{selecionado.observacao}</p>
                        )}
                        {selecionado.motivo_recusa && (
                          <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">Motivo: {selecionado.motivo_recusa}</p>
                        )}
                        {selecionado.status === 'APROVADO' && (
                          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs">
                            <span className="flex items-center gap-2 font-semibold text-emerald-800">
                              <CheckCircle2 className="h-4 w-4" /> Baixa contabilizada
                            </span>
                            {admTotal && custos.informes[selecionado.id] !== undefined && (
                              <p className="mt-1 text-base font-bold text-emerald-900">{reais(custos.informes[selecionado.id])}</p>
                            )}
                            <p className="mt-1 text-[11px] text-emerald-700">Aprovado por {selecionado.analisado_por_nome || 'ADM'} em {dataBR(selecionado.analisado_em)}</p>
                          </div>
                        )}

                        <HistoricoInforme
                          historico={historico?.solicitacao?.id === selecionado.id ? historico : null}
                          carregando={historicoCarregando}
                          erro={historicoErro}
                        />

                        {selecionado.status === 'PROCESSANDO' && (
                          <button type="button" disabled={busy}
                            onClick={() => executar('aprovar', selecionado)}
                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-900">
                            <RefreshCw className="h-4 w-4" /> Verificar baixa interrompida
                          </button>
                        )}

                        {selecionado.status === 'PENDENTE' && acao?.id !== selecionado.id && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            <button type="button" disabled={busy}
                              onClick={() => iniciarEdicao(selecionado)}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#d3e2d8] px-3 py-2.5 text-xs font-semibold hover:bg-[#eff8f2]">
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button type="button" disabled={busy}
                              onClick={() => setAcao({ id: selecionado.id, tipo: 'aprovar' })}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0b875a] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#076b47]">
                              <Check className="h-3.5 w-3.5" /> Aprovar
                            </button>
                            <button type="button" disabled={busy}
                              onClick={() => { setAcao({ id: selecionado.id, tipo: 'recusar' }); setMotivo(''); }}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                              <X className="h-3.5 w-3.5" /> Recusar
                            </button>
                          </div>
                        )}

                        {selecionado.status === 'PENDENTE' && acao?.id === selecionado.id && (
                          <div className={`space-y-2 rounded-xl border p-3 ${acao.tipo === 'aprovar' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                            <p className="text-xs font-semibold">
                              {acao.tipo === 'aprovar'
                                ? 'Confirmar a baixa dos produtos desta solicitação?'
                                : 'Informe o motivo da recusa'}
                            </p>
                            {acao.tipo === 'recusar' && (
                              <textarea rows={2} maxLength={2000} value={motivo}
                                onChange={(event) => setMotivo(event.target.value)}
                                className="w-full resize-none rounded-lg border border-rose-200 bg-white p-2 text-sm"
                                placeholder="Motivo da recusa" />
                            )}
                            <div className="flex gap-2">
                              <button type="button" disabled={busy} onClick={() => setAcao(null)}
                                className="flex-1 rounded-lg border border-[#d5e5dc] bg-white px-3 py-2 text-xs font-semibold">
                                Voltar
                              </button>
                              <button type="button" disabled={busy || (acao.tipo === 'recusar' && motivo.trim().length < 3)}
                                onClick={() => executar(acao.tipo, selecionado)}
                                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${acao.tipo === 'aprovar' ? 'bg-[#087c53]' : 'bg-rose-700'}`}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                Confirmar
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </aside>
            </div>
          </>
        ) : admTotal ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { titulo: 'Saídas aprovadas', valor: custoTotalNovo, subtitulo: 'Custo oficial do motor' },
                { titulo: 'OS antigas', valor: custoTotalOS, subtitulo: 'Valor histórico registrado' },
                { titulo: 'Total acumulado', valor: custoTotalNovo + custoTotalOS, subtitulo: 'Informes + OS anteriores' },
              ].map((card) => (
                <div key={card.titulo} className={`${estiloCard} px-4 py-3`}>
                  <p className="text-xs text-slate-500">{card.titulo}</p>
                  <strong className="mt-1 block text-xl tabular-nums">{reais(card.valor)}</strong>
                  <p className="text-[11px] text-slate-500">{card.subtitulo}</p>
                </div>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-[11px] h-4 w-4 text-slate-400" />
              <input type="search" value={busca} onChange={(event) => setBusca(event.target.value)}
                placeholder="Pesquisar lavoura" className="h-10 w-full rounded-xl border border-[#dce9e0] bg-white/90 pl-9 pr-3 text-sm outline-primary" />
            </div>
            <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
              <section className={`${estiloCard} min-w-0 overflow-hidden`}>
                <div className="flex items-center justify-between border-b border-[#edf2ee] px-3 py-2.5">
                  <h2 className="text-sm font-semibold">Custo por Lavoura</h2>
                  <span className="text-xs text-slate-500">{lavourasFiltradas.length} lavoura(s)</span>
                </div>
                {!lavourasFiltradas.length ? (
                  <p className="p-8 text-center text-sm text-slate-500">Nenhum custo contabilizado até agora.</p>
                ) : (
                  <div className="divide-y divide-[#eaf0eb]">
                    {lavourasFiltradas.map((lav) => {
                      const total = Number(lav.custo_total || 0) + Number(lav.custo_historico_os || 0);
                      return (
                        <button key={lav.lavoura_id} type="button"
                          onClick={() => setLavouraSelecionada(lav.lavoura_id)}
                          className={`flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left hover:bg-[#f0f9f3] ${lavouraAberta?.lavoura_id === lav.lavoura_id ? 'bg-[#eaf6ee]' : ''}`}>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e2f3e8] text-emerald-800">
                            <Leaf className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-sm">{lav.lavoura_nome}</strong>
                            <small className="text-[11px] text-slate-500">
                              {lav.quantidade_informes || 0} informe(s) · {lav.quantidade_os_historicas || 0} OS anterior(es)
                            </small>
                          </span>
                          <strong className="shrink-0 text-sm tabular-nums text-emerald-800">{reais(total)}</strong>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <aside className={`${estiloCard} min-w-0 space-y-3 p-3.5`}>
                {!lavouraAberta ? (
                  <p className="py-8 text-center text-sm text-slate-500">Selecione uma lavoura.</p>
                ) : (
                  <>
                    <div className="flex items-start gap-2.5">
                      <Sprout className="mt-1 h-5 w-5 text-emerald-700" />
                      <div className="min-w-0">
                        <h2 className="text-base font-bold">{lavouraAberta.lavoura_nome}</h2>
                        <p className="text-xs text-slate-500">
                          {lavouraAberta.hectares > 0 ? `${quantidadeFormatada(lavouraAberta.hectares)} ha` : 'Área não informada'}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#eff8f2] p-3">
                      <p className="text-xs text-slate-500">Total acumulado</p>
                      <strong className="text-2xl tabular-nums">
                        {reais(Number(lavouraAberta.custo_total || 0) + Number(lavouraAberta.custo_historico_os || 0))}
                      </strong>
                      {lavouraAberta.hectares > 0 && (
                        <p className="text-xs font-semibold text-emerald-800">
                          {reais((Number(lavouraAberta.custo_total || 0) + Number(lavouraAberta.custo_historico_os || 0)) / lavouraAberta.hectares)} / ha
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl border border-[#e0eae4] px-3 py-2">
                        <p className="text-slate-500">Novos informes</p>
                        <strong className="text-sm tabular-nums">{reais(lavouraAberta.custo_total)}</strong>
                      </div>
                      <div className="rounded-xl border border-[#e0eae4] px-3 py-2">
                        <p className="text-slate-500">Histórico de OS</p>
                        <strong className="text-sm tabular-nums">{reais(lavouraAberta.custo_historico_os)}</strong>
                      </div>
                    </div>
                    <div className="space-y-1.5 border-t border-[#e8efe9] pt-3">
                      <h3 className="text-xs font-bold">Produtos — novas saídas</h3>
                      {(lavouraAberta.produtos || []).length === 0 ? (
                        <p className="text-xs text-slate-500">Nenhuma saída nova contabilizada.</p>
                      ) : (lavouraAberta.produtos || []).map((produto) => (
                        <div key={`${produto.produto_id}-${produto.unidade}`}
                          className="flex items-center gap-2 rounded-xl bg-[#f5faf6] px-3 py-2.5">
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-xs">{produto.produto_nome}</strong>
                            <span className="text-[11px] text-slate-500">
                              {quantidadeFormatada(produto.quantidade)} {produto.unidade}
                            </span>
                          </span>
                          <strong className="text-xs tabular-nums text-emerald-800">{reais(produto.custo_total)}</strong>
                        </div>
                      ))}
                    </div>
                    {(lavouraAberta.quantidade_os_historicas || 0) > 0 && (
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        As OS antigas permanecem no histórico original. Seu valor fica separado dos documentos contabilizados pelos informes novos.
                      </p>
                    )}
                  </>
                )}
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
