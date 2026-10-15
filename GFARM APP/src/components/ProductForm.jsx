import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock3,
  FileText,
  Image as ImageIcon,
  MapPin,
  Package,
  RotateCcw,
  Save,
  Settings2,
  Warehouse,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import SearchSelect from '@/components/SearchSelect';
import { api } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import ProdutoFotoUpload from '@/components/cadastros/ProdutoFotoUpload';
import { setorControlaValidade } from '@/lib/lotes';
import { sortGavetas } from '@/lib/gavetas';
import { findProdutoDuplicado } from '@/lib/produtoDedup';
import { proximoCodigoInterno } from '@/lib/produtoCodigo';
import { formatQtd, parseQtd, formatInputQtd } from '@/lib/format';
import { UNIDADES, convertQty, isConversivel } from '@/lib/units';
import { recalcularCustosPorProduto } from '@/lib/osAplicacao';
import { invalidateEntidade } from '@/lib/useEntidades';

const empty = {
  codigo: '',
  codigo_referencia: '',
  nome: '',
  setor_id: '',
  deposito_id: '',
  maquina_id: '',
  gaveta_id: '',
  unidade: 'un',
  unidade_alt: '',
  fator_conversao: 0,
  estoque_minimo: 0,
  custo_unitario: 0,
  venda: false,
  foto_url: '',
};

