import { useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, Clock3, Loader2,
  Pencil, RefreshCw, ShieldCheck, X,
} from 'lucide-react';

import { entradaSaldoMobileApi } from '@/api/entradaSaldoMobileClient';
import SearchSelect from '@/components/SearchSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Image } from '@/components/ui/image';
import { useEntidades, invalidateEntidade, invalidateEstoque } from '@/lib/useEntidades';

const FILTROS = [
  { value: 'PENDENTE', label: 'Pendentes' },
  { value: 'APROVADO', label: 'Aprovados' },
  { value: 'REJEITADO', label: 'Recusados' },
];

function texto(value) {
  return String(value ?? '').trim();
}

function nomeNormalizado(value) {
  return texto(value).toLocaleUpperCase('pt-BR');
}

function campos(item) {
  return {
    nome_produto: item.nome_produto || '',
    quantidade: String(item.quantidade ?? ''),
    unidade: item.unidade || 'un',
    setor_id: item.setor_id || '',
    deposito_id: item.deposito_id || '',
    gaveta_id: item.gaveta_id || '',
    data_validade: item.data_validade || '',
  };
}

function horario(valor) {
  if (!valor) return '';
  const date = new Date(valor);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
}

export default function MobileEntradaSaldoRevisao() {
  const [filtro, setFiltro] = useState('PENDENTE');
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [abertoId, setAbertoId] = useState('');
  const [editarId, setEditarId] = useState('');
  const [rascunho, setRascunho] = useState(null);
  const [aprovarId, setAprovarId] = useState('');
  const [recusarId, setRecusarId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [mensagem, setMensagem] = useState(null);

  const { data } = useEntidades({
    Setor: {}, Deposito: {}, Gaveta: {}, Produto: {},
  });

  const setores = data.Setor || [];
  const depositos = data.Deposito || [];
  const gavetas = data.Gaveta || [];
  const produtos = data.Produto || [];

  const setoresMap = useMemo(
    () => new Map(setores.map((setor) => [setor.id, setor])),
    [setores]
  );
  const depositosMap = useMemo(
    () => new Map(depositos.map((deposito) => [deposito.id, deposito])),
    [depositos]
  );
  const gavetasMap = useMemo(
    () => new Map(gavetas.map((gaveta) => [gaveta.id, gaveta])),
    [gavetas]
  );

  async function carregar(status = filtro) {
    setLoading(true);
    setMensagem(null);
    try {
      const dados = await entradaSaldoMobileApi.listar(status);
      setItens(Array.isArray(dados) ? dados : []);
    } catch (error) {
      setItens([]);
      setMensagem({ error: true, text: error.message || 'Não foi possível consultar as solicitações.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar(filtro);
  }, [filtro]);

  function mudarFiltro(value) {
    setFiltro(value);
    setAbertoId('');
    setEditarId('');
    setRascunho(null);
    setAprovarId('');
    setRecusarId('');
    setMotivo('');
  }

  function mudarCampo(key, value) {
    setRascunho((antes) => ({
      ...antes,
      [key]: value,
      ...(key === 'setor_id' ? { deposito_id: '', gaveta_id: '', data_validade: '' } : {}),
      ...(key === 'deposito_id' ? { gaveta_id: '' } : {}),
    }));
  }

  function iniciarEdicao(item) {
    setAbertoId(item.id);
    setEditarId(item.id);
    setRascunho(campos(item));
    setAprovarId('');
    setRecusarId('');
    setMensagem(null);
  }

  function cancelarEdicao() {
    setEditarId('');
    setRascunho(null);
  }

  function produtoExistente(nome) {
    return produtos.find((produto) =>
      nomeNormalizado(produto.nome) === nomeNormalizado(nome)
    ) || null;
  }

  function dadosParaRevisao(dados) {
    const nome = texto(dados.nome_produto);
    const quantidade = Number(dados.quantidade);
    const setor = setoresMap.get(dados.setor_id);
    const deposito = depositosMap.get(dados.deposito_id);
    const gavetasLocal = gavetas.filter((gaveta) => gaveta.deposito_id === dados.deposito_id);
    const produto = produtoExistente(nome);

    if (!nome) throw new Error('Informe o nome do produto.');
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new Error('Informe uma quantidade maior que zero.');
    }
    if (!setor || !deposito || (deposito.setor_id && deposito.setor_id !== setor.id)) {
      throw new Error('Selecione um setor e um depósito correspondente.');
    }
    if (gavetasLocal.length && !gavetasLocal.some((gaveta) => gaveta.id === dados.gaveta_id)) {
      throw new Error('Selecione uma gaveta válida deste depósito.');
    }
    if (setor.controla_validade && !dados.data_validade) {
      throw new Error('Este setor exige uma data de validade.');
    }
    if (produto && produto.setor_id !== setor.id) {
      throw new Error('Este produto pertence a outro setor. Revise o cadastro.');
    }

    return {
      nome_produto: nome,
      quantidade,
      setor_id: setor.id,
      deposito_id: deposito.id,
      gaveta_id: dados.gaveta_id || null,
      unidade: texto(produto?.unidade || dados.unidade || 'un'),
      data_validade: dados.data_validade || null,
    };
  }

  async function salvarEdicao(item) {
    if (!rascunho || busy) return;
    let dados;
    try {
      dados = dadosParaRevisao(rascunho);
    } catch (error) {
      setMensagem({ error: true, text: error.message });
      return;
    }
    setBusy(true);
    setMensagem(null);
    try {
      await entradaSaldoMobileApi.editar(item.id, dados);
      cancelarEdicao();
      await carregar();
      setMensagem({ error: false, text: 'Alterações salvas. Nenhum saldo foi movimentado.' });
      setAbertoId(item.id);
    } catch (error) {
      setMensagem({ error: true, text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmarAprovacao(item) {
    if (busy || editarId) return;
    let dados;
    try {
      dados = dadosParaRevisao(campos(item));
    } catch (error) {
      setMensagem({ error: true, text: error.message });
      return;
    }
    setBusy(true);
    setMensagem(null);
    try {
      const resultado = await entradaSaldoMobileApi.aprovar(item.id, dados);
      await Promise.all([invalidateEntidade('Produto'), invalidateEstoque()]);
      setAprovarId('');
      await carregar();
      setMensagem({
        error: false,
        text: resultado?.documento?.numero
          ? 'Entrada aprovada e contabilizada pelo motor: ' + resultado.documento.numero
          : 'Entrada aprovada e contabilizada pelo motor de estoque.',
      });
    } catch (error) {
      setMensagem({ error: true, text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmarRecusa(item) {
    if (busy) return;
    if (texto(motivo).length < 2) {
      setMensagem({ error: true, text: 'Informe um motivo para recusar.' });
      return;
    }
    setBusy(true);
    setMensagem(null);
    try {
      await entradaSaldoMobileApi.rejeitar(item.id, texto(motivo));
      setRecusarId('');
      setMotivo('');
      await carregar();
      setMensagem({ error: false, text: 'Solicitação recusada, sem movimentar o estoque.' });
    } catch (error) {
      setMensagem({ error: true, text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border bg-card p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-bold">Revisão de entradas manuais</h2>
              <p className="text-[11px] text-muted-foreground">
                Só Aprovar contabiliza pelo motor de estoque.
              </p>
            </div>
          </div>
          <Button type="button" size="icon" variant="outline" aria-label="Atualizar lançamentos"
            disabled={busy || loading} onClick={() => carregar()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-muted/40 p-1">
          {FILTROS.map((opcao) => (
            <button key={opcao.value} type="button"
              onClick={() => mudarFiltro(opcao.value)}
              className={'rounded-lg px-1 py-2 text-[11px] font-semibold ' +
                (filtro === opcao.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>
              {opcao.label}
            </button>
          ))}
        </div>
      </div>

      {mensagem && (
        <div role="status" className={
          'rounded-xl border px-3 py-2 text-xs ' +
          (mensagem.error
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800')
        }>
          {mensagem.text}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : itens.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma solicitação {filtro === 'PENDENTE' ? 'pendente' : filtro === 'APROVADO' ? 'aprovada' : 'recusada'}.
        </div>
      ) : itens.map((item) => {
        const aberto = abertoId === item.id;
        const editando = editarId === item.id;
        const dados = editando ? rascunho : campos(item);
        const setor = setoresMap.get(dados?.setor_id);
        const depsLocal = depositos.filter((dep) => dep.setor_id === dados?.setor_id);
        const gavetasLocal = gavetas.filter((gaveta) => gaveta.deposito_id === dados?.deposito_id);
        const existente = produtoExistente(dados?.nome_produto);
        return (
          <article key={item.id} className="overflow-hidden rounded-2xl border bg-card">
            <button type="button" className="flex w-full items-start gap-3 p-3.5 text-left"
              onClick={() => {
                if (busy || editarId || recusarId || aprovarId) return;
                setAbertoId(aberto ? '' : item.id);
              }}>
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted/30">
                {item.foto_url
                  ? <Image src={item.foto_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-xl text-muted-foreground">+</div>}
              </div>
              <div className="min-w-0 flex-1">
                <strong className="block break-words text-sm font-semibold">{item.nome_produto}</strong>
                <span className="mt-0.5 block text-xs">
                  {item.quantidade} {item.unidade || 'un'} · {setoresMap.get(item.setor_id)?.nome || 'Setor'}
                </span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  <Clock3 className="mr-1 inline h-3 w-3" />
                  {item.solicitante_nome || 'Usuário'} · {horario(item.created_date)}
                </span>
              </div>
              {aberto
                ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>

            {aberto && (
              <div className="space-y-3 border-t px-3.5 py-3.5">
                {editando ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Produto</Label>
                      <Input className="h-11 text-base" value={dados.nome_produto}
                        onChange={(event) => mudarCampo('nome_produto', event.target.value)} />
                    </div>
                    <div className="grid grid-cols-[1fr_110px] gap-2">
                      <div className="space-y-1.5">
                        <Label>Quantidade</Label>
                        <Input className="h-11 text-base" inputMode="decimal" type="number"
                          min="0.001" step="0.001" value={dados.quantidade}
                          onChange={(event) => mudarCampo('quantidade', event.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Unidade</Label>
                        <Input className="h-11" value={existente?.unidade || dados.unidade}
                          disabled={!!existente} onChange={(event) => mudarCampo('unidade', event.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Setor</Label>
                      <SearchSelect value={dados.setor_id || 'all'} onChange={(value) =>
                        mudarCampo('setor_id', value === 'all' ? '' : value)
                      } allLabel="Selecione o setor" options={setores.map((x) => ({ value: x.id, label: x.nome }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Depósito</Label>
                      <SearchSelect value={dados.deposito_id || 'all'} onChange={(value) =>
                        mudarCampo('deposito_id', value === 'all' ? '' : value)
                      } allLabel="Selecione o depósito"
                        options={depsLocal.map((x) => ({
                          value: x.id, label: [x.numero, x.nome].filter(Boolean).join(' — ') || 'Depósito',
                        }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Gaveta {gavetasLocal.length ? '*' : ''}</Label>
                      {gavetasLocal.length ? (
                        <SearchSelect value={dados.gaveta_id || 'all'} onChange={(value) =>
                          mudarCampo('gaveta_id', value === 'all' ? '' : value)
                        } allLabel="Selecione a gaveta"
                          options={gavetasLocal.map((x) => ({
                            value: x.id, label: [x.codigo, x.descricao].filter(Boolean).join(' — ') || 'Gaveta',
                          }))} />
                      ) : (
                        <div className="rounded-xl border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">Sem gavetas cadastradas</div>
                      )}
                    </div>
                    {setor?.controla_validade && (
                      <div className="space-y-1.5">
                        <Label>Data de validade *</Label>
                        <Input type="date" className="h-11" value={dados.data_validade || ''}
                          onChange={(event) => mudarCampo('data_validade', event.target.value)} />
                      </div>
                    )}
                    {existente && (
                      <p className="text-[11px] text-muted-foreground">
                        Produto existente: a unidade original será respeitada.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" disabled={busy} onClick={cancelarEdicao}>
                        Cancelar
                      </Button>
                      <Button type="button" disabled={busy} onClick={() => salvarEdicao(item)}>
                        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                        Salvar edição
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Editar não movimenta estoque. Para contabilizar, aprove depois de salvar.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="block text-muted-foreground">Depósito</span>
                        <strong className="break-words">{[
                          depositosMap.get(item.deposito_id)?.numero,
                          depositosMap.get(item.deposito_id)?.nome,
                        ].filter(Boolean).join(' — ') || '—'}</strong>
                      </div>
                      <div><span className="block text-muted-foreground">Gaveta</span>
                        <strong className="break-words">{gavetasMap.get(item.gaveta_id)?.codigo || 'Sem gaveta'}</strong>
                      </div>
                      {item.data_validade && (
                        <div><span className="block text-muted-foreground">Validade</span><strong>{item.data_validade}</strong></div>
                      )}
                      <div><span className="block text-muted-foreground">Status</span>
                        <strong>{item.status === 'PENDENTE' ? 'Aguardando revisão' :
                          item.status === 'APROVADO' ? 'Aprovado' : 'Recusado'}</strong>
                      </div>
                    </div>
                    {item.status === 'APROVADO' && (
                      <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        Contabilizado no estoque. Documento: {item.documento_estoque_id || '—'}.
                      </p>
                    )}
                    {item.status === 'REJEITADO' && item.motivo_rejeicao && (
                      <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
                        Motivo da recusa: {item.motivo_rejeicao}
                      </p>
                    )}
                    {item.status === 'PENDENTE' && aprovarId !== item.id && recusarId !== item.id && (
                      <div className="grid grid-cols-3 gap-2">
                        <Button type="button" variant="outline" className="px-1 text-xs" disabled={busy}
                          onClick={() => iniciarEdicao(item)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                        </Button>
                        <Button type="button" className="px-1 text-xs" disabled={busy}
                          onClick={() => { setAprovarId(item.id); setMensagem(null); }}>
                          <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                        </Button>
                        <Button type="button" variant="outline" className="px-1 text-xs text-destructive" disabled={busy}
                          onClick={() => { setRecusarId(item.id); setMotivo(''); setMensagem(null); }}>
                          <X className="mr-1 h-3.5 w-3.5" /> Recusar
                        </Button>
                      </div>
                    )}
                    {item.status === 'PENDENTE' && aprovarId === item.id && (
                      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <strong className="block text-sm">Aprovar e contabilizar?</strong>
                        <p className="text-xs text-emerald-900">
                          O motor oficial registrará {item.quantidade} {item.unidade || 'un'} em estoque. Esta ação não é apenas uma edição.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" variant="outline" disabled={busy} onClick={() => setAprovarId('')}>Voltar</Button>
                          <Button type="button" disabled={busy} onClick={() => confirmarAprovacao(item)}>
                            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                            Confirmar
                          </Button>
                        </div>
                      </div>
                    )}
                    {item.status === 'PENDENTE' && recusarId === item.id && (
                      <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                        <Label>Motivo da recusa *</Label>
                        <Textarea rows={3} value={motivo} maxLength={2000}
                          onChange={(event) => setMotivo(event.target.value)}
                          placeholder="Explique por que a solicitação foi recusada" />
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" variant="outline" disabled={busy} onClick={() => setRecusarId('')}>Voltar</Button>
                          <Button type="button" variant="destructive" disabled={busy || texto(motivo).length < 2}
                            onClick={() => confirmarRecusa(item)}>
                            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <X className="mr-1 h-4 w-4" />}
                            Confirmar recusa
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
