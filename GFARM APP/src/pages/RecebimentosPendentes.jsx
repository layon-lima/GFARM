import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, FileUp, PackagePlus, RefreshCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useEntidades, invalidateEstoque } from '@/lib/useEntidades';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import NovoProdutoDaNota from '@/components/movimentacoes/NovoProdutoDaNota';

const API = import.meta.env.VITE_API_URL || '/api';
async function request(path, method = 'GET', payload, signal) {
  const token = localStorage.getItem('nh_access_token');
  const response = await fetch(API + '/integracoes/recebimentos' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detalhe = typeof data.detail === 'string' ? data.detail
      : Array.isArray(data.detail) ? data.detail.map(x => x.msg).filter(Boolean).join('; ')
      : typeof data.message === 'string' ? data.message : '';
    throw new Error(detalhe || ('Erro HTTP ' + response.status + ' ao consultar recebimentos no GFARM.'));
  }
  return data;
}
const txt = value => String(value ?? '');
const money = value => value === null || value === undefined ? '—' : 'R$ ' + Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function RecebimentosPendentes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const permitido = hasPermission(user, 'admin.estoque.entrada_manual');
  // Segue a mesma permissão da tela de cadastros: revisar estoque não concede,
  // por si só, autorização para criar produtos mestres.
  const podeCadastrar = hasPermission(user, 'page.cadastros');
  const { data } = useEntidades({ Produto: {}, Deposito: {}, Gaveta: {}, Setor: {} });
  const [produtosCriados, setProdutosCriados] = useState([]);
  const produtos = useMemo(() => {
    const atuais = data.Produto || [];
    const ids = new Set(atuais.map(produto => produto.id));
    return [...atuais, ...produtosCriados.filter(produto => !ids.has(produto.id))];
  }, [data.Produto, produtosCriados]);
  const setores = data.Setor || [];
  const depositos = data.Deposito || [];
  const gavetas = data.Gaveta || [];
  const [itens, setItens] = useState([]);
  const [edicoes, setEdicoes] = useState({});
  const [buscas, setBuscas] = useState({});
  const [recusas, setRecusas] = useState({});
  const [status, setStatus] = useState('PENDENTE');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [recuperando, setRecuperando] = useState('');
  const [criandoProdutoDe, setCriandoProdutoDe] = useState(null);

  const produtosOrdenados = useMemo(() => [...produtos].sort((a, b) => txt(a.nome).localeCompare(txt(b.nome), 'pt-BR')), [produtos]);

  async function carregar(signal) {
    if (!permitido) return;
    setLoading(true);
    try {
      const lista = await request('?status=' + status, 'GET', undefined, signal);
      if (signal?.aborted) return;
      if (!Array.isArray(lista)) throw new Error('A API retornou uma lista de recebimentos inválida.');
      setItens(lista);
      setEdicoes(prev => Object.fromEntries(lista.map(item => [
        item.origem_id, prev[item.origem_id] || {
          produto_id: '', deposito_id: '', gaveta_id: '',
          quantidade: txt(item.dados.quantidade),
          unidade: item.dados.unidade,
          fator_conversao: '', custo_unitario_base: '',
          validade: item.dados.validade || ''
        }
      ])));
    } catch (error) {
      // O modo StrictMode do React cancela a primeira consulta ao montar a tela;
      // não exibir dois avisos para um único erro.
      if (signal?.aborted || error.name === 'AbortError') return;
      toast({ variant: 'destructive', title: 'Erro ao listar recebimentos', description: error.message });
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    carregar(controller.signal);
    return () => controller.abort();
  }, [status, permitido]);

  async function selecionarProdutoCriado(produto, { novo } = {}) {
    setProdutosCriados(prev => [...prev.filter(item => item.id !== produto.id), produto]);
    setBuscas(prev => ({ ...prev, [criandoProdutoDe.origem_id]: produto.nome }));
    setEdicoes(prev => {
      const id = criandoProdutoDe.origem_id;
      const atual = prev[id] || {};
      const deposito = depositos.find(dep => dep.id === atual.deposito_id);
      const depositoId = deposito?.setor_id === produto.setor_id
        ? atual.deposito_id : (produto.deposito_id || '');
      const gavetaId = [atual.gaveta_id, produto.gaveta_id].find(gavetaId =>
        gavetaId && gavetas.some(gaveta => gaveta.id === gavetaId && gaveta.deposito_id === depositoId)
      ) || '';
      return {
        ...prev,
        [id]: {
          ...atual, produto_id: produto.id,
          deposito_id: depositoId,
          gaveta_id: gavetaId,
        },
      };
    });
    setCriandoProdutoDe(null);
    if (!novo) {
      toast({ title: 'Produto existente selecionado', description: produto.nome });
    }
  }

  function alterar(id, campo, valor) {
    setEdicoes(prev => ({
      ...prev,
      [id]: { ...prev[id], [campo]: valor,
        ...(campo === 'produto_id' ? { deposito_id: '', gaveta_id: '' } : {}),
        ...(campo === 'deposito_id' ? { gaveta_id: '' } : {})
      }
    }));
  }

  async function recuperarValorXml(item, arquivo) {
    if (!arquivo || recuperando) return;
    if (arquivo.size > 3 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'XML muito grande', description: 'Máximo de 3 MB.' });
      return;
    }
    setRecuperando(item.origem_id);
    try {
      const xml = await new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => {
          const resultado = String(leitor.result || '');
          resolve(resultado.slice(resultado.indexOf(',') + 1));
        };
        leitor.onerror = () => reject(new Error('Não foi possível ler o XML no navegador.'));
        leitor.readAsDataURL(arquivo);
      });
      const retorno = await request(
        '/' + encodeURIComponent(item.origem_id) + '/recuperar-custo-xml',
        'POST', { xml }
      );
      await carregar();
      toast({
        title: 'Custo fiscal recuperado da NF-e',
        description: retorno.itens_atualizados + ' produto(s) da mesma nota atualizado(s).' +
          (retorno.nao_identificados?.length ? ' Alguns produtos precisam de conferência.' : ''),
      });
    } catch (erro) {
      toast({
        variant: 'destructive', title: 'Não foi possível recuperar o custo',
        description: erro.message,
      });
    } finally {
      setRecuperando('');
    }
  }

  async function aprovar(item) {
    const edit = edicoes[item.origem_id];
    if (!edit?.produto_id || !edit?.deposito_id) {
      toast({ variant: 'destructive', title: 'Selecione produto e depósito do GFARM' }); return;
    }
    if (item.dados.valor_unitario == null && item.dados.valor_total == null &&
        edit.custo_unitario_base === '') {
      toast({
        variant: 'destructive', title: 'Falta o valor fiscal da NF-e',
        description: 'Use "Recuperar custo pelo XML" nesta nota. O GFARM não vai inventar o preço.',
      });
      return;
    }
    const payload = {
      produto_id: edit.produto_id, deposito_id: edit.deposito_id,
      gaveta_id: edit.gaveta_id || null,
      quantidade: edit.quantidade, unidade: edit.unidade,
      ...(edit.fator_conversao ? { fator_conversao: edit.fator_conversao } : {}),
      ...(edit.custo_unitario_base !== '' ? { custo_unitario_base: edit.custo_unitario_base } : {}),
      ...(edit.validade ? { validade: edit.validade } : {}),
    };
    setSaving(item.origem_id);
    try {
      const result = await request('/' + encodeURIComponent(item.origem_id) + '/aprovar', 'POST', payload);
      invalidateEstoque();
      toast({ title: 'Entrada aprovada pelo motor', description: 'Documento: ' + result.documento_estoque_id });
      await carregar();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Entrada não aprovada', description: error.message });
    } finally { setSaving(''); }
  }

  async function recusar(item) {
    const motivo = txt(recusas[item.origem_id]).trim();
    if (motivo.length < 2) {
      toast({ variant: 'destructive', title: 'Informe o motivo da recusa' }); return;
    }
    setSaving(item.origem_id);
    try {
      await request('/' + encodeURIComponent(item.origem_id) + '/recusar', 'POST', { motivo });
      toast({ title: 'Recebimento recusado' });
      await carregar();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Falha na recusa', description: error.message });
    } finally { setSaving(''); }
  }

  if (!permitido) return <Card className="p-4">Somente administradores autorizados podem aprovar recebimentos do Meus Controles.</Card>;

  return <div className="space-y-3 p-3 lg:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <Link to="/movimentacoes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"><ChevronLeft className="h-4 w-4" /> Movimentos</Link>
        <h1 className="text-xl font-semibold">Recebimentos do Meus Controles</h1>
        <p className="text-xs text-muted-foreground">Nada altera o saldo até sua aprovação. Confira produto, quantidade, local e custo.</p>
      </div>
      <div className="flex items-center gap-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="PENDENTE">Pendentes</option>
          <option value="PROCESSANDO">Em processamento</option>
          <option value="APROVADO">Aprovados</option>
          <option value="REJEITADO">Recusados</option>
        </select>
        <Button variant="outline" onClick={() => carregar()} disabled={loading}><RefreshCcw className="mr-1 h-4 w-4" /> Atualizar</Button>
      </div>
    </div>
    {loading && !itens.length ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}
    {!loading && !itens.length ? <Card className="p-5 text-sm text-muted-foreground">Nenhum recebimento nesta situação.</Card> : null}
    {itens.map(item => {
      const d = item.dados;
      const e = edicoes[item.origem_id] || {};
      const produto = produtos.find(p => p.id === e.produto_id);
      const optsDepositos = depositos.filter(dep => !produto?.setor_id || dep.setor_id === produto.setor_id);
      const optsGavetas = gavetas.filter(gav => gav.deposito_id === e.deposito_id);
      const filtro = txt(buscas[item.origem_id]).toLowerCase();
      const encontrados = produtosOrdenados.filter(p => (txt(p.nome) + ' ' + txt(p.codigo)).toLowerCase().includes(filtro)).slice(0, 100);
      const fechado = item.status === 'APROVADO' || item.status === 'REJEITADO';
      const semCusto = d.valor_unitario == null && d.valor_total == null;
      const unitarioFiscal = d.valor_total != null && Number(d.quantidade) > 0
        ? Number(d.valor_total) / Number(d.quantidade)
        : d.valor_unitario == null ? null : Number(d.valor_unitario);
      return <Card key={item.origem_id} className="space-y-3 border-border/70 p-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">NF {d.numero_nota} {d.serie ? '· Série ' + d.serie : ''}</div>
            <div className="text-xs text-muted-foreground">{d.fornecedor} {d.documento_fornecedor ? '· ' + d.documento_fornecedor : ''}</div>
            <div className="text-xs text-muted-foreground">Pedido {d.numero_pedido || '—'} · Recebido em {d.data_recebimento || '—'}</div>
          </div>
          <span className="text-xs font-semibold">{item.status}</span>
        </div>
        <div className="rounded-md border bg-muted/20 p-2 text-sm">
          <div className="font-semibold">{d.produto}</div>
          <div>{d.quantidade} {d.unidade} · {money(unitarioFiscal)} / {d.unidade} · Total {money(d.valor_total)}</div>
          <div className={semCusto ? 'mt-1 text-xs font-medium text-amber-700' : 'mt-1 text-xs text-emerald-700'}>
            {semCusto
              ? 'A nota chegou sem os valores fiscais. Recupere o custo com o XML original.'
              : 'Custo unitário fiscal identificado — conversão para unidade-base automática na aprovação.'}
          </div>
          <div className="mt-1 break-all text-xs text-muted-foreground">Chave {d.chave_acesso || 'não informada'} · Código {d.codigo_produto || '—'} · CFOP {d.cfop || '—'} · NCM {d.ncm || '—'} · Validade {d.validade || '—'}</div>
        </div>
        {!fechado && semCusto ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/70 bg-amber-50/60 px-3 py-2 text-xs">
            <span>O custo não foi enviado pelo Controles. Anexe o XML original desta NF-e para recuperar os preços.</span>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2.5 py-1.5 font-semibold hover:bg-muted">
              <FileUp className="h-3.5 w-3.5" />
              {recuperando === item.origem_id ? 'Lendo XML...' : 'Recuperar custo pelo XML'}
              <input
                type="file" accept=".xml,application/xml,text/xml" className="sr-only"
                disabled={!!recuperando}
                onChange={event => {
                  const arquivo = event.target.files?.[0];
                  event.target.value = '';
                  if (arquivo) recuperarValorXml(item, arquivo);
                }}
              />
            </label>
          </div>
        ) : null}
        {fechado ? <p className="text-sm text-muted-foreground">{item.documento_estoque_id ? 'Documento do estoque: ' + item.documento_estoque_id : item.motivo_recusa}</p> : <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs">Buscar produto do GFARM
            <Input placeholder="Nome ou código" value={buscas[item.origem_id] || ''} onChange={ev => setBuscas(p => ({ ...p, [item.origem_id]: ev.target.value }))} />
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={e.produto_id || ''} onChange={ev => alterar(item.origem_id, 'produto_id', ev.target.value)}>
              <option value="">Selecione o produto</option>
              {encontrados.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.unidade})</option>)}
            </select>
            {!e.produto_id && podeCadastrar ? (
              <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                onClick={() => setCriandoProdutoDe(item)}>
                <PackagePlus className="h-3.5 w-3.5" /> Não encontrou? Cadastrar usando a NF-e
              </button>
            ) : null}
            {!e.produto_id && !podeCadastrar ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Produto não encontrado? Solicite o cadastro a quem tem acesso a Cadastros.
              </p>
            ) : null}
          </label>
          <label className="space-y-1 text-xs">Depósito de destino
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={e.deposito_id || ''} onChange={ev => alterar(item.origem_id, 'deposito_id', ev.target.value)}>
              <option value="">Selecione depósito</option>
              {optsDepositos.map(dep => <option key={dep.id} value={dep.id}>{dep.numero || ''} {dep.nome || ''}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">Gaveta
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={e.gaveta_id || ''} onChange={ev => alterar(item.origem_id, 'gaveta_id', ev.target.value)}>
              <option value="">Sem gaveta</option>
              {optsGavetas.map(gav => <option key={gav.id} value={gav.id}>{gav.numero || ''} {gav.nome || ''}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">Quantidade
            <Input type="number" min="0.001" step="any" value={e.quantidade || ''} onChange={ev => alterar(item.origem_id, 'quantidade', ev.target.value)} />
          </label>
          <label className="space-y-1 text-xs">Unidade da nota
            <Input value={e.unidade || ''} onChange={ev => alterar(item.origem_id, 'unidade', ev.target.value)} />
          </label>
          <label className="space-y-1 text-xs">Conversão para unidade-base (opcional)
            <Input type="number" min="0.000001" step="any" placeholder="Automática pelo motor" value={e.fator_conversao || ''} onChange={ev => alterar(item.origem_id, 'fator_conversao', ev.target.value)} />
          </label>
          <label className="space-y-1 text-xs">Ajuste excepcional de custo na unidade-base (R$)
            <Input type="number" min="0" step="any" placeholder="Automático a partir da NF-e" value={e.custo_unitario_base ?? ''} onChange={ev => alterar(item.origem_id, 'custo_unitario_base', ev.target.value)} />
            <span className="block text-[10px] text-muted-foreground">
              Deixe vazio para utilizar o preço da nota, com a conversão do produto.
            </span>
          </label>
          <label className="space-y-1 text-xs">Validade
            <Input type="date" value={e.validade || ''} onChange={ev => alterar(item.origem_id, 'validade', ev.target.value)} />
          </label>
          <div className="flex gap-2 md:col-span-2 xl:col-span-4">
            <Button disabled={!!saving || !e.produto_id || !e.deposito_id} onClick={() => aprovar(item)}><Check className="mr-1 h-4 w-4" /> Aprovar entrada</Button>
            <Input placeholder="Motivo obrigatório para recusar" value={recusas[item.origem_id] || ''} onChange={ev => setRecusas(v => ({ ...v, [item.origem_id]: ev.target.value }))} />
            <Button variant="outline" disabled={!!saving || item.status !== 'PENDENTE'} onClick={() => recusar(item)}><XCircle className="mr-1 h-4 w-4" /> Recusar</Button>
          </div>
        </div>}
      </Card>;
    })}
    {criandoProdutoDe && (
      <NovoProdutoDaNota
        key={criandoProdutoDe.origem_id}
        item={criandoProdutoDe}
        setores={setores}
        depositos={depositos}
        gavetas={gavetas}
        produtos={produtos}
        depositoInicial={edicoes[criandoProdutoDe.origem_id]?.deposito_id || ''}
        onClose={() => setCriandoProdutoDe(null)}
        onCreated={selecionarProdutoCriado}
      />
    )}
  </div>;
}
