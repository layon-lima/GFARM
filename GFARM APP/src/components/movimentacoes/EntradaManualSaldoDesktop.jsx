import { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Loader2,
  PackagePlus,
  Trash2,
  Warehouse,
} from 'lucide-react';

import { api } from '@/api/apiClient';
import { estoqueApi } from '@/api/estoqueClient';
import SearchSelect from '@/components/SearchSelect';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { parseQtd } from '@/lib/format';
import { sortGavetas } from '@/lib/gavetas';
import { setorControlaValidade } from '@/lib/lotes';

function depositoLabel(deposito) {
  if (!deposito) return '—';

  const numero = String(deposito.numero || '').trim();
  const nome = String(deposito.nome || '').trim();

  if (numero && nome) {
    return `${numero} — ${nome}`;
  }

  return numero || nome || 'Depósito';
}

export default function EntradaManualSaldoDesktop({
  produtos = [],
  setores = [],
  depositos = [],
  gavetas = [],
  onSuccess,
}) {
  const { toast } = useToast();

  const [form, setForm] = useState({
    setor_id: '',
    nome_produto: '',
    quantidade: '',
    deposito_id: '',
    gaveta_id: '',
    unidade: 'un',
    data_validade: '',
    foto_url: '',
    observacao: '',
  });

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fotoNome, setFotoNome] = useState('');

  const setorSelecionado = setores.find(
    (item) => item.id === form.setor_id
  );

  const produtoExistente = useMemo(() => {
    const alvo = String(form.nome_produto || '')
      .trim()
      .toLocaleLowerCase('pt-BR');

    if (!alvo) return null;

    return produtos.find(
      (produto) =>
        String(produto.nome || '')
          .trim()
          .toLocaleLowerCase('pt-BR') === alvo
    ) || null;
  }, [form.nome_produto, produtos]);

  const produtosDoSetor = useMemo(
    () =>
      produtos
        .filter(
          (produto) =>
            !form.setor_id
            || produto.setor_id === form.setor_id
        )
        .slice()
        .sort((a, b) =>
          String(a.nome || '').localeCompare(
            String(b.nome || ''),
            'pt-BR'
          )
        ),
    [form.setor_id, produtos]
  );

  const depositosDoSetor = useMemo(
    () =>
      depositos
        .filter(
          (deposito) =>
            deposito.setor_id === form.setor_id
        )
        .slice()
        .sort((a, b) =>
          depositoLabel(a).localeCompare(
            depositoLabel(b),
            'pt-BR'
          )
        ),
    [depositos, form.setor_id]
  );

  const gavetasDoDeposito = useMemo(
    () =>
      sortGavetas(
        gavetas.filter(
          (gaveta) =>
            gaveta.deposito_id === form.deposito_id
        )
      ),
    [form.deposito_id, gavetas]
  );

  const gavetaObrigatoria =
    !!form.deposito_id
    && gavetasDoDeposito.length > 0;

  const controlaValidade =
    !!form.setor_id
    && setorControlaValidade(
      form.setor_id,
      setores
    );

  useEffect(() => {
    if (!form.setor_id) return;

    setForm((atual) => {
      const depositoValido =
        depositosDoSetor.some(
          (item) => item.id === atual.deposito_id
        );

      const proximoDeposito =
        depositosDoSetor.length === 1
          ? depositosDoSetor[0].id
          : depositoValido
            ? atual.deposito_id
            : '';

      if (
        proximoDeposito === atual.deposito_id
        && !atual.gaveta_id
      ) {
        return atual;
      }

      return {
        ...atual,
        deposito_id: proximoDeposito,
        gaveta_id: '',
      };
    });
  }, [depositosDoSetor, form.setor_id]);

  useEffect(() => {
    if (!produtoExistente) return;

    setForm((atual) => ({
      ...atual,
      unidade: produtoExistente.unidade || 'un',
    }));
  }, [produtoExistente]);

  function setCampo(campo, valor) {
    setForm((atual) => ({
      ...atual,
      [campo]: valor,
      ...(campo === 'setor_id'
        ? {
            deposito_id: '',
            gaveta_id: '',
            data_validade: '',
          }
        : {}),
      ...(campo === 'deposito_id'
        ? { gaveta_id: '' }
        : {}),
    }));
  }

  function limpar({ preservarLocal = false } = {}) {
    setForm((atual) => ({
      setor_id:
        preservarLocal
          ? atual.setor_id
          : '',
      nome_produto: '',
      quantidade: '',
      deposito_id:
        preservarLocal
          ? atual.deposito_id
          : '',
      gaveta_id: '',
      unidade: 'un',
      data_validade: '',
      foto_url: '',
      observacao: '',
    }));
    setFotoNome('');
  }

  async function enviarFoto(file) {
    if (!file) return;

    setUploading(true);

    try {
      const result =
        await api.integrations.Core.UploadFile({
          file,
        });

      setForm((atual) => ({
        ...atual,
        foto_url: result.file_url,
      }));
      setFotoNome(file.name || 'Foto do produto');
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível enviar a foto',
        description: error?.message,
      });
    } finally {
      setUploading(false);
    }
  }

  async function enviar(event) {
    event.preventDefault();

    const quantidade = parseQtd(form.quantidade);
    const nome = String(form.nome_produto || '').trim();

    if (!form.setor_id) {
      toast({
        variant: 'destructive',
        title: 'Setor obrigatório',
        description: 'Selecione o setor da entrada.',
      });
      return;
    }

    if (!nome) {
      toast({
        variant: 'destructive',
        title: 'Produto obrigatório',
        description: 'Informe o nome do produto.',
      });
      return;
    }

    if (!(quantidade > 0)) {
      toast({
        variant: 'destructive',
        title: 'Quantidade obrigatória',
        description: 'Informe uma quantidade maior que zero.',
      });
      return;
    }

    if (!form.deposito_id) {
      toast({
        variant: 'destructive',
        title: 'Depósito obrigatório',
        description:
          depositosDoSetor.length === 0
            ? 'Este setor não possui depósito cadastrado.'
            : 'Selecione o depósito.',
      });
      return;
    }

    if (gavetaObrigatoria && !form.gaveta_id) {
      toast({
        variant: 'destructive',
        title: 'Gaveta obrigatória',
        description:
          'Este depósito possui gavetas. Selecione a gaveta.',
      });
      return;
    }

    if (controlaValidade && !form.data_validade) {
      toast({
        variant: 'destructive',
        title: 'Validade obrigatória',
        description:
          'Este setor controla validade. Informe a data.',
      });
      return;
    }

    setSaving(true);

    try {
      const resposta = await estoqueApi.entradaManual({
        nome_produto: nome,
        quantidade,
        setor_id: form.setor_id,
        deposito_id: form.deposito_id,
        gaveta_id: form.gaveta_id || null,
        unidade:
          produtoExistente?.unidade
          || form.unidade
          || 'un',
        data_validade:
          form.data_validade
          || null,
        foto_url:
          form.foto_url
          || null,
        observacao:
          String(form.observacao || '').trim()
          || null,
      });

      toast({
        title: 'Saldo adicionado',
        description: resposta?.produto_criado
          ? 'Produto criado e saldo contabilizado pelo motor de estoque.'
          : 'Saldo contabilizado pelo motor de estoque.',
      });

      limpar({
        preservarLocal: true,
      });

      onSuccess?.(resposta);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível adicionar o saldo',
        description:
          error?.message
          || 'Revise os dados e tente novamente.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden border-border/70">
      <form
        onSubmit={enviar}
        className="grid lg:grid-cols-[minmax(0,1fr)_340px]"
      >
        <div className="space-y-4 border-b p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <section className="rounded-xl border bg-card p-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                1
              </div>
              <div>
                <h2 className="text-sm font-semibold">
                  Setor e produto
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Igual ao fluxo mobile: escolha o setor e informe o produto.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Setor *</Label>
                <SearchSelect
                  value={form.setor_id}
                  onChange={(value) =>
                    setCampo(
                      'setor_id',
                      value === 'all'
                        ? ''
                        : value
                    )
                  }
                  placeholder="Selecionar setor..."
                  options={setores.map((setor) => ({
                    value: setor.id,
                    label: setor.nome,
                  }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="entrada-manual-produto">
                  Produto *
                </Label>
                <Input
                  id="entrada-manual-produto"
                  list="entrada-manual-produtos-lista"
                  value={form.nome_produto}
                  onChange={(event) =>
                    setCampo(
                      'nome_produto',
                      event.target.value
                    )
                  }
                  placeholder="Digite ou escolha o nome do produto"
                  autoComplete="off"
                />
                <datalist id="entrada-manual-produtos-lista">
                  {produtosDoSetor.map((produto) => (
                    <option
                      key={produto.id}
                      value={produto.nome}
                    />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  {produtoExistente
                    ? `Produto existente · ${produtoExistente.codigo || 'sem código'}`
                    : form.nome_produto.trim()
                      ? 'Nome novo: o produto será criado automaticamente.'
                      : 'Você pode usar um produto existente ou digitar um novo nome.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="entrada-manual-qtd">
                  Quantidade *
                </Label>
                <Input
                  id="entrada-manual-qtd"
                  inputMode="decimal"
                  value={form.quantidade}
                  onChange={(event) =>
                    setCampo(
                      'quantidade',
                      event.target.value
                    )
                  }
                  placeholder="0,00"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="entrada-manual-unidade">
                  Unidade
                </Label>
                <Input
                  id="entrada-manual-unidade"
                  value={
                    produtoExistente?.unidade
                    || form.unidade
                  }
                  onChange={(event) =>
                    setCampo(
                      'unidade',
                      event.target.value
                    )
                  }
                  disabled={!!produtoExistente}
                  placeholder="un"
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border bg-card p-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                2
              </div>
              <div>
                <h2 className="text-sm font-semibold">
                  Localização
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Depósito e gaveta obedecem ao setor selecionado.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Depósito *</Label>
                <SearchSelect
                  value={form.deposito_id}
                  onChange={(value) =>
                    setCampo(
                      'deposito_id',
                      value === 'all'
                        ? ''
                        : value
                    )
                  }
                  placeholder={
                    form.setor_id
                      ? 'Selecionar depósito...'
                      : 'Selecione o setor primeiro'
                  }
                  disabled={!form.setor_id}
                  options={depositosDoSetor.map(
                    (deposito) => ({
                      value: deposito.id,
                      label: depositoLabel(deposito),
                    })
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  Gaveta
                  {gavetaObrigatoria ? ' *' : ''}
                </Label>
                <SearchSelect
                  value={form.gaveta_id}
                  onChange={(value) =>
                    setCampo(
                      'gaveta_id',
                      value === 'all'
                        ? ''
                        : value
                    )
                  }
                  allLabel={
                    gavetaObrigatoria
                      ? 'Selecione a gaveta'
                      : '— Nenhuma —'
                  }
                  placeholder="Selecionar gaveta..."
                  disabled={!form.deposito_id}
                  options={gavetasDoDeposito.map(
                    (gaveta) => ({
                      value: gaveta.id,
                      label: gaveta.codigo,
                    })
                  )}
                />
              </div>

              {controlaValidade ? (
                <div className="space-y-1.5">
                  <Label htmlFor="entrada-manual-validade">
                    Validade *
                  </Label>
                  <Input
                    id="entrada-manual-validade"
                    type="date"
                    value={form.data_validade}
                    onChange={(event) =>
                      setCampo(
                        'data_validade',
                        event.target.value
                      )
                    }
                  />
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                3
              </div>
              <div>
                <h2 className="text-sm font-semibold">
                  Foto e observação
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A foto é opcional, como no fluxo mobile.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <Label>Foto do produto</Label>
                <label className="flex min-h-24 cursor-pointer items-center justify-center rounded-xl border border-dashed bg-muted/10 px-3 text-center hover:bg-muted/20">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(event) =>
                      enviarFoto(
                        event.target.files?.[0]
                      )
                    }
                  />
                  {uploading ? (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando...
                    </span>
                  ) : form.foto_url ? (
                    <span className="flex items-center gap-2 text-sm text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      {fotoNome || 'Foto carregada'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Camera className="h-4 w-4" />
                      Adicionar foto
                    </span>
                  )}
                </label>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="entrada-manual-obs">
                  Observação
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </Label>
                <Textarea
                  id="entrada-manual-obs"
                  rows={4}
                  value={form.observacao}
                  onChange={(event) =>
                    setCampo(
                      'observacao',
                      event.target.value
                    )
                  }
                  placeholder="Informação complementar sobre esta entrada..."
                />
              </div>
            </div>
          </section>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => limpar()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Limpar
            </Button>

            <Button
              type="submit"
              disabled={saving || uploading}
              className="min-w-[190px]"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PackagePlus className="mr-2 h-4 w-4" />
              )}
              {saving
                ? 'Adicionando...'
                : 'Adicionar saldo'}
            </Button>
          </div>
        </div>

        <aside className="bg-muted/5 p-4 sm:p-5">
          <div className="lg:sticky lg:top-24">
            <h2 className="text-sm font-semibold">
              Resumo da entrada manual
            </h2>

            <div className="mt-3 space-y-3">
              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <PackagePlus className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {form.nome_produto.trim()
                        || 'Nenhum produto informado'}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {produtoExistente
                        ? 'Produto existente'
                        : form.nome_produto.trim()
                          ? 'Novo produto'
                          : 'Digite o nome para iniciar'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4 text-sm">
                <div className="text-xs font-medium text-muted-foreground">
                  Quantidade
                </div>
                <div className="mt-1 font-semibold">
                  {form.quantidade || '—'} {
                    produtoExistente?.unidade
                    || form.unidade
                    || 'un'
                  }
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Warehouse className="h-4 w-4" />
                  Localização
                </div>
                <div className="mt-2 text-sm font-semibold">
                  {setorSelecionado?.nome || '—'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {depositoLabel(
                    depositos.find(
                      (item) =>
                        item.id === form.deposito_id
                    )
                  )}
                  {form.gaveta_id
                    ? ' · ' + (
                        gavetas.find(
                          (item) =>
                            item.id === form.gaveta_id
                        )?.codigo
                        || 'Gaveta'
                      )
                    : ''}
                </div>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 text-xs leading-relaxed text-muted-foreground">
                <strong className="block text-foreground">
                  Motor de estoque
                </strong>
                A entrada só é concluída depois que o backend valida o local e o motor oficial contabiliza o saldo.
              </div>
            </div>
          </div>
        </aside>
      </form>
    </Card>
  );
}
