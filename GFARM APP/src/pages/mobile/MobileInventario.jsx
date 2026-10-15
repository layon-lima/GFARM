import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Package,
  Plus,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SearchSelect from '@/components/SearchSelect';
import { api } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import { formatQtd, parseQtd } from '@/lib/format';
import { getDisplayName } from '@/lib/userName';
import {
  aplicarAjusteInventario,
  nextInventarioNumber,
} from '@/lib/inventario';
import { useToast } from '@/components/ui/use-toast';

const SEM_GAVETA = '__sem_gaveta__';

function depositoLabel(deposito) {
  if (!deposito) return '—';

  return [
    deposito.numero,
    deposito.nome,
  ]
    .filter(Boolean)
    .join(' · ') || 'Depósito';
}

function parseCriterios(doc) {
  let raw = {};

  try {
    raw = doc?.criterios
      ? JSON.parse(doc.criterios)
      : {};
  } catch {
    raw = {};
  }

  return {
    deposito_id: raw?.deposito_id || '',
    setor_id:
      raw?.setor_id ||
      doc?.setor_id ||
      '',
    gaveta_id: '',
    maquina_id: '',
    modo_contagem:
      raw?.modo_contagem || 'produto',
    progresso_gavetas:
      raw?.progresso_gavetas &&
      typeof raw.progresso_gavetas === 'object'
        ? raw.progresso_gavetas
        : {},
    produtos_extras:
      Array.isArray(raw?.produtos_extras)
        ? raw.produtos_extras
        : [],
    snapshot_sistema:
      raw?.snapshot_sistema &&
      typeof raw.snapshot_sistema === 'object'
        ? raw.snapshot_sistema
        : {},
  };
}

function serializeCriterios(criterios) {
  return JSON.stringify({
    deposito_id:
      criterios.deposito_id || '',
    setor_id:
      criterios.setor_id || '',
    gaveta_id: '',
    maquina_id: '',
    modo_contagem:
      criterios.modo_contagem || 'produto',
    progresso_gavetas:
      criterios.progresso_gavetas || {},
    produtos_extras:
      criterios.produtos_extras || [],
    snapshot_sistema:
      criterios.snapshot_sistema || {},
  });
}

function saldoLivreNoDeposito(
  saldo,
  depositoId
) {
  return (
    saldo &&
    (saldo.tipo_estoque || 'livre') === 'livre' &&
    saldo.deposito_id === depositoId
  );
}

function qtdSistemaProduto(
  produtoId,
  saldos,
  depositoId
) {
  return (saldos || [])
    .filter(
      (saldo) =>
        saldo.produto_id === produtoId &&
        saldoLivreNoDeposito(
          saldo,
          depositoId
        )
    )
    .reduce(
      (acc, saldo) =>
        acc +
        (Number(saldo.quantidade) || 0),
      0
    );
}

function produtoPertenceAoEscopo(
  produto,
  setorId,
  depositoId,
  saldos
) {
  if (!produto) return false;

  if (
    setorId &&
    produto.setor_id !== setorId
  ) {
    return false;
  }

  if (
    produto.deposito_id === depositoId
  ) {
    return true;
  }

  return (saldos || []).some(
    (saldo) =>
      saldo.produto_id === produto.id &&
      saldoLivreNoDeposito(
        saldo,
        depositoId
      )
  );
}

function buildResultado({
  produtosAlvo,
  items,
  criterios,
  saldos,
}) {
  const itemMap = new Map(
    (items || []).map(
      (item) => [
        item.produto_id,
        item,
      ]
    )
  );

  return produtosAlvo.map(
    (produto) => {
      const item =
        itemMap.get(produto.id);

      const sistema =
        Number(
          criterios.snapshot_sistema?.[
            produto.id
          ]
        );

      const qtdSistema =
        Number.isFinite(sistema)
          ? sistema
          : qtdSistemaProduto(
              produto.id,
              saldos,
              criterios.deposito_id
            );

      const contado =
        Number(
          item?.qtd_contada
        ) || 0;

      const divergencia =
        contado - qtdSistema;

      return {
        produto_id: produto.id,
        codigo: produto.codigo || '',
        nome: produto.nome || '',
        unidade: produto.unidade || 'un',
        qtd_sistema: qtdSistema,
        qtd_contada: contado,
        divergencia,
        status:
          Math.abs(divergencia) < 0.0001
            ? 'acerto'
            : 'divergencia',
        responsavel:
          item?.responsavel || '',
      };
    }
  );
}

function modoLabel(modo) {
  return modo === 'gaveta'
    ? 'Por gaveta'
    : 'Por produto';
}

