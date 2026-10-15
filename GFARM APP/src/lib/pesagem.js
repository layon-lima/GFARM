// Utilitários do módulo de Pesagem Rodoviária.
import { api } from '@/api/apiClient';
import { estoqueApi } from '@/api/estoqueClient';
import { parseQtd } from '@/lib/format';
import { convertQtyForProduto } from '@/lib/units';
import {
  construirItensSaida,
  estornarDocumentoAtivoPorOrigem,
} from '@/lib/estoqueOperacoes';
import { invalidateEntidade } from '@/lib/useEntidades';

// Normaliza placa: uppercase, sem hífen/espaços (ex.: "ABC-1234" -> "ABC1234").
export function normalizePlaca(placa) {
  return String(placa || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Formata placa para exibição no padrão Mercosul/antigo conforme o tamanho.
export function formatPlaca(placa) {
  const norm = normalizePlaca(placa);
  if (norm.length === 7) {
    return `${norm.slice(0, 3)}-${norm.slice(3)}`;
  }
  return norm;
}

// Gera o próximo número sequencial de ticket (PES-000001) com base na lista existente.
export function nextTicketNumber(tickets = []) {
  let max = 0;
  tickets.forEach((t) => {
    const m = String(t.numero || '').match(/PES-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return `PES-${String(max + 1).padStart(6, '0')}`;
}

// Gera o próximo número sequencial de pagamento (PAG-000001) com base na lista existente.
export function nextPagamentoNumber(pagamentos = []) {
  let max = 0;
  pagamentos.forEach((p) => {
    const m = String(p.numero || '').match(/PAG-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return `PAG-${String(max + 1).padStart(6, '0')}`;
}

// Gera o próximo número sequencial de pedido (PED-000001) com base na lista existente.
export function nextPedidoNumber(pedidos = []) {
  let max = 0;
  pedidos.forEach((p) => {
    const m = String(p.numero || '').match(/PED-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return `PED-${String(max + 1).padStart(6, '0')}`;
}

// Calcula total em kg: qtd_sacas * peso_saca_kg.
export function calcTotalKg(qtdSacas, pesoSacaKg) {
  return round3(parseQtd(qtdSacas) * parseQtd(pesoSacaKg));
}

// Calcula valor total: qtd_sacas * valor_saca.
export function calcValorTotal(qtdSacas, valorSaca) {
  return round3(parseQtd(qtdSacas) * parseQtd(valorSaca));
}

// Calcula peso líquido: |bruto - tara| (sempre positivo, independente da ordem de pesagem).
export function calcLiquido(bruto, tara) {
  return round3(Math.abs(parseQtd(bruto) - parseQtd(tara)));
}

export function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

// Soma o peso líquido dos tickets vinculados a um pedido.
export function somaLiquidoTickets(tickets = [], pedidoId) {
  return (tickets || [])
    .filter((t) => t.pedido_id === pedidoId)
    .reduce((acc, t) => acc + (Number(t.peso_liquido) || 0), 0);
}

// Define o status do pedido com base no saldo (kg) restante, preservando 'cancelado'.
export function statusPorSaldo(saldoKg, totalKg, statusAtual) {
  if (statusAtual === 'cancelado') return 'cancelado';
  if (statusAtual === 'concluido') return 'concluido';
  const saldo = Number(saldoKg) || 0;
  const total = Number(totalKg) || 0;
  return total > 0 && saldo <= 0 ? 'concluido' : 'aberto';
}

// Formata kg para exibição — sempre em kg (sem converter para toneladas).
export function formatKg(n) {
  const num = Number(n) || 0;
  return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;
}

export function formatMoeda(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Baixa o saldo real (SaldoEstoque — origem da verdade, FEFO quando há lotes)
// do produto vendido ao fechar um ticket de VENDA. Cria a movimentação de
// saída vinculada ao ticket. Autocontida: carrega saldos/lotes/movimentações.
// Retorna { mov, consumidos, totalDisponivel, suficiente }.
// Lança 'DEPOSITO_OBRIGATORIO' quando não houver depósito nem saldo.
export async function baixarEstoqueVendaTicket({
  produto,
  quantidadeKg,
  ticketNumero,
  ticketId,
}) {
  const qtdKg =
    parseQtd(quantidadeKg);

  if (
    !(qtdKg > 0) ||
    !produto?.id
  ) {
    return null;
  }

  const conversao =
    convertQtyForProduto(
      qtdKg,
      'kg',
      produto
    );

  const qtdBase =
    Number(conversao.qtd) || 0;

  if (!(qtdBase > 0)) {
    throw new Error(
      'Quantidade inválida.'
    );
  }

  const origemId =
    String(
      ticketId ||
      ticketNumero ||
      ''
    ).trim();

  if (!origemId) {
    throw new Error(
      'TICKET_SEM_IDENTIFICADOR'
    );
  }

  const alocacao =
    await construirItensSaida({
      produto,
      quantidadeBase:
        qtdBase,
      depositoId:
        produto.deposito_id || '',
      gavetaId:
        produto.gaveta_id || '',
      somenteDeposito: false,
      somenteGaveta: false,
      observacao:
        `Venda — Ticket ${ticketNumero || ''}`,
    });

  if (!alocacao.suficiente) {
    throw new Error(
      `SALDO_INSUFICIENTE:${alocacao.totalDisponivel}`
    );
  }

  const resposta =
    await estoqueApi.movimentar({
      tipo_movimento:
        'SAIDA_CONSUMO',
      origem_modulo:
        'pesagem',
      documento_origem_id:
        origemId,
      referencia_externa:
        ticketNumero || origemId,
      observacao:
        `Venda — Ticket ${ticketNumero || ''}`,
      itens:
        alocacao.itens,
    });

  const documento =
    resposta.documento;

  const consumidos =
    (documento.itens || [])
      .map(
        (item) => ({
          lote_id:
            item.lote_origem_id || '',
          quantidade:
            Number(
              item.quantidade
            ) || 0,
          custo_unitario:
            Number(
              item.custo_unitario
            ) || 0,
        })
      );

  return {
    mov: documento,
    documento,
    consumidos,
    totalDisponivel:
      alocacao.totalDisponivel,
    suficiente: true,
  };
}

// Fecha um ticket de pesagem: atualiza o ticket, o pedido (venda) e baixa o estoque.
export async function fecharTicket({ ticket, pesoBruto, isInverted, liquido, correcaoPesoKg = null, isVenda, pedidoId, transportadoraId, observacao, pedidoSel, clienteNome, transpNome, produtos }) {
  const semLimite = isVenda && pedidoSel?.sem_limite;
  const novoSaldo = (!semLimite && pedidoSel) ? Math.round((Number(pedidoSel.saldo_kg) - liquido) * 1000) / 1000 : (pedidoSel?.saldo_kg || 0);

  const updateData = {
    peso_tara: isInverted ? parseQtd(pesoBruto) : (ticket.peso_tara || 0),
    peso_bruto: isInverted ? (ticket.peso_bruto || 0) : parseQtd(pesoBruto),
    peso_liquido: liquido,
    ...(correcaoPesoKg !== null ? { correcao_peso_kg: parseQtd(correcaoPesoKg) } : {}),
    pedido_id: isVenda ? pedidoId : '',
    produto_id: isVenda && pedidoSel ? pedidoSel.produto_id : (ticket.produto_id || ''),
    cliente_id: isVenda && pedidoSel ? pedidoSel.cliente_id : (ticket.cliente_id || ''),
    cliente_nome: isVenda && pedidoSel ? clienteNome(pedidoSel.cliente_id) : (ticket.cliente_nome || ''),
    transportadora_id: transportadoraId,
    transportadora_nome: transportadoraId ? transpNome(transportadoraId) : (ticket.transportadora_nome || ''),
    status: 'fechado',
    data_fechamento: new Date().toISOString(),
    observacao: observacao || '',
  };

  await api.entities.TicketPesagem.update(ticket.id, updateData);

  const closedTicket = { ...ticket, ...updateData };
  let baixaError = null;

  if (isVenda && pedidoSel) {
    if (!semLimite) {
      await api.entities.PedidoPesagem.update(pedidoId, {
        saldo_kg: novoSaldo,
      });
    }
    const prodVenda = produtos.find((p) => p.id === pedidoSel.produto_id);
    if (prodVenda) {
      try {
        await baixarEstoqueVendaTicket({ produto: prodVenda, quantidadeKg: liquido, ticketNumero: ticket.numero, ticketId: ticket.id });
      } catch (e) {
        baixaError = String(e?.message || e);
      }
    }
  }

  // Invalida caches para a UI refletir imediatamente
  invalidateEntidade('TicketPesagem');
  invalidateEntidade('PedidoPesagem');
  if (isVenda && pedidoSel) {
    invalidateEntidade('SaldoEstoque');
    invalidateEntidade('Movimentacao');
    invalidateEntidade('Lote');
    invalidateEntidade('Produto');
  }

  return { ticket: closedTicket, baixaError };
}

// Ajusta estoque e saldo do pedido ao editar os pesos de um ticket de venda FECHADO:
// estorna a movimentação de saída original (devolvendo estoque/lotes), reajusta o
// saldo do pedido e re-aplica a baixa com o novo peso líquido. Retorna { baixaError }.
export async function ajustarEstoqueVendaTicket({
  ticket,
  novoLiquido,
  produtos,
}) {
  const novoLiq =
    round3(
      Number(novoLiquido) || 0
    );

  const liquidoAntigo =
    round3(
      Number(
        ticket?.peso_liquido
      ) || 0
    );

  let pedido = null;

  if (ticket?.pedido_id) {
    try {
      pedido =
        await api.entities
          .PedidoPesagem
          .get(
            ticket.pedido_id
          );
    } catch {
      pedido = null;
    }
  }

  const origemId =
    String(
      ticket?.id ||
      ticket?.numero ||
      ''
    );

  await estornarDocumentoAtivoPorOrigem({
    origemModulo: 'pesagem',
    documentoOrigemId:
      origemId,
    tipoMovimento:
      'SAIDA_CONSUMO',
    motivo:
      `Reajuste do Ticket ${ticket?.numero || ''}`,
  });

  let baixaError = null;

  const produto =
    (produtos || []).find(
      (p) =>
        p.id === ticket.produto_id
    );

  if (
    produto &&
    novoLiq > 0
  ) {
    try {
      await baixarEstoqueVendaTicket({
        produto,
        quantidadeKg:
          novoLiq,
        ticketNumero:
          ticket.numero,
        ticketId:
          ticket.id,
      });
    } catch (erro) {
      baixaError =
        String(
          erro?.message || erro
        );
    }
  }

  if (
    !baixaError &&
    pedido &&
    !pedido.sem_limite
  ) {
    const novoSaldo =
      round3(
        (
          Number(
            pedido.saldo_kg
          ) || 0
        )
        + liquidoAntigo
        - novoLiq
      );

    await api.entities
      .PedidoPesagem
      .update(
        pedido.id,
        {
          saldo_kg:
            novoSaldo,
        }
      );
  }

  invalidateEntidade(
    'TicketPesagem'
  );
  invalidateEntidade(
    'PedidoPesagem'
  );
  invalidateEntidade(
    'SaldoEstoque'
  );
  invalidateEntidade(
    'Movimentacao'
  );
  invalidateEntidade(
    'Lote'
  );
  invalidateEntidade(
    'Produto'
  );

  return {
    baixaError,
  };
}

// Quebra um ticket em dois quando o peso excede o saldo do pedido original.
// O ticket original é ajustado para fechar o pedido exatamente (liquido = saldo_kg),
// e o excedente vira um novo ticket vinculado ao novo pedido escolhido pelo usuário.
export async function quebrarTicket({ ticket, pesoBruto, isInverted, liquido, pedidoSel, novoPedido, transportadoraId, observacao, clienteNome, transpNome, produtos, tickets }) {
  if (!ticket?.id) throw new Error('Ticket inválido para quebra.');
  const taraRaw = Number(ticket.peso_tara) || 0;
  const brutoRaw = Number(ticket.peso_bruto) || 0;
  const leve = Math.min(taraRaw, brutoRaw);
  const pesada = Math.max(taraRaw, brutoRaw);
  const saldoOriginal = Number(pedidoSel.saldo_kg) || 0;
  const liquidoExcesso = round3(liquido - saldoOriginal);

  // Quebra encadeada: o ticket original mantém a pesagem leve como tara e fecha o
  // pedido exatamente (bruto = leve + saldo consumido, líquido = saldo). O bruto gerado
  // vira a tara do complementar, e a pesagem pesada original vira o bruto dele (líquido = excedente).
  const brutoOriginal = round3(leve + saldoOriginal);

  const pesosOriginal = { peso_tara: leve, peso_bruto: brutoOriginal, peso_liquido: saldoOriginal };
  const pesosNovo = { peso_tara: brutoOriginal, peso_bruto: pesada, peso_liquido: liquidoExcesso };

  const now = new Date().toISOString();
  const transpId = transportadoraId || (pedidoSel.transportadora_ids || '').split(',')[0]?.trim() || '';
  const transpNm = transpId ? transpNome(transpId) : (ticket.transportadora_nome || '');

  // 1. Atualiza o ticket original com os pesos ajustados
  const updateOriginal = {
    ...pesosOriginal,
    pedido_id: pedidoSel.id,
    produto_id: pedidoSel.produto_id,
    cliente_id: pedidoSel.cliente_id,
    cliente_nome: clienteNome(pedidoSel.cliente_id),
    transportadora_id: transpId,
    transportadora_nome: transpNm,
    status: 'fechado',
    data_fechamento: now,
    observacao: observacao || '',
  };
  await api.entities.TicketPesagem.update(ticket.id, updateOriginal);
  const closedOriginal = { ...ticket, ...updateOriginal };

  // 2. Cria o novo ticket complementar — número gerado de uma listagem FRESCA do banco
  //    para evitar colisão com tickets criados concorrentemente (lista em cache pode estar desatualizada).
  let novoNumero;
  try {
    const freshTickets = await api.entities.TicketPesagem.list('-created_date', 200);
    novoNumero = nextTicketNumber(freshTickets);
  } catch {
    novoNumero = nextTicketNumber(tickets || []);
  }
  const novoTicket = await api.entities.TicketPesagem.create({
    numero: novoNumero,
    tipo: 'venda',
    produto_id: pedidoSel.produto_id,
    cliente_id: pedidoSel.cliente_id,
    cliente_nome: clienteNome(pedidoSel.cliente_id),
    transportadora_id: transpId,
    transportadora_nome: transpNm,
    origem: ticket.origem || '',
    destino: ticket.destino || '',
    data_abertura: ticket.data_abertura,
    data_fechamento: now,
    motorista: ticket.motorista,
    placa: ticket.placa,
    ...pesosNovo,
    pedido_id: novoPedido.id,
    status: 'fechado',
    observacao: `complemento do ticket ${ticket.numero}${observacao ? ' — ' + observacao : ''}`,
  });

  // 3. Atualiza os pedidos
  if (!pedidoSel.sem_limite) {
    await api.entities.PedidoPesagem.update(pedidoSel.id, {
      saldo_kg: 0,
      status: 'concluido',
    });
  }
  if (!novoPedido.sem_limite) {
    const novoSaldo = round3((Number(novoPedido.saldo_kg) || 0) - liquidoExcesso);
    await api.entities.PedidoPesagem.update(novoPedido.id, {
      saldo_kg: novoSaldo,
      status: novoSaldo <= 0 ? 'concluido' : 'aberto',
    });
  }

  // 4. Baixa estoque para ambos os tickets
  const prodVenda = produtos.find((p) => p.id === pedidoSel.produto_id);
  let baixaErrorOriginal = null;
  let baixaErrorNovo = null;

  if (prodVenda) {
    try {
      await baixarEstoqueVendaTicket({ produto: prodVenda, quantidadeKg: saldoOriginal, ticketNumero: ticket.numero, ticketId: ticket.id });
    } catch (e) {
      baixaErrorOriginal = String(e?.message || e);
    }
    try {
      await baixarEstoqueVendaTicket({ produto: prodVenda, quantidadeKg: liquidoExcesso, ticketNumero: novoNumero, ticketId: novoTicket.id });
    } catch (e) {
      baixaErrorNovo = String(e?.message || e);
    }
  }

  invalidateEntidade('TicketPesagem');
  invalidateEntidade('PedidoPesagem');
  invalidateEntidade('SaldoEstoque');
  invalidateEntidade('Movimentacao');
  invalidateEntidade('Lote');
  invalidateEntidade('Produto');

  return { ticketOriginal: closedOriginal, ticketNovo: novoTicket, baixaErrorOriginal, baixaErrorNovo };
}

// Vincula um ticket FECHADO a um pedido aberto DO MESMO PRODUTO, acessível a
// partir do modal de detalhe do ticket no histórico.
// - Se o ticket JÁ É 'venda' (fechado sem pedido): apenas vincula e consome o
//   saldo do pedido. O estoque já foi baixado no fechamento — NÃO baixa de novo.
// - Se o ticket NÃO É 'venda' (lavoura/compra/entrada_saida): converte para
//   'venda' (tipo, produto, cliente e transportadora do pedido), consome o
//   saldo do pedido e BAIXA o estoque agora. Tipos não-venda não baixam estoque
//   no fechamento, então a baixa acontece uma única vez aqui (sem furo/dupla baixa).
// Retorna { ticket: updatedTicket, baixaError, convertidoDe }.
export async function vincularConverterTicket({ ticket, pedido, produtos, clienteNome, transpNome }) {
  if (!ticket?.id || !pedido?.id) throw new Error('Ticket ou pedido inválido.');
  const liq = round3(Number(ticket.peso_liquido) || 0);
  const tipoOriginal = ticket.tipo || '';
  const jaVenda = tipoOriginal === 'venda';
  const semLimite = !!pedido.sem_limite;

  const transpId = ticket.transportadora_id || (pedido.transportadora_ids || '').split(',')[0]?.trim() || '';

  const updateTicket = {
    pedido_id: pedido.id,
    produto_id: pedido.produto_id,
    cliente_id: pedido.cliente_id,
    cliente_nome: clienteNome(pedido.cliente_id),
    transportadora_id: transpId,
    transportadora_nome: transpId ? transpNome(transpId) : (ticket.transportadora_nome || ''),
  };
  if (!jaVenda) updateTicket.tipo = 'venda';

  // 1. Atualiza o ticket (vincula + converte o tipo quando necessário)
  await api.entities.TicketPesagem.update(ticket.id, updateTicket);
  const updatedTicket = { ...ticket, ...updateTicket };

  // 2. Consome o saldo do pedido (pedidos "sem limite" não debitam)
  if (!semLimite) {
    const novoSaldo = round3((Number(pedido.saldo_kg) || 0) - liq);
    await api.entities.PedidoPesagem.update(pedido.id, {
      saldo_kg: novoSaldo,
      status: statusPorSaldo(novoSaldo, pedido.total_kg, pedido.status),
    });
  }

  // 3. Baixa o estoque SOMENTE na conversão (não-venda → venda).
  //    Venda já baixou no fechamento; converter uma venda só reorganiza o pedido.
  let baixaError = null;
  if (!jaVenda && liq > 0) {
    const produto = (produtos || []).find((p) => p.id === pedido.produto_id);
    if (produto) {
      try {
        await baixarEstoqueVendaTicket({ produto, quantidadeKg: liq, ticketNumero: ticket.numero, ticketId: ticket.id });
      } catch (e) {
        baixaError = String(e?.message || e);
      }
    } else {
      baixaError = 'PRODUTO_NAO_ENCONTRADO';
    }
  }

  invalidateEntidade('TicketPesagem');
  invalidateEntidade('PedidoPesagem');
  if (!jaVenda) {
    invalidateEntidade('SaldoEstoque');
    invalidateEntidade('Movimentacao');
    invalidateEntidade('Lote');
    invalidateEntidade('Produto');
  }

  return { ticket: updatedTicket, baixaError, convertidoDe: jaVenda ? null : tipoOriginal };
}