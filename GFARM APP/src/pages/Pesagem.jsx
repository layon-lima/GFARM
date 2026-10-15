import { useCallback, useState } from 'react';
import {
  ClipboardList,
  Scale,
  Wallet,
} from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useAuth } from '@/lib/AuthContext';
import { useEntidades } from '@/lib/useEntidades';
import PedidosManager from '@/components/pesagem/PedidosManager';
import TicketsManager from '@/components/pesagem/TicketsManager';
import PagamentosManager from '@/components/pesagem/PagamentosManager';

const CORE_CONFIG = {
  Pessoa: { sort: '-created_date', limit: 500 },
  Produto: {},
  PedidoPesagem: { sort: '-created_date', limit: 500 },
  TicketPesagem: { sort: '-data_abertura', limit: 500 },
};

const FINANCE_CONFIG = {
  Pagamento: { sort: '-data_pagamento', limit: 500 },
};

function InlineLoader({ label }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border bg-muted/10 py-12 text-sm text-muted-foreground">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span>{label}</span>
    </div>
  );
}

export default function Pesagem() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState('tickets');
  const [pedidoParaTicket, setPedidoParaTicket] = useState('');

  /*
   * A abertura da Pesagem carrega somente o núcleo usado por Tickets.
   * Pagamentos só é consultado quando Pedidos ou Pagamentos forem abertos.
   *
   * Isso preserva os mesmos dados/limites já usados pelo sistema, mas evita
   * bloquear a tela inicial esperando uma entidade que Tickets não utiliza.
   */
  const {
    data: coreData,
    loading: coreLoading,
    reload: reloadCore,
  } = useEntidades(CORE_CONFIG);

  const precisaFinanceiro =
    tab === 'pedidos' || tab === 'pagamentos';

  const {
    data: financeData,
    loading: financeLoading,
    reload: reloadFinance,
  } = useEntidades(
    precisaFinanceiro
      ? FINANCE_CONFIG
      : {}
  );

  const {
    Pessoa: pessoas = [],
    Produto: produtos = [],
    PedidoPesagem: pedidos = [],
    TicketPesagem: tickets = [],
  } = coreData;

  const {
    Pagamento: pagamentos = [],
  } = financeData;

  const transportadoras = pessoas.filter(
    (p) => p.is_transportadora
  );

  const abertosCount = tickets.filter(
    (t) => t.status === 'aberto'
  ).length;

  const reloadPedidos = useCallback(() => {
    reloadCore();
    reloadFinance();
  }, [reloadCore, reloadFinance]);

  function gerarTicketVenda(pedido) {
    setPedidoParaTicket(pedido.id);
    setTab('tickets');
  }

  return (
    <div className="w-full min-w-0 space-y-3 p-3 lg:px-4 xl:px-5">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
            <Scale className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
            Pesagem Rodoviária
          </h1>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="tickets" className="gap-1.5">
            <Scale className="h-4 w-4" />
            Tickets

            {abertosCount > 0 && (
              <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {abertosCount}
              </span>
            )}
          </TabsTrigger>

          <TabsTrigger value="pedidos" className="gap-1.5">
            <ClipboardList className="h-4 w-4" />
            Pedidos
          </TabsTrigger>

          <TabsTrigger value="pagamentos" className="gap-1.5">
            <Wallet className="h-4 w-4" />
            Pagamentos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="mt-4">
          {coreLoading ? (
            <InlineLoader label="Carregando dados da pesagem..." />
          ) : (
            <TicketsManager
              tickets={tickets}
              pedidos={pedidos}
              pessoas={pessoas}
              produtos={produtos}
              transportadoras={transportadoras}
              onReload={reloadCore}
              isAdmin={isAdmin}
              initialPedidoId={pedidoParaTicket}
              onInitialPedidoConsumed={() =>
                setPedidoParaTicket('')
              }
            />
          )}
        </TabsContent>

        <TabsContent value="pedidos" className="mt-2">
          {coreLoading || financeLoading ? (
            <InlineLoader label="Carregando pedidos de venda..." />
          ) : (
            <PedidosManager
              pedidos={pedidos}
              pessoas={pessoas}
              produtos={produtos}
              tickets={tickets}
              transportadoras={transportadoras}
              pagamentos={pagamentos}
              onReload={reloadPedidos}
              isAdmin={isAdmin}
              onGerarTicketVenda={gerarTicketVenda}
            />
          )}
        </TabsContent>

        <TabsContent value="pagamentos" className="mt-2">
          {coreLoading || financeLoading ? (
            <InlineLoader label="Carregando pagamentos..." />
          ) : (
            <PagamentosManager
              pagamentos={pagamentos}
              pedidos={pedidos}
              pessoas={pessoas}
              produtos={produtos}
              tickets={tickets}
              onReload={reloadFinance}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