export default function MobileInventario() {
  const { user } = useAuth();
  const { toast } = useToast();

  const {
    data,
    loading,
    reload,
  } = useEntidades({
    Setor: {},
    Produto: {},
    Deposito: {},
    Gaveta: {},
    SaldoEstoque: {},
    Inventario: {
      sort: '-data',
      limit: 300,
    },
  });

  const setores = data.Setor || [];
  const produtos = data.Produto || [];
  const depositos = data.Deposito || [];
  const gavetas = data.Gaveta || [];
  const saldos = data.SaldoEstoque || [];
  const inventarios = data.Inventario || [];

  const [view, setView] =
    useState('lista');

  const [novo, setNovo] =
    useState({
      setor_id: '',
      deposito_id: '',
      modo_contagem: 'gaveta',
    });

  const [doc, setDoc] =
    useState(null);

  const [criterios, setCriterios] =
    useState(null);

  const [items, setItems] =
    useState([]);

  const [gavetaAtiva, setGavetaAtiva] =
    useState(null);

  const [busca, setBusca] =
    useState('');

  const [quantidades, setQuantidades] =
    useState({});

  const [foundOpen, setFoundOpen] =
    useState(false);

  const [foundProdutoId, setFoundProdutoId] =
    useState('');

  const [foundGavetaId, setFoundGavetaId] =
    useState('');

  const [saving, setSaving] =
    useState(false);

  const [resultado, setResultado] =
    useState(null);

  const [aplicando, setAplicando] =
    useState(false);

  const setorMap = useMemo(
    () =>
      new Map(
        setores.map((setor) => [
          setor.id,
          setor,
        ])
      ),
    [setores]
  );

  const depositoMap = useMemo(
    () =>
      new Map(
        depositos.map((deposito) => [
          deposito.id,
          deposito,
        ])
      ),
    [depositos]
  );

  const gavetaMap = useMemo(
    () =>
      new Map(
        gavetas.map((gaveta) => [
          gaveta.id,
          gaveta,
        ])
      ),
    [gavetas]
  );

  const produtosPorId = useMemo(
    () =>
      new Map(
        produtos.map((produto) => [
          produto.id,
          produto,
        ])
      ),
    [produtos]
  );

  const depositosCompativeis =
    useMemo(() => {
      if (!novo.setor_id) {
        return [];
      }

      const produtosSetor =
        produtos.filter(
          (produto) =>
            produto.setor_id ===
            novo.setor_id
        );

      const idsProdutos =
        new Set(
          produtosSetor.map(
            (produto) => produto.id
          )
        );

      const idsDepositos =
        new Set();

      produtosSetor.forEach(
        (produto) => {
          if (produto.deposito_id) {
            idsDepositos.add(
              produto.deposito_id
            );
          }
        }
      );

      saldos.forEach((saldo) => {
        if (
          idsProdutos.has(
            saldo.produto_id
          ) &&
          saldo.deposito_id
        ) {
          idsDepositos.add(
            saldo.deposito_id
          );
        }
      });

      return depositos
        .filter(
          (deposito) =>
            deposito.setor_id ===
              novo.setor_id ||
            idsDepositos.has(
              deposito.id
            )
        )
        .sort((a, b) =>
          depositoLabel(a).localeCompare(
            depositoLabel(b),
            'pt-BR'
          )
        );
    }, [
      novo.setor_id,
      produtos,
      saldos,
      depositos,
    ]);

  const produtosBase =
    useMemo(() => {
      if (
        !criterios?.deposito_id ||
        !criterios?.setor_id
      ) {
        return [];
      }

      return produtos
        .filter((produto) =>
          produtoPertenceAoEscopo(
            produto,
            criterios.setor_id,
            criterios.deposito_id,
            saldos
          )
        )
        .sort((a, b) =>
          String(
            a.nome || ''
          ).localeCompare(
            String(b.nome || ''),
            'pt-BR'
          )
        );
    }, [
      criterios,
      produtos,
      saldos,
    ]);

  const produtosAlvo =
    useMemo(() => {
      if (!criterios) return [];

      const mapa =
        new Map(
          produtosBase.map(
            (produto) => [
              produto.id,
              produto,
            ]
          )
        );

      (
        criterios.produtos_extras ||
        []
      ).forEach((extra) => {
        const produto =
          produtosPorId.get(
            extra.produto_id
          );

        if (
          produto &&
          produto.setor_id ===
            criterios.setor_id
        ) {
          mapa.set(
            produto.id,
            produto
          );
        }
      });

      return [
        ...mapa.values(),
      ].sort((a, b) =>
        String(
          a.nome || ''
        ).localeCompare(
          String(b.nome || ''),
          'pt-BR'
        )
      );
    }, [
      criterios,
      produtosBase,
      produtosPorId,
    ]);

  const itemMap = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.produto_id,
          item,
        ])
      ),
    [items]
  );

  const gavetasComProdutos =
    useMemo(() => {
      if (
        !criterios ||
        criterios.modo_contagem !==
          'gaveta'
      ) {
        return [];
      }

      const mapa = new Map();

      const adicionar = (
        gavetaId,
        produtoId
      ) => {
        const key =
          gavetaId ||
          SEM_GAVETA;

        if (!mapa.has(key)) {
          mapa.set(
            key,
            new Set()
          );
        }

        mapa.get(key).add(
          produtoId
        );
      };

      produtosBase.forEach(
        (produto) => {
          const localizacoes =
            new Set();

          saldos
            .filter(
              (saldo) =>
                saldo.produto_id ===
                  produto.id &&
                saldoLivreNoDeposito(
                  saldo,
                  criterios.deposito_id
                ) &&
                (Number(
                  saldo.quantidade
                ) || 0) > 0
            )
            .forEach((saldo) => {
              localizacoes.add(
                saldo.gaveta_id ||
                  SEM_GAVETA
              );
            });

          if (
            localizacoes.size === 0
          ) {
            if (
              produto.deposito_id ===
                criterios.deposito_id &&
              produto.gaveta_id
            ) {
              localizacoes.add(
                produto.gaveta_id
              );
            } else {
              localizacoes.add(
                SEM_GAVETA
              );
            }
          }

          localizacoes.forEach(
            (gavetaId) =>
              adicionar(
                gavetaId,
                produto.id
              )
          );
        }
      );

      (
        criterios.produtos_extras ||
        []
      ).forEach((extra) => {
        adicionar(
          extra.gaveta_id ||
            SEM_GAVETA,
          extra.produto_id
        );
      });

      return [
        ...mapa.entries(),
      ]
        .map(
          ([
            gaveta_id,
            produtoIds,
          ]) => {
            const lista = [
              ...produtoIds,
            ]
              .map((id) =>
                produtosPorId.get(id)
              )
              .filter(Boolean)
              .sort((a, b) =>
                String(
                  a.nome || ''
                ).localeCompare(
                  String(
                    b.nome || ''
                  ),
                  'pt-BR'
                )
              );

            const progresso =
              criterios
                .progresso_gavetas?.[
                gaveta_id
              ] || {};

            const contados =
              lista.filter(
                (produto) =>
                  Object.prototype.hasOwnProperty.call(
                    progresso,
                    produto.id
                  )
              ).length;

            return {
              gaveta_id,
              gaveta:
                gaveta_id ===
                SEM_GAVETA
                  ? null
                  : gavetaMap.get(
                      gaveta_id
                    ),
              produtos: lista,
              contados,
              total: lista.length,
            };
          }
        )
        .sort((a, b) => {
          if (
            a.gaveta_id ===
            SEM_GAVETA
          ) {
            return 1;
          }

          if (
            b.gaveta_id ===
            SEM_GAVETA
          ) {
            return -1;
          }

          return String(
            a.gaveta?.codigo ||
              a.gaveta?.descricao ||
              ''
          ).localeCompare(
            String(
              b.gaveta?.codigo ||
                b.gaveta
                  ?.descricao ||
                ''
            ),
            'pt-BR'
          );
        });
    }, [
      criterios,
      produtosBase,
      saldos,
      produtosPorId,
      gavetaMap,
    ]);

  const produtosContados =
    useMemo(() => {
      if (!criterios) return 0;

      if (
        criterios.modo_contagem ===
        'produto'
      ) {
        return produtosAlvo.filter(
          (produto) =>
            itemMap.has(
              produto.id
            )
        ).length;
      }

      const ids =
        new Set();

      Object.values(
        criterios
          .progresso_gavetas ||
          {}
      ).forEach((grupo) => {
        Object.keys(
          grupo || {}
        ).forEach((id) =>
          ids.add(id)
        );
      });

      return produtosAlvo.filter(
        (produto) =>
          ids.has(produto.id)
      ).length;
    }, [
      criterios,
      produtosAlvo,
      itemMap,
    ]);

  const totalAssociacoes =
    useMemo(
      () =>
        gavetasComProdutos.reduce(
          (acc, grupo) =>
            acc + grupo.total,
          0
        ),
      [gavetasComProdutos]
    );

  const associacoesContadas =
    useMemo(
      () =>
        gavetasComProdutos.reduce(
          (acc, grupo) =>
            acc + grupo.contados,
          0
        ),
      [gavetasComProdutos]
    );

  const podeConcluir =
    criterios?.modo_contagem ===
    'gaveta'
      ? (
          totalAssociacoes > 0 &&
          associacoesContadas ===
            totalAssociacoes
        )
      : (
          produtosAlvo.length > 0 &&
          produtosContados ===
            produtosAlvo.length
        );

  const listaInventarios =
    useMemo(
      () =>
        [...inventarios].sort(
          (a, b) =>
            new Date(
              b.data || 0
            ) -
            new Date(
              a.data || 0
            )
        ),
      [inventarios]
    );

  function limparFluxo() {
    setDoc(null);
    setCriterios(null);
    setItems([]);
    setGavetaAtiva(null);
    setBusca('');
    setQuantidades({});
    setFoundOpen(false);
    setFoundProdutoId('');
    setFoundGavetaId('');
    setResultado(null);
    setView('lista');
  }

  async function carregarItens(
    inventarioId
  ) {
    return (
      await api.entities.InventarioItem.filter(
        {
          inventario_id:
            inventarioId,
        }
      )
    ) || [];
  }

  async function abrirInventario(
    inventario
  ) {
    if (
      inventario.status ===
      'concluido'
    ) {
      setDoc(inventario);
      setCriterios(
        parseCriterios(
          inventario
        )
      );

      setView('detalhe');
      return;
    }

    try {
      const its =
        await carregarItens(
          inventario.id
        );

      const escopo =
        parseCriterios(
          inventario
        );

      setDoc(inventario);
      setCriterios(escopo);
      setItems(its);
      setGavetaAtiva(null);
      setBusca('');
      setQuantidades({});
      setResultado(null);

      setView(
        escopo.modo_contagem ===
          'gaveta'
          ? 'gavetas'
          : 'produtos'
      );
    } catch (error) {
      toast({
        variant:
          'destructive',
        title:
          'Erro ao abrir inventário',
        description:
          error?.message,
      });
    }
  }

  async function iniciarInventario() {
    if (
      !novo.setor_id ||
      !novo.deposito_id
    ) {
      toast({
        variant:
          'destructive',
        title:
          'Selecione setor e depósito',
      });
      return;
    }

    setSaving(true);

    try {
      const abertos =
        await api.entities.Inventario.filter(
          {
            status: 'aberto',
          },
          '-data',
          200
        );

      const existente =
        (abertos || []).find(
          (item) => {
            const atual =
              parseCriterios(
                item
              );

            return (
              atual.setor_id ===
                novo.setor_id &&
              atual.deposito_id ===
                novo.deposito_id
            );
          }
        );

      if (existente) {
        toast({
          title:
            'Inventário em aberto',
          description:
            'Retomando a contagem já existente para este setor e depósito.',
        });

        await abrirInventario(
          existente
        );

        return;
      }

      const produtosEscopo =
        produtos.filter(
          (produto) =>
            produtoPertenceAoEscopo(
              produto,
              novo.setor_id,
              novo.deposito_id,
              saldos
            )
        );

      const snapshot = {};

      produtosEscopo.forEach(
        (produto) => {
          snapshot[
            produto.id
          ] =
            qtdSistemaProduto(
              produto.id,
              saldos,
              novo.deposito_id
            );
        }
      );

      const escopo = {
        deposito_id:
          novo.deposito_id,
        setor_id:
          novo.setor_id,
        gaveta_id: '',
        maquina_id: '',
        modo_contagem:
          novo.modo_contagem,
        progresso_gavetas: {},
        produtos_extras: [],
        snapshot_sistema:
          snapshot,
      };

      const todos =
        await api.entities.Inventario.list(
          '-data',
          500
        );

      const setor =
        setorMap.get(
          novo.setor_id
        );

      const deposito =
        depositoMap.get(
          novo.deposito_id
        );

      const criado =
        await api.entities.Inventario.create(
          {
            numero:
              nextInventarioNumber(
                todos
              ),
            data:
              new Date().toISOString(),
            setor_id:
              novo.setor_id,
            setor_nome:
              setor?.nome || '',
            criterios:
              serializeCriterios(
                escopo
              ),
            criterios_descricao:
              `Setor: ${
                setor?.nome || '—'
              } | Depósito: ${
                depositoLabel(
                  deposito
                )
              } | Contagem: ${
                modoLabel(
                  novo.modo_contagem
                )
              }`,
            status: 'aberto',
            responsavel:
              getDisplayName(
                user
              ),
            total_itens:
              produtosEscopo.length,
            total_acertos: 0,
            total_divergencias: 0,
            resultado:
              'consistente',
          }
        );

      setDoc(criado);
      setCriterios(escopo);
      setItems([]);
      setView(
        novo.modo_contagem ===
          'gaveta'
          ? 'gavetas'
          : 'produtos'
      );

      reload();
    } catch (error) {
      toast({
        variant:
          'destructive',
        title:
          'Erro ao iniciar inventário',
        description:
          error?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function salvarCriterios(
    next
  ) {
    if (!doc) return;

    await api.entities.Inventario.update(
      doc.id,
      {
        criterios:
          serializeCriterios(
            next
          ),
      }
    );

    setCriterios(next);
  }

  async function upsertItemProduto(
    produto,
    quantidade
  ) {
    const existente =
      itemMap.get(
        produto.id
      );

    const sistema =
      Number(
        criterios
          ?.snapshot_sistema?.[
          produto.id
        ]
      );

    const qtdSistema =
      Number.isFinite(
        sistema
      )
        ? sistema
        : qtdSistemaProduto(
            produto.id,
            saldos,
            criterios.deposito_id
          );

    const payload = {
      qtd_contada:
        quantidade,
      responsavel:
        getDisplayName(user),
      data:
        new Date().toISOString(),
    };

    let salvo;

    if (existente) {
      salvo =
        await api.entities.InventarioItem.update(
          existente.id,
          payload
        );
    } else {
      salvo =
        await api.entities.InventarioItem.create(
          {
            inventario_id:
              doc.id,
            produto_id:
              produto.id,
            codigo:
              produto.codigo,
            nome:
              produto.nome,
            unidade:
              produto.unidade ||
              'un',
            qtd_sistema:
              qtdSistema,
            ...payload,
          }
        );
    }

    setItems((prev) => {
      const found =
        prev.some(
          (item) =>
            item.produto_id ===
            produto.id
        );

      return found
        ? prev.map(
            (item) =>
              item.produto_id ===
              produto.id
                ? salvo
                : item
          )
        : [...prev, salvo];
    });

    return salvo;
  }

  async function salvarProdutoDireto(
    produto
  ) {
    const raw =
      quantidades[
        produto.id
      ];

    if (
      raw === undefined ||
      String(raw).trim() ===
        ''
    ) {
      toast({
        variant:
          'destructive',
        title:
          'Informe a quantidade contada',
      });
      return;
    }

    setSaving(true);

    try {
      await upsertItemProduto(
        produto,
        parseQtd(raw)
      );

      setQuantidades(
        (prev) => ({
          ...prev,
          [produto.id]: '',
        })
      );

      toast({
        title:
          'Contagem salva',
      });
    } catch (error) {
      toast({
        variant:
          'destructive',
        title:
          'Erro ao salvar contagem',
        description:
          error?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function salvarProdutoGaveta(
    produto
  ) {
    if (!gavetaAtiva) return;

    const raw =
      quantidades[
        produto.id
      ];

    if (
      raw === undefined ||
      String(raw).trim() ===
        ''
    ) {
      toast({
        variant:
          'destructive',
        title:
          'Informe a quantidade contada',
      });
      return;
    }

    setSaving(true);

    try {
      const valor =
        parseQtd(raw);

      const progressoAtual =
        criterios
          .progresso_gavetas ||
        {};

      const grupoAtual = {
        ...(
          progressoAtual[
            gavetaAtiva
          ] || {}
        ),
        [produto.id]:
          valor,
      };

      const progresso = {
        ...progressoAtual,
        [gavetaAtiva]:
          grupoAtual,
      };

      let totalProduto = 0;

      Object.values(
        progresso
      ).forEach((grupo) => {
        if (
          Object.prototype.hasOwnProperty.call(
            grupo || {},
            produto.id
          )
        ) {
          totalProduto +=
            Number(
              grupo[
                produto.id
              ]
            ) || 0;
        }
      });

      const next = {
        ...criterios,
        progresso_gavetas:
          progresso,
      };

      await upsertItemProduto(
        produto,
        totalProduto
      );

      await salvarCriterios(
        next
      );

      setQuantidades(
        (prev) => ({
          ...prev,
          [produto.id]: '',
        })
      );

      toast({
        title:
          'Contagem salva',
      });
    } catch (error) {
      toast({
        variant:
          'destructive',
        title:
          'Erro ao salvar contagem',
        description:
          error?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function adicionarProdutoEncontrado() {
    if (
      !foundProdutoId ||
      !criterios
    ) {
      return;
    }

    const gavetaId =
      criterios.modo_contagem ===
      'gaveta'
        ? (
            gavetaAtiva ||
            SEM_GAVETA
          )
        : (
            foundGavetaId ||
            SEM_GAVETA
          );

    const jaExiste =
      (
        criterios
          .produtos_extras ||
        []
      ).some(
        (item) =>
          item.produto_id ===
            foundProdutoId &&
          item.gaveta_id ===
            gavetaId
      );

    const extras =
      jaExiste
        ? (
            criterios
              .produtos_extras ||
            []
          )
        : [
            ...(
              criterios
                .produtos_extras ||
              []
            ),
            {
              produto_id:
                foundProdutoId,
              gaveta_id:
                gavetaId,
            },
          ];

    const snapshot = {
      ...(
        criterios
          .snapshot_sistema ||
        {}
      ),
    };

    if (
      !Object.prototype.hasOwnProperty.call(
        snapshot,
        foundProdutoId
      )
    ) {
      snapshot[
        foundProdutoId
      ] =
        qtdSistemaProduto(
          foundProdutoId,
          saldos,
          criterios.deposito_id
        );
    }

    const next = {
      ...criterios,
      produtos_extras:
        extras,
      snapshot_sistema:
        snapshot,
    };

    try {
      await salvarCriterios(
        next
      );

      setFoundOpen(false);
      setFoundProdutoId('');
      setFoundGavetaId('');

      toast({
        title:
          'Produto adicionado à contagem',
      });
    } catch (error) {
      toast({
        variant:
          'destructive',
        title:
          'Erro ao adicionar produto',
        description:
          error?.message,
      });
    }
  }

  function prepararRevisao() {
    if (!podeConcluir) {
      toast({
        variant:
          'destructive',
        title:
          'Contagem incompleta',
        description:
          criterios
            ?.modo_contagem ===
          'gaveta'
            ? 'Conclua todos os produtos de todas as gavetas antes de revisar.'
            : 'Conte todos os produtos antes de revisar.',
      });

      return;
    }

    const itensResultado =
      buildResultado({
        produtosAlvo,
        items,
        criterios,
        saldos,
      });

    setResultado({
      itens:
        itensResultado,
      total_itens:
        itensResultado.length,
      total_acertos:
        itensResultado.filter(
          (item) =>
            item.status ===
            'acerto'
        ).length,
      total_divergencias:
        itensResultado.filter(
          (item) =>
            item.status ===
            'divergencia'
        ).length,
    });

    setView('revisao');
  }

  async function concluirInventario() {
    if (
      !doc ||
      !resultado
    ) {
      return;
    }

    setSaving(true);

    try {
      const resultadoCalc =
        resultado
          .total_divergencias ===
        0
          ? 'consistente'
          : 'divergente';

      const atualizado =
        await api.entities.Inventario.update(
          doc.id,
          {
            itens:
              JSON.stringify(
                resultado.itens
              ),
            total_itens:
              resultado.total_itens,
            total_acertos:
              resultado.total_acertos,
            total_divergencias:
              resultado
                .total_divergencias,
            resultado:
              resultadoCalc,
            status:
              'concluido',
            data_fechamento:
              new Date().toISOString(),
          }
        );

      setDoc(atualizado);
      setView('resultado');

      reload();

      toast({
        title:
          'Inventário concluído',
      });
    } catch (error) {
      toast({
        variant:
          'destructive',
        title:
          'Erro ao concluir inventário',
        description:
          error?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function aplicarAjustes() {
    if (
      !doc ||
      !resultado
    ) {
      return;
    }

    setAplicando(true);

    try {
      const resposta =
        await aplicarAjusteInventario(
          {
            inventario: doc,
            itens:
              resultado.itens,
            produtos,
            setores,
            criterios: {
              ...criterios,
              gaveta_id: '',
              maquina_id: '',
            },
          }
        );

      toast({
        title:
          'Ajustes postados',
        description:
          `${resposta.aplicados} de ${resposta.total} divergências foram enviadas ao motor oficial de estoque.`,
      });

      reload();
    } catch (error) {
      toast({
        variant:
          'destructive',
        title:
          'Erro ao aplicar ajustes',
        description:
          error?.message,
      });
    } finally {
      setAplicando(false);
    }
  }

  const progressoTotal =
    criterios
      ?.modo_contagem ===
    'gaveta'
      ? `${associacoesContadas} de ${totalAssociacoes} posições contadas`
      : `${produtosContados} de ${produtosAlvo.length} produtos contados`;

  const cabecalhoContagem = (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (
              view ===
              'gaveta'
            ) {
              setGavetaAtiva(
                null
              );
              setView(
                'gavetas'
              );
              return;
            }

            limparFluxo();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full border bg-white"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">
            {doc?.numero ||
              'Inventário'}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {
              setorMap.get(
                criterios?.setor_id
              )?.nome
            }{' '}
            ·{' '}
            {depositoLabel(
              depositoMap.get(
                criterios
                  ?.deposito_id
              )
            )}
          </p>
        </div>
      </div>

      <div className="pt-2">
        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>
            {progressoTotal}
          </span>
          <span>
            {modoLabel(
              criterios
                ?.modo_contagem
            )}
          </span>
        </div>

        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-emerald-100">
          <div
            className="h-full rounded-full bg-emerald-600 transition-all"
            style={{
              width:
                `${
                  criterios
                    ?.modo_contagem ===
                  'gaveta'
                    ? (
                        totalAssociacoes
                          ? Math.round(
                              (
                                associacoesContadas /
                                totalAssociacoes
                              ) *
                                100
                            )
                          : 0
                      )
                    : (
                        produtosAlvo.length
                          ? Math.round(
                              (
                                produtosContados /
                                produtosAlvo.length
                              ) *
                                100
                            )
                          : 0
                      )
                }%`,
            }}
          />
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (view === 'novo') {
    return (
      <div className="mobile-page space-y-5 px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setView('lista')
            }
            className="flex h-9 w-9 items-center justify-center rounded-full border bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <h1 className="text-xl font-bold">
            Novo inventário
          </h1>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold">
              Setor
            </label>

            <SearchSelect
              value={
                novo.setor_id
              }
              onChange={(value) =>
                setNovo(
                  (prev) => ({
                    ...prev,
                    setor_id:
                      value ===
                      'all'
                        ? ''
                        : value,
                    deposito_id:
                      '',
                  })
                )
              }
              placeholder="Selecione o setor"
              options={setores
                .map(
                  (setor) => ({
                    value:
                      setor.id,
                    label:
                      setor.nome,
                  })
                )
                .sort((a, b) =>
                  a.label.localeCompare(
                    b.label,
                    'pt-BR'
                  )
                )}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold">
              Depósito
            </label>

            <SearchSelect
              value={
                novo.deposito_id
              }
              onChange={(value) =>
                setNovo(
                  (prev) => ({
                    ...prev,
                    deposito_id:
                      value ===
                      'all'
                        ? ''
                        : value,
                  })
                )
              }
              disabled={
                !novo.setor_id
              }
              placeholder={
                novo.setor_id
                  ? 'Selecione o depósito'
                  : 'Selecione o setor primeiro'
              }
              options={
                depositosCompativeis.map(
                  (deposito) => ({
                    value:
                      deposito.id,
                    label:
                      depositoLabel(
                        deposito
                      ),
                  })
                )
              }
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">
              Modelo de contagem
            </label>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  setNovo(
                    (prev) => ({
                      ...prev,
                      modo_contagem:
                        'gaveta',
                    })
                  )
                }
                className={`rounded-2xl border p-4 text-left transition ${
                  novo.modo_contagem ===
                  'gaveta'
                    ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                    : 'bg-white'
                }`}
              >
                <Boxes className="mb-3 h-5 w-5 text-emerald-700" />
                <strong className="block text-sm">
                  Por gaveta
                </strong>
                <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                  Organiza a contagem pela localização física.
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setNovo(
                    (prev) => ({
                      ...prev,
                      modo_contagem:
                        'produto',
                    })
                  )
                }
                className={`rounded-2xl border p-4 text-left transition ${
                  novo.modo_contagem ===
                  'produto'
                    ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                    : 'bg-white'
                }`}
              >
                <Package className="mb-3 h-5 w-5 text-emerald-700" />
                <strong className="block text-sm">
                  Por produto
                </strong>
                <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                  Mostra os produtos diretamente para a contagem.
                </span>
              </button>
            </div>
          </div>
        </div>

        <Button
          className="h-11 w-full"
          onClick={
            iniciarInventario
          }
          disabled={
            saving ||
            !novo.setor_id ||
            !novo.deposito_id
          }
        >
          {saving
            ? 'Iniciando...'
            : 'Iniciar inventário'}
        </Button>
      </div>
    );
  }

  if (
    view === 'gavetas' &&
    criterios
  ) {
    return (
      <div className="mobile-page space-y-4 px-4 py-4">
        {cabecalhoContagem}

        <div className="space-y-2">
          {gavetasComProdutos.map(
            (grupo) => {
              const concluida =
                grupo.total > 0 &&
                grupo.contados ===
                  grupo.total;

              const nome =
                grupo.gaveta_id ===
                SEM_GAVETA
                  ? 'SEM GAVETA'
                  : (
                      grupo.gaveta
                        ?.codigo ||
                      grupo.gaveta
                        ?.descricao ||
                      'GAVETA'
                    );

              return (
                <button
                  type="button"
                  key={
                    grupo.gaveta_id
                  }
                  onClick={() => {
                    setGavetaAtiva(
                      grupo.gaveta_id
                    );

                    const atual =
                      criterios
                        .progresso_gavetas?.[
                        grupo
                          .gaveta_id
                      ] || {};

                    const valores =
                      {};

                    grupo.produtos.forEach(
                      (produto) => {
                        if (
                          Object.prototype.hasOwnProperty.call(
                            atual,
                            produto.id
                          )
                        ) {
                          valores[
                            produto.id
                          ] =
                            String(
                              atual[
                                produto
                                  .id
                              ]
                            );
                        }
                      }
                    );

                    setQuantidades(
                      valores
                    );
                    setView(
                      'gaveta'
                    );
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Boxes className="h-5 w-5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {nome}
                    </strong>

                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {grupo.total}{' '}
                      {grupo.total ===
                      1
                        ? 'produto'
                        : 'produtos'}{' '}
                      ·{' '}
                      {
                        grupo.contados
                      }
                      /{grupo.total}{' '}
                      contados
                    </span>
                  </span>

                  {concluida ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              );
            }
          )}
        </div>

        <Button
          className="h-11 w-full"
          onClick={
            prepararRevisao
          }
          disabled={
            !podeConcluir
          }
        >
          Revisar inventário
        </Button>
      </div>
    );
  }

  if (
    view === 'gaveta' &&
    criterios &&
    gavetaAtiva
  ) {
    const grupo =
      gavetasComProdutos.find(
        (item) =>
          item.gaveta_id ===
          gavetaAtiva
      );

    const produtosGaveta =
      grupo?.produtos || [];

    const termo =
      busca
        .trim()
        .toLowerCase();

    const filtrados =
      termo
        ? produtosGaveta.filter(
            (produto) =>
              [
                produto.nome,
                produto.codigo,
                produto
                  .codigo_referencia,
              ]
                .filter(Boolean)
                .some((valor) =>
                  String(valor)
                    .toLowerCase()
                    .includes(
                      termo
                    )
                )
          )
        : produtosGaveta;

    const nomeGaveta =
      gavetaAtiva ===
      SEM_GAVETA
        ? 'SEM GAVETA'
        : (
            gavetaMap.get(
              gavetaAtiva
            )?.codigo ||
            gavetaMap.get(
              gavetaAtiva
            )?.descricao ||
            'GAVETA'
          );

    return (
      <div className="mobile-page space-y-4 px-4 py-4">
        {cabecalhoContagem}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Contando
            </p>
            <h2 className="text-lg font-bold">
              {nomeGaveta}
            </h2>
          </div>

          <button
            type="button"
            onClick={() =>
              setFoundOpen(
                (value) =>
                  !value
              )
            }
            className="rounded-full border px-3 py-2 text-xs font-semibold text-emerald-700"
          >
            + Produto encontrado
          </button>
        </div>

        {foundOpen ? (
          <div className="space-y-3 rounded-2xl border bg-amber-50/60 p-3">
            <p className="text-xs font-semibold">
              Produto encontrado nesta gaveta
            </p>

            <SearchSelect
              value={
                foundProdutoId
              }
              onChange={(value) =>
                setFoundProdutoId(
                  value ===
                    'all'
                    ? ''
                    : value
                )
              }
              placeholder="Buscar produto..."
              options={produtos
                .filter(
                  (produto) =>
                    produto.setor_id ===
                    criterios.setor_id
                )
                .map(
                  (produto) => ({
                    value:
                      produto.id,
                    label:
                      `${produto.nome}${
                        produto.codigo
                          ? ` · ${produto.codigo}`
                          : ''
                      }`,
                  })
                )
                .sort((a, b) =>
                  a.label.localeCompare(
                    b.label,
                    'pt-BR'
                  )
                )}
            />

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setFoundOpen(
                    false
                  );
                  setFoundProdutoId(
                    ''
                  );
                }}
              >
                Cancelar
              </Button>

              <Button
                className="flex-1"
                disabled={
                  !foundProdutoId
                }
                onClick={
                  adicionarProdutoEncontrado
                }
              >
                Adicionar
              </Button>
            </div>
          </div>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(event) =>
              setBusca(
                event.target.value
              )
            }
            placeholder="Buscar produto..."
            className="h-10 pl-9"
          />
        </div>

        <div className="space-y-2">
          {filtrados.map(
            (produto) => {
              const progresso =
                criterios
                  .progresso_gavetas?.[
                  gavetaAtiva
                ] || {};

              const contado =
                Object.prototype.hasOwnProperty.call(
                  progresso,
                  produto.id
                );

              return (
                <div
                  key={produto.id}
                  className={`rounded-2xl border bg-white p-3 ${
                    contado
                      ? 'border-emerald-200'
                      : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {produto.nome}
                      </strong>
                      <span className="text-[11px] text-muted-foreground">
                        Código:{' '}
                        {produto.codigo ||
                          '—'}{' '}
                        ·{' '}
                        {produto.unidade ||
                          ''}
                      </span>
                    </div>

                    {contado ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : null}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Input
                      inputMode="decimal"
                      value={
                        quantidades[
                          produto.id
                        ] ??
                        (
                          contado
                            ? String(
                                progresso[
                                  produto.id
                                ]
                              )
                            : ''
                        )
                      }
                      onChange={(event) =>
                        setQuantidades(
                          (prev) => ({
                            ...prev,
                            [produto.id]:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="Quantidade contada"
                      className="h-10 flex-1"
                    />

                    <Button
                      className="h-10 px-4"
                      disabled={saving}
                      onClick={() =>
                        salvarProdutoGaveta(
                          produto
                        )
                      }
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>
    );
  }

  if (
    view === 'produtos' &&
    criterios
  ) {
    const termo =
      busca
        .trim()
        .toLowerCase();

    const filtrados =
      termo
        ? produtosAlvo.filter(
            (produto) =>
              [
                produto.nome,
                produto.codigo,
                produto
                  .codigo_referencia,
              ]
                .filter(Boolean)
                .some((valor) =>
                  String(valor)
                    .toLowerCase()
                    .includes(
                      termo
                    )
                )
          )
        : produtosAlvo;

    return (
      <div className="mobile-page space-y-4 px-4 py-4">
        {cabecalhoContagem}

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">
            Produtos
          </h2>

          <button
            type="button"
            onClick={() =>
              setFoundOpen(
                (value) =>
                  !value
              )
            }
            className="rounded-full border px-3 py-2 text-xs font-semibold text-emerald-700"
          >
            + Produto encontrado
          </button>
        </div>

        {foundOpen ? (
          <div className="space-y-3 rounded-2xl border bg-amber-50/60 p-3">
            <SearchSelect
              value={
                foundProdutoId
              }
              onChange={(value) =>
                setFoundProdutoId(
                  value ===
                    'all'
                    ? ''
                    : value
                )
              }
              placeholder="Buscar produto..."
              options={produtos
                .filter(
                  (produto) =>
                    produto.setor_id ===
                    criterios.setor_id
                )
                .map(
                  (produto) => ({
                    value:
                      produto.id,
                    label:
                      `${produto.nome}${
                        produto.codigo
                          ? ` · ${produto.codigo}`
                          : ''
                      }`,
                  })
                )
                .sort((a, b) =>
                  a.label.localeCompare(
                    b.label,
                    'pt-BR'
                  )
                )}
            />

            <SearchSelect
              value={
                foundGavetaId
              }
              onChange={(value) =>
                setFoundGavetaId(
                  value ===
                    'all'
                    ? ''
                    : value
                )
              }
              allLabel="Sem gaveta"
              placeholder="Onde foi encontrado?"
              options={gavetas
                .filter(
                  (gaveta) =>
                    gaveta.deposito_id ===
                    criterios.deposito_id
                )
                .map(
                  (gaveta) => ({
                    value:
                      gaveta.id,
                    label:
                      gaveta.codigo ||
                      gaveta.descricao ||
                      'Gaveta',
                  })
                )
                .sort((a, b) =>
                  a.label.localeCompare(
                    b.label,
                    'pt-BR'
                  )
                )}
            />

            <Button
              className="w-full"
              disabled={
                !foundProdutoId
              }
              onClick={
                adicionarProdutoEncontrado
              }
            >
              Adicionar à contagem
            </Button>
          </div>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(event) =>
              setBusca(
                event.target.value
              )
            }
            placeholder="Buscar produto..."
            className="h-10 pl-9"
          />
        </div>

        <div className="space-y-2">
          {filtrados.map(
            (produto) => {
              const existente =
                itemMap.get(
                  produto.id
                );

              return (
                <div
                  key={produto.id}
                  className={`rounded-2xl border bg-white p-3 ${
                    existente
                      ? 'border-emerald-200'
                      : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {produto.nome}
                      </strong>
                      <span className="text-[11px] text-muted-foreground">
                        Código:{' '}
                        {produto.codigo ||
                          '—'}{' '}
                        ·{' '}
                        {produto.unidade ||
                          ''}
                      </span>
                    </div>

                    {existente ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : null}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Input
                      inputMode="decimal"
                      value={
                        quantidades[
                          produto.id
                        ] ??
                        (
                          existente
                            ? String(
                                existente
                                  .qtd_contada
                              )
                            : ''
                        )
                      }
                      onChange={(event) =>
                        setQuantidades(
                          (prev) => ({
                            ...prev,
                            [produto.id]:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="Quantidade contada"
                      className="h-10 flex-1"
                    />

                    <Button
                      className="h-10 px-4"
                      disabled={saving}
                      onClick={() =>
                        salvarProdutoDireto(
                          produto
                        )
                      }
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              );
            }
          )}
        </div>

        <Button
          className="h-11 w-full"
          onClick={
            prepararRevisao
          }
          disabled={
            !podeConcluir
          }
        >
          Revisar inventário
        </Button>
      </div>
    );
  }

  if (
    view === 'revisao' &&
    resultado
  ) {
    const divergencias =
      resultado.itens.filter(
        (item) =>
          item.status ===
          'divergencia'
      );

    return (
      <div className="mobile-page space-y-4 px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setView(
                criterios
                  ?.modo_contagem ===
                'gaveta'
                  ? 'gavetas'
                  : 'produtos'
              )
            }
            className="flex h-9 w-9 items-center justify-center rounded-full border bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div>
            <h1 className="text-xl font-bold">
              Revisar inventário
            </h1>
            <p className="text-xs text-muted-foreground">
              {
                resultado
                  .total_itens
              }{' '}
              produtos contados
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border bg-emerald-50 p-3">
            <span className="text-[10px] font-semibold uppercase text-emerald-700">
              Conferem
            </span>
            <strong className="mt-1 block text-2xl text-emerald-800">
              {
                resultado
                  .total_acertos
              }
            </strong>
          </div>

          <div className="rounded-2xl border bg-amber-50 p-3">
            <span className="text-[10px] font-semibold uppercase text-amber-700">
              Divergências
            </span>
            <strong className="mt-1 block text-2xl text-amber-800">
              {
                resultado
                  .total_divergencias
              }
            </strong>
          </div>
        </div>

        {divergencias.length >
        0 ? (
          <div className="space-y-2">
            {divergencias.map(
              (item) => (
                <div
                  key={
                    item.produto_id
                  }
                  className="rounded-2xl border border-amber-200 bg-white p-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />

                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {item.nome}
                      </strong>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div>
                          <span className="block text-[9px] uppercase text-muted-foreground">
                            Sistema
                          </span>
                          <strong className="text-xs">
                            {formatQtd(
                              item.qtd_sistema
                            )}
                          </strong>
                        </div>

                        <div>
                          <span className="block text-[9px] uppercase text-muted-foreground">
                            Contado
                          </span>
                          <strong className="text-xs">
                            {formatQtd(
                              item.qtd_contada
                            )}
                          </strong>
                        </div>

                        <div>
                          <span className="block text-[9px] uppercase text-muted-foreground">
                            Diferença
                          </span>
                          <strong className="text-xs text-amber-700">
                            {item.divergencia >
                            0
                              ? '+'
                              : ''}
                            {formatQtd(
                              item.divergencia
                            )}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border bg-emerald-50 p-4">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <div>
              <strong className="block text-sm">
                Tudo confere
              </strong>
              <span className="text-xs text-muted-foreground">
                Nenhuma divergência encontrada.
              </span>
            </div>
          </div>
        )}

        <Button
          className="h-11 w-full"
          onClick={
            concluirInventario
          }
          disabled={saving}
        >
          {saving
            ? 'Concluindo...'
            : 'Concluir inventário'}
        </Button>
      </div>
    );
  }

  if (
    view === 'resultado' &&
    resultado
  ) {
    return (
      <div className="mobile-page space-y-5 px-4 py-5">
        <div className="rounded-3xl border bg-white p-5 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-3 text-xl font-bold">
            Inventário concluído
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {
              resultado
                .total_divergencias
            }{' '}
            divergência(s)
          </p>
        </div>

        {resultado
          .total_divergencias >
        0 ? (
          <Button
            className="h-11 w-full"
            onClick={
              aplicarAjustes
            }
            disabled={
              aplicando
            }
          >
            {aplicando
              ? 'Aplicando...'
              : 'Aplicar ajustes no estoque'}
          </Button>
        ) : null}

        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={
            limparFluxo
          }
        >
          Voltar para inventários
        </Button>
      </div>
    );
  }

  if (
    view === 'detalhe' &&
    doc
  ) {
    let itens = [];

    try {
      itens = doc.itens
        ? JSON.parse(
            doc.itens
          )
        : [];
    } catch {
      itens = [];
    }

    return (
      <div className="mobile-page space-y-4 px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={
              limparFluxo
            }
            className="flex h-9 w-9 items-center justify-center rounded-full border bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">
              {doc.numero}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {doc.setor_nome ||
                'Inventário'}{' '}
              ·{' '}
              {depositoLabel(
                depositoMap.get(
                  criterios
                    ?.deposito_id
                )
              )}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border bg-white p-3 text-center">
            <strong className="block text-lg">
              {Number(
                doc.total_itens
              ) || 0}
            </strong>
            <span className="text-[9px] uppercase text-muted-foreground">
              Itens
            </span>
          </div>

          <div className="rounded-xl border bg-emerald-50 p-3 text-center">
            <strong className="block text-lg text-emerald-700">
              {Number(
                doc.total_acertos
              ) || 0}
            </strong>
            <span className="text-[9px] uppercase text-emerald-700">
              Conferem
            </span>
          </div>

          <div className="rounded-xl border bg-amber-50 p-3 text-center">
            <strong className="block text-lg text-amber-700">
              {Number(
                doc.total_divergencias
              ) || 0}
            </strong>
            <span className="text-[9px] uppercase text-amber-700">
              Diverg.
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {itens.map(
            (item) => (
              <div
                key={
                  item.produto_id
                }
                className="rounded-2xl border bg-white p-3"
              >
                <strong className="block truncate text-sm">
                  {item.nome}
                </strong>

                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <span className="block text-[9px] uppercase text-muted-foreground">
                      Sistema
                    </span>
                    <span className="text-xs font-semibold">
                      {formatQtd(
                        item.qtd_sistema
                      )}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[9px] uppercase text-muted-foreground">
                      Contado
                    </span>
                    <span className="text-xs font-semibold">
                      {formatQtd(
                        item.qtd_contada
                      )}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[9px] uppercase text-muted-foreground">
                      Dif.
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        Math.abs(
                          Number(
                            item.divergencia
                          ) || 0
                        ) >
                        0.0001
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {Number(
                        item.divergencia
                      ) > 0
                        ? '+'
                        : ''}
                      {formatQtd(
                        item.divergencia
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-page space-y-4 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">
          Inventários
        </h1>

        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setNovo({
              setor_id: '',
              deposito_id: '',
              modo_contagem:
                'gaveta',
            });

            setView('novo');
          }}
        >
          <Plus className="h-4 w-4" />
          Novo inventário
        </Button>
      </div>

      {listaInventarios.length ===
      0 ? (
        <div className="rounded-2xl border bg-white px-4 py-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-semibold">
            Nenhum inventário
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {listaInventarios.map(
            (inventario) => {
              const escopo =
                parseCriterios(
                  inventario
                );

              const aberto =
                inventario.status ===
                'aberto';

              return (
                <button
                  type="button"
                  key={
                    inventario.id
                  }
                  onClick={() =>
                    abrirInventario(
                      inventario
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      aberto
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {aberto ? (
                      <ClipboardList className="h-5 w-5" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {inventario.numero ||
                        'Inventário'}
                    </strong>

                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {
                        setorMap.get(
                          escopo.setor_id
                        )?.nome ||
                        inventario.setor_nome ||
                        '—'
                      }{' '}
                      ·{' '}
                      {depositoLabel(
                        depositoMap.get(
                          escopo.deposito_id
                        )
                      )}
                    </span>

                    <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {aberto
                        ? `Em contagem · ${modoLabel(
                            escopo.modo_contagem
                          )}`
                        : 'Concluído'}
                    </span>
                  </span>

                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}
