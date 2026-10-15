import { jsPDF } from 'jspdf';
import { api } from '@/api/apiClient';

// Trunca texto longo com "…" quando não cabe mesmo no tamanho mínimo de fonte.
function fitText(doc, value, maxWidth) {
  const text = String(value ?? '');
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && doc.getTextWidth(t + '…') > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length > 0 ? t + '…' : '';
}

/**
 * Desenha uma célula reduzindo a fonte para caber — nunca trunca valores monetários/numéricos.
 * Textos muito longos (nomes) são truncados com "…" apenas no último recurso.
 */
function drawCell(doc, value, colStart, colWidth, yText, baseFontSize, align) {
  const text = String(value ?? '');
  if (!text) return;
  const padding = 1.5;
  const maxW = colWidth - padding * 2;

  doc.setFontSize(baseFontSize);
  let w = doc.getTextWidth(text);
  let fs = baseFontSize;
  while (w > maxW && fs > 5) {
    fs -= 0.5;
    doc.setFontSize(fs);
    w = doc.getTextWidth(text);
  }

  const txt = w > maxW ? fitText(doc, text, maxW) : text;
  if (align === 'right') {
    doc.text(txt, colStart + colWidth - padding, yText, { align: 'right' });
  } else {
    doc.text(txt, colStart + padding, yText);
  }
  doc.setFontSize(baseFontSize);
}

function gerarPDFDoc(titulo, colunas, linhas) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;

  // Cabeçalho do documento
  doc.setFontSize(14);
  doc.setTextColor(34, 139, 87);
  doc.text(titulo, margin, 13);
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, 18);

  const baseFontSize = 7;
  const headerHeight = 6;
  const rowHeight = 5; // Compacto verticalmente
  const minColW = 16;
  const maxColW = 65;

  // Calcula larguras com base no conteúdo, com piso e teto por coluna.
  doc.setFontSize(baseFontSize);
  const contentWidths = colunas.map((col, ci) => {
    let maxW = doc.getTextWidth(String(col));
    linhas.forEach((linha) => {
      const w = doc.getTextWidth(String(linha[ci] ?? ''));
      if (w > maxW) maxW = w;
    });
    return Math.min(Math.max(maxW + 3, minColW), maxColW);
  });

  // Distribui o espaço: se cabe com folga, expande proporcionalmente; se excede, escala.
  const totalContent = contentWidths.reduce((a, b) => a + b, 0);
  let finalWidths;
  if (totalContent <= usableWidth) {
    const extra = usableWidth - totalContent;
    finalWidths = contentWidths.map((w) => w + (extra * w) / totalContent);
  } else {
    const scale = usableWidth / totalContent;
    finalWidths = contentWidths.map((w) => w * scale);
  }

  // Colunas numéricas/monetárias → alinhamento à direita
  const rightAlignCols = new Set();
  colunas.forEach((col, ci) => {
    if (/peso|valor|r\$|kg|qtd|total|saldo/i.test(col)) rightAlignCols.add(ci);
  });

  const tableW = finalWidths.reduce((a, b) => a + b, 0);
  let y = 24;
  const startX = margin;

  function drawHeader() {
    doc.setFillColor(34, 139, 87);
    doc.rect(startX, y, tableW, headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(baseFontSize);
    let x = startX;
    colunas.forEach((col, i) => {
      drawCell(doc, col, x, finalWidths[i], y + headerHeight - 2, baseFontSize, rightAlignCols.has(i) ? 'right' : 'left');
      x += finalWidths[i];
    });
    y += headerHeight;
  }

  drawHeader();

  doc.setFont(undefined, 'normal');
  doc.setTextColor(40, 40, 40);
  let rowIndex = 0;

  linhas.forEach((linha) => {
    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin + 5;
      drawHeader();
      doc.setFont(undefined, 'normal');
      doc.setTextColor(40, 40, 40);
    }

    const tipoCell = String(linha[2] ?? '');
    const isSubtotal = tipoCell.includes('Subtotal');
    const isTotal = tipoCell.includes('TOTAL');
    const isEmpty = linha.every((c) => !String(c ?? '').trim());

    // 1) Fundo da linha
    if (isTotal) {
      doc.setFillColor(218, 240, 228);
      doc.rect(startX, y, tableW, rowHeight, 'F');
    } else if (isSubtotal) {
      doc.setFillColor(238, 246, 241);
      doc.rect(startX, y, tableW, rowHeight, 'F');
    } else if (!isEmpty && rowIndex % 2 === 0) {
      doc.setFillColor(248, 251, 249);
      doc.rect(startX, y, tableW, rowHeight, 'F');
    }

    // 2) Bordas (verticais + base) — desenhadas ANTES do texto para não cortar dados
    doc.setDrawColor(210, 216, 210);
    doc.setLineWidth(0.1);
    let x = startX;
    colunas.forEach((_, i) => {
      doc.line(x, y, x, y + rowHeight);
      x += finalWidths[i];
    });
    doc.line(x, y, x, y + rowHeight); // borda direita
    doc.line(startX, y + rowHeight, startX + tableW, y + rowHeight); // borda inferior

    // 3) Texto — desenhado POR CIMA das bordas
    if (isSubtotal || isTotal) {
      doc.setFont(undefined, 'bold');
    } else {
      doc.setFont(undefined, 'normal');
    }

    x = startX;
    linha.forEach((cell, ci) => {
      drawCell(doc, cell, x, finalWidths[ci], y + rowHeight - 1.5, baseFontSize, rightAlignCols.has(ci) ? 'right' : 'left');
      x += finalWidths[ci];
    });

    y += rowHeight;
    rowIndex++;
  });

  return doc.output('blob');
}

