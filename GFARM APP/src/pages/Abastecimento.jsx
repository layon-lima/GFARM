import { useState, useMemo, useEffect } from 'react';
import { Fuel, Search, Clock, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { useEntidades, invalidateEstoque } from '@/lib/useEntidades';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useBackHandler } from '@/hooks/useBackHandler';
import { useToast } from '@/components/ui/use-toast';
import { getDisplayName } from '@/lib/userName';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  carregarCatalogoAbastecimento,
  contarAbastecimentosOffline,
  registrarAbastecimentoMobileSeguro,
  salvarCatalogoAbastecimento,
} from '@/lib/abastecimentoOffline';
import {
  findSetorCombustivel, produtosCombustivel,
  registrarAbastecimentoPendente, confirmarAbastecimento, cancelarAbastecimento,
} from '@/lib/abastecimento';
import { formatQtd } from '@/lib/format';
import AbastecimentoForm from '@/components/abastecimento/AbastecimentoForm';
import AbastecimentoRow from '@/components/abastecimento/AbastecimentoRow';
import AbastecimentoPendentes from '@/components/abastecimento/AbastecimentoPendentes';

export default function Abastecimento() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [sucesso, setSucesso] = useState(false);
  const [pendentesSync, setPendentesSync] = useState(0);
  const [catalogoOffline, setCatalogoOffline] = useState(() =>
    carregarCatalogoAbastecimento()
  );

  const [maquinaSelecionada, setMaquinaSelecionada] = useState(null);
  const [buscaMaquina, setBuscaMaquina] = usePersistentState('abast:busca', '');
  const [maquinaId, setMaquinaId] = usePersistentState('abast:maquinaId', null);
  const [aba, setAba] = useState('abastecer');

  const { data, loading, reload: load } = useEntidades({
    Maquina: {},
    Produto: {},
    Setor: {},
    Lote: {},
    SaldoEstoque: {},
    Movimentacao: { sort: '-data', limit: 100 },
    Abastecimento: { sort: '-data', limit: 200 },
  });
  const {
    Maquina: maquinasRede,
    Produto: produtosRede,
    Setor: setoresRede,
    Lote: lotes,
    SaldoEstoque: saldos,
    Movimentacao: movimentacoes,
    Abastecimento: abastecimentos,
  } = data;

  const maquinas =
    isMobile && (maquinasRede || []).length === 0
      ? catalogoOffline.maquinas
      : (maquinasRede || []);

  const produtos =
    isMobile && (produtosRede || []).length === 0
      ? catalogoOffline.produtos
      : (produtosRede || []);

  const setores =
    isMobile && (setoresRede || []).length === 0
      ? catalogoOffline.setores
      : (setoresRede || []);

  useEffect(() => {
    if (
      !isMobile
      || loading
      || (maquinasRede || []).length === 0
      || (produtosRede || []).length === 0
      || (setoresRede || []).length === 0
    ) {
      return;
    }

    salvarCatalogoAbastecimento({
      maquinas: maquinasRede,
      produtos: produtosRede,
      setores: setoresRede,
    });

    setCatalogoOffline(
      carregarCatalogoAbastecimento()
    );
  }, [
    isMobile,
    loading,
    maquinasRede,
    produtosRede,
    setoresRede,
  ]);

  useEffect(() => {
    if (!isMobile) return undefined;

    let active = true;

    const atualizar = async () => {
      const total = await contarAbastecimentosOffline({
        userId: user?.id,
      });

      if (active) {
        setPendentesSync(total);
      }
    };

    const sincronizado = () => {
      atualizar();
      load();
    };

    atualizar();

    window.addEventListener(
      'abastecimento:offline-synced',
      sincronizado
    );

    return () => {
      active = false;
      window.removeEventListener(
        'abastecimento:offline-synced',
        sincronizado
      );
    };
  }, [isMobile, user?.id, load]);

  const podeConfirmar = hasPermission(
    user,
    'operacao.abastecimento.confirmar'
  );

  const podeAbastecerSemFoto = hasPermission(
    user,
    'operacao.abastecimento.sem_foto'
  );

  const setorCombustivel = useMemo(() => findSetorCombustivel(setores), [setores]);
  const combustiveis = useMemo(
    () => produtosCombustivel(produtos, setorCombustivel?.id),
    [produtos, setorCombustivel]
  );

  const maquinasFiltradas = useMemo(() => {
    const q = buscaMaquina.toLowerCase().trim();
    return maquinas
      .filter((m) => m.permite_abastecimento === true)
      .filter((m) =>
        !q ||
        (m.codigo || '').toLowerCase().includes(q) ||
        (m.nome || '').toLowerCase().includes(q)
      );
  }, [maquinas, buscaMaquina]);

  const produtoPredefinido = useMemo(
    () => combustiveis.find((p) => p.id === maquinaSelecionada?.combustivel_id) || null,
    [combustiveis, maquinaSelecionada]
  );

  const pendentes = useMemo(
    () => abastecimentos.filter((a) => (a.status || 'pendente') === 'pendente'),
    [abastecimentos]
  );
  const recentes = useMemo(
    () => abastecimentos.filter((a) => (a.status || 'pendente') !== 'pendente'),
    [abastecimentos]
  );

  // Voltar do sistema (mobile): com máquina selecionada, volta para a lista em vez de sair.
  useBackHandler(!!maquinaSelecionada, () => { setMaquinaSelecionada(null); setMaquinaId(null); });

  // Restaura a máquina selecionada ao retornar para a aba (preserva fluxo em andamento).
  useEffect(() => {
    if (maquinaId && !maquinaSelecionada) {
      const m = maquinas.find((x) => x.id === maquinaId);
      if (m) setMaquinaSelecionada(m);
    }
  }, [maquinas, maquinaId, maquinaSelecionada]);

  async function handleSubmit({
    produto,
    quantidade,
    observacao,
    foto_url,
    foto_file,
  }) {
    setSaving(true);

    try {
      if (isMobile) {
        const resultado =
          await registrarAbastecimentoMobileSeguro({
            maquina: maquinaSelecionada,
            produto,
            quantidade,
            observacao,
            operador: getDisplayName(user),
            fotoFile: foto_file || null,
            userId: user?.id,
          });

        const total = await contarAbastecimentosOffline({
          userId: user?.id,
        });

        setPendentesSync(total);

        if (resultado.sincronizado) {
          load();
        }

        toast({
          title: 'Abastecimento registrado',
        });
      } else {
        await registrarAbastecimentoPendente({
          maquina: maquinaSelecionada,
          produto,
          quantidade,
          observacao,
          operador: getDisplayName(user),
          foto_url,
        });

        toast({
          title: 'Abastecimento registrado',
          description:
            'Aguardando confirmação de um usuário autorizado para baixar o estoque.',
        });

        load();
      }

      setMaquinaSelecionada(null);
      setMaquinaId(null);
      setSucesso(true);
      setTimeout(() => setSucesso(false), 4000);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao registrar',
        description: err.message,
      });
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm(abast) {
    const maquina = maquinas.find((m) => m.id === abast.maquina_id);
    const produto = produtos.find((p) => p.id === abast.produto_id);
    if (!maquina || !produto) {
      toast({ variant: 'destructive', title: 'Dados indisponíveis', description: 'Máquina ou combustível não encontrados.' });
      return;
    }
    setSavingId(abast.id);
    try {
      await confirmarAbastecimento({
        abast,
        maquina,
        produto,
        confirmado_por: getDisplayName(user),
        setores,
        lotes,
        saldos,
        movimentacoes,
      });
      toast({ title: 'Baixa confirmada', description: `${produto.nome} baixado em ${formatQtd(abast.quantidade)} ${produto.unidade || 'un'}.` });
      load();
      invalidateEstoque();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao confirmar', description: err.message });
    } finally {
      setSavingId(null);
    }
  }

  async function handleCancel(abast) {
    setSavingId(abast.id);
    try {
      await cancelarAbastecimento(abast.id);
      toast({ title: 'Abastecimento cancelado' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro ao cancelar', description: err.message });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-4 p-3 lg:px-4 xl:px-5">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Fuel className="w-6 h-6 text-amber-500" />
            Abastecimento
          </h1>

          {isMobile && pendentesSync > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50/70 px-2 py-0.5 text-[10px] font-medium text-amber-700"
            >
              Sincronização pendente
              {pendentesSync > 1
                ? ' · ' + pendentesSync
                : ''}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {podeConfirmar
            ? 'Registre abastecimentos e confirme as baixas pendentes.'
            : 'Leia o QR Code da máquina e registre o combustível abastecido.'}
        </p>
      </header>

      {!setorCombustivel && !loading && (
        <Card className="p-4 border-amber-300 bg-amber-50 text-amber-800 text-sm">
          Nenhum setor de <strong>Combustíveis</strong> encontrado. Cadastre um setor com o nome contendo "Combustível" e vincule os produtos de combustível a ele.
        </Card>
      )}

      {sucesso && (
        <Card className="p-4 border-emerald-300 bg-emerald-50 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          Abastecimento registrado.
        </Card>
      )}

      {podeConfirmar && (
        <div className="flex gap-1 p-1 rounded-xl bg-muted">
          <button
            onClick={() => setAba('abastecer')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${aba === 'abastecer' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            Abastecer
          </button>
          <button
            onClick={() => setAba('pendentes')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${aba === 'pendentes' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            Aguardando confirmação
            {pendentes.length > 0 && (
              <Badge className="bg-amber-500 hover:bg-amber-500 text-white">{pendentes.length}</Badge>
            )}
          </button>
        </div>
      )}

      {(!podeConfirmar || aba === 'abastecer') && (
        !maquinaSelecionada ? (
          <div className="space-y-4">
            <Card className="p-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar máquina por código ou nome…"
                  value={buscaMaquina}
                  onChange={(e) => setBuscaMaquina(e.target.value)}
                />
              </div>
              <div className="space-y-2 max-h-[55vh] overflow-y-auto scrollbar-thin">
                {buscaMaquina.trim() === '' ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Digite para buscar uma máquina.</p>
                ) : maquinasFiltradas.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhuma máquina encontrada.</p>
                ) : (
                  maquinasFiltradas.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setMaquinaSelecionada(m); setMaquinaId(m.id); setBuscaMaquina(''); }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center font-semibold text-xs">
                        {(m.codigo || '?').slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{m.nome}</p>
                        <p className="text-xs font-mono text-muted-foreground">{m.codigo}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </Card>

            <div className="hidden sm:block">
              <h3 className="font-semibold mb-3 text-sm">Abastecimentos recentes</h3>
              {loading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : recentes.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Nenhum abastecimento registrado.</p>
              ) : (
                <div className="space-y-2">
                  {recentes.map((a) => (
                    <AbastecimentoRow key={a.id} abast={a} maquinas={maquinas} produtos={produtos} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <AbastecimentoForm
            maquina={maquinaSelecionada}
            combustiveis={combustiveis}
            produtoPredefinido={produtoPredefinido}
            saving={saving}
            fotoOpcional={podeAbastecerSemFoto}
            userId={user?.id}
            onSubmit={handleSubmit}
            onBack={() => { setMaquinaSelecionada(null); setMaquinaId(null); }}
          />
        )
      )}

      {podeConfirmar && aba === 'pendentes' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            Confirme a baixa após conferir a foto do painel do abastecedor.
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <AbastecimentoPendentes
              pendentes={pendentes}
              maquinas={maquinas}
              produtos={produtos}
              savingId={savingId}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          )}
        </div>
      )}

    </div>
  );
}