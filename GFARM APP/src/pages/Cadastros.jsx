import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  Boxes,
  Building2,
  Car,
  Contact,
  MapPinned,
  Package,
  PackagePlus,
  Smartphone,
  Tractor,
  Users,
  Warehouse,
} from 'lucide-react';

import SearchSelect from '@/components/SearchSelect';

import SetorManager from '@/components/cadastros/SetorManager';
import DepositoManager from '@/components/cadastros/DepositoManager';
import MaquinaManager from '@/components/cadastros/MaquinaManager';
import GavetaManager from '@/components/cadastros/GavetaManager';
import ProdutosManager from '@/components/cadastros/ProdutosManager';
import PessoasManager from '@/components/cadastros/PessoasManager';
import VeiculosManager from '@/components/cadastros/VeiculosManager';
import LavourasManager from '@/components/cadastros/LavourasManager';
import AnoSafraManager from '@/components/cadastros/AnoSafraManager';
import CadastrosMobilePendentes from '@/components/cadastros/CadastrosMobilePendentes';
import EntradaSaldoMobilePendentes from '@/components/cadastros/EntradaSaldoMobilePendentes';

import Usuarios from '@/pages/Usuarios';

import { useAuth } from '@/lib/AuthContext';
import { canAccessUsuarios, hasPermission } from '@/lib/permissions';
import { cadastrosMobileApi } from '@/api/cadastrosMobileClient';
import { entradaSaldoMobileApi } from '@/api/entradaSaldoMobileClient';


const CADASTROS = {
  pessoas: {
    label: 'Pessoas',
    descricao:
      'Clientes, fornecedores, transportadoras e motoristas em um cadastro único.',
    icon: Contact,
    componente: PessoasManager,
    grupo: 'Operação',
  },

  veiculos: {
    label: 'Veículos',
    descricao:
      'Frota, capacidade, transportadora e motorista responsável.',
    icon: Car,
    componente: VeiculosManager,
    grupo: 'Operação',
  },

  maquinas: {
    label: 'Máquinas',
    descricao:
      'Máquinas e equipamentos utilizados pela operação.',
    icon: Tractor,
    componente: MaquinaManager,
    grupo: 'Operação',
  },

  produtos: {
    label: 'Produtos',
    descricao:
      'Cadastro mestre dos produtos utilizados no ERP.',
    icon: Package,
    componente: ProdutosManager,
    grupo: 'Estoque',
  },

  setores: {
    label: 'Setores',
    descricao:
      'Estrutura principal de organização dos estoques.',
    icon: Boxes,
    componente: SetorManager,
    grupo: 'Estoque',
  },

  depositos: {
    label: 'Depósitos',
    descricao:
      'Locais de armazenamento pertencentes aos setores.',
    icon: Warehouse,
    componente: DepositoManager,
    grupo: 'Estoque',
  },

  gavetas: {
    label: 'Gavetas',
    descricao:
      'Endereços físicos internos dos depósitos.',
    icon: MapPinned,
    componente: GavetaManager,
    grupo: 'Estoque',
  },

  lavouras: {
    label: 'Lavouras',
    descricao:
      'Áreas e lavouras utilizadas na operação agrícola.',
    icon: Building2,
    componente: LavourasManager,
    grupo: 'Agrícola',
  },

  ano_safra: {
    label: 'Ano / Safra',
    descricao:
      'Períodos agrícolas utilizados nas ordens e controles do ERP.',
    icon: Building2,
    componente: AnoSafraManager,
    grupo: 'Agrícola',
  },

  usuarios: {
    label: 'Usuários',
    descricao:
      'Usuários, acessos e permissões do sistema.',
    icon: Users,
    componente: Usuarios,
    grupo: 'Administração',
  },

  mobile_pendentes: {
    label: 'Cadastros Mobile Pendentes',
    descricao: 'Solicitações enviadas pelo celular aguardando aprovação.',
    icon: Smartphone,
    componente: CadastrosMobilePendentes,
    grupo: 'Administração',
  },

  saldo_mobile_pendentes: {
    label: 'Entradas Mobile Pendentes',
    descricao: 'Entradas Manuais de Saldo enviadas pelo celular aguardando revisão.',
    icon: PackagePlus,
    componente: EntradaSaldoMobilePendentes,
    grupo: 'Administração',
  },
};


