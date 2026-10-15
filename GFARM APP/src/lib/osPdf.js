// Geração de PDF da Ordem de Serviço de Aplicação (documento impresso para campo).
import { jsPDF } from 'jspdf';
import { formatQtd, formatDose } from '@/lib/format';
import { parseItens } from '@/lib/osAplicacao';

export function gerarPDFOS(os, { cultura, lavoura }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 16;

  // Cabeçalho
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ORDEM DE SERVIÇO DE APLICAÇÃO', pageW / 2, y, { align: 'center' });
  y += 7;
  doc.setFontSize(12);
  doc.text(os.numero || '', pageW / 2, y, { align: 'center' });
  y += 8;

  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  // Dados gerais
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const dataFmt = os.data ? new Date(os.data).toLocaleString('pt-BR') : '';
  const linhas = [
    `Cultura: ${cultura?.nome || os.cultura_nome || ''}`,
    `Ano Safra: ${os.ano_safra || ''}`,
    `Lavoura: ${lavoura?.nome || os.lavoura_nome || ''}${lavoura?.numero ? ' (Nº ' + lavoura.numero + ')' : ''}`,
    `Hectares: ${formatQtd(os.hectares || 0)} ha`,
    `Responsável: ${os.responsavel || ''}`,
    `Data de Abertura: ${dataFmt}`,
  ];
  for (const linha of linhas) {
    doc.text(linha, margin, y);
    y += 5.5;
  }
  if (os.observacao) {
    y += 1;
    doc.text(`Observação: ${os.observacao}`, margin, y, { maxWidth: contentW });
    y += 5.5;
  }

  y += 4;

  // Tabela de produtos
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Produtos / Previsão de Consumo', margin, y);
  y += 5;

  // Cabeçalho da tabela — colunas espaçadas para evitar sobreposição
  const colProduto = margin;
  const colUn = 118;
  const colDose = 148;
  const colPrev = 172;
  const colReal = 196;

  doc.setFontSize(9);
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y - 4, contentW, 6, 'F');
  doc.text('Produto', colProduto, y);
  doc.text('Un.', colUn, y);
  doc.text('Dose/ha', colDose, y, { align: 'right' });
  doc.text('Previsto', colPrev, y, { align: 'right' });
  doc.text('Realizado', colReal, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  const itens = parseItens(os.itens);
  for (const item of itens) {
    if (y > 275) {
      doc.addPage();
      y = 16;
    }
    doc.text(String(item.nome || '').slice(0, 48), colProduto, y);
    doc.text(item.unidade || '', colUn, y);
    doc.text(formatDose(item.dose_por_hect || 0), colDose, y, { align: 'right' });
    doc.text(formatQtd(item.previsto || 0), colPrev, y, { align: 'right' });
    doc.text(os.status === 'baixada' ? formatQtd(item.realizado || 0) : '_______', colReal, y, { align: 'right' });
    y += 6;
  }

  // Linha para anotações do aplicador
  y += 6;
  if (y > 250) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Anotações do Aplicador', margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(200);
  for (let i = 0; i < 5; i++) {
    doc.line(margin, y, pageW - margin, y);
    y += 7;
  }

  // Rodapé
  y += 4;
  if (y > 270) y = 270;
  doc.line(margin, y, pageW - margin, y);
  y += 6;
  doc.setFontSize(9);
  doc.text('Assinatura Aplicador:', margin, y);
  doc.text('Conferente:', margin + 90, y);

  doc.save(`${os.numero || 'OS-Aplicacao'}.pdf`);
}