const sanitizeFilename = (titulo) =>
  `${titulo}`.replace(/[^\w\- ]/g, '').trim() || 'relatorio';

/**
 * Envia o arquivo para o storage do API local e devolve a URL pública.
 * No app nativo (APK/WebView) o download via anchor não funciona, então
 * usamos a URL hospedada para abrir no navegador do sistema ou compartilhar.
 */
async function uploadToStorage(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const { file_url } = await api.integrations.Core.UploadFile({ file });
  if (!file_url) throw new Error('Não foi possível obter a URL do arquivo.');
  return file_url;
}

/** Abre a URL no navegador do sistema (download/visualização). */
function openExternally(url) {
  const win = window.open(url, '_blank');
  if (!win) window.location.href = url;
}

/**
 * Abre a folha de compartilhamento nativa do celular com o link do PDF.
 * Usa a Web Share API (navigator.share), que abre o menu nativo de
 * compartilhamento em APKs baseados em Chrome/TWA e na maioria dos celulares.
 * Se não houver suporte, abre o PDF no navegador do sistema como fallback.
 */
async function shareUrl(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title}\n${url}`, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // usuário cancelou
    }
  }
  openExternally(url);
}

/** Gera e baixa o PDF. No APK, envia ao storage e abre no navegador do sistema. */
export async function exportPDF(titulo, colunas, linhas) {
  const blob = gerarPDFDoc(titulo, colunas, linhas);
  const filename = `${sanitizeFilename(titulo)}.pdf`;
  const file = new File([blob], filename, { type: 'application/pdf' });

  // Mobile browser / PWA com Web Share API de arquivo
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: titulo });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }

  // Desktop: download direto via anchor
  const isDesktop = window.matchMedia?.('(pointer: fine)')?.matches && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  if (isDesktop) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }

  // APK / WebView: envia ao storage e abre a URL externamente
  const file_url = await uploadToStorage(blob, filename);
  openExternally(file_url);
}

/** Abre a folha de compartilhamento nativa do celular com o link do PDF. */
export async function sharePDF(titulo, colunas, linhas) {
  const blob = gerarPDFDoc(titulo, colunas, linhas);
  const filename = `${sanitizeFilename(titulo)}.pdf`;
  const file_url = await uploadToStorage(blob, filename);
  await shareUrl(file_url, titulo);
}

export function exportCSV(titulo, colunas, linhas) {
  const DELIM = ';';
  const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const csv = [
    colunas.map(escape).join(DELIM),
    ...linhas.map((linha) => linha.map(escape).join(DELIM)),
  ].join('\r\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${titulo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Gera um arquivo Excel real (.xls SpreadsheetML) com uma planilha.
 * Células numéricas (passadas como number) viram Number no Excel; demais como String.
 * Entrega igual ao PDF: Web Share no mobile, download direto no desktop, upload+abertura no APK.
 */
export async function exportExcel(titulo, colunas, linhas, opts = {}) {
  const sheet = (opts.sheetName || sanitizeFilename(titulo)).slice(0, 31) || 'Relatorio';
  const columnTypes = Array.isArray(opts.columnTypes) ? opts.columnTypes : [];
  const metadata = Array.isArray(opts.metadata) ? opts.metadata : [];

  const styles = `
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Aptos" ss:Size="10"/>
    </Style>
    <Style ss:ID="head">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#0F6B50" ss:Pattern="Solid"/>
      <Alignment ss:Vertical="Center"/>
    </Style>
    <Style ss:ID="number"><NumberFormat ss:Format="#,##0.000"/></Style>
    <Style ss:ID="currency"><NumberFormat ss:Format="R$ #,##0.00"/></Style>
    <Style ss:ID="date"><NumberFormat ss:Format="dd/mm/yyyy"/></Style>
    <Style ss:ID="datetime"><NumberFormat ss:Format="dd/mm/yyyy hh:mm"/></Style>
    <Style ss:ID="metaLabel"><Font ss:Bold="1"/></Style>
  `;

  const normalizeDate = (value, withTime) => {
    if (value == null || value === '') return null;

    if (!withTime && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return `${value.slice(0, 10)}T00:00:00.000`;
    }

    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    if (withTime) return d.toISOString().replace(/\.\d{3}Z$/, '.000');

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T00:00:00.000`;
  };

  const cellXml = (cell, ci) => {
    const declared = columnTypes[ci] || null;

    if ((declared === 'number' || declared === 'currency') && cell !== '' && cell != null) {
      const n = Number(cell);
      if (Number.isFinite(n)) {
        const style = declared === 'currency' ? 'currency' : 'number';
        return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${n}</Data></Cell>`;
      }
    }

    if (declared === 'boolean') {
      const label = cell === true || cell === 'true' || cell === 1 ? 'Sim' : 'Não';
      return `<Cell><Data ss:Type="String">${escXml(label)}</Data></Cell>`;
    }

    if (declared === 'date' || declared === 'datetime') {
      const iso = normalizeDate(cell, declared === 'datetime');
      if (iso) {
        return `<Cell ss:StyleID="${declared}"><Data ss:Type="DateTime">${iso}</Data></Cell>`;
      }
    }

    if (typeof cell === 'number' && isFinite(cell)) {
      return `<Cell ss:StyleID="number"><Data ss:Type="Number">${cell}</Data></Cell>`;
    }

    return `<Cell><Data ss:Type="String">${escXml(cell)}</Data></Cell>`;
  };

  const widths = colunas.map((col, ci) => {
    let maxLen = String(col || '').length;
    for (const row of linhas || []) {
      maxLen = Math.max(maxLen, String(row?.[ci] ?? '').length);
      if (maxLen >= 42) break;
    }
    const width = Math.min(260, Math.max(70, maxLen * 7.2));
    return `<Column ss:AutoFitWidth="0" ss:Width="${width.toFixed(0)}"/>`;
  }).join('');

  const header = `<Row ss:Height="22">${colunas
    .map((c) => `<Cell ss:StyleID="head"><Data ss:Type="String">${escXml(c)}</Data></Cell>`)
    .join('')}</Row>`;

  const body = (linhas || [])
    .map((linha) => `<Row>${linha.map((cell, ci) => cellXml(cell, ci)).join('')}</Row>`)
    .join('');

  const metaSheet = metadata.length
    ? `<Worksheet ss:Name="Parametros"><Table>
        <Column ss:Width="150"/><Column ss:Width="320"/>
        <Row><Cell ss:StyleID="head"><Data ss:Type="String">Parâmetro</Data></Cell><Cell ss:StyleID="head"><Data ss:Type="String">Valor</Data></Cell></Row>
        ${metadata.map(([label, value]) => `<Row><Cell ss:StyleID="metaLabel"><Data ss:Type="String">${escXml(label)}</Data></Cell><Cell><Data ss:Type="String">${escXml(value)}</Data></Cell></Row>`).join('')}
      </Table>
      <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/></WorksheetOptions>
    </Worksheet>`
    : '';

  const lastRow = Math.max(1, (linhas || []).length + 1);
  const lastCol = Math.max(1, colunas.length);

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:x="urn:schemas-microsoft-com:office:excel">\n` +
    `<Styles>${styles}</Styles>\n` +
    `<Worksheet ss:Name="${escXml(sheet)}"><Table>${widths}${header}${body}</Table>` +
    `<AutoFilter x:Range="R1C1:R${lastRow}C${lastCol}" xmlns="urn:schemas-microsoft-com:office:excel"/>` +
    `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">` +
    `<FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane>` +
    `</WorksheetOptions></Worksheet>\n` +
    metaSheet +
    `</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const filename = `${sanitizeFilename(titulo)}.xls`;
  const file = new File([blob], filename, { type: 'application/vnd.ms-excel' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: titulo });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }

  const isDesktop =
    window.matchMedia?.('(pointer: fine)')?.matches && !/Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isDesktop) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }

  const file_url = await uploadToStorage(blob, filename);
  openExternally(file_url);
}
