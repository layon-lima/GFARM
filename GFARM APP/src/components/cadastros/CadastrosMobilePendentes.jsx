import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Loader2, RefreshCw, Smartphone, X } from 'lucide-react';

import { cadastrosMobileApi } from '@/api/cadastrosMobileClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Image } from '@/components/ui/image';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SearchSelect from '@/components/SearchSelect';
import { useToast } from '@/components/ui/use-toast';
import { useEntidades } from '@/lib/useEntidades';

const LABELS = {
  nome: 'Nome',
  codigo: 'Código',
  codigo_referencia: 'Código de referência',
  numero: 'Número',
  descricao: 'Descrição',
  setor_id: 'Setor',
  deposito_id: 'Depósito',
  gaveta_id: 'Gaveta',
  maquina_id: 'Máquina',
  unidade: 'Unidade',
  unidade_alt: 'Unidade alternativa',
  fator_conversao: 'Fator de conversão',
  estoque_minimo: 'Estoque mínimo',
  custo_unitario: 'Custo unitário',
  venda: 'Produto de venda',
  cor: 'Cor',
  icon: 'Ícone',
  controla_validade: 'Controla validade',
  tem_aba_mobile: 'Aparece no mobile',
  permite_inventario: 'Permite inventário',
};

const NUMERICOS = new Set(['fator_conversao', 'estoque_minimo', 'custo_unitario']);

export default function CadastrosMobilePendentes() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState({});
  const { data } = useEntidades({
    Setor: {},
    Deposito: {},
    Gaveta: {},
    Maquina: {},
  });

  const setores = data.Setor || [];
  const depositos = data.Deposito || [];
  const gavetas = data.Gaveta || [];
  const maquinas = data.Maquina || [];

  const options = useMemo(
    () => ({
      setor_id: setores.map((x) => ({ value: x.id, label: x.nome })),
      deposito_id: depositos.map((x) => ({
        value: x.id,
        label: `${x.numero || ''} ${x.nome || ''}`.trim(),
      })),
      maquina_id: maquinas.map((x) => ({
        value: x.id,
        label: `${x.codigo || ''} ${x.nome || ''}`.trim(),
      })),
    }),
    [setores, depositos, maquinas]
  );

  async function load() {
    setLoading(true);
    try {
      const result = await cadastrosMobileApi.listar('PENDENTE');
      setItems(result);
      setEditing(
        Object.fromEntries(result.map((item) => [item.id, { ...item.dados }]))
      );
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar pendências',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function setField(itemId, key, value) {
    setEditing((all) => ({
      ...all,
      [itemId]: {
        ...all[itemId],
        [key]: value,
      },
    }));
  }

  async function approve(item) {
    setBusy(item.id);
    try {
      await cadastrosMobileApi.aprovar(item.id, editing[item.id]);
      toast({
        title: 'Cadastro aprovado',
        description: 'O registro oficial foi criado com sucesso.',
      });
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
      await cadastrosMobileApi.rejeitar(item.id, motivo.trim());
      toast({ title: 'Solicitação rejeitada' });
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

  function editor(item, key, value) {
    if (key === 'setor_id' || key === 'deposito_id' || key === 'maquina_id') {
      return (
        <SearchSelect
          value={value || 'all'}
          onChange={(novo) => setField(item.id, key, novo === 'all' ? '' : novo)}
          allLabel="— Nenhum —"
          placeholder="Selecione…"
          options={options[key] || []}
        />
      );
    }

    if (key === 'gaveta_id') {
      const depositoId = editing[item.id]?.deposito_id;
      const opcoes = gavetas
        .filter((gaveta) => !depositoId || gaveta.deposito_id === depositoId)
        .map((gaveta) => ({
          value: gaveta.id,
          label: `${gaveta.codigo || ''}${gaveta.descricao ? ` — ${gaveta.descricao}` : ''}`,
        }));

      return (
        <SearchSelect
          value={value || 'all'}
          onChange={(novo) => setField(item.id, key, novo === 'all' ? '' : novo)}
          allLabel="— Nenhuma —"
          placeholder="Selecione…"
          options={opcoes}
        />
      );
    }

    if (typeof value === 'boolean') {
      return (
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={String(value)}
          onChange={(e) => setField(item.id, key, e.target.value === 'true')}
        >
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      );
    }

    return (
      <Input
        type={NUMERICOS.has(key) ? 'number' : key === 'cor' ? 'color' : 'text'}
        step={key === 'fator_conversao' ? '0.001' : NUMERICOS.has(key) ? '0.01' : undefined}
        value={value ?? ''}
        onChange={(e) => setField(item.id, key, e.target.value)}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Aguardando revisão</h3>
          <p className="text-sm text-muted-foreground">
            Revise os dados antes de criar o cadastro oficial.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="rounded-2xl p-8 text-center text-muted-foreground">
          <Smartphone className="mx-auto mb-3 h-8 w-8" />
          Nenhum cadastro mobile pendente.
        </Card>
      ) : (
        items.map((item) => (
          <Card key={item.id} className="overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge>{item.tipo}</Badge>
                  <span className="font-semibold">
                    {item.dados?.nome || item.dados?.codigo || item.dados?.numero || 'Solicitação'}
                  </span>
                </div>

                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 className="h-3 w-3" />
                  {item.solicitante_nome || 'Administrador'} ·{' '}
                  {new Date(item.created_date).toLocaleString('pt-BR')}
                </p>
              </div>

              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                Pendente
              </Badge>
            </div>

            <div className="grid gap-5 p-4 lg:grid-cols-[1fr_240px]">
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(editing[item.id] || {})
                  .filter(([key]) => key !== 'foto_url')
                  .map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <Label>{LABELS[key] || key}</Label>
                      {editor(item, key, value)}
                    </div>
                  ))}
              </div>

              <div className="space-y-3">
                {item.imagem_url ? (
                  <Image
                    src={item.imagem_url}
                    alt="Foto enviada"
                    className="h-44 w-full rounded-xl border object-cover"
                  />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
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
                  Aprovar
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
        ))
      )}
    </div>
  );
}
