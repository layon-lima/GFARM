import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import SearchSelect from '@/components/SearchSelect';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  FolderOpen,
  Package,
  RefreshCw,
  Save,
  Search,
  Warehouse,
  X,
} from 'lucide-react';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { useBackHandler } from '@/hooks/useBackHandler';
import { formatQtd, parseQtd } from '@/lib/format';
import { getDisplayName } from '@/lib/userName';
import {
  aplicarAjusteInventario,
  buildCriteriosDescricao,
  criteriosKey,
  filterProdutosParaInventario,
  nextInventarioNumber,
  parseInventarioCriterios,
  qtdSistema,
} from '@/lib/inventario';

const emptyCriterios = {
  deposito_id: '',
  setor_id: '',
  gaveta_id: '',
  maquina_id: '',
};

function depositoLabel(deposito) {
  if (!deposito) return '—';
  return `${deposito.numero || ''}${deposito.numero && deposito.nome ? ' · ' : ''}${deposito.nome || ''}` || '—';
}

function maquinaLabel(maquina) {
  if (!maquina) return '—';
  return `${maquina.codigo || ''}${maquina.codigo && maquina.nome ? ' · ' : ''}${maquina.nome || ''}` || '—';
}

export default function InventarioConference({
  open,
  onOpenChange,
  setores = [],
  produtos = [],
  depositos = [],
  maquinas = [],
  gavetas = [],
  saldos = [],
  user,
  onSaved,
  initialInventarioId,
  onForaEstoque,
}) {
  const { toast } = useToast();
  const [step, setStep] = useState('criterios');
  const [criterios, setCriterios] = useState(emptyCriterios);
  const [inventario, setInventario] = useState(null);
  const [items, setItems] = useState([]);
  const [abertos, setAbertos] = useState([]);
  const [busca, setBusca] = useState('');
  const [ativoId, setAtivoId] = useState(null);
  const [qtdInput, setQtdInput] = useState('');
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [concluindo, setConcluindo] = useState(false);
  const [confirmConcluir, setConfirmConcluir] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [aplicando, setAplicando] = useState(false);
  const [aplicado, setAplicado] = useState(null);
  const inputRef = useRef(null);

  useBackHandler(open && step === 'criterios', () => handleClose(false));
  useBackHandler(open && step === 'documento', () => handleClose(false));
  useBackHandler(open && step === 'resultado', () => setStep('documento'));
  useBackHandler(open && !!confirmConcluir, () => setConfirmConcluir(false));
  useBackHandler(open && !!aviso, () => setAviso(null));

  useEffect(() => {
    if (!open) return;

    if (initialInventarioId) {
      abrirDocumento(initialInventarioId);
      return;
    }

    setStep('criterios');
    carregarAbertos();
  }, [open, initialInventarioId]);

  useEffect(() => {
    if (!inventario) return undefined;

    let active = true;
    api.entities.InventarioItem.filter({ inventario_id: inventario.id })
      .then((rows) => {
        if (active) setItems(rows || []);
      })
      .catch(() => {});

    const unsub = api.entities.InventarioItem.subscribe((event) => {
      const rec = event.data;
      if (rec && rec.inventario_id !== inventario.id) return;

      setItems((prev) => {
        if (event.type === 'delete') return prev.filter((item) => item.id !== event.id);
        const exists = prev.some((item) => item.id === event.id);
        return exists
          ? prev.map((item) => (item.id === event.id ? rec : item))
          : [...prev, rec];
      });
    });

    return () => {
      active = false;
      unsub?.();
    };
  }, [inventario?.id]);

  const criteriosDoc = useMemo(
    () => (inventario ? parseInventarioCriterios(inventario) : criterios),
    [inventario, criterios]
  );

  const depositoAtual = useMemo(
    () => depositos.find((d) => d.id === criteriosDoc.deposito_id) || null,
    [depositos, criteriosDoc.deposito_id]
  );

  const setorAtual = useMemo(
    () => setores.find((s) => s.id === criteriosDoc.setor_id) || null,
    [setores, criteriosDoc.setor_id]
  );

  const alvo = useMemo(
    () => filterProdutosParaInventario(produtos, saldos, criteriosDoc),
    [produtos, saldos, criteriosDoc]
  );

  const previewAlvo = useMemo(
    () => filterProdutosParaInventario(produtos, saldos, criterios),
    [produtos, saldos, criterios]
  );

  const itemMap = useMemo(() => new Map(items.map((item) => [item.produto_id, item])), [items]);
  const contadosIds = useMemo(() => new Set(items.map((item) => item.produto_id)), [items]);
  const pendentes = useMemo(() => alvo.filter((produto) => !contadosIds.has(produto.id)), [alvo, contadosIds]);
  const conferidosCount = alvo.length - pendentes.length;
  const total = alvo.length;
  const pct = total ? Math.round((conferidosCount / total) * 100) : 0;

  const produtoAtivo = useMemo(
    () => alvo.find((produto) => produto.id === ativoId) || null,
    [alvo, ativoId]
  );

  const sistAtivo = produtoAtivo ? qtdSistema(produtoAtivo, saldos, criteriosDoc) : 0;
  const diffLive =
    qtdInput.trim() !== '' && produtoAtivo
      ? parseQtd(qtdInput) - sistAtivo
      : null;

  const resultadosBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = termo
      ? alvo.filter((produto) =>
          [produto.nome, produto.codigo, produto.codigo_referencia]
            .filter(Boolean)
            .some((valor) => String(valor).toLowerCase().includes(termo))
        )
      : pendentes.slice(0, 30);

    return [...base].sort((a, b) => {
      const aContado = contadosIds.has(a.id) ? 1 : 0;
      const bContado = contadosIds.has(b.id) ? 1 : 0;
      if (aContado !== bContado) return aContado - bContado;
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });
  }, [alvo, busca, pendentes, contadosIds]);

  const gavetasDisponiveis = useMemo(
    () => gavetas.filter((gaveta) => !criterios.deposito_id || gaveta.deposito_id === criterios.deposito_id),
    [gavetas, criterios.deposito_id]
  );

  const maquinasDisponiveis = useMemo(
    () =>
      maquinas.filter(
        (maquina) =>
          !criterios.deposito_id ||
          !maquina.deposito_id ||
          maquina.deposito_id === criterios.deposito_id
      ),
    [maquinas, criterios.deposito_id]
  );

  const abertosVisiveis = useMemo(() => {
    if (!criterios.deposito_id) return abertos.slice(0, 8);
    return abertos.filter(
      (doc) => parseInventarioCriterios(doc).deposito_id === criterios.deposito_id
    );
  }, [abertos, criterios.deposito_id]);

  useEffect(() => {
    if (step === 'documento' && produtoAtivo) {
      setQtdInput('');
      const timer = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [produtoAtivo?.id, step]);

  async function carregarAbertos() {
    try {
      const rows = await api.entities.Inventario.filter({ status: 'aberto' }, '-data', 100);
      setAbertos(rows || []);
    } catch {
      setAbertos([]);
    }
  }

  function reset() {
    setStep('criterios');
    setCriterios(emptyCriterios);
    setInventario(null);
    setItems([]);
    setBusca('');
    setAtivoId(null);
    setQtdInput('');
    setAviso(null);
    setResultado(null);
    setAplicado(null);
    setConfirmConcluir(false);
  }

  function handleClose(value) {
    if (!value) reset();
    onOpenChange?.(value);
  }

  async function abrirDocumento(id) {
    setLoadingDoc(true);
    try {
      const doc = await api.entities.Inventario.get(id);
      const escopo = parseInventarioCriterios(doc);

      if (!escopo.deposito_id) {
        setCriterios({ ...emptyCriterios, setor_id: escopo.setor_id || '' });
        setInventario(null);
        setStep('criterios');
        toast({
          variant: 'destructive',
          title: 'Inventário antigo sem depósito',
          description: 'A nova estrutura exige um depósito. Selecione o depósito e abra um novo documento.',
        });
        return;
      }

      setCriterios(escopo);
      setInventario(doc);
      setItems([]);
      setBusca('');
      setAtivoId(null);
      setQtdInput('');
      setAviso(null);
      setResultado(null);
      setAplicado(null);
      setStep('documento');
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao abrir inventário',
        description: error?.message,
      });
    } finally {
      setLoadingDoc(false);
    }
  }

  function atualizarCriterio(campo, valor) {
    setCriterios((prev) => {
      const next = { ...prev, [campo]: valor === 'all' ? '' : valor };
      if (campo === 'deposito_id') {
        next.gaveta_id = '';
        next.maquina_id = '';
      }
      return next;
    });
  }

  async function iniciar() {
    if (!criterios.deposito_id) {
      toast({
        variant: 'destructive',
        title: 'Depósito obrigatório',
        description: 'Selecione o depósito que será contado.',
      });
      return;
    }

    setLoadingDoc(true);
    try {
      const key = criteriosKey(criterios);
      const documentosAbertos = await api.entities.Inventario.filter({ status: 'aberto' }, '-data', 200);
      const existente = (documentosAbertos || []).find(
        (doc) => criteriosKey(parseInventarioCriterios(doc)) === key
      );

      let doc = existente;
      if (existente) {
        toast({
          title: 'Documento em aberto',
          description: 'Retomando o inventário já existente para este mesmo escopo.',
        });
      } else {
        const todos = await api.entities.Inventario.list('-data', 500);
        const setorSelecionado = setores.find((s) => s.id === criterios.setor_id);
        doc = await api.entities.Inventario.create({
          numero: nextInventarioNumber(todos),
          data: new Date().toISOString(),
          setor_id: criterios.setor_id || '',
          setor_nome: setorSelecionado?.nome || '',
          criterios: key,
          criterios_descricao: buildCriteriosDescricao(
            criterios,
            depositos,
            setores,
            maquinas,
            gavetas
          ),
          status: 'aberto',
          responsavel: getDisplayName(user),
          total_itens: 0,
          total_acertos: 0,
          total_divergencias: 0,
          resultado: 'consistente',
        });
      }

      setInventario(doc);
      setItems([]);
      setBusca('');
      setAtivoId(null);
      setQtdInput('');
      setResultado(null);
      setAplicado(null);
      setStep('documento');
      onSaved?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao iniciar inventário',
        description: error?.message,
      });
    } finally {
      setLoadingDoc(false);
    }
  }

  function selecionarProduto(produto) {
    const itemExistente = itemMap.get(produto.id);
    if (itemExistente) {
      setAviso({ item: itemExistente, produto, qty: String(itemExistente.qtd_contada ?? '') });
      return;
    }

    setAtivoId(produto.id);
    setBusca('');
  }

  async function confirmar() {
    if (!produtoAtivo || !inventario) return;

    if (qtdInput.trim() === '') {
      toast({
        variant: 'destructive',
        title: 'Informe a quantidade',
        description: 'Digite a quantidade física encontrada.',
      });
      return;
    }

    const val = parseQtd(qtdInput);
    try {
      const registrado = await api.entities.InventarioItem.create({
        inventario_id: inventario.id,
        produto_id: produtoAtivo.id,
        codigo: produtoAtivo.codigo,
        nome: produtoAtivo.nome,
        unidade: produtoAtivo.unidade || 'un',
        qtd_sistema: qtdSistema(produtoAtivo, saldos, criteriosDoc),
        qtd_contada: val,
        responsavel: getDisplayName(user),
        data: new Date().toISOString(),
      });
      setItems((current) => [...current.filter((item) => item.id !== registrado.id), registrado]);
      setAtivoId(null);
      setQtdInput('');
      setBusca('');
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao registrar contagem',
        description: error?.message,
      });
    }
  }

  async function aplicarAviso(modo) {
    if (!aviso) return;
    if (String(aviso.qty || '').trim() === '') {
      toast({ variant: 'destructive', title: 'Informe a quantidade' });
      return;
    }

    const val = parseQtd(aviso.qty);
    try {
      const nova = modo === 'add'
        ? (Number(aviso.item.qtd_contada) || 0) + val
        : val;

      const atualizado = await api.entities.InventarioItem.update(aviso.item.id, {
        qtd_contada: nova,
        responsavel: getDisplayName(user),
        data: new Date().toISOString(),
      });

      setItems((current) => current.map((item) => item.id === atualizado.id ? atualizado : item));

      toast({ title: modo === 'add' ? 'Quantidade adicionada' : 'Contagem atualizada' });
      setAviso(null);
      setAtivoId(null);
      setQtdInput('');
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao atualizar contagem',
        description: error?.message,
      });
    }
  }

  async function concluir() {
    if (!inventario) return;
    setConcluindo(true);

    try {
      const itensDb = await api.entities.InventarioItem.filter({ inventario_id: inventario.id });
      const contagemMap = new Map((itensDb || []).map((item) => [item.produto_id, item]));

      const itensResultado = alvo.map((produto) => {
        const sist = qtdSistema(produto, saldos, criteriosDoc);
        const item = contagemMap.get(produto.id);
        const cont = item ? Number(item.qtd_contada) || 0 : sist;
        const divergencia = cont - sist;

        return {
          produto_id: produto.id,
          codigo: produto.codigo,
          nome: produto.nome,
          unidade: produto.unidade || 'un',
          qtd_sistema: sist,
          qtd_contada: cont,
          divergencia,
          status: Math.abs(divergencia) < 0.0001 ? 'acerto' : 'divergencia',
          responsavel: item?.responsavel || '',
        };
      });

      const total_itens = itensResultado.length;
      const total_acertos = itensResultado.filter((item) => item.status === 'acerto').length;
      const total_divergencias = total_itens - total_acertos;
      const resultadoCalc = total_divergencias === 0 ? 'consistente' : 'divergente';

      await api.entities.Inventario.update(inventario.id, {
        itens: JSON.stringify(itensResultado),
        total_itens,
        total_acertos,
        total_divergencias,
        resultado: resultadoCalc,
        status: 'concluido',
        data_fechamento: new Date().toISOString(),
      });

      setResultado({
        itens: itensResultado,
        total_itens,
        total_acertos,
        total_divergencias,
        resultado: resultadoCalc,
      });
      setConfirmConcluir(false);
      setStep('resultado');
      onSaved?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao concluir inventário',
        description: error?.message,
      });
    } finally {
      setConcluindo(false);
    }
  }

  async function aplicarAjustes() {
    if (!inventario || !resultado) return;
    setAplicando(true);

    try {
      const resposta = await aplicarAjusteInventario({
        inventario,
        itens: resultado.itens,
        produtos,
        setores,
        criterios: criteriosDoc,
      });

      setAplicado(resposta);
      toast({
        title: 'Ajustes postados',
        description: `${resposta.aplicados} de ${resposta.total} divergências foram enviadas ao motor de estoque.`,
      });
      onSaved?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao postar ajustes',
        description: error?.message,
      });
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="inventory-conference flex max-h-[94vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px] max-sm:!h-[100dvh] max-sm:!max-h-none max-sm:!w-screen max-sm:!max-w-none max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Inventário físico
              </p>
              <DialogTitle className="truncate text-base font-semibold">
                {inventario ? inventario.numero : 'Novo documento'}
              </DialogTitle>
              {inventario ? (
                <p className="truncate text-xs text-muted-foreground">
                  {depositoLabel(depositoAtual)} · {setorAtual?.nome || 'Todos os setores'}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {step === 'documento' && inventario ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setConfirmConcluir(true)}
                disabled={concluindo || total === 0}
              >
                <FileCheck2 className="h-4 w-4" />
                Concluir
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => handleClose(false)}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 scrollbar-thin">
          {step === 'criterios' ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <Card className="overflow-hidden rounded-2xl border shadow-none">
                  <div className="border-b bg-muted/20 px-4 py-3">
                    <h3 className="text-sm font-semibold">Dados do documento</h3>
                    <p className="text-xs text-muted-foreground">
                      O depósito define o estoque físico a ser contado. O setor apenas restringe o escopo.
                    </p>
                  </div>

                  <div className="grid gap-4 p-4 md:grid-cols-2">
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>Depósito *</Label>
                      <SearchSelect
                        value={criterios.deposito_id}
                        onChange={(value) => atualizarCriterio('deposito_id', value)}
                        allLabel="— Selecione o depósito —"
                        placeholder="Buscar depósito..."
                        options={depositos
                          .map((d) => ({ value: d.id, label: depositoLabel(d) }))
                          .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))}
                      />
                    </div>

                  </div>
                </Card>

                <Card className="rounded-2xl border p-4 shadow-none">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                        <Warehouse className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Escopo calculado</p>
                        <p className="font-semibold">
                          {criterios.deposito_id
                            ? `${previewAlvo.length} produto(s) para contagem`
                            : 'Selecione um depósito'}
                        </p>
                      </div>
                    </div>

                    <Button
                      onClick={iniciar}
                      disabled={loadingDoc || !criterios.deposito_id}
                      className="gap-2 sm:min-w-[210px]"
                    >
                      <ClipboardList className="h-4 w-4" />
                      {loadingDoc ? 'Abrindo...' : 'Abrir inventário'}
                    </Button>
                  </div>
                </Card>
              </div>

              <Card className="h-fit overflow-hidden rounded-2xl border shadow-none">
                <div className="border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-amber-600" />
                    <h3 className="text-sm font-semibold">Inventários em aberto</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Retome uma contagem sem criar outro documento.</p>
                </div>

                <div className="max-h-[420px] space-y-2 overflow-y-auto p-3 scrollbar-thin">
                  {abertosVisiveis.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      Nenhum inventário em aberto neste escopo.
                    </div>
                  ) : (
                    abertosVisiveis.map((doc) => {
                      const escopo = parseInventarioCriterios(doc);
                      const dep = depositos.find((d) => d.id === escopo.deposito_id);
                      const set = setores.find((s) => s.id === escopo.setor_id);
                      return (
                        <button
                          type="button"
                          key={doc.id}
                          onClick={() => abrirDocumento(doc.id)}
                          className="w-full rounded-xl border p-3 text-left transition-colors hover:bg-accent"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-primary">{doc.numero}</span>
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                              Aberto
                            </Badge>
                          </div>
                          <p className="mt-2 truncate text-sm font-medium">{depositoLabel(dep)}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {set?.nome || 'Todos os setores'}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>
          ) : null}

          {step === 'documento' && inventario ? (
            <div className="space-y-4">
              {onForaEstoque ? <Button variant="outline" className="h-12 w-full" onClick={() => onForaEstoque(inventario.id)}>
                Encontrei um item fora do estoque
              </Button> : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border bg-card px-3 py-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Depósito</p>
                  <p className="mt-1 truncate text-sm font-semibold">{depositoLabel(depositoAtual)}</p>
                </div>
                <div className="rounded-xl border bg-card px-3 py-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Setor</p>
                  <p className="mt-1 truncate text-sm font-semibold">{setorAtual?.nome || 'Todos os setores'}</p>
                </div>
                <div className="rounded-xl border bg-card px-3 py-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Progresso</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">{conferidosCount} / {total} itens</p>
                </div>
                <div className="rounded-xl border bg-card px-3 py-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Conclusão</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">{pct}%</p>
                </div>
              </div>

              <Progress value={pct} className="h-2" />

              {total === 0 ? (
                <Card className="rounded-2xl border p-10 text-center shadow-none">
                  <Package className="mx-auto h-10 w-10 text-muted-foreground/40" />
                  <p className="mt-3 font-medium">Nenhum produto neste escopo</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Feche o documento e revise depósito/setor/filtros antes de continuar.
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
                  <div className="space-y-4">
                    <Card className="overflow-hidden rounded-2xl border shadow-none">
                      <div className="border-b bg-muted/20 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Search className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold">Selecionar produto</h3>
                        </div>
                      </div>

                      <div className="p-4">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Nome, código ou referência..."
                            className="pl-9"
                          />
                        </div>

                        <div className="mt-3 max-h-[260px] overflow-y-auto rounded-xl border scrollbar-thin">
                          {resultadosBusca.length === 0 ? (
                            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                              Nenhum produto encontrado.
                            </p>
                          ) : (
                            resultadosBusca.map((produto) => {
                              const contado = contadosIds.has(produto.id);
                              return (
                                <button
                                  type="button"
                                  key={produto.id}
                                  onClick={() => selecionarProduto(produto)}
                                  className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent"
                                >
                                  <div className={
                                    contado
                                      ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700'
                                      : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'
                                  }>
                                    {contado ? <Check className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{produto.nome}</p>
                                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                                      {produto.codigo || 'sem código'}
                                    </p>
                                  </div>
                                  {contado ? (
                                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                      Conferido
                                    </Badge>
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </Card>

                    <Card className="overflow-hidden rounded-2xl border shadow-none">
                      <div className="border-b bg-muted/20 px-4 py-3">
                        <h3 className="text-sm font-semibold">Contagem física</h3>
                        <p className="text-xs text-muted-foreground">Selecione um produto e informe a quantidade encontrada.</p>
                      </div>

                      {!produtoAtivo ? (
                        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                          Selecione um produto na lista acima para iniciar a contagem.
                        </div>
                      ) : (
                        <div className="space-y-4 p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                              <Package className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold leading-tight">{produtoAtivo.nome}</p>
                              <p className="mt-1 font-mono text-xs text-muted-foreground">{produtoAtivo.codigo || '—'}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Saldo sistema</p>
                              <p className="text-xl font-semibold tabular-nums">
                                {formatQtd(sistAtivo)} <span className="text-xs font-normal text-muted-foreground">{produtoAtivo.unidade || 'un'}</span>
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                            <Input
                              ref={inputRef}
                              type="text"
                              inputMode="decimal"
                              value={qtdInput}
                              onChange={(e) => setQtdInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmar();
                              }}
                              placeholder="Quantidade contada"
                              className="h-12 text-center text-lg font-semibold"
                            />
                            <Button onClick={confirmar} className="h-12 gap-2 px-6">
                              <Check className="h-4 w-4" />
                              Registrar
                            </Button>
                          </div>

                          {diffLive !== null ? (
                            <div className={
                              diffLive === 0
                                ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-700'
                                : 'rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-700'
                            }>
                              {diffLive === 0
                                ? 'Contagem confere com o saldo do sistema'
                                : `Diferença prevista: ${diffLive > 0 ? '+' : ''}${formatQtd(diffLive)} ${produtoAtivo.unidade || 'un'}`}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </Card>
                  </div>

                  <Card className="h-fit overflow-hidden rounded-2xl border shadow-none">
                    <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold">Itens conferidos</h3>
                        <p className="text-xs text-muted-foreground">Clique em uma linha para recontar.</p>
                      </div>
                      <Badge variant="outline">{items.length}</Badge>
                    </div>

                    <div className="max-h-[570px] overflow-auto scrollbar-thin">
                      {items.length === 0 ? (
                        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                          Nenhum item contado ainda.
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Produto</TableHead>
                              <TableHead className="text-right">Sistema</TableHead>
                              <TableHead className="text-right">Contado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((item) => {
                              const produto = alvo.find((p) => p.id === item.produto_id);
                              const sist = produto ? qtdSistema(produto, saldos, criteriosDoc) : Number(item.qtd_sistema) || 0;
                              const diff = (Number(item.qtd_contada) || 0) - sist;
                              return (
                                <TableRow
                                  key={item.id}
                                  className="cursor-pointer"
                                  onClick={() => produto && selecionarProduto(produto)}
                                >
                                  <TableCell>
                                    <p className="max-w-[210px] truncate text-sm font-medium">{item.nome}</p>
                                    <p className={
                                      Math.abs(diff) < 0.0001
                                        ? 'text-[10px] text-emerald-700'
                                        : 'text-[10px] text-amber-700'
                                    }>
                                      {Math.abs(diff) < 0.0001
                                        ? 'Confere'
                                        : `Dif. ${diff > 0 ? '+' : ''}${formatQtd(diff)}`}
                                    </p>
                                  </TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">{formatQtd(sist)}</TableCell>
                                  <TableCell className="text-right text-sm font-semibold tabular-nums">{formatQtd(item.qtd_contada)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          ) : null}

          {step === 'resultado' && resultado ? (
            <div className="space-y-4">
              <Card className="overflow-hidden rounded-2xl border shadow-none">
                <div className={
                  resultado.resultado === 'consistente'
                    ? 'flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3'
                    : 'flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3'
                }>
                  {resultado.resultado === 'consistente' ? (
                    <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-700" />
                  ) : (
                    <AlertTriangle className="h-7 w-7 shrink-0 text-amber-700" />
                  )}
                  <div>
                    <p className="font-semibold">
                      {resultado.resultado === 'consistente' ? 'Inventário consistente' : 'Inventário com divergências'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {resultado.total_acertos} de {resultado.total_itens} itens conferem · {resultado.total_divergencias} divergência(s)
                    </p>
                  </div>
                </div>

                <div className="max-h-[52vh] overflow-auto scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[260px]">Produto</TableHead>
                        <TableHead className="text-right">Sistema</TableHead>
                        <TableHead className="text-right">Contado</TableHead>
                        <TableHead className="text-right">Diferença</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultado.itens.map((item) => (
                        <TableRow key={item.produto_id}>
                          <TableCell>
                            <p className="text-sm font-medium">{item.nome}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{item.codigo || '—'}</p>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{formatQtd(item.qtd_sistema)}</TableCell>
                          <TableCell className="text-right text-sm font-medium tabular-nums">{formatQtd(item.qtd_contada)}</TableCell>
                          <TableCell className="text-right">
                            <span className={
                              item.status === 'acerto'
                                ? 'text-sm text-muted-foreground'
                                : 'text-sm font-semibold text-amber-700'
                            }>
                              {item.divergencia > 0 ? '+' : ''}{formatQtd(item.divergencia)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              {resultado.total_divergencias > 0 ? (
                <Card className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-none">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <Save className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                      <div>
                        <p className="text-sm font-semibold text-amber-900">Postagem das divergências</p>
                        <p className="mt-0.5 text-xs text-amber-800">
                          {aplicado
                            ? `${aplicado.aplicados} de ${aplicado.total} ajustes já foram enviados ao motor oficial de estoque.`
                            : 'A contagem está concluída. Poste os ajustes para atualizar o saldo oficial do depósito.'}
                        </p>
                      </div>
                    </div>

                    {!aplicado ? (
                      <Button
                        onClick={aplicarAjustes}
                        disabled={aplicando}
                        variant="outline"
                        className="gap-2 border-amber-300 bg-background text-amber-900 hover:bg-amber-100"
                      >
                        <RefreshCw className={aplicando ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                        {aplicando ? 'Postando...' : 'Postar ajustes'}
                      </Button>
                    ) : (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Postado
                      </Badge>
                    )}
                  </div>
                </Card>
              ) : null}

              <div className="flex justify-end">
                <Button onClick={() => handleClose(false)} className="min-w-[140px]">Fechar</Button>
              </div>
            </div>
          ) : null}
        </div>

        {aviso ? (
          <div className="absolute inset-0 z-50 flex items-end justify-center sm:items-center">
            <button
              type="button"
              aria-label="Fechar recontagem"
              className="absolute inset-0 bg-black/40"
              onClick={() => setAviso(null)}
            />
            <Card className="relative z-10 w-full rounded-b-none rounded-t-2xl border p-4 shadow-xl sm:max-w-md sm:rounded-2xl">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <RefreshCw className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Produto já conferido</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {aviso.produto?.nome} · atual {formatQtd(aviso.item?.qtd_contada)} {aviso.produto?.unidade || 'un'}
                  </p>
                </div>
              </div>

              <Input
                type="text"
                inputMode="decimal"
                autoFocus
                value={aviso.qty}
                onChange={(e) => setAviso({ ...aviso, qty: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') aplicarAviso('recontar');
                }}
                placeholder="Nova quantidade"
                className="mt-4 h-12 text-center text-lg font-semibold"
              />

              <div className="mt-3 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => aplicarAviso('add')}>
                  Somar quantidade
                </Button>
                <Button className="flex-1" onClick={() => aplicarAviso('recontar')}>
                  Recontar
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        <AlertDialog open={confirmConcluir} onOpenChange={setConfirmConcluir}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Concluir inventário?</AlertDialogTitle>
              <AlertDialogDescription>
                {conferidosCount < total
                  ? `Foram conferidos ${conferidosCount} de ${total} produtos. Os ${total - conferidosCount} itens não contados serão mantidos com o saldo do sistema, sem gerar divergência.`
                  : 'Todos os produtos do escopo foram conferidos. O documento será fechado para revisão das divergências.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={concluindo}>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={concluindo} onClick={concluir}>
                {concluindo ? 'Concluindo...' : 'Concluir documento'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