function formatCurrency(value) {
  const number = Number(parseQtd(value)) || 0;
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value) {
  if (!value) return 'Ainda não salvo';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function ProductForm({ open, onOpenChange, produto, setores, depositos = [], maquinas, gavetas, onSaved, produtos = [] }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (produto) setForm({ ...empty, ...produto });
    else setForm({ ...empty });
  }, [produto, open]);

  const controlaValidade = setorControlaValidade(form.setor_id, setores);
  const setorSelecionado = setores.find((s) => s.id === form.setor_id);
  const depositoSelecionado = depositos.find((d) => d.id === form.deposito_id);
  const gavetaSelecionada = gavetas.find((g) => g.id === form.gaveta_id);
  const maquinaSelecionada = maquinas.find((m) => m.id === form.maquina_id);

  const ultimosProdutos = useMemo(() => {
    return [...produtos]
      .sort((a, b) => {
        const dataA = new Date(a.updated_date || a.created_date || 0).getTime();
        const dataB = new Date(b.updated_date || b.created_date || 0).getTime();
        return dataB - dataA;
      })
      .slice(0, 5);
  }, [produtos]);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  function handleUnidadeChange(novaUnidade) {
    const unidadeAtual = form.unidade || 'un';
    const minAtual = parseQtd(form.estoque_minimo);

    if (!isConversivel(unidadeAtual, novaUnidade)) {
      set('unidade', novaUnidade);
      return;
    }

    const novoMin = convertQty(minAtual, unidadeAtual, novaUnidade);

    setForm((f) => ({
      ...f,
      unidade: novaUnidade,
      estoque_minimo: formatInputQtd(novoMin),
    }));

    toast({
      title: 'Unidade alterada',
      description: `Estoque mínimo convertido: ${formatQtd(minAtual)} ${unidadeAtual} → ${formatQtd(novoMin)} ${novaUnidade}.`,
    });
  }

  async function saveProduct(keepOpen = false) {
    setSaving(true);

    try {
      const basePayload = {
        ...form,
        estoque_minimo: parseQtd(form.estoque_minimo),
        fator_conversao: form.fator_conversao ? parseQtd(form.fator_conversao) : 0,
        custo_unitario: form.custo_unitario ? parseQtd(form.custo_unitario) : 0,
      };

      if (produto) {
        const duplicado = findProdutoDuplicado({ produtos, dados: form, excludeId: produto.id });
        if (duplicado) {
          toast({ variant: 'destructive', title: 'Código já existe', description: `Já existe outro produto com este código: ${duplicado.nome}.` });
          return;
        }

        await api.entities.Produto.update(produto.id, {
          ...basePayload,
          quantidade: produto.quantidade,
        });

        invalidateEntidade('Produto');
        invalidateEntidade('SaldoEstoque');

        const custoAntigo = Number(produto.custo_unitario) || 0;
        const custoNovo = parseQtd(form.custo_unitario) || 0;

        if (custoAntigo !== custoNovo) {
          const n = await recalcularCustosPorProduto(produto.id, custoNovo);
          if (n > 0) {
            invalidateEntidade('OrdemServicoAplicacao');
            toast({ title: 'Custos das OS atualizados', description: `${n} OS recalculada(s) com o novo custo.` });
          }
        }
      } else {
        const duplicado = findProdutoDuplicado({ produtos, dados: form });
        if (duplicado) {
          toast({ variant: 'destructive', title: 'Código já existe', description: `Já existe um produto com este código: ${duplicado.nome}. Use Movimentações para dar entrada.` });
          return;
        }

        await api.entities.Produto.create({
          ...basePayload,
          quantidade: 0,
          codigo: proximoCodigoInterno(produtos),
        });
      }

      await onSaved?.();

      if (keepOpen && !produto) {
        setForm({ ...empty });
        toast({ title: 'Produto salvo', description: 'O formulário foi limpo para um novo cadastro.' });
        return;
      }

      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await saveProduct(false);
  }

  function scrollToSection(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function restoreForm() {
    setForm(produto ? { ...empty, ...produto } : { ...empty });
  }

  if (!open) return null;

  return (
    <div className="produto-editor-page">
      <header className="produto-editor-header">
        <div className="produto-editor-header__main">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="produto-editor-back"
            onClick={() => onOpenChange(false)}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="min-w-0">
            <h1 className="produto-editor-title">
              {produto ? 'Cadastro de Produto' : 'Cadastro de Produto'}
            </h1>
            <p className="produto-editor-subtitle">
              Gerencie informações, estoque e localização do produto
            </p>
          </div>
        </div>

        <div className="produto-editor-header__right">
          <div className="produto-editor-breadcrumb hidden xl:flex">
            <span>Cadastros</span>
            <span>›</span>
            <span>Produtos</span>
            <span>›</span>
            <strong>{produto ? 'Editar' : 'Novo'}</strong>
          </div>

          <div className="produto-editor-actions">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>

            {!produto && (
              <Button type="button" variant="outline" onClick={() => saveProduct(true)} disabled={saving}>
                <FileText className="mr-2 h-4 w-4" />
                Salvar e Novo
              </Button>
            )}

            <Button type="submit" form="produto-editor-form" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      </header>

      <form id="produto-editor-form" onSubmit={handleSubmit}>
        <div className="produto-editor-grid">
          <div className="produto-editor-main">
            <section className="produto-editor-section" id="produto-basico">
              <div className="produto-editor-section__header">
                <div className="produto-editor-section__icon">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h2>Informações Básicas</h2>
                  <p>Dados principais do produto</p>
                </div>
              </div>

              <div className="produto-editor-fields produto-editor-fields--2">
                <div className="produto-field">
                  <Label>Código</Label>
                  <div className="produto-readonly">
                    {produto?.codigo || 'Gerado automaticamente'}
                  </div>
                </div>

                <div className="produto-field">
                  <Label htmlFor="nome">Nome do Produto *</Label>
                  <Input
                    id="nome"
                    value={form.nome}
                    onChange={(e) => set('nome', e.target.value)}
                    placeholder="Ex.: Adubo NPK 20-05-20"
                    required
                  />
                </div>

                <div className="produto-field">
                  <Label>Categoria / Setor *</Label>
                  <SearchSelect
                    value={form.setor_id}
                    onChange={(v) => set('setor_id', v === 'all' ? '' : v)}
                    allLabel="— Nenhum —"
                    placeholder="Selecione o setor"
                    options={setores.map((s) => ({ value: s.id, label: s.nome }))}
                  />
                </div>

                <div className="produto-field">
                  <Label>Unidade de Medida *</Label>
                  <SearchSelect
                    value={form.unidade || 'un'}
                    onChange={handleUnidadeChange}
                    placeholder="Selecione a unidade"
                    options={UNIDADES.flatMap((f) => f.itens.map((u) => ({ value: u.value, label: u.label })))}
                  />
                </div>

                <div className="produto-field">
                  <Label htmlFor="codigo_referencia">Código de Referência</Label>
                  <Input
                    id="codigo_referencia"
                    value={form.codigo_referencia || ''}
                    onChange={(e) => set('codigo_referencia', e.target.value)}
                    placeholder="Código do fornecedor ou da NF-e"
                  />
                </div>

                <div className="produto-field">
                  <Label>Controle de Validade</Label>
                  <div className="produto-readonly produto-readonly--status">
                    <span className={controlaValidade ? 'is-positive' : ''}>
                      {controlaValidade ? 'Controla lotes e validade' : 'Sem controle de validade'}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="produto-editor-section" id="produto-localizacao">
              <div className="produto-editor-section__header">
                <div className="produto-editor-section__icon">
                  <Warehouse className="h-5 w-5" />
                </div>
                <div>
                  <h2>Estoque e Localização</h2>
                  <p>Controle de estoque e localização física</p>
                </div>
              </div>

              <div className="produto-editor-fields produto-editor-fields--2">
                <div className="produto-field">
                  <Label>Depósito Padrão</Label>
                  <SearchSelect
                    value={form.deposito_id}
                    onChange={(v) => set('deposito_id', v === 'all' ? '' : v)}
                    allLabel="— Nenhum —"
                    placeholder="Selecione o depósito"
                    options={depositos.map((d) => ({ value: d.id, label: `${d.numero}${d.nome ? ' · ' + d.nome : ''}` }))}
                  />
                </div>

                <div className="produto-field">
                  <Label>Gaveta / Local Padrão</Label>
                  <SearchSelect
                    value={form.gaveta_id}
                    onChange={(v) => set('gaveta_id', v === 'all' ? '' : v)}
                    allLabel="— Nenhum —"
                    placeholder="Selecione a gaveta / local"
                    options={sortGavetas(gavetas).map((g) => ({ value: g.id, label: g.codigo }))}
                  />
                </div>

                <div className="produto-field">
                  <Label>Máquina / Etiqueta</Label>
                  <SearchSelect
                    value={form.maquina_id}
                    onChange={(v) => set('maquina_id', v === 'all' ? '' : v)}
                    allLabel="— Nenhuma —"
                    placeholder="Selecione a máquina"
                    options={maquinas.map((m) => ({ value: m.id, label: `${m.codigo} — ${m.nome}` }))}
                  />
                </div>

                <div className="produto-field">
                  <Label>Estoque Atual</Label>
                  <div className="produto-readonly produto-readonly--quantity">
                    <span>{produto ? formatQtd(produto.quantidade || 0) : '0,000'}</span>
                    <small>{form.unidade || 'un'}</small>
                  </div>
                </div>

                <div className="produto-field">
                  <Label htmlFor="min">Estoque Mínimo</Label>
                  <div className="produto-input-with-unit">
                    <Input
                      id="min"
                      type="text"
                      inputMode="decimal"
                      placeholder="0,000"
                      value={form.estoque_minimo}
                      onChange={(e) => set('estoque_minimo', e.target.value)}
                    />
                    <span>{form.unidade || 'un'}</span>
                  </div>
                </div>

                <div className="produto-field">
                  <Label htmlFor="custo">Custo Unitário (R$)</Label>
                  <Input
                    id="custo"
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.custo_unitario}
                    onChange={(e) => set('custo_unitario', e.target.value)}
                  />
                </div>
              </div>

              <p className="produto-editor-help">
                A localização cadastrada é usada como padrão nas operações. Alterar estes campos não movimenta o estoque.
              </p>
            </section>

            <section className="produto-editor-section" id="produto-complementos">
              <div className="produto-editor-section__header">
                <div className="produto-editor-section__icon">
                  <Settings2 className="h-5 w-5" />
                </div>
                <div>
                  <h2>Complementos</h2>
                  <p>Informações adicionais do produto</p>
                </div>
              </div>

              <div className="produto-editor-complements">
                <div className="produto-editor-option">
                  <div>
                    <h3>Produto de venda</h3>
                    <p>Disponibiliza o produto para operações comerciais na pesagem/balança.</p>
                  </div>
                  <Checkbox checked={!!form.venda} onCheckedChange={(v) => set('venda', !!v)} />
                </div>

                <div className="produto-editor-conversion" id="produto-conversao">
                  <div className="produto-editor-conversion__header">
                    <div>
                      <h3>Conversão customizada para NF-e</h3>
                      <p>Use somente para unidades que não são reconhecidas automaticamente.</p>
                    </div>
                  </div>

                  <div className="produto-editor-conversion__row">
                    <span>1</span>
                    <Input
                      placeholder="CX"
                      value={form.unidade_alt || ''}
                      onChange={(e) => set('unidade_alt', e.target.value)}
                    />
                    <span>=</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={form.fator_conversao || ''}
                      onChange={(e) => set('fator_conversao', e.target.value)}
                    />
                    <span>{form.unidade || 'un'}</span>
                  </div>
                </div>

                <div className="produto-editor-photo" id="produto-foto">
                  <div className="produto-editor-photo__header">
                    <div className="produto-editor-photo__icon">
                      <ImageIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3>Foto de Referência</h3>
                      <p>Imagem opcional para facilitar a identificação do produto.</p>
                    </div>
                  </div>
                  <ProdutoFotoUpload value={form.foto_url || ''} onChange={(url) => set('foto_url', url)} />
                </div>
              </div>
            </section>
          </div>

          <aside className="produto-editor-side">
            <section className="produto-side-card">
              <div className="produto-side-card__header">
                <div className="produto-side-card__icon">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <h2>Status do Produto</h2>
                  <p>Situação do cadastro</p>
                </div>
              </div>

              <div className="produto-status-row">
                <div className={`produto-status-indicator ${produto ? 'is-saved' : 'is-new'}`}>
                  <span />
                </div>
                <div>
                  <strong>{produto ? 'Cadastrado' : 'Novo cadastro'}</strong>
                  <p>{produto ? 'Produto disponível no cadastro mestre' : 'Preencha os dados para salvar'}</p>
                </div>
              </div>

              <div className="produto-status-meta">
                <Clock3 className="h-4 w-4" />
                <div>
                  <span>Última atualização</span>
                  <strong>{formatDateTime(produto?.updated_date || produto?.created_date)}</strong>
                </div>
              </div>
            </section>

            <section className="produto-side-card">
              <div className="produto-side-card__header">
                <div className="produto-side-card__icon">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h2>Resumo do Cadastro</h2>
                  <p>Principais informações</p>
                </div>
              </div>

              <dl className="produto-summary">
                <div><dt>Código</dt><dd>{produto?.codigo || '—'}</dd></div>
                <div><dt>Nome do Produto</dt><dd>{form.nome || '—'}</dd></div>
                <div><dt>Categoria</dt><dd>{setorSelecionado?.nome || '—'}</dd></div>
                <div><dt>Unidade</dt><dd>{form.unidade || '—'}</dd></div>
                <div><dt>Estoque Atual</dt><dd>{produto ? `${formatQtd(produto.quantidade || 0)} ${form.unidade || ''}` : `0,000 ${form.unidade || 'un'}`}</dd></div>
                <div><dt>Custo Unitário</dt><dd>R$ {formatCurrency(form.custo_unitario)}</dd></div>
              </dl>
            </section>

            <section className="produto-side-card produto-side-card--actions">
              <div className="produto-side-card__header">
                <div className="produto-side-card__icon">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h2>Ações Rápidas</h2>
                  <p>Atalhos deste cadastro</p>
                </div>
              </div>

              <div className="produto-quick-actions">
                <button type="button" onClick={() => scrollToSection('produto-localizacao')}>
                  <MapPin className="h-4 w-4" />
                  <span>Ir para localização</span>
                </button>
                <button type="button" onClick={() => scrollToSection('produto-foto')}>
                  <ImageIcon className="h-4 w-4" />
                  <span>Ir para foto de referência</span>
                </button>
                <button type="button" onClick={() => scrollToSection('produto-conversao')}>
                  <Boxes className="h-4 w-4" />
                  <span>Ir para conversão NF-e</span>
                </button>
                <button type="button" onClick={restoreForm}>
                  <RotateCcw className="h-4 w-4" />
                  <span>Restaurar campos</span>
                </button>
              </div>

              <div className="produto-location-mini">
                <div>
                  <span>Depósito</span>
                  <strong>{depositoSelecionado?.nome || depositoSelecionado?.numero || 'Não definido'}</strong>
                </div>
                <div>
                  <span>Gaveta</span>
                  <strong>{gavetaSelecionada?.codigo || 'Não definida'}</strong>
                </div>
                <div>
                  <span>Máquina</span>
                  <strong>{maquinaSelecionada?.nome || 'Não definida'}</strong>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </form>

      <section className="produto-recent-card">
        <div className="produto-recent-card__header">
          <div className="produto-recent-card__title">
            <Clock3 className="h-4 w-4 text-primary" />
            <div>
              <h2>Últimos Produtos Cadastrados</h2>
              <p>Relação dos últimos produtos disponíveis no cadastro</p>
            </div>
          </div>
        </div>

        <div className="produto-recent-table-wrap">
          <table className="produto-recent-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome do Produto</th>
                <th>Categoria</th>
                <th>Unidade</th>
                <th>Estoque Atual</th>
                <th>Custo Unitário</th>
                <th>Última Atualização</th>
              </tr>
            </thead>
            <tbody>
              {ultimosProdutos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="produto-recent-empty">Nenhum produto cadastrado ainda.</td>
                </tr>
              ) : (
                ultimosProdutos.map((item) => {
                  const setorItem = setores.find((s) => s.id === item.setor_id);
                  return (
                    <tr key={item.id}>
                      <td className="font-mono">{item.codigo || '—'}</td>
                      <td className="font-medium">{item.nome || '—'}</td>
                      <td>{setorItem?.nome || '—'}</td>
                      <td>{item.unidade || '—'}</td>
                      <td>{formatQtd(item.quantidade || 0)}</td>
                      <td>R$ {formatCurrency(item.custo_unitario)}</td>
                      <td>{formatDateTime(item.updated_date || item.created_date)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
