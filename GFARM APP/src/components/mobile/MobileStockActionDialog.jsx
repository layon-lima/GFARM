import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  Loader2,
  PackageMinus,
  Search,
  Warehouse,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { estoqueApi } from '@/api/estoqueClient';
import { invalidateEstoque } from '@/lib/useEntidades';
import { mobileStockActions } from '@/lib/mobileAccess';
import { sortGavetas } from '@/lib/gavetas';

const ACTIONS = {
  baixar: {
    label: 'Dar baixa',
    description: 'Retirar uma quantidade real do estoque.',
    icon: PackageMinus,
  },
  mudar_gaveta: {
    label: 'Mudar gaveta',
    description: 'Mover para outra gaveta do mesmo depósito.',
    icon: ArrowRightLeft,
  },
  mudar_deposito: {
    label: 'Mudar depósito',
    description: 'Mover para outro depósito e outra gaveta.',
    icon: Warehouse,
  },
};

function numero(valor) {
  return Number(valor || 0);
}

function formatQtd(valor) {
  return numero(valor).toLocaleString('pt-BR', {
    maximumFractionDigits: 3,
  });
}

function depositoLabel(deposito) {
  if (!deposito) return 'Depósito não identificado';
  return [deposito.numero, deposito.nome].filter(Boolean).join(' · ') || 'Depósito';
}

