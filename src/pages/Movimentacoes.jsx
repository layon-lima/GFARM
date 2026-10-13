import { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  CheckCircle2,
  FileText,
  Package,
  PackagePlus,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  Warehouse,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SearchSelect from '@/components/SearchSelect';
import ProductSearchSelect from '@/components/ProductSearchSelect';
import FornecedorCombobox from '@/components/FornecedorCombobox';
import NfeImportButton from '@/components/NfeImportButton';
import NfeDropZone from '@/components/NfeDropZone';
import NfePreviewDialog from '@/components/NfePreviewDialog';
import EntradaManualSaldoDesktop from '@/components/movimentacoes/EntradaManualSaldoDesktop';

import {
  invalidateEstoque,
  useEntidades,
} from '@/lib/useEntidades';
import { useToast } from '@/components/ui/use-toast';
import {
  formatQtd,
  parseQtd,
} from '@/lib/format';
import {
  setorControlaValidade,
} from '@/lib/lotes';
import { sortGavetas } from '@/lib/gavetas';
import {
  estornarMovimentacao,
  registrarMovimentacao,
  registrarTransferencia,
} from '@/lib/movimentacoes';
import {
  depositosComSaldoDoProduto,
  gavetasComSaldoDoProduto,
  saldoTotalProduto,
} from '@/lib/saldos';
import { useNfeImport } from '@/hooks/useNfeImport';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';


const emptyForm = {
  produto_id: '',
  tipo: 'entrada',
  subtipo: 'ENTRADA_COMPRA',
  quantidade: 1,
  deposito_id: '',
  gaveta_id: '',
  deposito_origem_id: '',
  gaveta_origem_id: '',
  deposito_destino_id: '',
  gaveta_destino_id: '',
  observacao: '',
  codigo_lote: '',
  data_validade: '',
  numero_nf: '',
  fornecedor: '',
  chave_acesso: '',
  estorno_de: '',
};


const TIPO_CONFIG = {
  entrada: {
    label: 'Entrada',
    description: 'Entrada de compra, nota fiscal ou ajuste positivo.',
    Icon: ArrowDownToLine,
  },
  saida: {
    label: 'Saída',
    description: 'Baixa de estoque com consumo do saldo disponível.',
    Icon: ArrowUpFromLine,
  },
  transferencia: {
    label: 'Transferência',
    description: 'Movimentação interna entre depósitos e gavetas.',
    Icon: ArrowRightLeft,
  },
  estorno: {
    label: 'Estorno',
    description: 'Reversão controlada de um movimento já contabilizado.',
    Icon: Undo2,
  },
};


const MOVIMENTO_SUBTIPOS = {
  entrada: [
    {
      value: 'ENTRADA_COMPRA',
      label: 'Compra / Nota Fiscal',
      description: 'Entrada recebida de fornecedor ou por documento fiscal.',
    },
    {
      value: 'DEVOLUCAO_ENTRADA',
      label: 'Devolução de Entrada',
      description: 'Retorno de material ao estoque.',
    },
    {
      value: 'AJUSTE_POSITIVO',
      label: 'Ajuste Positivo',
      description: 'Correção controlada que aumenta o saldo.',
    },
  ],

  saida: [
    {
      value: 'SAIDA_CONSUMO',
      label: 'Consumo',
      description: 'Saída normal para consumo ou utilização.',
    },
    {
      value: 'DEVOLUCAO_SAIDA',
      label: 'Devolução de Saída',
      description: 'Saída por devolução a fornecedor ou origem.',
    },
    {
      value: 'AJUSTE_NEGATIVO',
      label: 'Ajuste Negativo',
      description: 'Correção controlada que reduz o saldo.',
    },
  ],
};


function subtipoPadrao(tipo) {
  if (tipo === 'entrada') {
    return 'ENTRADA_COMPRA';
  }

  if (tipo === 'saida') {
    return 'SAIDA_CONSUMO';
  }

  return '';
}


function InfoCell({
  label,
  value,
  helper,
  Icon,
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon && (
          <Icon className="h-4 w-4" />
        )}
        <span>{label}</span>
      </div>

      <div className="mt-1.5 truncate text-base font-semibold">
        {value || '—'}
      </div>

      {helper && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {helper}
        </div>
      )}
    </div>
  );
}


