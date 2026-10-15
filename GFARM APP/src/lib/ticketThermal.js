// Impressão de ticket em impressoras térmicas (cupom 80mm/58mm).
// Gera um HTML de reciboo estreito e dispara window.print() — a impressora
// térmica aparece como uma impressora normal no diálogo do navegador.
const TIPO_LABEL = { venda: 'VENDA', lavoura: 'SAÍDA P/ LAVOURA', compra: 'ENTRADA POR COMPRA', entrada_saida: 'ENTRADA E SAÍDA', avulsa: 'AVULSA' };

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtNum(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function resolveProduto(ticket, pedido, produtoNome) {
  if (ticket.produto_id && produtoNome) return produtoNome(ticket.produto_id) || '—';
  if (ticket.tipo === 'venda' && pedido && produtoNome) return produtoNome(pedido.produto_id) || '—';
  return '—';
}
function resolveCliente(ticket, pedido, clienteNome) {
  if (ticket.cliente_nome) return ticket.cliente_nome;
  if (ticket.cliente_id && clienteNome) return clienteNome(ticket.cliente_id) || '—';
  if (ticket.tipo === 'venda' && pedido && clienteNome) return clienteNome(pedido.cliente_id) || '—';
  return '—';
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Abre o diálogo de impressão com um cupom térmico (80mm).
 * @param {object} ticket
 * @param {object} ctx - { pedido, produtoNome, clienteNome }
 */
export async function imprimirTicketTermico(ticket, ctx = {}) {
  const { pedido, produtoNome, clienteNome } = ctx;
  const tipo = TIPO_LABEL[ticket.tipo] || 'AVULSA';
  const dataTxt = fmtDateTime(ticket.data_fechamento || ticket.data_abertura);
  const horaTara = ticket.data_abertura ? fmtHora(ticket.data_abertura) : '—';
  const horaBruto = ticket.data_fechamento ? fmtHora(ticket.data_fechamento) : '—';

  const obsParts = [];
  if (ticket.observacao && ticket.observacao.trim()) obsParts.push(ticket.observacao.trim());
  if (ticket.origem && String(ticket.origem).trim()) obsParts.push(`Origem: ${String(ticket.origem).trim()}`);
  if (ticket.destino && String(ticket.destino).trim()) obsParts.push(`Destino: ${String(ticket.destino).trim()}`);

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Ticket ${esc(ticket.numero || '')}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { width: 80mm; margin: 0; padding: 3mm 4mm; font-family: 'Courier New', ui-monospace, monospace; color:#000; font-size: 12px; line-height: 1.35; -webkit-print-color-adjust: exact; }
.center { text-align: center; }
.right { text-align: right; }
.bold { font-weight: 700; }
.lg { font-size: 16px; }
.xl { font-size: 26px; letter-spacing: 1px; }
.muted { color:#333; }
.head { border-bottom: 1px dashed #000; padding-bottom: 3px; margin-bottom: 4px; }
.row { display:flex; justify-content: space-between; gap: 6px; }
.lbl { font-weight: 700; }
.divider { border-top: 1px dashed #000; margin: 4px 0; }
.weights { display:flex; justify-content: space-between; gap: 4px; margin: 4px 0; }
.box { flex:1; border:1px solid #000; padding: 2px 1px; text-align:center; }
.box .v { font-size: 17px; font-weight: 700; }
.box .h { font-size: 9px; color:#333; }
.sign { margin-top: 14px; }
.sign .line { border-top:1px solid #000; width: 90%; margin: 0 auto 2px; }
.siggrid { display:flex; justify-content: space-between; gap: 8px; margin-top: 16px; }
.sigcell { flex:1; text-align:center; }
.sigcell .line { border-top:1px solid #000; margin-bottom: 2px; }
.foot { margin-top: 6px; }
@page { margin: 3mm 2mm; }
@media print { body { width:auto; } }
</style></head><body>
<div class="center head">
  <div class="bold lg">NOVO HORIZONTE</div>
  <div>TICKET DE PESAGEM</div>
</div>
<div class="row bold"><span>${esc(tipo)}</span><span>Nº ${esc(ticket.numero || '—')}</span></div>
<div class="divider"></div>
<div class="row"><span class="lbl">Motorista:</span><span>${esc(ticket.motorista || '—')}</span></div>
<div class="row"><span class="lbl">Placa:</span><span>${esc((ticket.placa || '—').toUpperCase())}</span></div>
<div class="row"><span class="lbl">Produto:</span><span style="text-align:right">${esc(resolveProduto(ticket, pedido, produtoNome))}</span></div>
<div class="row"><span class="lbl">Cliente:</span><span style="text-align:right">${esc(resolveCliente(ticket, pedido, clienteNome))}</span></div>
<div class="row"><span class="lbl">Transp.:</span><span style="text-align:right">${esc(ticket.transportadora_nome || (pedido ? pedido.transportadora_nomes : '') || '—')}</span></div>
<div class="row"><span class="lbl">Data/Hora:</span><span>${esc(dataTxt)}</span></div>
<div class="divider"></div>
<div class="weights">
  <div class="box"><div class="h">1ª PES.</div><div class="v">${fmtNum(ticket.peso_tara)}</div><div class="h">${esc(horaTara)}</div></div>
  <div class="box"><div class="h">2ª PES.</div><div class="v">${fmtNum(ticket.peso_bruto)}</div><div class="h">${esc(horaBruto)}</div></div>
  <div class="box"><div class="h">LÍQUIDO</div><div class="v" style="font-size:19px">${fmtNum(ticket.peso_liquido)}</div><div class="h">&nbsp;</div></div>
</div>
${obsParts.length ? `<div class="divider"></div><div class="lbl">Obs:</div><div>${esc(obsParts.join(' · '))}</div>` : ''}
<div class="siggrid">
  <div class="sigcell"><div class="line"></div><div class="h">Motorista</div></div>
  <div class="sigcell"><div class="line"></div><div class="h">Balanceiro</div></div>
</div>
<div class="center foot h">Controle interno · Novo Horizonte</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) {
    throw new Error('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-up.');
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Aguarda o carregamento antes de imprimir.
  w.onload = () => {
    setTimeout(() => {
      w.focus();
      w.print();
      // Mantém a janela aberta caso o usuário cancele; fecha ao confirmar impressão.
      setTimeout(() => { try { w.close(); } catch (_) {} }, 300);
    }, 150);
  };
}