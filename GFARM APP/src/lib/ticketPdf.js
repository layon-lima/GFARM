// Geração do Ticket de Pesagem em PDF — layout leve e simples, um ticket por folha A4.
// jsPDF é carregado sob demanda (import dinâmico) só ao gerar o documento.
const TIPO_LABEL = { venda: 'VENDA', lavoura: 'SAÍDA P/ LAVOURA', compra: 'ENTRADA POR COMPRA', entrada_saida: 'ENTRADA E SAÍDA', avulsa: 'AVULSA' };

const INK = [0, 0, 0];
const MUTED = [130, 130, 130];
const LINE = [210, 210, 210];

// --- Helpers de formatação ---
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtNum(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}
function fmtHoraCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Extração do logo (image1.jpg) embutido no xlsx, feita no navegador ---
async function loadSheetLogo() { return null; }

// --- Logo vetorial (fallback) ---
const SUN = [255, 179, 0];
const HILL_DARK = [46, 125, 50];
const HILL_LIGHT = [102, 187, 106];
const HAND = [93, 64, 55];
function drawLogo(doc, cx, cy, r) {
  doc.setFillColor(...SUN); doc.circle(cx, cy, r, 'F');
  doc.setFillColor(...HILL_DARK);
  doc.circle(cx - r * 0.18, cy + r * 0.95, r * 0.78, 'F');
  doc.circle(cx + r * 0.45, cy + r * 0.95, r * 0.7, 'F');
  doc.setFillColor(...HILL_LIGHT);
  doc.circle(cx + r * 0.08, cy + r * 0.85, r * 0.62, 'F');
  doc.setFillColor(255, 255, 255); doc.circle(cx, cy + r * 1.22, r * 0.8, 'F');
  doc.setFillColor(...HAND); doc.circle(cx, cy + r * 1.22, r * 0.74, 'F');
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

// --- Primitivas leves ---
function hline(doc, x1, x2, y, color = LINE, w = 0.2) {
  doc.setDrawColor(...color); doc.setLineWidth(w);
  doc.line(x1, y, x2, y);
}
function text(doc, x, y, str, { size = 11, bold = false, color = INK, align = 'left' } = {}) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(String(str), x, y, { align });
}