export default function Cadastros() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobilePendentes, setMobilePendentes] = useState(0);
  const [saldoMobilePendentes, setSaldoMobilePendentes] = useState(0);

  useEffect(() => {
    const podeRevisarCadastros = hasPermission(
      user,
      'admin.cadastros_mobile.revisar'
    );
    const podeRevisarSaldo = hasPermission(
      user,
      'admin.entrada_saldo_mobile.revisar'
    );

    if (!podeRevisarCadastros && !podeRevisarSaldo) {
      setMobilePendentes(0);
      setSaldoMobilePendentes(0);
      return;
    }

    Promise.all([
      podeRevisarCadastros
        ? cadastrosMobileApi.contador()
        : Promise.resolve({ pendentes: 0 }),
      podeRevisarSaldo
        ? entradaSaldoMobileApi.contador()
        : Promise.resolve({ pendentes: 0 }),
    ])
      .then(([cadastros, saldos]) => {
        setMobilePendentes(cadastros.pendentes || 0);
        setSaldoMobilePendentes(saldos.pendentes || 0);
      })
      .catch(() => {
        setMobilePendentes(0);
        setSaldoMobilePendentes(0);
      });
  }, [user]);


  const codigosDisponiveis = useMemo(() => {
    const lista = [
      'pessoas',
      'veiculos',
      'maquinas',
      'produtos',
      'setores',
      'depositos',
      'gavetas',
      'lavouras',
      'ano_safra',
    ];

    if (canAccessUsuarios(user)) {
      lista.push('usuarios');
    }

    if (
      hasPermission(
        user,
        'admin.cadastros_mobile.revisar'
      )
    ) {
      lista.push('mobile_pendentes');
    }

    if (
      hasPermission(
        user,
        'admin.entrada_saldo_mobile.revisar'
      )
    ) {
      lista.push('saldo_mobile_pendentes');
    }

    return lista;
  }, [user]);


  const solicitado =
    searchParams.get('tab');

  const cadastroSelecionado =
    codigosDisponiveis.includes(solicitado)
      ? solicitado
      : 'pessoas';


  const configuracao =
    CADASTROS[cadastroSelecionado]
    || CADASTROS.pessoas;

  const Componente =
    configuracao.componente;

  const Icone =
    configuracao.icon;


  const opcoes = useMemo(
    () =>
      codigosDisponiveis.map((codigo) => ({
        value: codigo,
        label:
          codigo === 'mobile_pendentes' && mobilePendentes > 0
            ? `${CADASTROS[codigo].label} (${mobilePendentes})`
            : codigo === 'saldo_mobile_pendentes' && saldoMobilePendentes > 0
              ? `${CADASTROS[codigo].label} (${saldoMobilePendentes})`
              : CADASTROS[codigo].label,
      })),
    [codigosDisponiveis, mobilePendentes, saldoMobilePendentes]
  );


  const selecionarCadastro = (codigo) => {
    setSearchParams(
      { tab: codigo },
      { replace: false }
    );
  };


  return (
    <div className="cadastros-page">
      <div className="cadastros-shell">

        <main className="cadastros-main">
          <div className="cadastros-mobile-select lg:hidden">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Cadastros
              </p>

              <h1 className="text-base font-semibold">
                Central de dados mestres
              </h1>
            </div>

            <SearchSelect
              value={cadastroSelecionado}
              onChange={selecionarCadastro}
              placeholder="Selecione o cadastro..."
              options={opcoes}
            />
          </div>

          <div className="cadastros-tabs-panel mb-2 hidden rounded-xl border bg-card p-2 shadow-sm lg:block">
            <div className="mb-2 flex items-baseline gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Cadastros
              </p>

              <h1 className="mt-0.5 text-xl font-semibold">
                Central de dados mestres
              </h1>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {codigosDisponiveis.map((codigo) => {
                const cadastro = CADASTROS[codigo];
                const ativo = cadastroSelecionado === codigo;
                const TabIcone = cadastro.icon;

                return (
                  <button
                    key={codigo}
                    type="button"
                    onClick={() => selecionarCadastro(codigo)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      ativo
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background text-foreground hover:border-primary/30 hover:bg-primary/[0.04]',
                    ].join(' ')}
                  >
                    <TabIcone className="h-3.5 w-3.5" />
                    <span>
                      {cadastro.label}
                      {codigo === 'mobile_pendentes' && mobilePendentes > 0
                        ? ` (${mobilePendentes})`
                        : codigo === 'saldo_mobile_pendentes' && saldoMobilePendentes > 0
                          ? ` (${saldoMobilePendentes})`
                          : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>


          <section className="cadastros-content-card">
            <header className="cadastros-content-header">
              <div className="cadastros-content-header__icon">
                <Icone className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <p className="cadastros-content-header__eyebrow">
                  {configuracao.grupo}
                </p>

                <h2 className="cadastros-content-header__title">
                  {configuracao.label}
                  {cadastroSelecionado === 'mobile_pendentes' && mobilePendentes > 0
                    ? ` (${mobilePendentes})`
                    : cadastroSelecionado === 'saldo_mobile_pendentes' && saldoMobilePendentes > 0
                      ? ` (${saldoMobilePendentes})`
                      : ''}
                </h2>

                <p className="cadastros-content-header__description">
                  {configuracao.descricao}
                </p>
              </div>
            </header>

            <div className="cadastros-content">
              <Componente
                {...(
                  cadastroSelecionado === 'saldo_mobile_pendentes'
                    ? { onPendingCountChange: setSaldoMobilePendentes }
                    : {}
                )}
              />
            </div>
          </section>
        </main>

      </div>
    </div>
  );
}
