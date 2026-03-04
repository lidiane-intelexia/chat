import PDFDocument from 'pdfkit';
import { buildReportData } from './messageProcessor.js';
import type { ClientQuery, ReportData } from './messageProcessor.js';
import type { MessageRecord } from './chatService.js';

export interface ReportOutput {
  report: ReportData;
  text: string;
  pdf?: Buffer;
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
}

function buildExecutiveSummary(report: ReportData) {
  const totalMessages = report.timeline.length;
  const period = report.periodStart && report.periodEnd
    ? `${formatDate(report.periodStart)} a ${formatDate(report.periodEnd)}`
    : 'Período não identificado';

  return [
    `Total de mensagens analisadas: ${totalMessages}`,
    `Período: ${period}`,
    `Participantes: ${report.participants.length}`,
    `Decisões: ${report.decisions.length}`,
    `Pendências: ${report.pendings.length}`,
    `Prazos: ${report.deadlines.length}`
  ].join('\n');
}

function buildReportText(report: ReportData) {
  const lines: string[] = [];

  lines.push(`Relatório de Conversas - ${report.clientLabel}`);
  lines.push('');
  lines.push('Resumo Executivo');
  lines.push(buildExecutiveSummary(report));
  lines.push('');
  lines.push('Temas Principais');
  lines.push(report.topics.length ? report.topics.join(', ') : 'Nenhum tema identificado.');
  lines.push('');
  lines.push('Decisões');
  lines.push(report.decisions.length ? report.decisions.map((item) => `- ${item.text}`).join('\n') : 'Sem decisões identificadas.');
  lines.push('');
  lines.push('Pendências');
  lines.push(report.pendings.length ? report.pendings.map((item) => `- ${item.text}`).join('\n') : 'Sem pendências identificadas.');
  lines.push('');
  lines.push('Prazos');
  lines.push(
    report.deadlines.length
      ? report.deadlines.map((item) => `- ${item.text}${item.dateMention ? ` (data: ${item.dateMention})` : ''}`).join('\n')
      : 'Sem prazos identificados.'
  );
  lines.push('');
  lines.push('Histórico Consolidado');
  lines.push(
    report.timeline.length
      ? report.timeline
          .map((entry) => `[${formatDate(entry.time)}] (${entry.space}) ${entry.sender}: ${entry.text}`)
          .join('\n')
      : 'Nenhuma mensagem encontrada.'
  );

  return lines.join('\n');
}

function renderPdf(text: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(12).text(text, { align: 'left' });
    doc.end();
  });
}

export async function generateReport(records: MessageRecord[], query: ClientQuery, format: 'pdf' | 'gdoc') {
  const report = buildReportData(records, query);
  const text = buildReportText(report);
  const pdf = format === 'pdf' ? await renderPdf(text) : undefined;

  return { report, text, pdf } satisfies ReportOutput;
}