function drawTicket(doc, ticket, ctx, logoImg) {
  const { pedido, produtoNome, clienteNome } = ctx;
  const tipo = TIPO_LABEL[ticket.tipo] || 'AVULSA';
  const dataTxt = fmtDateTime(ticket.data_fechamento || ticket.data_abertura);

  const ML = 16, MR = 16, LW = 210 - ML - MR; // margens e largura útil
  const UNI = 13; // tamanho unificado de rótulos e valores (preto)

  // Fundo branco
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 297, 'F');

  // ===== Cabeçalho: logo + título =====
  const logoX = ML, logoY = 12, logoSize = 22;
  if (logoImg) {
    const iw = logoImg.naturalWidth || logoImg.width;
    const ih = logoImg.naturalHeight || logoImg.height;
    if (iw && ih) {
      const s = Math.min(logoSize / iw, logoSize / ih);
      const w = iw * s, h = ih * s;
      doc.addImage(logoImg, 'JPEG', logoX + (logoSize - w) / 2, logoY + (logoSize - h) / 2, w, h);
    }
  } else {
    drawLogo(doc, logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 - 2);
  }

  text(doc, ML + logoSize + 7, logoY + 9, 'NOVO HORIZONTE', { size: 14, bold: true });
  text(doc, ML + logoSize + 7, logoY + 16, 'TICKET DE PESAGEM', { size: 10, color: MUTED });

  // Rótulo do tipo à direita
  text(doc, 210 - MR, logoY + 9, tipo, { size: 13, bold: true, align: 'right' });

  // Linha de separação do cabeçalho
  hline(doc, ML, 210 - MR, logoY + logoSize + 3);

  // ===== Número =====
  let y = logoY + logoSize + 12;
  text(doc, ML, y, 'Nº', { size: UNI, bold: true, color: INK });
  text(doc, ML + 12, y, ticket.numero || '—', { size: UNI, bold: true, color: INK });
  hline(doc, ML, 210 - MR, y + 3);

  // ===== Linhas de informação (rótulo e valor no mesmo tamanho/cor preta) =====
  const labelX = ML;
  const valueX = ML + 44;
  function infoRow(label, value, opts = {}) {
    y += opts.gap || 12;
    text(doc, labelX, y, label, { size: UNI, bold: true, color: INK });
    // Valor posicionado depois do rótulo (com folga mínima), evitando sobreposição mesmo em rótulos longos.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(UNI);
    const labelW = doc.getTextWidth(label);
    const vx = Math.max(valueX, labelX + labelW + 4);
    text(doc, vx, y, value, { size: UNI, bold: true, color: INK });
    hline(doc, ML, 210 - MR, y + 3);
  }

  infoRow('MOTORISTA', ticket.motorista || '—');
  infoRow('PLACA', (ticket.placa || '—').toUpperCase());
  infoRow('PRODUTO', resolveProduto(ticket, pedido, produtoNome));
  infoRow('CLIENTE', resolveCliente(ticket, pedido, clienteNome));
  infoRow('TRANSPORTADORA', ticket.transportadora_nome || (pedido ? pedido.transportadora_nomes : '') || '—');
  infoRow('DATA - HORA', dataTxt);

  // Horários de pesagem (tara = abertura, bruto = fechamento)
  const horaTara = ticket.data_abertura ? fmtHoraCurta(ticket.data_abertura) : '—';
  const horaBruto = ticket.data_fechamento ? fmtHoraCurta(ticket.data_fechamento) : '—';

  // ===== Pesos: três caixas compactas =====
  y += 12;
  const boxW = (LW - 8) / 3;
  const boxes = [
    { label: '1ª PESAGEM (kg)', val: ticket.peso_tara, hora: horaTara },
    { label: '2ª PESAGEM (kg)', val: ticket.peso_bruto, hora: horaBruto },
    { label: 'LÍQUIDO (kg)', val: ticket.peso_liquido, hora: null },
  ];
  boxes.forEach((b, i) => {
    const bx = ML + i * (boxW + 4);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
    doc.roundedRect(bx, y - 8, boxW, 30, 2, 2, 'S');
    text(doc, bx + boxW / 2, y - 2, b.label, { size: UNI, bold: true, color: INK, align: 'center' });
    text(doc, bx + boxW / 2, y + 14, fmtNum(b.val), { size: 22, bold: true, color: INK, align: 'center' });
    if (b.hora) text(doc, bx + boxW / 2, y + 20, b.hora, { size: 8, color: MUTED, align: 'center' });
  });

  // ===== Observações (consolida observação + origem + destino, se houver) =====
  const obsParts = [];
  if (ticket.observacao && ticket.observacao.trim()) obsParts.push(ticket.observacao.trim());
  if (ticket.origem && String(ticket.origem).trim()) obsParts.push(`Origem: ${String(ticket.origem).trim()}`);
  if (ticket.destino && String(ticket.destino).trim()) obsParts.push(`Destino: ${String(ticket.destino).trim()}`);
  if (obsParts.length) {
    y += 28;
    text(doc, ML, y, 'Observações', { size: UNI, bold: true, color: INK });
    hline(doc, ML, 210 - MR, y + 3, LINE, 0.2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...INK);
    const obsLines = doc.splitTextToSize(obsParts.join('\n'), LW);
    doc.text(obsLines.slice(0, 4), ML, y + 9);
  }

  // ===== Assinaturas (agrupadas na parte superior) =====
  const sigY = y + 40;
  doc.setDrawColor(...INK); doc.setLineWidth(0.3);
  doc.line(ML + 6, sigY, ML + 80, sigY);
  doc.line(210 - MR - 80, sigY, 210 - MR - 6, sigY);
  text(doc, ML + 43, sigY + 4, 'Assinatura do Motorista', { size: 9, color: INK, align: 'center' });
  text(doc, 210 - MR - 43, sigY + 4, 'Assinatura do Balanceiro', { size: 9, color: INK, align: 'center' });
}

/**
 * Gera o PDF do ticket (aberto ou fechado) — uma folha A4 por ticket.
 * @param {object} ticket
 * @param {object} ctx - { pedido, produtoNome, clienteNome }
 * @param {object} opts - { print: true } abre impressão; senão baixa o arquivo.
 */
export async function gerarTicketPDF(ticket, ctx = {}, opts = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logoImg = await loadSheetLogo();
  drawTicket(doc, ticket, ctx, logoImg);
  if (opts.print) {
    doc.autoPrint();
    const url = doc.output('bloburl');
    window.open(url, '_blank');
  } else {
    doc.save(`Ticket-${(ticket.numero || 'pesagem').replace(/[^a-zA-Z0-9-]/g, '')}.pdf`);
  }
}