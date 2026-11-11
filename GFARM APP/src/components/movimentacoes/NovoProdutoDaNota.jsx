import { useMemo, useState } from 'react';
import { PackagePlus } from 'lucide-react';

import { api } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { invalidateEntidade } from '@/lib/useEntidades';
import { montarProdutoDaNota } from '@/lib/produtoDaNota';
import { normalizarUnidade, precisaConversaoCustom, UNIDADES } from '@/lib/units';

const normalizar = (valor) => String(valor || '').trim().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
  .replace(/\s+/g, ' ');

function iniciar(dados, depositoInicial, depositos) {
  const deposito = depositos.find(x => x.id === depositoInicial);
  return {
    nome: String(dados.produto || '').trim(),
    codigo_referencia: String(dados.codigo_produto || '').trim(),
    unidade: normalizarUnidade(dados.unidade),
    setor_id: deposito?.setor_id || '',
    deposito_id: depositoInicial || '',
    gaveta_id: '',
    fator_conversao: '',
  };
}

export default function NovoProdutoDaNota({
  item, depositos = [], gavetas = [], setores = [], produtos = [],
  depositoInicial = '', onClose, onCreated,
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(() => iniciar(item.dados, depositoInicial, depositos));
  const [salvando, setSalvando] = useState(false);
  const dados = item.dados;

  const depositoAtual = depositos.find(dep => dep.id === form.deposito_id);
  const depositosDoSetor = useMemo(() => depositos.filter(dep => dep.setor_id === form.setor_id), [depositos, form.setor_id]);
  const gavetasDoDeposito = useMemo(() => gavetas.filter(gav => gav.deposito_id === form.deposito_id), [gavetas, form.deposito_id]);
  const exigeConversao = !!form.unidade && precisaConversaoCustom(dados.unidade, form.unidade);

  function mudar(campo, valor) {
    setForm(atual => ({
      ...atual, [campo]: valor,
      ...(campo === 'setor_id' ? { deposito_id: '', gaveta_id: '' } : {}),
      ...(campo === 'deposito_id' ? { gaveta_id: '' } : {}),
    }));
  }

  async function salvar(event) {
    event.preventDefault();
    if (salvando) return;
    const nome = form.nome.trim();
    const referencia = form.codigo_referencia.trim();
    if (!nome || !form.setor_id || !form.unidade) {
      toast({ variant: 'destructive', title: 'Informe nome, setor e unidade.' });
      return;
    }
    if (form.deposito_id && depositoAtual?.setor_id !== form.setor_id) {
      toast({ variant: 'destructive', title: 'Depósito não pertence ao setor selecionado.' });
      return;
    }
    if (form.gaveta_id && !gavetasDoDeposito.some(gav => gav.id === form.gaveta_id)) {
      toast({ variant: 'destructive', title: 'Gaveta não pertence ao depósito selecionado.' });
      return;
    }
    const fator = Number(String(form.fator_conversao).replace(',', '.'));
    if (exigeConversao && !(Number.isFinite(fator) && fator > 0)) {
      toast({
        variant: 'destructive', title: 'Informe a conversão da unidade da NF-e.',
        description: `Quantas unidades ${form.unidade} há em 1 ${dados.unidade}?`,
      });
      return;
    }
    setSalvando(true);
    try {
      // Consulta o cadastro real antes de criar; não use só os primeiros 100 resultados do seletor.
      const existentes = await api.entities.Produto.list();
      // Código de fornecedor não é identificador global: o mesmo pode ser usado
      // por emitentes diferentes. Só reaproveitar um produto quando o nome e
      // setor correspondem exatamente.
      const duplicado = (Array.isArray(existentes) ? existentes : produtos).find(prod =>
        prod.setor_id === form.setor_id && normalizar(prod.nome) === normalizar(nome)
      );
      if (duplicado) {
        toast({
          title: 'Produto já cadastrado',
          description: `O produto ${duplicado.nome} já existe neste setor e foi selecionado.`,
        });
        await onCreated(duplicado, { novo: false });
        return;
      }

      const payload = montarProdutoDaNota(
        dados, form, Array.isArray(existentes) ? existentes : produtos, depositos, gavetas
      );
      const criado = await api.entities.Produto.create(payload);
      await invalidateEntidade('Produto');
      await onCreated(criado, { novo: true });
      toast({
        title: 'Produto cadastrado e selecionado',
        description: 'Saldo zerado. A nota continua pendente de aprovação.',
      });
    } catch (erro) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível cadastrar o produto',
        description: erro.message || 'Verifique os dados do cadastro.',
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose(); }}>
      <DialogContent className="max-w-2xl space-y-3" aria-describedby="novo-produto-nfe-descricao">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackagePlus className="h-4 w-4" /> Criar produto com dados da NF-e
          </DialogTitle>
          <DialogDescription id="novo-produto-nfe-descricao">
            NF {dados.numero_nota} · {dados.fornecedor || 'Emitente não informado'}.
            Confira o cadastro antes de salvar. A quantidade só entra no estoque após aprovação.
          </DialogDescription>
        </DialogHeader>
        <form id="form-novo-produto-nfe" onSubmit={salvar} className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-2 text-xs">
            <div className="font-semibold">{dados.produto}</div>
            <div className="mt-1 text-muted-foreground">
              Código na nota: {dados.codigo_produto || 'não informado'} ·
              Quantidade: {dados.quantidade} {dados.unidade} ·
              Valor unitário: {dados.valor_unitario == null ? 'não informado' : `R$ ${dados.valor_unitario}`}
            </div>
            <div className="mt-1 text-muted-foreground">
              CFOP {dados.cfop || '—'} · NCM {dados.ncm || '—'} · Lote {dados.lote || '—'} · Validade {dados.validade || '—'}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs sm:col-span-2">
              Nome do produto (copiado da NF-e) *
              <Input required maxLength={255} value={form.nome} onChange={e => mudar('nome', e.target.value)} />
            </label>
            <label className="space-y-1 text-xs">
              Código de referência da NF-e
              <Input maxLength={255} value={form.codigo_referencia} onChange={e => mudar('codigo_referencia', e.target.value)} placeholder="Código do fornecedor" />
            </label>
            <label className="space-y-1 text-xs">
              Unidade-base do produto *
              <select required className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={form.unidade} onChange={e => mudar('unidade', e.target.value)}>
                <option value="">Selecione unidade</option>
                {UNIDADES.map(familia => <optgroup label={familia.familia} key={familia.familia}>
                  {familia.itens.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </optgroup>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              Setor do GFARM *
              <select required className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={form.setor_id} onChange={e => mudar('setor_id', e.target.value)}>
                <option value="">Selecione setor</option>
                {setores.map(setor => <option value={setor.id} key={setor.id}>{setor.nome}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              Depósito padrão
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                disabled={!form.setor_id} value={form.deposito_id} onChange={e => mudar('deposito_id', e.target.value)}>
                <option value="">Definir ao aprovar</option>
                {depositosDoSetor.map(dep => <option value={dep.id} key={dep.id}>
                  {[dep.numero, dep.nome].filter(Boolean).join(' · ')}
                </option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              Gaveta padrão
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                disabled={!form.deposito_id} value={form.gaveta_id} onChange={e => mudar('gaveta_id', e.target.value)}>
                <option value="">Definir ao aprovar</option>
                {gavetasDoDeposito.map(gav => <option value={gav.id} key={gav.id}>
                  {gav.codigo || gav.descricao || 'Gaveta'}
                </option>)}
              </select>
            </label>
            {exigeConversao && (
              <label className="space-y-1 text-xs sm:col-span-2">
                Conversão obrigatória: 1 {dados.unidade} equivale a quantos {form.unidade}? *
                <Input required type="number" step="any" min="0.000001"
                  placeholder={`Ex.: 20 ${form.unidade} por ${dados.unidade}`}
                  value={form.fator_conversao} onChange={e => mudar('fator_conversao', e.target.value)} />
                <span className="block text-muted-foreground">
                  A unidade da nota é diferente da unidade-base do produto; não vamos presumir a conversão.
                </span>
              </label>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Código interno gerado pelo GFARM. CFOP, NCM, lote, validade e preço continuam
            na nota para conferência; o cadastro do produto não movimenta quantidade nem contabiliza custo.
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" disabled={salvando} onClick={onClose}>Cancelar</Button>
          <Button form="form-novo-produto-nfe" type="submit" disabled={salvando}>
            <PackagePlus className="mr-1 h-4 w-4" />
            {salvando ? 'Salvando...' : 'Cadastrar e selecionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
