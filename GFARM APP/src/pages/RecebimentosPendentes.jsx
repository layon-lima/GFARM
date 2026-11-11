import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, RefreshCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useEntidades, invalidateEstoque } from '@/lib/useEntidades';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';

const API = import.meta.env.VITE_API_URL || '/api';
async function request(path, method = 'GET', payload) {
  const token = localStorage.getItem('nh_access_token');
  const response = await fetch(API + '/integracoes/recebimentos' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Falha ao processar recebimento.');
  return data;
}
const txt = value => String(value ?? '');
const money = value => value === null || value === undefined ? '—' : 'R$ ' + Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function RecebimentosPendentes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const permitido = hasPermission(user, 'admin.estoque.entrada_manual');
  const { data } = useEntidades({ Produto: {}, Deposito: {}, Gaveta: {}, Setor: {} });
  const produtos = data.Produto || [];
  const depositos = data.Deposito || [];
  const gavetas = data.Gaveta || [];
  const [itens, setItens] = useState([]);
  const [edicoes, setEdicoes] = useState({});
  const [buscas, setBuscas] = useState({});
  const [recusas, setRecusas] = useState({});
  const [status, setStatus] = useState('PENDENTE');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');

  const produtosOrdenados = useMemo(() => [...produtos].sort((a, b) => txt(a.nome).localeCompare(txt(b.nome), 'pt-BR')), [produtos]);

  async function carregar() {
    if (!permitido) return;
    setLoading(true);
    try {
      const lista = await request('?status=' + status);
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
      toast({ variant: 'destructive', title: 'Erro ao listar recebimentos', description: error.message });
    } finally { setLoading(false); }
  }

  useEffect(() => { carregar(); }, [status, permitido]);

  function alterar(id, campo, valor) {
    setEdicoes(prev => ({
      ...prev,
      [id]: { ...prev[id], [campo]: valor,
        ...(campo === 'produto_id' ? { deposito_id: '', gaveta_id: '' } : {}),
        ...(campo === 'deposito_id' ? { gaveta_id: '' } : {})
      }
    }));
  }

  async function aprovar(item) {
    const edit = edicoes[item.origem_id];
    if (!edit?.produto_id || !edit?.deposito_id) {
      toast({ variant: 'destructive', title: 'Selecione produto e depósito do GFARM' }); return;
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
        <Button variant="outline" onClick={carregar} disabled={loading}><RefreshCcw className="mr-1 h-4 w-4" /> Atualizar</Button>
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
          <div>{d.quantidade} {d.unidade} · {money(d.valor_unitario)} / {d.unidade} · Total {money(d.valor_total)}</div>
          <div className="mt-1 break-all text-xs text-muted-foreground">Chave {d.chave_acesso || 'não informada'} · Código {d.codigo_produto || '—'} · CFOP {d.cfop || '—'} · NCM {d.ncm || '—'} · Validade {d.validade || '—'}</div>
        </div>
        {fechado ? <p className="text-sm text-muted-foreground">{item.documento_estoque_id ? 'Documento do estoque: ' + item.documento_estoque_id : item.motivo_recusa}</p> : <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs">Buscar produto do GFARM
            <Input placeholder="Nome ou código" value={buscas[item.origem_id] || ''} onChange={ev => setBuscas(p => ({ ...p, [item.origem_id]: ev.target.value }))} />
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={e.produto_id || ''} onChange={ev => alterar(item.origem_id, 'produto_id', ev.target.value)}>
              <option value="">Selecione o produto</option>
              {encontrados.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.unidade})</option>)}
            </select>
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
          <label className="space-y-1 text-xs">Custo unitário na unidade-base (R$)
            <Input type="number" min="0" step="any" placeholder="Calculado pelo motor da unidade" value={e.custo_unitario_base ?? ''} onChange={ev => alterar(item.origem_id, 'custo_unitario_base', ev.target.value)} />
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
  </div>;
}
