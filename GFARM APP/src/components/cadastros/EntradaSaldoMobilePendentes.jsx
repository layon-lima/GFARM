import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock3,
  Loader2,
  PackagePlus,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';

import { entradaSaldoMobileApi } from '@/api/entradaSaldoMobileClient';
import SearchSelect from '@/components/SearchSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Image } from '@/components/ui/image';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useEntidades, invalidateEntidade, invalidateEstoque } from '@/lib/useEntidades';

function norm(value) {
  return String(value || '').trim().toLocaleUpperCase('pt-BR');
}

export default function EntradaSaldoMobilePendentes({
  onPendingCountChange,
}) {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const { data } = useEntidades({
    Setor: {},
    Deposito: {},
    Gaveta: {},
    Produto: {},
  });

  const setores = data.Setor || [];
  const depositos = data.Deposito || [];
  const gavetas = data.Gaveta || [];
  const produtos = data.Produto || [];

  const setoresMap = useMemo(
    () => new Map(setores.map((item) => [item.id, item])),
    [setores]
  );

  async function load() {
    setLoading(true);

    try {
      const result = await entradaSaldoMobileApi.listar('PENDENTE');
      const pendentes = result || [];

      setItems(pendentes);
      onPendingCountChange?.(pendentes.length);

      setEditing(
        Object.fromEntries(
          pendentes.map((item) => [
            item.id,
            {
              nome_produto: item.nome_produto || '',
              quantidade: item.quantidade ?? '',
              setor_id: item.setor_id || '',
              deposito_id: item.deposito_id || '',
              gaveta_id: item.gaveta_id || '',
              unidade: item.unidade || 'un',
              data_validade: item.data_validade || '',
            },
          ])
        )
      );
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar Entradas Manuais',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function setField(id, field, value) {
    setEditing((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [field]: value,
        ...(field === 'setor_id'
          ? { deposito_id: '', gaveta_id: '', data_validade: '' }
          : {}),
        ...(field === 'deposito_id'
          ? { gaveta_id: '' }
          : {}),
      },
    }));
  }

  function depositoOptions(item) {
    const setorId = editing[item.id]?.setor_id;

    return depositos
      .filter((deposito) => !setorId || deposito.setor_id === setorId)
      .map((deposito) => ({
        value: deposito.id,
        label: `${deposito.numero || ''}${deposito.nome ? ` — ${deposito.nome}` : ''}`.trim(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  function gavetaOptions(item) {
    const depositoId = editing[item.id]?.deposito_id;

    return gavetas
      .filter((gaveta) => gaveta.deposito_id === depositoId)
      .map((gaveta) => ({
        value: gaveta.id,
        label: `${gaveta.codigo || ''}${gaveta.descricao ? ` — ${gaveta.descricao}` : ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  function produtoExistente(item) {
    const nome = norm(editing[item.id]?.nome_produto);
    if (!nome) return null;

    return produtos.find((produto) => norm(produto.nome) === nome) || null;
  }

  async function approve(item) {
    const dados = editing[item.id] || {};
    const gavetasLocal = gavetaOptions(item);

    if (!dados.nome_produto?.trim()) {
      toast({ variant: 'destructive', title: 'Nome do produto obrigatório' });
      return;
    }

    if (Number(dados.quantidade) <= 0) {
      toast({ variant: 'destructive', title: 'Quantidade inválida' });
      return;
    }

    if (!dados.setor_id || !dados.deposito_id) {
      toast({
        variant: 'destructive',
        title: 'Setor e depósito são obrigatórios',
      });
      return;
    }

    if (gavetasLocal.length > 0 && !dados.gaveta_id) {
      toast({
        variant: 'destructive',
        title: 'Gaveta obrigatória',
        description: 'O depósito selecionado possui gavetas vinculadas.',
      });
      return;
    }

    const setor = setoresMap.get(dados.setor_id);
    if (setor?.controla_validade && !dados.data_validade) {
      toast({
        variant: 'destructive',
        title: 'Data de validade obrigatória',
        description: 'O setor selecionado controla validade.',
      });
      return;
    }

    setBusy(item.id);

    try {
      const result = await entradaSaldoMobileApi.aprovar(item.id, {
        nome_produto: dados.nome_produto.trim(),
        quantidade: Number(dados.quantidade),
        setor_id: dados.setor_id,
        deposito_id: dados.deposito_id,
        gaveta_id: dados.gaveta_id || null,
        unidade: String(produtoExistente(item)?.unidade || dados.unidade || 'un').trim() || 'un',
        data_validade: dados.data_validade || null,
      });

      toast({
        title: 'Entrada Manual aprovada',
        description: result?.documento?.numero
          ? `Saldo contabilizado no documento ${result.documento.numero}.`
          : 'Produto e saldo foram processados com sucesso.',
      });

      await Promise.all([
        invalidateEntidade('Produto'),
        invalidateEstoque(),
      ]);

      await load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'A aprovação não foi concluída',
        description: error.message,
      });
    } finally {
      setBusy(null);
    }
  }

  async function reject(item) {
    const motivo = window.prompt('Informe o motivo da rejeição:');
    if (!motivo?.trim()) return;

    setBusy(item.id);

    try {
      await entradaSaldoMobileApi.rejeitar(item.id, motivo.trim());
      toast({ title: 'Entrada Manual rejeitada' });
      await load();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível rejeitar',
        description: error.message,
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Entradas Manuais aguardando revisão</h3>
          <p className="text-sm text-muted-foreground">
            Nada enviado pelo celular altera o estoque antes da aprovação.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="rounded-xl p-8 text-center text-muted-foreground">
          <Smartphone className="mx-auto mb-3 h-8 w-8" />
          Nenhuma Entrada Manual de Saldo pendente.
        </Card>
      ) : (
        items.map((item) => {
          const dados = editing[item.id] || {};
          const gavetasLocal = gavetaOptions(item);
          const setor = setoresMap.get(dados.setor_id);
          const existente = produtoExistente(item);

          return (
            <Card key={item.id} className="overflow-hidden rounded-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="gap-1">
                      <PackagePlus className="h-3 w-3" />
                      Entrada Manual
                    </Badge>

                    <span className="font-semibold">
                      {item.nome_produto || 'Produto'}
                    </span>

                    {existente ? (
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                        Produto já cadastrado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Novo produto
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    {item.solicitante_nome || 'Usuário'} ·{' '}
                    {new Date(item.created_date).toLocaleString('pt-BR')}
                  </p>
                </div>

                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                  Pendente
                </Badge>
              </div>

              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-1">
                    <Label>Nome do produto</Label>
                    <Input
                      value={dados.nome_produto || ''}
                      onChange={(e) => setField(item.id, 'nome_produto', e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Quantidade</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={dados.quantidade ?? ''}
                      onChange={(e) => setField(item.id, 'quantidade', e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Unidade</Label>
                    <Input
                      value={existente?.unidade || dados.unidade || 'un'}
                      onChange={(e) => setField(item.id, 'unidade', e.target.value)}
                      placeholder="un"
                      disabled={!!existente}
                    />
                    {existente ? (
                      <p className="text-[11px] text-muted-foreground">
                        Produto existente: a entrada usará a unidade já cadastrada.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <Label>Setor</Label>
                    <SearchSelect
                      value={dados.setor_id || 'all'}
                      onChange={(value) => setField(item.id, 'setor_id', value === 'all' ? '' : value)}
                      allLabel="Selecione…"
                      placeholder="Selecione…"
                      options={setores
                        .map((x) => ({ value: x.id, label: x.nome }))
                        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Depósito</Label>
                    <SearchSelect
                      value={dados.deposito_id || 'all'}
                      onChange={(value) => setField(item.id, 'deposito_id', value === 'all' ? '' : value)}
                      allLabel="Selecione…"
                      placeholder="Selecione…"
                      options={depositoOptions(item)}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>
                      Gaveta {gavetasLocal.length > 0 ? '*' : ''}
                    </Label>
                    {gavetasLocal.length > 0 ? (
                      <SearchSelect
                        value={dados.gaveta_id || 'all'}
                        onChange={(value) => setField(item.id, 'gaveta_id', value === 'all' ? '' : value)}
                        allLabel="Selecione…"
                        placeholder="Selecione…"
                        options={gavetasLocal}
                      />
                    ) : (
                      <div className="flex h-10 items-center rounded-md border bg-muted/20 px-3 text-sm text-muted-foreground">
                        Depósito sem gavetas
                      </div>
                    )}
                  </div>

                  {setor?.controla_validade ? (
                    <div className="space-y-1">
                      <Label>Data de validade *</Label>
                      <Input
                        type="date"
                        value={dados.data_validade || ''}
                        onChange={(e) => setField(item.id, 'data_validade', e.target.value)}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {item.foto_url ? (
                    <Image
                      src={item.foto_url}
                      alt={item.nome_produto || 'Produto'}
                      className="aspect-square w-full rounded-xl border object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                      Sem foto
                    </div>
                  )}

                  <Button
                    className="w-full"
                    disabled={busy === item.id}
                    onClick={() => approve(item)}
                  >
                    {busy === item.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Aprovar e contabilizar
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full text-destructive"
                    disabled={busy === item.id}
                    onClick={() => reject(item)}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Rejeitar
                  </Button>
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
