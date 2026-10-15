// Geração de PDF do resumo de OS selecionadas:
//  1) Uma linha por produto, somando o total previsto de todas as OS/lavouras.
//  2) Uma seção apenas listando as lavouras das OS selecionadas.
import { jsPDF } from 'jspdf';
import { formatQtd } from '@/lib/format';
import { parseItens } from '@/lib/osAplicacao';

export function gerarPDFResumoOS(ordens) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 16;

  // Cabeçalho
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('RESUMO DE OS DE APLICAÇÃO', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `${(ordens || []).length} OS selecionadas · gerado em ${new Date().toLocaleString('pt-BR')}`,
    pageW / 2,
    y,
    { align: 'center' }
  );
  y += 6;
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // --- 1) Total por produto (soma de todas as OS selecionadas) ---
  const porProduto = {};
  const lavourasMap = {};
  for (const os of ordens || []) {
    if (os.lavoura_id) lavourasMap[os.lavoura_id] = os.lavoura_nome || 'Sem lavoura';
    for (const it of parseItens(os.itens)) {
      if (!porProduto[it.produto_id]) {
        porProduto[it.produto_id] = {
          nome: it.nome,
          codigo: it.codigo,
          unidade: it.unidade || 'un',
          total: 0,
        };
      }
      porProduto[it.produto_id].total += Number(it.previsto) || 0;
    }
  }
  const produtos = Object.values(porProduto).sort((a, b) => a.nome.localeCompare(b.nome));
  const lavouras = Object.entries(lavourasMap).map(([id, nome]) => ({ id, nome }));
  lavouras.sort((a, b) => a.nome.localeCompare(b.nome));

  const colProduto = margin;
  const colCod = 120;
  const colUn = 162;
  const colTotal = pageW - margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Total por Produto', margin, y);
  y += 6;

  // Cabeçalho da tabela
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y - 4, contentW, 6, 'F');
  doc.setFontSize(9);
  doc.text('Produto', colProduto, y);
  doc.text('Código', colCod, y);
  doc.text('Un.', colUn, y);
  doc.text('Total', colTotal, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  for (const p of produtos) {
    if (y > 282) {
      doc.addPage();
      y = 16;
    }
    doc.text(String(p.nome || '').slice(0, 52), colProduto, y);
    doc.text(String(p.codigo || ''), colCod, y);
    doc.text(p.unidade, colUn, y);
    doc.text(formatQtd(p.total), colTotal, y, { align: 'right' });
    y += 5.5;
  }

  // --- 2) Lista de lavouras ---
  y += 8;
  if (y > 270) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Lavouras', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  for (const l of lavouras) {
    if (y > 282) {
      doc.addPage();
      y = 16;
    }
    doc.text(`• ${l.nome}`, margin, y);
    y += 6;
  }

  doc.save('Resumo-OS-Aplicacao.pdf');
}