function gavetaLabel(gaveta) {
  if (!gaveta) return 'Sem gaveta';
  return [gaveta.codigo, gaveta.descricao].filter(Boolean).join(' · ') || 'Gaveta';
}

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function MobileGavetaSearch({
  value,
  onChange,
  options = [],
  disabled = false,
}) {
  const ordenadas = useMemo(
    () => sortGavetas(options),
    [options]
  );

  const selecionada = ordenadas.find(
    (item) => item.id === value
  );

  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (!aberto) {
      setBusca(
        selecionada
          ? gavetaLabel(selecionada)
          : ''
      );
    }
  }, [aberto, selecionada]);

  const filtradas = useMemo(() => {
    const termo = normalizarBusca(busca);

    if (
      !termo
      || (
        selecionada
        && termo === normalizarBusca(
          gavetaLabel(selecionada)
        )
      )
    ) {
      return ordenadas;
    }

    return ordenadas.filter((item) =>
      normalizarBusca(
        gavetaLabel(item)
      ).includes(termo)
    );
  }, [ordenadas, busca, selecionada]);

  function escolher(item) {
    onChange(item.id);
    setBusca(gavetaLabel(item));
    setAberto(false);
  }

  return (
    <div className="mobile-gaveta-search">
      <div className="mobile-gaveta-search__field">
        <Search className="mobile-gaveta-search__icon h-4 w-4" />

        <input
          type="text"
          value={busca}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Selecione o depósito primeiro'
              : 'Digite a gaveta...'
          }
          autoComplete="off"
          inputMode="search"
          onFocus={(event) => {
            setAberto(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setBusca(event.target.value);
            setAberto(true);

            if (value) {
              onChange('');
            }
          }}
          onBlur={() => {
            window.setTimeout(
              () => setAberto(false),
              120
            );
          }}
        />
      </div>

      {aberto && !disabled ? (
        <div className="mobile-gaveta-search__results">
          {filtradas.length === 0 ? (
            <div className="mobile-gaveta-search__empty">
              Nenhuma gaveta encontrada.
            </div>
          ) : (
            filtradas.map((gaveta) => {
              const ativa = gaveta.id === value;

              return (
                <button
                  key={gaveta.id}
                  type="button"
                  className={[
                    'mobile-gaveta-search__option',
                    ativa ? 'is-active' : '',
                  ].join(' ')}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => escolher(gaveta)}
                >
                  <span>{gavetaLabel(gaveta)}</span>
                  {ativa ? (
                    <Check className="h-4 w-4" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function MobileStockActionDialog({
  open,
  onOpenChange,
  produto,
  user,
  saldos = [],
  depositos = [],
  gavetas = [],
  onSaved,
}) {
  const { toast } = useToast();
  const [acao, setAcao] = useState(null);
  const [saldoId, setSaldoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [destinoDepositoId, setDestinoDepositoId] = useState('');
  const [destinoGavetaId, setDestinoGavetaId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const permissoes = useMemo(() => mobileStockActions(user), [user]);
  const depositosMap = useMemo(
    () => new Map(depositos.map((item) => [item.id, item])),
    [depositos]
  );
  const gavetasMap = useMemo(
    () => new Map(gavetas.map((item) => [item.id, item])),
    [gavetas]
  );

  const saldosProduto = useMemo(
    () =>
      saldos.filter(
        (saldo) =>
          saldo.produto_id === produto?.id && numero(saldo.quantidade) > 0
      ),
    [saldos, produto]
  );

  const saldosDisponiveis = useMemo(
    () =>
      acao === 'baixar'
        ? saldosProduto
        : saldosProduto.filter(
            (saldo) => saldo.deposito_id && saldo.gaveta_id
          ),
    [acao, saldosProduto]
  );

  const saldoSelecionado = saldosDisponiveis.find(
    (saldo) => saldo.id === saldoId
  );

  const depositosDestino = useMemo(
    () =>
      depositos.filter(
        (deposito) =>
          deposito.setor_id === produto?.setor_id &&
          deposito.id !== saldoSelecionado?.deposito_id
      ),
    [depositos, produto, saldoSelecionado]
  );

  const gavetasDestino = useMemo(() => {
    if (!saldoSelecionado) return [];

    const depositoId =
      acao === 'mudar_gaveta'
        ? saldoSelecionado.deposito_id
        : destinoDepositoId;

    return sortGavetas(
      gavetas.filter(
        (gaveta) =>
          gaveta.deposito_id === depositoId &&
          gaveta.id !== saldoSelecionado.gaveta_id
      )
    );
  }, [gavetas, acao, saldoSelecionado, destinoDepositoId]);

  useEffect(() => {
    if (open) return;
    setAcao(null);
    setSaldoId('');
    setQuantidade('');
    setDestinoDepositoId('');
    setDestinoGavetaId('');
    setMotivo('');
    setSaving(false);
  }, [open]);

  useEffect(() => {
    setDestinoDepositoId('');
    setDestinoGavetaId('');
  }, [acao, saldoId]);

  const selecionarAcao = (key) => {
    setAcao(key);
    setSaldoId('');
    setQuantidade('');
    setMotivo('');
  };

  const executar = async () => {
    const qtd = numero(String(quantidade).replace(',', '.'));

    if (!saldoSelecionado) {
      toast({ variant: 'destructive', title: 'Escolha a localização de origem' });
      return;
    }

    if (qtd <= 0 || qtd > numero(saldoSelecionado.quantidade)) {
      toast({
        variant: 'destructive',
        title: 'Quantidade inválida',
        description: `O máximo disponível nesta localização é ${formatQtd(saldoSelecionado.quantidade)} ${produto?.unidade || ''}.`,
      });
      return;
    }

    if (acao === 'baixar' && motivo.trim().length < 3) {
      toast({
        variant: 'destructive',
        title: 'Informe o motivo da baixa',
        description: 'Digite pelo menos três caracteres.',
      });
      return;
    }

    if (
      (acao === 'mudar_gaveta' || acao === 'mudar_deposito') &&
      !destinoGavetaId
    ) {
      toast({ variant: 'destructive', title: 'Escolha a nova gaveta' });
      return;
    }

    if (acao === 'mudar_deposito' && !destinoDepositoId) {
      toast({ variant: 'destructive', title: 'Escolha o novo depósito' });
      return;
    }

    const transferencia = acao !== 'baixar';
    const item = {
      produto_id: produto.id,
      quantidade: qtd,
      unidade: produto.unidade || 'un',
      deposito_origem_id: saldoSelecionado.deposito_id || undefined,
      gaveta_origem_id: saldoSelecionado.gaveta_id || undefined,
      lote_origem_id: saldoSelecionado.lote_id || undefined,
      observacao: motivo.trim() || ACTIONS[acao].label,
    };

    if (transferencia) {
      item.deposito_destino_id =
        acao === 'mudar_gaveta'
          ? saldoSelecionado.deposito_id
          : destinoDepositoId;
      item.gaveta_destino_id = destinoGavetaId;
    }

    setSaving(true);

    try {
      const resposta = await estoqueApi.movimentar({
        tipo_movimento: transferencia ? 'TRANSFERENCIA' : 'SAIDA_CONSUMO',
        origem_modulo: 'mobile',
        observacao: motivo.trim() || `${ACTIONS[acao].label} pelo celular`,
        itens: [item],
      });

      invalidateEstoque();
      await onSaved?.();

      toast({
        title: `${ACTIONS[acao].label} concluído`,
        description: resposta?.documento?.numero
          ? `Documento ${resposta.documento.numero} contabilizado.`
          : 'Movimentação contabilizada pelo motor de estoque.',
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível movimentar o estoque',
        description: error?.message || 'Confira os dados e tente novamente.',
      });
    } finally {
      setSaving(false);
    }
  };

  const acaoAtual = acao ? ACTIONS[acao] : null;

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="mobile-stock-action-dialog max-w-sm">
        <DialogHeader>
          <DialogTitle>{produto?.nome || 'Produto'}</DialogTitle>
          <DialogDescription>
            {acaoAtual ? acaoAtual.description : 'Escolha o movimento que deseja realizar.'}
          </DialogDescription>
        </DialogHeader>

        {!acao ? (
          <div className="mobile-stock-action-list">
            {permissoes.length === 0 ? (
              <div className="mobile-stock-action-empty">
                <strong>Nenhuma ação autorizada</strong>
                <span>
                  Um administrador precisa liberar as ações deste usuário na
                  tela de Usuários do computador.
                </span>
              </div>
            ) : permissoes.map((key) => {
              const config = ACTIONS[key];
              const Icon = config.icon;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selecionarAcao(key)}
                  className="mobile-stock-action-choice"
                >
                  <span className="mobile-stock-action-choice__icon">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <strong>{config.label}</strong>
                    <small>{config.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mobile-stock-action-form">
            <button
              type="button"
              className="mobile-stock-action-back"
              onClick={() => setAcao(null)}
              disabled={saving}
            >
              <ArrowLeft className="h-4 w-4" />
              Trocar ação
            </button>

            <label>
              <span>Saldo de origem</span>
              <select value={saldoId} onChange={(event) => setSaldoId(event.target.value)}>
                <option value="">Selecione a localização</option>
                {saldosDisponiveis.map((saldo) => (
                  <option key={saldo.id} value={saldo.id}>
                    {depositoLabel(depositosMap.get(saldo.deposito_id))} · {gavetaLabel(gavetasMap.get(saldo.gaveta_id))} · {formatQtd(saldo.quantidade)} {produto?.unidade || ''}
                  </option>
                ))}
              </select>
            </label>

            {saldoSelecionado ? (
              <div className="mobile-stock-source-summary">
                Disponível: <strong>{formatQtd(saldoSelecionado.quantidade)} {produto?.unidade || ''}</strong>
              </div>
            ) : null}

            <label>
              <span>Quantidade</span>
              <Input
                type="text"
                inputMode="decimal"
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value)}
                placeholder="0"
              />
            </label>

            {acao === 'mudar_deposito' ? (
              <label>
                <span>Novo depósito</span>
                <select
                  value={destinoDepositoId}
                  onChange={(event) => {
                    setDestinoDepositoId(event.target.value);
                    setDestinoGavetaId('');
                  }}
                >
                  <option value="">Selecione outro depósito</option>
                  {depositosDestino.map((deposito) => (
                    <option key={deposito.id} value={deposito.id}>
                      {depositoLabel(deposito)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {acao === 'mudar_gaveta' || acao === 'mudar_deposito' ? (
              <label>
                <span>Nova gaveta</span>
                <MobileGavetaSearch
                  value={destinoGavetaId}
                  onChange={setDestinoGavetaId}
                  options={gavetasDestino}
                  disabled={acao === 'mudar_deposito' && !destinoDepositoId}
                />
              </label>
            ) : null}

            <label>
              <span>{acao === 'baixar' ? 'Motivo da baixa' : 'Observação (opcional)'}</span>
              <Input
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                placeholder={acao === 'baixar' ? 'Ex.: consumo, perda ou avaria' : 'Informe um motivo, se necessário'}
              />
            </label>
          </div>
        )}

        {acao ? (
          <DialogFooter className="mobile-stock-action-footer">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={executar} disabled={saving || !saldoSelecionado}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar movimento'}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