export default function Movimentacoes() {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [modoEntradaManual, setModoEntradaManual] = useState(false);

  const { toast } = useToast();
  const { user } = useAuth();
  const podeEntradaManualSaldo = hasPermission(
    user,
    'admin.estoque.entrada_manual'
  );

  const {
    data,
    reload: load,
  } = useEntidades({
    Produto: {},
    Setor: {},
    Maquina: {},
    Gaveta: {},
    Deposito: {},
    Lote: {},
    SaldoEstoque: {},
    Movimentacao: {
      sort: '-data',
      limit: 500,
    },
    Pessoa: {
      sort: '-created_date',
      limit: 500,
    },
  });

  const {
    Produto: produtos,
    Setor: setores,
    Maquina: maquinas,
    Gaveta: gavetas,
    Deposito: depositos,
    Lote: lotes,
    SaldoEstoque: saldos,
    Movimentacao: movimentacoes,
    Pessoa: pessoas,
  } = data;

  const nfe = useNfeImport({
    produtos,
    setores,
    maquinas,
    gavetas,
    onImported: load,
  });


  const fornecedores = useMemo(() => {
    const nomes = new Set();

    pessoas
      .filter((p) => p.is_fornecedor)
      .forEach((p) => {
        if (p.nome) {
          nomes.add(p.nome);
        }
      });

    movimentacoes.forEach((m) => {
      if (m.fornecedor) {
        nomes.add(m.fornecedor);
      }
    });

    return Array.from(nomes).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [pessoas, movimentacoes]);


  const estornaveis = useMemo(
    () => (
      form.tipo === 'estorno'
        ? movimentacoes.filter(
            (m) =>
              m.tipo !== 'estorno'
              && m.estornada !== true
          )
        : []
    ),
    [movimentacoes, form.tipo]
  );


  const movEstorno =
    form.tipo === 'estorno'
      ? movimentacoes.find(
          (m) => m.id === form.estorno_de
        )
      : null;


  const depositoEstorno =
    movEstorno
      ? depositos.find(
          (d) =>
            d.id === movEstorno.deposito_id
        )
      : null;


  const produtoSelecionado =
    produtos.find(
      (p) => p.id === form.produto_id
    );


  const controlaValidade =
    produtoSelecionado
      ? setorControlaValidade(
          produtoSelecionado.setor_id,
          setores
        )
      : false;


  const lotesDoProduto =
    produtoSelecionado
      ? lotes.filter(
          (l) =>
            l.produto_id
              === produtoSelecionado.id
        )
      : [];


  const saldoTotal = useMemo(
    () =>
      saldoTotalProduto(
        form.produto_id,
        saldos
      ),
    [form.produto_id, saldos]
  );


  const temSaldo =
    saldoTotal > 0;


  const depositosComSaldo = useMemo(
    () =>
      depositosComSaldoDoProduto(
        form.produto_id,
        saldos,
        depositos
      ),
    [
      form.produto_id,
      saldos,
      depositos,
    ]
  );


  const gavetasComSaldoDep = useMemo(
    () =>
      gavetasComSaldoDoProduto(
        form.produto_id,
        form.deposito_id,
        saldos,
        gavetas
      ),
    [
      form.produto_id,
      form.deposito_id,
      saldos,
      gavetas,
    ]
  );


  const gavetasComSaldoOrigem = useMemo(
    () =>
      gavetasComSaldoDoProduto(
        form.produto_id,
        form.deposito_origem_id,
        saldos,
        gavetas
      ),
    [
      form.produto_id,
      form.deposito_origem_id,
      saldos,
      gavetas,
    ]
  );


  const saldoOrigem = useMemo(() => {
    if (
      !produtoSelecionado
      || !form.deposito_origem_id
    ) {
      return 0;
    }

    return (saldos || [])
      .filter(
        (s) =>
          s.produto_id
            === produtoSelecionado.id
          && s.deposito_id
            === form.deposito_origem_id
          && (
            !form.gaveta_origem_id
            || (s.gaveta_id || '')
              === form.gaveta_origem_id
          )
      )
      .reduce(
        (sum, s) =>
          sum + Number(s.quantidade || 0),
        0
      );
  }, [
    produtoSelecionado,
    form.deposito_origem_id,
    form.gaveta_origem_id,
    saldos,
  ]);


  const saldoLocal = useMemo(() => {
    if (
      !produtoSelecionado
      || !form.deposito_id
    ) {
      return saldoTotal;
    }

    return (saldos || [])
      .filter(
        (s) =>
          s.produto_id
            === produtoSelecionado.id
          && s.deposito_id
            === form.deposito_id
          && (
            !form.gaveta_id
            || (s.gaveta_id || '')
              === form.gaveta_id
          )
      )
      .reduce(
        (sum, s) =>
          sum + Number(s.quantidade || 0),
        0
      );
  }, [
    produtoSelecionado,
    form.deposito_id,
    form.gaveta_id,
    saldos,
    saldoTotal,
  ]);


  const podeEnviar =
    form.tipo === 'estorno'
      ? !!form.estorno_de
      : form.tipo === 'transferencia'
        ? (
          !!form.produto_id
          && parseQtd(form.quantidade) > 0
          && !!form.deposito_origem_id
          && !!form.deposito_destino_id
        )
        : (
          !!form.produto_id
          && parseQtd(form.quantidade) > 0
          && !!form.deposito_id
        );


  const qtdFormulario =
    parseQtd(form.quantidade) || 0;


  const depositoSelecionado =
    depositos.find(
      (d) => d.id === form.deposito_id
    );


  const depositoOrigem =
    depositos.find(
      (d) =>
        d.id === form.deposito_origem_id
    );


  const depositoDestino =
    depositos.find(
      (d) =>
        d.id === form.deposito_destino_id
    );


  const gavetaSelecionada =
    gavetas.find(
      (g) => g.id === form.gaveta_id
    );


  const gavetaOrigem =
    gavetas.find(
      (g) =>
        g.id === form.gaveta_origem_id
    );


  const gavetaDestino =
    gavetas.find(
      (g) =>
        g.id === form.gaveta_destino_id
    );


  function depositoLabel(dep) {
    if (!dep) return '—';

    return [
      dep.numero,
      dep.nome,
    ]
      .filter(Boolean)
      .join(' · ')
      || '—';
  }


  function trocarTipo(tipo) {
    setModoEntradaManual(false);

    setForm((atual) => ({
      ...atual,
      tipo,
      subtipo:
        subtipoPadrao(tipo),
      deposito_id: '',
      gaveta_id: '',
      deposito_origem_id: '',
      gaveta_origem_id: '',
      deposito_destino_id: '',
      gaveta_destino_id: '',
      numero_nf: '',
      fornecedor: '',
      chave_acesso: '',
      estorno_de: '',
    }));
  }


  function limparFormulario() {
    setForm({
      ...emptyForm,
      tipo: form.tipo,
      subtipo:
        subtipoPadrao(
          form.tipo
        ),
    });
  }


  async function handleSubmit(e) {
    e.preventDefault();

    if (form.tipo === 'estorno') {
      const alvo =
        movimentacoes.find(
          (m) =>
            m.id === form.estorno_de
        );

      if (!alvo) {
        toast({
          variant: 'destructive',
          title: 'Movimento obrigatório',
          description:
            'Selecione o movimento que deseja estornar.',
        });
        return;
      }

      setSaving(true);

      try {
        await estornarMovimentacao(
          alvo,
          {
            produtos,
            lotes,
            saldos,
            movimentacoes,
          }
        );

        toast({
          title:
            'Movimento estornado com sucesso',
        });

        setForm(emptyForm);
        load();
        invalidateEstoque();

      } catch (err) {
        const msg =
          err?.message || '';

        const map = {
          ESTORNO_NAO_EXISTE: [
            'Movimento inválido',
            'A movimentação selecionada não existe.',
          ],
          ESTORNO_TIPO_ESTORNO: [
            'Não permitido',
            'Não é possível estornar uma movimentação de estorno.',
          ],
          ESTORNO_JA_ESTORNADA: [
            'Já estornada',
            'Esta movimentação já foi estornada.',
          ],
        };

        const [title, desc] =
          map[msg]
          || [
            'Erro ao estornar',
            msg,
          ];

        toast({
          variant: 'destructive',
          title,
          description: desc,
        });

      } finally {
        setSaving(false);
      }

      return;
    }


    const produto =
      produtos.find(
        (p) =>
          p.id === form.produto_id
      );


    if (!produto) {
      toast({
        variant: 'destructive',
        title: 'Produto obrigatório',
        description:
          'Selecione o produto da movimentação.',
      });
      return;
    }


    if (!form.tipo) {
      toast({
        variant: 'destructive',
        title: 'Tipo obrigatório',
        description:
          'Selecione o tipo de movimentação.',
      });
      return;
    }


    if (
      form.tipo !== 'transferencia'
      && !form.deposito_id
    ) {
      toast({
        variant: 'destructive',
        title: 'Depósito obrigatório',
        description:
          'Selecione o depósito da movimentação.',
      });
      return;
    }


    if (!(parseQtd(form.quantidade) > 0)) {
      toast({
        variant: 'destructive',
        title: 'Quantidade obrigatória',
        description:
          'Informe uma quantidade maior que zero.',
      });
      return;
    }

    setSaving(true);

    try {
      if (
        form.tipo === 'transferencia'
      ) {
        await registrarTransferencia({
          form,
          produto,
          lotes,
          saldos,
          movimentacoes,
          controlaValidade,
          depositos,
        });

      } else {
        await registrarMovimentacao({
          form,
          produto,
          lotes,
          saldos,
          movimentacoes,
          controlaValidade,
        });
      }


      toast({
        title:
          'Movimentação registrada com sucesso',
      });

      setForm({
        ...emptyForm,
        tipo: form.tipo,
      });

      load();
      invalidateEstoque();

    } catch (err) {
      const msg =
        err?.message || '';

      if (
        msg.startsWith(
          'NF_DUPLICADA'
        )
      ) {
        toast({
          variant: 'destructive',
          title:
            'Nota fiscal duplicada',
          description:
            'Esta NF-e já está ativa no estoque.',
        });

      } else if (
        msg.startsWith(
          'VALIDADE_OBRIGATORIA'
        )
      ) {
        toast({
          variant: 'destructive',
          title:
            'Validade obrigatória',
          description:
            'Este setor controla validade. Informe a data de validade.',
        });

      } else if (
        msg.startsWith(
          'DEPOSITO_OBRIGATORIO'
        )
      ) {
        toast({
          variant: 'destructive',
          title:
            'Depósito obrigatório',
          description:
            'Selecione o depósito onde o estoque será movimentado.',
        });

      } else if (
        msg.startsWith(
          'ORIGEM_DESTINO_IGUAIS'
        )
      ) {
        toast({
          variant: 'destructive',
          title:
            'Origem e destino iguais',
          description:
            'Selecione depósitos ou gavetas diferentes para a transferência.',
        });

      } else if (
        msg.startsWith(
          'SALDO_INSUFICIENTE'
        )
      ) {
        const disp =
          Number(
            msg.split(':')[1]
            || 0
          );

        toast({
          variant: 'destructive',
          title:
            'Saldo insuficiente',
          description:
            `Disponível: ${formatQtd(disp)} ${produto.unidade || 'un'}.`,
        });

      } else if (
        msg === 'Quantidade inválida.'
      ) {
        toast({
          variant: 'destructive',
          title:
            'Quantidade inválida',
          description:
            'Informe uma quantidade maior que zero.',
        });

      } else {
        toast({
          variant: 'destructive',
          title:
            'Erro ao registrar',
          description:
            msg,
        });
      }

    } finally {
      setSaving(false);
    }
  }


  const tipoAtual =
    TIPO_CONFIG[form.tipo];


  const subtiposDisponiveis = (
    MOVIMENTO_SUBTIPOS[
      form.tipo
    ] || []
  ).filter(
    (item) =>
      !item.adminOnly
      || podeEntradaManualSaldo
  );


  const subtipoAtual =
    subtiposDisponiveis.find(
      (item) =>
        item.value
        === form.subtipo
    );


  const camposPendentes = [];

  if (form.tipo === 'estorno') {
    if (!form.estorno_de) {
      camposPendentes.push(
        'Selecione o movimento a estornar'
      );
    }

  } else {
    if (
      (
        form.tipo === 'entrada'
        || form.tipo === 'saida'
      )
      && !form.subtipo
    ) {
      camposPendentes.push(
        'Selecione a finalidade'
      );
    }

    if (!form.produto_id) {
      camposPendentes.push(
        'Selecione o produto'
      );
    }

    if (!(qtdFormulario > 0)) {
      camposPendentes.push(
        'Informe a quantidade'
      );
    }

    if (
      form.tipo === 'transferencia'
    ) {
      if (!form.deposito_origem_id) {
        camposPendentes.push(
          'Selecione o depósito de origem'
        );
      }

      if (!form.deposito_destino_id) {
        camposPendentes.push(
          'Selecione o depósito de destino'
        );
      }

    } else if (
      !form.deposito_id
    ) {
      camposPendentes.push(
        'Selecione o depósito'
      );
    }

    if (
      controlaValidade
      && form.tipo === 'entrada'
      && !form.data_validade
    ) {
      camposPendentes.push(
        'Informe a validade'
      );
    }

  }


  return (
    <NfeDropZone
      onDropFile={nfe.processFile}
      disabled={nfe.importing || modoEntradaManual}
    >
      <div className="w-full min-w-0 space-y-3 p-3 lg:px-4 xl:px-5">
        <Card className="border-border/70 p-3 shadow-sm">
          <header className="mb-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Movimentos
            </p>

            <h1 className="mt-0.5 text-xl font-semibold sm:text-2xl">
              Movimentos
            </h1>

            <p className="mt-0.5 text-sm text-muted-foreground">
              Registre entradas, saídas, transferências e estornos de produtos no seu estoque.
            </p>
          </header>

          <div className="flex flex-wrap gap-2">
            {Object.entries(
              TIPO_CONFIG
            ).map(
              ([
                value,
                config,
              ]) => {
                const Icon =
                  config.Icon;

                const ativo =
                  !modoEntradaManual
                  && form.tipo === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      trocarTipo(value)
                    }
                    className={[
                      'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:px-4',
                      ativo
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background text-foreground hover:border-primary/30 hover:bg-primary/[0.04]',
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4" />
                    <span>
                      {config.label}
                    </span>
                  </button>
                );
              }
            )}

            {podeEntradaManualSaldo ? (
              <button
                type="button"
                onClick={() => setModoEntradaManual(true)}
                className={[
                  'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:px-4',
                  modoEntradaManual
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:border-primary/30 hover:bg-primary/[0.04]',
                ].join(' ')}
              >
                <PackagePlus className="h-4 w-4" />
                <span>Entrada Manual</span>
              </button>
            ) : null}
          </div>
        </Card>


        {modoEntradaManual ? (
          <EntradaManualSaldoDesktop
            produtos={produtos}
            setores={setores}
            depositos={depositos}
            gavetas={gavetas}
            onSuccess={() => {
              load();
              invalidateEstoque();
            }}
          />
        ) : (
        <Card className="overflow-hidden border-border/70">
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 border-b p-3 lg:border-b-0 lg:border-r">
              <form
                onSubmit={handleSubmit}
                className="space-y-2.5"
              >
                {(form.tipo === 'entrada' || form.tipo === 'saida') && (
                  <div className={`grid min-w-0 items-stretch gap-2.5 ${
                    form.tipo === 'entrada' && form.subtipo === 'ENTRADA_COMPRA'
                      ? 'lg:grid-cols-[minmax(260px,35%)_minmax(0,1fr)]'
                      : ''
                  }`}>
                {(
                  form.tipo === 'entrada'
                  || form.tipo === 'saida'
                ) && (
                  <section className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
                    <div className="mb-2 flex items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                        1
                      </div>

                      <div>
                        <h2 className="text-sm font-semibold">
                          Tipo e finalidade
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Defina a finalidade desta movimentação
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>
                        Finalidade *
                      </Label>

                      <SearchSelect
                        value={form.subtipo}
                        onChange={(v) =>
                          setForm({
                            ...form,
                            subtipo:
                              v === 'all'
                                ? ''
                                : v,
                            numero_nf:
                              v === 'ENTRADA_COMPRA'
                                ? form.numero_nf
                                : '',
                            fornecedor:
                              v === 'ENTRADA_COMPRA'
                                ? form.fornecedor
                                : '',
                            chave_acesso:
                              v === 'ENTRADA_COMPRA'
                                ? form.chave_acesso
                                : '',
                          })
                        }
                        placeholder="Selecionar finalidade..."
                        options={subtiposDisponiveis.map(
                          (item) => ({
                            value: item.value,
                            label: item.label,
                          })
                        )}
                      />

                      <p className="text-xs text-muted-foreground">
                        {subtipoAtual?.description || 'Selecione uma opção na lista.'}
                      </p>
                    </div>
                  </section>
                )}


                    {(
                      form.tipo === 'entrada'
                      && form.subtipo === 'ENTRADA_COMPRA'
                    ) && (
                      <section className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
                        <div className="mb-2 flex items-start gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                            4
                          </div>

                          <div>
                            <h2 className="text-sm font-semibold">
                              Documento fiscal
                            </h2>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Preencha os dados da nota fiscal ou documento de origem
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="mv-nf">
                              Número da NF
                            </Label>

                            <Input
                              id="mv-nf"
                              value={form.numero_nf}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  numero_nf:
                                    e.target.value,
                                })
                              }
                              placeholder="Ex.: 000123456"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="mv-forn">
                              Fornecedor
                            </Label>

                            <FornecedorCombobox
                              id="mv-forn"
                              value={form.fornecedor}
                              onChange={(v) =>
                                setForm({
                                  ...form,
                                  fornecedor: v,
                                })
                              }
                              suggestions={fornecedores}
                              placeholder="Nome / CNPJ"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="mv-chave">
                              Chave de acesso
                            </Label>

                            <Input
                              id="mv-chave"
                              value={form.chave_acesso}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  chave_acesso:
                                    e.target.value,
                                })
                              }
                              placeholder="44 dígitos"
                              className="font-mono text-xs"
                            />
                          </div>
                        </div>
                      </section>
                    )}

                  </div>
                )}

                {form.tipo === 'estorno' ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>
                        Movimento a estornar *
                      </Label>

                      <SearchSelect
                        value={form.estorno_de}
                        onChange={(v) =>
                          setForm({
                            ...form,
                            estorno_de:
                              v === 'all'
                                ? ''
                                : v,
                          })
                        }
                        placeholder="Buscar por número, produto ou NF..."
                        options={estornaveis.map(
                          (m) => ({
                            value: m.id,
                            label:
                              `${m.numero || 's/n'} · ${
                                m.tipo === 'entrada'
                                  ? 'Entrada'
                                  : 'Saída'
                              } · ${m.nome_produto || '—'} · ${formatQtd(m.quantidade || 0)} · ${
                                m.data
                                  ? new Date(m.data).toLocaleDateString('pt-BR')
                                  : ''
                              }`,
                          })
                        )}
                      />
                    </div>

                    {movEstorno ? (
                      <div className="grid gap-3 rounded-xl border bg-muted/15 p-4 sm:grid-cols-2 lg:grid-cols-3">
                        <InfoCell
                          label="Documento"
                          value={movEstorno.numero || '—'}
                          Icon={FileText}
                        />

                        <InfoCell
                          label="Produto"
                          value={movEstorno.nome_produto || '—'}
                          helper={movEstorno.codigo || ''}
                          Icon={Package}
                        />

                        <InfoCell
                          label="Quantidade"
                          value={formatQtd(
                            movEstorno.quantidade || 0
                          )}
                          helper={
                            depositoLabel(
                              depositoEstorno
                            )
                          }
                          Icon={Warehouse}
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed bg-muted/10 p-4 text-sm text-muted-foreground">
                        Selecione o movimento acima. O estorno será feito pelo motor oficial de estoque e ficará vinculado ao documento original.
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid min-w-0 gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(215px,1fr)]">
                    <section className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
                      <div className="mb-2 flex items-start gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                          {form.tipo === 'entrada' || form.tipo === 'saida' ? '2' : '1'}
                        </div>

                        <div>
                          <h2 className="text-sm font-semibold">
                            Produto
                          </h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Selecione o produto
                          </p>
                        </div>
                      </div>


                        <div className="space-y-1.5">
                          <Label>
                            Produto *
                          </Label>

                          <ProductSearchSelect
                            produtos={produtos}
                            maquinas={maquinas}
                            gavetas={gavetas}
                            value={form.produto_id}
                            onChange={(v) =>
                              setForm({
                                ...form,
                                produto_id: v,
                                deposito_id: '',
                                gaveta_id: '',
                                deposito_origem_id: '',
                                gaveta_origem_id: '',
                                deposito_destino_id: '',
                                gaveta_destino_id: '',
                                codigo_lote: '',
                                data_validade: '',
                              })
                            }
                            placeholder="Buscar produto por nome, código, referência..."
                          />
                        </div>


                    </section>
                    <section className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
                      <div className="mb-2 flex items-start gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                          {form.tipo === 'entrada' || form.tipo === 'saida' ? '3' : '2'}
                        </div>
                        <div>
                          <h2 className="text-sm font-semibold">Quantidade</h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">Informe a quantidade</p>
                        </div>
                      </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="mv-qtd">
                            Quantidade *
                          </Label>

                          <div className="relative">
                            <Input
                              id="mv-qtd"
                              type="text"
                              inputMode="decimal"
                              placeholder="0,00"
                              value={form.quantidade}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  quantidade:
                                    e.target.value,
                                })
                              }
                              className={
                                produtoSelecionado
                                  ? 'pr-16'
                                  : ''
                              }
                              required
                            />

                            {produtoSelecionado && (
                              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">
                                {produtoSelecionado.unidade || 'un'}
                              </span>
                            )}
                          </div>
                        </div>

                    </section>
                    </div>


                    {form.tipo === 'transferencia' ? (
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)]">
                        <div className="space-y-3 rounded-xl border bg-muted/10 p-4">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold">
                              Origem
                            </div>

                            {form.deposito_origem_id && (
                              <span className="text-xs text-muted-foreground">
                                Saldo: <strong className="text-foreground">{formatQtd(saldoOrigem)}</strong> {produtoSelecionado?.unidade || ''}
                              </span>
                            )}
                          </div>

                          <div className="space-y-1.5">
                            <Label>
                              Depósito de origem *
                            </Label>

                            <SearchSelect
                              value={form.deposito_origem_id}
                              onChange={(v) =>
                                setForm({
                                  ...form,
                                  deposito_origem_id:
                                    v === 'all'
                                      ? ''
                                      : v,
                                  gaveta_origem_id: '',
                                })
                              }
                              allLabel="— Sem saldo —"
                              placeholder="Selecionar depósito..."
                              disabled={
                                !produtoSelecionado
                              }
                              options={depositosComSaldo.map(
                                (d) => ({
                                  value: d.id,
                                  label:
                                    depositoLabel(d),
                                })
                              )}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label>
                              Gaveta de origem
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                (opcional)
                              </span>
                            </Label>

                            <SearchSelect
                              value={form.gaveta_origem_id}
                              onChange={(v) =>
                                setForm({
                                  ...form,
                                  gaveta_origem_id:
                                    v === 'all'
                                      ? ''
                                      : v,
                                })
                              }
                              allLabel="— Todas —"
                              placeholder="Selecionar gaveta..."
                              disabled={
                                !form.deposito_origem_id
                              }
                              options={gavetasComSaldoOrigem.map(
                                (g) => ({
                                  value: g.id,
                                  label: g.codigo,
                                })
                              )}
                            />
                          </div>
                        </div>


                        <div className="hidden items-center justify-center xl:flex">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-card text-primary">
                            <ArrowRightLeft className="h-4 w-4" />
                          </div>
                        </div>


                        <div className="space-y-3 rounded-xl border bg-muted/10 p-4">
                          <div className="text-sm font-semibold">
                            Destino
                          </div>

                          <div className="space-y-1.5">
                            <Label>
                              Depósito de destino *
                            </Label>

                            <SearchSelect
                              value={form.deposito_destino_id}
                              onChange={(v) =>
                                setForm({
                                  ...form,
                                  deposito_destino_id:
                                    v === 'all'
                                      ? ''
                                      : v,
                                  gaveta_destino_id: '',
                                })
                              }
                              allLabel="— Selecione —"
                              placeholder="Selecionar depósito..."
                              options={depositos.map(
                                (d) => ({
                                  value: d.id,
                                  label:
                                    depositoLabel(d),
                                })
                              )}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label>
                              Gaveta de destino
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                (opcional)
                              </span>
                            </Label>

                            <SearchSelect
                              value={form.gaveta_destino_id}
                              onChange={(v) =>
                                setForm({
                                  ...form,
                                  gaveta_destino_id:
                                    v === 'all'
                                      ? ''
                                      : v,
                                })
                              }
                              allLabel="— Nenhuma —"
                              placeholder="Selecionar gaveta..."
                              disabled={
                                !form.deposito_destino_id
                              }
                              options={sortGavetas(
                                gavetas.filter(
                                  (g) =>
                                    g.deposito_id
                                      === form.deposito_destino_id
                                )
                              ).map(
                                (g) => ({
                                  value: g.id,
                                  label: g.codigo,
                                })
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <section className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
                        <div className="mb-2 flex items-start gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                            {form.tipo === 'entrada' && form.subtipo === 'ENTRADA_COMPRA' ? '5' : form.tipo === 'entrada' || form.tipo === 'saida' ? '4' : '3'}
                          </div>

                          <div>
                            <h2 className="text-sm font-semibold">
                              Localização
                            </h2>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Informe onde o produto será movimentado
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-2.5 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>
                              Depósito *
                            </Label>

                            <SearchSelect
                              value={form.deposito_id}
                              onChange={(v) =>
                                setForm({
                                  ...form,
                                  deposito_id:
                                    v === 'all'
                                      ? ''
                                      : v,
                                  gaveta_id: '',
                                })
                              }
                              allLabel={
                                form.tipo === 'saida'
                                  ? '— Sem saldo —'
                                  : '— Nenhum —'
                              }
                              placeholder="Selecionar depósito..."
                              disabled={
                                form.tipo === 'saida'
                                && !temSaldo
                              }
                              options={(
                                form.tipo === 'saida'
                                  ? depositosComSaldo
                                  : depositos
                              ).map(
                                (d) => ({
                                  value: d.id,
                                  label:
                                    depositoLabel(d),
                                })
                              )}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label>
                              Gaveta
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                (opcional)
                              </span>
                            </Label>

                            <SearchSelect
                              value={form.gaveta_id}
                              onChange={(v) =>
                                setForm({
                                  ...form,
                                  gaveta_id:
                                    v === 'all'
                                      ? ''
                                      : v,
                                })
                              }
                              allLabel="— Nenhuma —"
                              placeholder="Selecionar gaveta..."
                              disabled={
                                !form.deposito_id
                              }
                              options={(
                                form.tipo === 'saida'
                                  ? gavetasComSaldoDep
                                  : sortGavetas(
                                      gavetas.filter(
                                        (g) =>
                                          !form.deposito_id
                                          || g.deposito_id
                                            === form.deposito_id
                                      )
                                    )
                              ).map(
                                (g) => ({
                                  value: g.id,
                                  label: g.codigo,
                                })
                              )}
                            />
                          </div>
                        </div>
                      </section>
                    )}


                    {controlaValidade
                      && form.tipo === 'entrada'
                      && (
                        <div className="grid gap-4 rounded-xl border bg-muted/10 p-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>
                              Lote interno
                            </Label>

                            <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                              Gerado automaticamente na entrada
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="mv-val">
                              Validade *
                            </Label>

                            <Input
                              id="mv-val"
                              type="date"
                              value={form.data_validade}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  data_validade:
                                    e.target.value,
                                })
                              }
                              required
                            />
                          </div>
                        </div>
                      )}


                    {controlaValidade
                      && form.tipo === 'saida'
                      && (
                        <div className="rounded-xl border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
                          Saída por FEFO: o motor consome primeiro os lotes com vencimento mais próximo. {lotesDoProduto.length} lote(s) disponível(is).
                        </div>
                      )}


                  </>
                )}


                <section className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
                  <div className="mb-2">
                    <h2 className="text-sm font-semibold">Observações</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Informações adicionais complementares sobre esta movimentação
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="mv-obs">
                      Observação
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (opcional)
                      </span>
                    </Label>

                    <Textarea
                      id="mv-obs"
                      rows={1}
                      className="min-h-10 resize-y"
                      value={form.observacao}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          observacao:
                            e.target.value,
                        })
                      }
                      placeholder="Adicione uma observação sobre esta movimentação..."
                    />
                  </div>
                </section>


                <div className="flex flex-col gap-2 border-t pt-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    {(
                      form.tipo === 'entrada'
                      && form.subtipo === 'ENTRADA_COMPRA'
                    ) && (
                      <NfeImportButton
                        importing={nfe.importing}
                        onFile={nfe.processFile}
                      />
                    )}
                  </div>

                  <div className="flex gap-2 sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={limparFormulario}
                      disabled={saving}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Limpar
                    </Button>

                    <Button
                      type="submit"
                      disabled={
                        saving
                        || !podeEnviar
                      }
                      className="min-w-[190px]"
                    >
                      {saving ? (
                        <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                      ) : form.tipo === 'estorno' ? (
                        <Undo2 className="mr-2 h-4 w-4" />
                      ) : form.tipo === 'transferencia' ? (
                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}

                      {saving
                        ? 'Processando...'
                        : form.tipo === 'estorno'
                          ? 'Estornar movimento'
                          : form.tipo === 'transferencia'
                            ? 'Registrar transferência'
                            : 'Registrar movimentação'
                      }
                    </Button>
                  </div>
                </div>
              </form>
            </div>


            <aside className="min-w-0 bg-muted/5 p-3">
              <div className="lg:sticky lg:top-24">
                <h2 className="text-sm font-semibold">
                  Resumo da movimentação
                </h2>

                <div className="mt-2 space-y-2">
                  {form.tipo === 'estorno' ? (
                    <div className="rounded-xl border bg-card p-3">
                      {movEstorno ? (
                        <>
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                              <Undo2 className="h-5 w-5" />
                            </div>

                            <div className="min-w-0">
                              <div className="truncate font-semibold">
                                {movEstorno.numero || 'Movimento'}
                              </div>

                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {movEstorno.nome_produto || '—'}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-2">
                            <InfoCell
                              label="Quantidade"
                              value={formatQtd(
                                movEstorno.quantidade || 0
                              )}
                              Icon={Package}
                            />

                            <InfoCell
                              label="Depósito"
                              value={depositoLabel(
                                depositoEstorno
                              )}
                              Icon={Warehouse}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="py-5 text-center text-sm text-muted-foreground">
                          Selecione um movimento para visualizar o impacto do estorno.
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border bg-card p-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Package className="h-5 w-5" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">
                              {produtoSelecionado?.nome || 'Nenhum produto selecionado'}
                            </div>

                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {produtoSelecionado
                                ? `Cód.: ${produtoSelecionado.codigo || '—'} · Ref.: ${produtoSelecionado.codigo_referencia || '—'}`
                                : 'Busque um produto para iniciar'
                              }
                            </div>
                          </div>
                        </div>
                      </div>


                      {subtipoAtual && (
                        <div className="rounded-xl border bg-card px-3 py-2.5">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Finalidade
                          </div>

                          <div className="mt-1 text-sm font-semibold">
                            {subtipoAtual.label}
                          </div>
                        </div>
                      )}


                      <div className="grid grid-cols-2 gap-2">
                        <InfoCell
                          label={
                            form.tipo === 'transferencia'
                              ? 'Saldo na origem'
                              : form.tipo === 'saida'
                                ? 'Saldo no local'
                                : 'Saldo atual'
                          }
                          value={
                            produtoSelecionado
                              ? formatQtd(
                                  form.tipo === 'transferencia'
                                    ? saldoOrigem
                                    : form.tipo === 'saida'
                                      ? saldoLocal
                                      : saldoTotal
                                )
                              : '—'
                          }
                          helper={
                            produtoSelecionado?.unidade || ''
                          }
                          Icon={Warehouse}
                        />

                        <InfoCell
                          label="Unidade"
                          value={
                            produtoSelecionado?.unidade
                            || '—'
                          }
                          helper={
                            produtoSelecionado?.unidade_alt
                              ? `Alt.: ${produtoSelecionado.unidade_alt}`
                              : ''
                          }
                          Icon={Package}
                        />
                      </div>


                      <div className="rounded-xl border bg-card p-3">
                        <div className="text-xs font-medium text-muted-foreground">
                          Localização
                        </div>

                        {form.tipo === 'transferencia' ? (
                          <div className="mt-3 space-y-3 text-sm">
                            <div>
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Origem
                              </div>

                              <div className="mt-0.5 font-medium">
                                {depositoLabel(
                                  depositoOrigem
                                )}
                              </div>

                              {gavetaOrigem && (
                                <div className="text-xs text-muted-foreground">
                                  Gaveta {gavetaOrigem.codigo}
                                </div>
                              )}
                            </div>

                            <div className="border-t pt-3">
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Destino
                              </div>

                              <div className="mt-0.5 font-medium">
                                {depositoLabel(
                                  depositoDestino
                                )}
                              </div>

                              {gavetaDestino && (
                                <div className="text-xs text-muted-foreground">
                                  Gaveta {gavetaDestino.codigo}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-sm">
                            <div className="font-medium">
                              {depositoLabel(
                                depositoSelecionado
                              )}
                            </div>

                            {gavetaSelecionada && (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                Gaveta {gavetaSelecionada.codigo}
                              </div>
                            )}
                          </div>
                        )}
                      </div>


                      <div className="rounded-xl border bg-card p-3">
                        <div className="text-xs font-medium text-muted-foreground">
                          Impacto da movimentação
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                            form.tipo === 'entrada'
                              ? 'bg-primary/10 text-primary'
                              : form.tipo === 'saida'
                                ? 'bg-destructive/10 text-destructive'
                                : 'bg-secondary text-secondary-foreground'
                          }`}>
                            {form.tipo === 'entrada' ? (
                              <ArrowDownToLine className="h-5 w-5" />
                            ) : form.tipo === 'saida' ? (
                              <ArrowUpFromLine className="h-5 w-5" />
                            ) : (
                              <ArrowRightLeft className="h-5 w-5" />
                            )}
                          </div>

                          <div>
                            {form.tipo === 'transferencia' ? (
                              <>
                                <div className="text-sm">
                                  Origem:{' '}
                                  <strong className="text-destructive">
                                    - {formatQtd(qtdFormulario)}
                                  </strong>
                                </div>

                                <div className="text-sm">
                                  Destino:{' '}
                                  <strong className="text-primary">
                                    + {formatQtd(qtdFormulario)}
                                  </strong>
                                </div>
                              </>
                            ) : (
                              <div className="text-lg font-semibold tabular-nums">
                                {form.tipo === 'entrada'
                                  ? '+ '
                                  : '- '
                                }
                                {formatQtd(qtdFormulario)}
                                {' '}
                                {produtoSelecionado?.unidade || ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}


                  <div className={`rounded-xl border p-3 ${
                    camposPendentes.length === 0
                      ? 'bg-primary/5'
                      : 'bg-muted/15'
                  }`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        camposPendentes.length === 0
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        <CheckCircle2 className="h-4 w-4" />
                      </div>

                      <div>
                        <div className="text-sm font-semibold">
                          {camposPendentes.length === 0
                            ? 'Dados essenciais preenchidos'
                            : 'Validação do formulário'
                          }
                        </div>

                        {camposPendentes.length === 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            O formulário está pronto para passar pelas validações finais do motor de estoque.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                            {camposPendentes.map(
                              (item) => (
                                <li key={item}>
                                  • {item}
                                </li>
                              )
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </Card>
        )}


        {nfe.preview && (
          <NfePreviewDialog
            open
            nfeInfo={{
              nNF:
                nfe.preview.nNF,
              emitente:
                nfe.preview.emitente,
              chave:
                nfe.preview.chave,
            }}
            items={nfe.preview.items}
            produtos={produtos}
            setores={setores}
            maquinas={maquinas}
            gavetas={gavetas}
            depositos={depositos}
            onClose={nfe.close}
            onConfirm={nfe.confirm}
          />
        )}
      </div>
    </NfeDropZone>
  );
}
