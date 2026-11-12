import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ExternalLink, RefreshCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useEntidades, invalidateEstoque } from '@/lib/useEntidades';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import NovoProdutoDaNota from '@/components/movimentacoes/NovoProdutoDaNota';
import ConsultaXmlFazenda from '@/components/movimentacoes/ConsultaXmlFazenda';
import EscolherProdutoDaNota from '@/components/movimentacoes/EscolherProdutoDaNota';
import { encontrarProdutoExatoDaNota } from '@/lib/correspondenciaProdutoNfe';
import { precoFiscalNaUnidadeBase, precoFiscalParaInput } from '@/lib/custoRecebimentoNfe';
import { aplicarItensFiscaisXml } from '@/lib/atualizarRecebimentosXml';
import { formatarValidadeInicial, interpretarValidadeLivre, linkConsultaFiscalNfe } from '@/lib/consultaFiscalNfe';
const FSIST_URL = 'https://www.fsist.com.br/';
const EXTENSAO_GFARM_URL =
  'https://github.com/layon-lima/GFARM/releases/download/gfarm-captura-xml-v0.1.0/gfarm-captura-xml-chrome.zip';

const API = import.meta.env.VITE_API_URL || '/api';
async function request(path, method = 'GET', payload, signal) {
  const token = localStorage.getItem('nh_access_token');
  const response = await fetch(API + '/integracoes/recebimentos' + path, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detalhe = typeof data.detail === 'string' ? data.detail
      : Array.isArray(data.detail) ? data.detail.map(x => x.msg).filter(Boolean).join('; ')
      : typeof data.message === 'string' ? data.message : '';
    const acao = path.endsWith('/aprovar') ? 'aprovar a entrada' :
      path.endsWith('/recusar') ? 'recusar a entrada' :
      path.includes('/recuperar-custo-xml') ? 'recuperar o custo da NF-e' :
      'consultar recebimentos';
    throw new Error(detalhe || ('Erro HTTP ' + response.status + ' ao ' + acao + ' no GFARM.'));
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
  const { data, loading: carregandoCadastros, reload: recarregarCadastros } = useEntidades({ Produto: {}, Deposito: {}, Gaveta: {}, Setor: {} });
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
  const [consultandoNota, setConsultandoNota] = useState(null);
  const [extensaoAusente, setExtensaoAusente] = useState('');
  const [avisosXml, setAvisosXml] = useState({});
  const abaFSistRef = useRef(null);

  function abrirFSist(item) {
    if (!/^[0-9]{44}$/.test(String(item.dados.chave_acesso || ''))) {
      toast({ variant: 'destructive', title: 'Chave da NF-e inválida',
        description: 'A consulta exige uma chave de 44 dígitos.' });
      return;
    }
    // A aba deve ser aberta sincronamente pelo clique, antes de esperar
    // a extensão. Só navegamos depois de ativar a captura, para não haver
    // corrida entre o carregamento do FSist e a chave ativa na extensão.
    const aba = window.open('about:blank', '_blank');
    if (!aba) {
      toast({ variant: 'destructive', title: 'Pop-up bloqueado',
        description: 'Permita abrir abas para o GFARM e tente novamente.' });
      return;
    }
    aba.opener = null;
    abaFSistRef.current = aba;
    setExtensaoAusente('');
    setConsultandoNota(item);
  }

  function fsistPronto(ok, mensagem) {
    const aba = abaFSistRef.current;
    if (aba && !aba.closed) {
      try { aba.location.replace(FSIST_URL); } catch { /* Aba fechada ou protegida. */ }
    }
    abaFSistRef.current = null;
    // O site nao pode instalar extensoes automaticamente.
    // Quando ausente, manter o FSist aberto e oferecer um link discreto.
    setExtensaoAusente(ok ? '' : (
      mensagem || 'Instale a extensão GFARM para capturar XMLs automaticamente.'
    ));
  }

  // A fila pode chegar ANTES do cache de Produtos. Vincular quando ambos
  // estiverem carregados, sem sobrescrever escolhas/correções feitas pelo usuário.
  useEffect(() => {
    if (!produtos.length || !itens.length) return;
    setEdicoes(anterior => {
      let alterado = false;
      const seguinte = { ...anterior };
      for (const item of itens) {
        if (item.status !== 'PENDENTE') continue;
        // O XML é a fonte fiscal: nunca auto-selecionar no estoque um
        // produto cujo nome divergente só existia no Meus Controles.
        if (item.dados.divergencia_produto_xml) continue;
        const atual = anterior[item.origem_id] || {};
        if (atual.produto_id || atual.vinculo_manual) continue;
        const encontrado = encontrarProdutoExatoDaNota(item.dados, produtos)
          || (item.dados.custo_origem === 'xml_conferido' && item.dados.produto_xml
            ? encontrarProdutoExatoDaNota(
              { ...item.dados, produto: item.dados.produto_xml }, produtos
            ) : null);
        if (!encontrado) continue;
        const destinoAnterior = depositos.find(dep => dep.id === atual.deposito_id);
        const depositoId = destinoAnterior?.setor_id === encontrado.setor_id
          ? atual.deposito_id
          : depositos.some(dep => dep.id === encontrado.deposito_id && dep.setor_id === encontrado.setor_id)
            ? encontrado.deposito_id : '';
        const gavetaId = [atual.gaveta_id, encontrado.gaveta_id].find(id =>
          id && gavetas.some(g => g.id === id && g.deposito_id === depositoId)
        ) || '';
        seguinte[item.origem_id] = {
          ...atual, produto_id: encontrado.id, deposito_id: depositoId,
          gaveta_id: gavetaId, identificacao: 'automatico',
          custo_unitario_base: '', custo_alterado: false,
        };
        alterado = true;
      }
      return alterado ? seguinte : anterior;
    });
  }, [produtos, itens, depositos, gavetas]);

  function selecionarProduto(id, produto, identificacao = 'manual') {
    setBuscas(anterior => ({ ...anterior, [id]: produto.nome }));
    setEdicoes(anterior => {
      const atual = anterior[id] || {};
      const depositoAnterior = depositos.find(dep => dep.id === atual.deposito_id);
      const depositoId = depositoAnterior?.setor_id === produto.setor_id
        ? atual.deposito_id
        : depositos.some(dep => dep.id === produto.deposito_id && dep.setor_id === produto.setor_id)
          ? produto.deposito_id : '';
      const gavetaId = [atual.gaveta_id, produto.gaveta_id].find(id =>
        id && gavetas.some(g => g.id === id && g.deposito_id === depositoId)
      ) || '';
      return {
        ...anterior,
        [id]: { ...atual, produto_id: produto.id,
          deposito_id: depositoId, gaveta_id: gavetaId,
          identificacao, vinculo_manual: true,
          custo_unitario_base: '', custo_alterado: false },
      };
    });
  }

  function pesquisarProduto(id, valor) {
    setBuscas(anterior => ({ ...anterior, [id]: valor }));
    setEdicoes(anterior => ({
      ...anterior,
      [id]: {
        ...anterior[id], produto_id: '', deposito_id: '', gaveta_id: '',
        identificacao: '', vinculo_manual: true,
        custo_unitario_base: '', custo_alterado: false,
      },
    }));
  }

  async function carregar(signal) {
    if (!permitido) return;
    setLoading(true);
    try {
      const lista = await request('?status=' + status, 'GET', undefined, signal);
      if (signal?.aborted) return;
      if (!Array.isArray(lista)) throw new Error('A API retornou uma lista de recebimentos inválida.');
      setItens(lista);
      setEdicoes(prev => Object.fromEntries(lista.map(item => [
        item.origem_id, prev[item.origem_id] ? {
          ...prev[item.origem_id],
          ...(!prev[item.origem_id].validade && item.dados.validade
            ? { validade: formatarValidadeInicial(item.dados.validade) } : {}),
        } : {
          produto_id: '', deposito_id: '', gaveta_id: '',
          quantidade: txt(item.dados.quantidade),
          unidade: item.dados.unidade,
          fator_conversao: '', custo_unitario_base: '', custo_alterado: false,
          validade: formatarValidadeInicial(item.dados.validade)
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
    const id = criandoProdutoDe.origem_id;
    setProdutosCriados(anterior => [
      ...anterior.filter(p => p.id !== produto.id),
      produto,
    ]);
    selecionarProduto(id, produto, novo ? 'criado' : 'manual');
    setCriandoProdutoDe(null);
    if (!novo) toast({ title: 'Produto existente selecionado', description: produto.nome });
  }

  function alterar(id, campo, valor) {
    setEdicoes(prev => ({
      ...prev,
      [id]: { ...prev[id], [campo]: valor,
        ...(campo === 'produto_id' ? { deposito_id: '', gaveta_id: '' } : {}),
        ...(campo === 'deposito_id' ? { gaveta_id: '' } : {}),
        ...(['produto_id', 'unidade', 'fator_conversao'].includes(campo)
          ? { custo_unitario_base: '', custo_alterado: false } : {})
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
      // Apresentar os valores QUE O SERVIDOR CONFIRMOU sem esperar a segunda
      // consulta. O retorno contem cada origem_id e seus dados fiscais,
      // nunca apenas uma contagem de produtos atualizados.
      const novos = Array.isArray(retorno.itens_fiscais_atualizados)
        ? retorno.itens_fiscais_atualizados : [];
      setItens(anterior => aplicarItensFiscaisXml(anterior, novos));
      setEdicoes(anterior => {
        const seguinte = { ...anterior };
        for (const reg of novos) {
          const atual = anterior[reg.origem_id];
          if (!atual) continue;
          seguinte[reg.origem_id] = {
            ...atual,
            ...(reg.dados.divergencia_produto_xml
              ? {
                produto_id: '', deposito_id: '', gaveta_id: '',
                identificacao: '', vinculo_manual: true,
                custo_unitario_base: '', custo_alterado: false,
              } : {}),
            ...(!atual.validade && reg.dados.validade
              ? { validade: formatarValidadeInicial(reg.dados.validade) } : {}),
          };
        }
        return seguinte;
      });
      setBuscas(anterior => {
        const seguinte = { ...anterior };
        for (const reg of novos) {
          if (reg.dados.divergencia_produto_xml) delete seguinte[reg.origem_id];
        }
        return seguinte;
      });
      setAvisosXml(anterior => {
        const seguinte = { ...anterior };
        for (const reg of novos) delete seguinte[reg.origem_id];
        for (const erro of retorno.detalhes_pendentes || []) {
          seguinte[erro.origem_id] = erro.motivo;
        }
        return seguinte;
      });
      // A lista é sincronizada novamente com o PostgreSQL após o preenchimento.
      await carregar();
      const nomes = novos.map(reg => reg.dados.produto).filter(Boolean).slice(0, 4);
      toast({
        title: 'XML conferido: ' + retorno.itens_atualizados + ' entrada(s) preenchida(s)',
        description: (nomes.length ? 'Preenchidos: ' + nomes.join(', ') + '. ' : '') +
          (retorno.nao_identificados?.length
            ? 'Sem correspondência: ' + retorno.nao_identificados.join(', ') + '.'
            : 'Todos os produtos correspondentes foram atualizados.'),
      });
      return retorno;
    } catch (erro) {
      toast({
        variant: 'destructive', title: 'Não foi possível recuperar o custo',
        description: erro.message,
      });
    } finally {
      setRecuperando('');
    }
    return null;
  }

  async function aprovar(item) {
    const edit = edicoes[item.origem_id];
    if (!edit?.produto_id || !edit?.deposito_id) {
      toast({ variant: 'destructive', title: 'Selecione produto e depósito do GFARM' }); return;
    }
    const produto = produtos.find(p => p.id === edit.produto_id);
    const valorAutomatico = precoFiscalNaUnidadeBase(item.dados, produto, edit.fator_conversao);
    if (!edit.custo_alterado && valorAutomatico === null) {
      toast({
        variant: 'destructive', title: 'Preço fiscal indisponível',
        description: item.dados.valor_unitario == null && item.dados.valor_total == null
          ? 'Recupere o preço pelo XML ou informe um custo unitário corrigido.'
          : 'Confira o fator de conversão do produto antes de aprovar.',
      });
      return;
    }
    if (edit.custo_alterado && (String(edit.custo_unitario_base).trim() === ''
      || !Number.isFinite(Number(edit.custo_unitario_base))
      || Number(edit.custo_unitario_base) < 0)) {
      toast({ variant: 'destructive', title: 'Custo corrigido inválido' });
      return;
    }
    const validadeInformada = txt(edit.validade).trim();
    const validade = validadeInformada ? interpretarValidadeLivre(validadeInformada) : null;
    if (validadeInformada && !validade) {
      toast({ variant: 'destructive', title: 'Validade inválida',
        description: 'Informe 010126, 01012026 ou 01/01/2026.' });
      return;
    }
    const payload = {
      produto_id: edit.produto_id, deposito_id: edit.deposito_id,
      gaveta_id: edit.gaveta_id || null,
      quantidade: edit.quantidade, unidade: edit.unidade,
      ...(edit.fator_conversao ? { fator_conversao: edit.fator_conversao } : {}),
      ...(edit.custo_alterado ? { custo_unitario_base: edit.custo_unitario_base } : {}),
      ...(validade ? { validade: validade.iso } : {}),
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
        <p className="text-xs text-muted-foreground">Nada altera o saldo até sua aprovação. Confira produto, quantidade, local e custo. <span className="font-semibold">· Busca inteligente v2</span></p>
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
    {!!extensaoAusente && (
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/10 px-3 py-2 text-xs"
        role="status">
        <span>{extensaoAusente}</span>
        <a href={EXTENSAO_GFARM_URL} target="_blank" rel="noopener noreferrer"
          className="font-semibold text-primary underline">Baixar extensão GFARM</a>
        <button type="button" className="ml-auto text-muted-foreground underline"
          onClick={() => setExtensaoAusente('')}>Dispensar</button>
      </div>
    )}
    {loading && !itens.length ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}
    {!loading && !itens.length ? <Card className="p-5 text-sm text-muted-foreground">Nenhum recebimento nesta situação.</Card> : null}
    {itens.map(item => {
      const d = item.dados;
      const e = edicoes[item.origem_id] || {};
      const produto = produtos.find(p => p.id === e.produto_id);
      const optsDepositos = depositos.filter(dep => !produto?.setor_id || dep.setor_id === produto.setor_id);
      const optsGavetas = gavetas.filter(gav => gav.deposito_id === e.deposito_id);
      const fechado = item.status === 'APROVADO' || item.status === 'REJEITADO';
      const semCusto = d.valor_unitario == null && d.valor_total == null;
      const linkFazenda = linkConsultaFiscalNfe(d.chave_acesso);
      const unitarioFiscal = precoFiscalNaUnidadeBase(d);
      const custoFiscalBase = precoFiscalNaUnidadeBase(d, produto, e.fator_conversao);
      const custoEditado = !!e.custo_alterado;
      const custoExibido = custoEditado
        ? (e.custo_unitario_base ?? '')
        : precoFiscalParaInput(custoFiscalBase);
      const unidadeBase = produto?.unidade || d.unidade || 'unidade';
      return <Card key={item.origem_id} className="space-y-3 border-border/70 p-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">NF {d.numero_nota} {d.serie ? '· Série ' + d.serie : ''}</div>
            <div className="text-xs text-muted-foreground">Pedido {d.numero_pedido || '—'} · Recebido em {d.data_recebimento || '—'}</div>
          </div>
          <span className="text-xs font-semibold">{item.status}</span>
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/10 p-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3 xl:grid-cols-5">
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground">Produto da NF-e</div>
              <div className="font-semibold">{d.produto || '—'}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground">Fornecedor</div>
              <div className="break-words font-medium">{d.fornecedor || '—'}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Quantidade</div>
              <div className="font-semibold">{d.quantidade ?? '—'} {d.unidade || ''}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Valor unitário</div>
              <div className="font-semibold">{money(unitarioFiscal)}{d.unidade ? ' / ' + d.unidade : ''}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Valor total</div>
              <div className="font-semibold">{money(d.valor_total)}</div>
            </div>
            <div className="col-span-2 border-t pt-2 md:col-span-3 xl:col-span-5">
              <div className="mb-1 text-[11px] text-muted-foreground">Chave de acesso da NF-e</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-all font-mono text-xs">{d.chave_acesso || 'Não informada'}</span>
                {d.custo_origem === 'xml_conferido' && <span className="text-[11px] font-semibold text-emerald-700">XML conferido</span>}
                {d.identificacao_fiscal === 'quantidade_e_unidade_unicas' && (
                  <span className="text-[11px] font-semibold text-amber-700">
                    Produto vinculado pela quantidade e unidade — confira o nome fiscal
                  </span>
                )}
                {linkFazenda ? (
                  <button type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-semibold text-primary hover:bg-muted"
                    title="Abrir o FSist diretamente e capturar automaticamente o XML da NF-e"
                    onClick={() => abrirFSist(item)}>
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir FSist e capturar XML
                  </button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Consulta disponível com chave válida de 44 dígitos.</span>
                )}
              </div>
            </div>
          </div>
          {d.custo_origem === 'xml_conferido' && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
              <span>Itens da NF-e: {Array.isArray(d.itens_xml) ? d.itens_xml.join(', ') : '—'}</span>
              <span>Quantidade fiscal: {d.quantidade_xml || '—'} {d.unidade_xml || d.unidade || ''}</span>
              {d.origem_quantidade_fiscal === 'tributavel' && (
                <span>Dados de quantidade tributável da NF-e ({d.unidade_fiscal_origem || 'qTrib'})</span>
              )}
              {d.produto_xml && <span>Descrição na NF-e: {d.produto_xml}</span>}
              {d.cfop && <span>CFOP: {d.cfop}</span>}
              {d.ncm && <span>NCM: {d.ncm}</span>}
              {d.lote && <span>Lote: {d.lote}</span>}
              {d.validade
                ? <span>Validade: {formatarValidadeInicial(d.validade)}</span>
                : <span>Validade não informada no XML</span>}
            </div>
          )}
          {d.divergencia_produto_xml && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-900">
              Atenção: o Meus Controles informou “{d.produto}”, mas a NF-e registra “{d.produto_xml}”.
              Os dados fiscais foram recuperados pela chave, quantidade e unidade.
              Confirme e selecione o produto correto no GFARM antes da entrada em estoque.
            </p>
          )}
          {avisosXml[item.origem_id] && (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              Este produto não foi preenchido pelo XML: {avisosXml[item.origem_id]}
            </p>
          )}
          {semCusto && (
            <p className="mt-2 text-xs text-amber-700">
              Sem valor fiscal neste recebimento. Confira a identificação e a unidade do produto no XML.
            </p>
          )}
        </div>
        {fechado ? <p className="text-sm text-muted-foreground">{item.documento_estoque_id ? 'Documento do estoque: ' + item.documento_estoque_id : item.motivo_recusa}</p> : <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <EscolherProdutoDaNota
            dados={{ ...d, origem_id: item.origem_id,
              produto: d.divergencia_produto_xml ? d.produto_xml : d.produto }}
            produtos={produtos}
            setores={setores}
            carregando={carregandoCadastros}
            onReload={recarregarCadastros}
            selecionado={produto || null}
            busca={buscas[item.origem_id]}
            identificacao={e.identificacao}
            onSearch={valor => pesquisarProduto(item.origem_id, valor)}
            onSelect={selecionado => selecionarProduto(item.origem_id, selecionado)}
            onClear={() => pesquisarProduto(item.origem_id, '')}
            onCreate={() => setCriandoProdutoDe(item)}
            podeCadastrar={podeCadastrar}
          />
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
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={'custo-nfe-' + item.origem_id}>Custo unitário (R$ / {unidadeBase})</label>
              {custoEditado ? (
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => setEdicoes(prev => ({
                    ...prev,
                    [item.origem_id]: {
                      ...prev[item.origem_id],
                      custo_unitario_base: '',
                      custo_alterado: false,
                    },
                  }))}
                >Restaurar valor da NF-e</button>
              ) : null}
            </div>
            <Input
              id={'custo-nfe-' + item.origem_id}
              type="number" min="0" step="any"
              placeholder={semCusto ? 'Informe o custo ou recupere do XML' : 'Selecione o produto para converter'}
              value={custoExibido}
              onChange={ev => setEdicoes(prev => ({
                ...prev,
                [item.origem_id]: {
                  ...prev[item.origem_id],
                  custo_unitario_base: ev.target.value,
                  custo_alterado: ev.target.value !== '',
                },
              }))}
            />
            <span className="block text-[10px] text-muted-foreground">
              {custoEditado
                ? 'Valor corrigido manualmente. Esse será o custo usado na aprovação.'
                : custoFiscalBase !== null
                  ? `Preenchido pela NF-e: ${money(unitarioFiscal)} por ${d.unidade}. Você pode corrigir.`
                  : semCusto
                    ? 'Sem valor fiscal importado para esta entrada; confira o XML ou informe o custo.'
                    : 'O custo fiscal foi lido, mas falta configurar a conversão de ' +
                      (d.unidade || 'unidade fiscal') + ' para ' + unidadeBase +
                      ' no produto ou informar um fator válido.'}
            </span>
          </div>
          <label className="space-y-1 text-xs">Validade
            <Input
              type="text" inputMode="numeric" autoComplete="off" maxLength={10}
              placeholder="010126 ou 01012026"
              value={e.validade || ''}
              onChange={ev => alterar(item.origem_id, 'validade', ev.target.value)}
              onBlur={ev => {
                const normalizada = interpretarValidadeLivre(ev.target.value);
                if (normalizada) alterar(item.origem_id, 'validade', normalizada.exibicao);
              }}
            />
            <span className="block text-[10px] text-muted-foreground">Digite livremente; formatação ao sair do campo.</span>
          </label>
          <div className="flex gap-2 md:col-span-2 xl:col-span-4">
            <Button disabled={!!saving || !e.produto_id || !e.deposito_id} onClick={() => aprovar(item)}><Check className="mr-1 h-4 w-4" /> Aprovar entrada</Button>
            <Input placeholder="Motivo obrigatório para recusar" value={recusas[item.origem_id] || ''} onChange={ev => setRecusas(v => ({ ...v, [item.origem_id]: ev.target.value }))} />
            <Button variant="outline" disabled={!!saving || item.status !== 'PENDENTE'} onClick={() => recusar(item)}><XCircle className="mr-1 h-4 w-4" /> Recusar</Button>
          </div>
        </div>}
      </Card>;
    })}
    {consultandoNota && (
      <ConsultaXmlFazenda
        key={consultandoNota.origem_id}
        nota={consultandoNota.dados}
        onStatus={fsistPronto}
        onImportar={arquivo => recuperarValorXml(consultandoNota, arquivo)}
        onConcluido={() => setConsultandoNota(null)}
        onErro={mensagem => toast({
          variant: 'destructive', title: 'Falha na captura do XML', description: mensagem,
        })}
      />
    )}
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
