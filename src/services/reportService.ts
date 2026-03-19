import puppeteer from 'puppeteer';
import { buildReportData } from './messageProcessor.js';
import type { ClientQuery, ReportData } from './messageProcessor.js';
import type { MessageRecord } from './chatService.js';
import { analyzeWithAI } from './aiService.js';

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

function formatDateTimePrecise(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} - ${hh}:${min}:${ss}`;
}

function buildExecutiveSummary(report: ReportData) {
  const totalMessages = report.timeline.length;
  const period = report.periodStart && report.periodEnd
    ? `${formatDate(report.periodStart)} a ${formatDate(report.periodEnd)}`
    : 'Periodo nao identificado';

  return [
    `Total de mensagens analisadas: ${totalMessages}`,
    `Periodo: ${period}`,
    `Participantes: ${report.participants.length}`,
    `Decisoes: ${report.decisions.length}`,
    `Pendencias: ${report.pendings.length}`,
    `Prazos: ${report.deadlines.length}`
  ].join('\n');
}

function buildReportText(report: ReportData) {
  const lines: string[] = [];
  lines.push(`Relatorio de Conversas - ${report.clientLabel}`);
  lines.push('');
  lines.push('Resumo Executivo');
  lines.push(buildExecutiveSummary(report));
  lines.push('');
  lines.push('Temas Principais');
  lines.push(report.topics.length ? report.topics.join(', ') : 'Nenhum tema identificado.');
  lines.push('');
  lines.push('Decisoes');
  lines.push(report.decisions.length ? report.decisions.map((item) => `- ${item.text}`).join('\n') : 'Sem decisoes identificadas.');
  lines.push('');
  lines.push('Pendencias');
  lines.push(report.pendings.length ? report.pendings.map((item) => `- ${item.text}`).join('\n') : 'Sem pendencias identificadas.');
  lines.push('');
  lines.push('Prazos');
  lines.push(
    report.deadlines.length
      ? report.deadlines.map((item) => `- ${item.text}${item.dateMention ? ` (data: ${item.dateMention})` : ''}`).join('\n')
      : 'Sem prazos identificados.'
  );
  lines.push('');
  lines.push('Historico Consolidado');
  lines.push(
    report.timeline.length
      ? report.timeline
          .map((entry) => `[${formatDateTimePrecise(entry.time)}] [${entry.sender}]: ${entry.text}`)
          .join('\n')
      : 'Nenhuma mensagem encontrada.'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTML/CSS Template Engine
// ---------------------------------------------------------------------------

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 11px;
  line-height: 1.6;
  color: #1a1a2e;
  background: #fff;
  padding: 40px 50px;
}

.header {
  text-align: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 2px solid #0f3460;
}

.header h1 {
  font-size: 22px;
  font-weight: 700;
  color: #0f3460;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.header .subtitle {
  font-size: 10px;
  color: #666;
  font-weight: 400;
}

.header .logo-badge {
  display: inline-block;
  background: linear-gradient(135deg, #0f3460, #16213e);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  padding: 3px 12px;
  border-radius: 12px;
  letter-spacing: 1.5px;
  margin-bottom: 10px;
}

.section {
  margin-bottom: 28px;
  page-break-inside: avoid;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f3460;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 10px;
  padding-bottom: 5px;
  border-bottom: 2px solid #e94560;
  display: inline-block;
}

.section-content {
  font-size: 10.5px;
  color: #333;
  line-height: 1.7;
}

.section-content p {
  margin-bottom: 6px;
}

.bullet-list {
  list-style: none;
  padding: 0;
}

.bullet-list li {
  padding: 5px 0 5px 18px;
  position: relative;
  font-size: 10.5px;
  border-bottom: 1px solid #f0f0f0;
}

.bullet-list li:last-child {
  border-bottom: none;
}

.bullet-list li::before {
  content: '\\203A';
  position: absolute;
  left: 2px;
  color: #0f3460;
  font-weight: 700;
  font-size: 14px;
  line-height: 1.4;
}

.bold { font-weight: 600; color: #16213e; }

/* Access Data Table - highlight section */
.access-section {
  background: linear-gradient(135deg, #fafbff, #f0f4ff);
  border: 1px solid #d0d8f0;
  border-radius: 8px;
  padding: 18px;
  margin-bottom: 28px;
}

.access-section .section-title {
  color: #e94560;
  border-bottom-color: #e94560;
}

.access-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5px;
  margin-top: 10px;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

.access-table thead th {
  background: #f2f2f2;
  color: #16213e;
  font-weight: 600;
  font-size: 8.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 10px 8px;
  text-align: left;
  border-bottom: 2px solid #d0d8f0;
}

.access-table tbody td {
  padding: 8px 8px;
  border-bottom: 1px solid #e8e8e8;
  color: #333;
  vertical-align: top;
}

.access-table tbody tr:nth-child(even) {
  background: #fafafa;
}

.access-table tbody tr:hover {
  background: #f0f4ff;
}

.access-table .credential {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  background: #fff3f5;
  color: #e94560;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid #fdd;
}

.empty-notice {
  color: #999;
  font-style: italic;
  font-size: 10px;
  padding: 12px 0;
}

/* Raw log section */
.raw-log {
  page-break-before: always;
}

.raw-log .section-title {
  border-bottom-color: #ccc;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px;
  line-height: 1.5;
}

.log-table td {
  padding: 3px 6px;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: top;
}

.log-table .log-time {
  color: #666;
  white-space: nowrap;
  width: 130px;
  font-size: 7.5px;
}

.log-table .log-sender {
  color: #0f3460;
  font-weight: 500;
  white-space: nowrap;
  width: 140px;
  font-size: 7.5px;
}

.log-table .log-msg {
  color: #333;
  word-break: break-word;
  font-size: 7.5px;
}

.log-table tr:nth-child(even) {
  background: #fafafa;
}

/* Page footer */
.page-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8px;
  color: #999;
  padding: 10px 50px;
  border-top: 1px solid #eee;
}
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ParsedSection {
  title: string;
  content: string;
}

function parseMarkdownSections(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const sectionRegex = /(?:\*\*\[(.+?)\]\*\*|\[(.+?)\])\s*\n/g;
  const matches = [...text.matchAll(sectionRegex)];

  if (!matches.length) {
    return [{ title: 'RELATORIO', content: text }];
  }

  for (let i = 0; i < matches.length; i++) {
    const title = (matches[i][1] || matches[i][2]).trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const content = text.slice(start, end).trim();
    sections.push({ title, content });
  }

  return sections;
}

function markdownToHtml(content: string): string {
  let html = escapeHtml(content);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<span class="bold">$1</span>');
  // Lines starting with - as bullet list
  const lines = html.split('\n');
  let inList = false;
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      if (!inList) { result.push('<ul class="bullet-list">'); inList = true; }
      result.push(`<li>${trimmed.slice(2)}</li>`);
    } else {
      if (inList) { result.push('</ul>'); inList = false; }
      if (trimmed === '' || trimmed === '---') {
        // skip empty or separator
      } else {
        result.push(`<p>${trimmed}</p>`);
      }
    }
  }
  if (inList) result.push('</ul>');

  return result.join('\n');
}

interface AccessEntry {
  system: string;
  login: string;
  password: string;
  informedBy: string;
  dateTime: string;
}

function parseAccessEntries(text: string): AccessEntry[] {
  const entries: AccessEntry[] = [];
  const blocks = text.split(/(?=^-\s|\n-\s)/m).filter((b) => b.trim());

  for (const block of blocks) {
    const system = extractField(block, 'Cliente/Sistema') || extractField(block, 'Sistema');
    const login = extractField(block, 'Login') || extractField(block, 'Usuario') || extractField(block, 'User');
    const password = extractField(block, 'Senha') || extractField(block, 'Password');
    const informedBy = extractField(block, 'Informado por') || extractField(block, 'Informado');
    const dateTime = extractField(block, 'Data e Hora') || extractField(block, 'Data');

    if (system || login || password) {
      entries.push({
        system: system || '-',
        login: login || '-',
        password: password || '-',
        informedBy: informedBy || '-',
        dateTime: dateTime || '-',
      });
    }
  }

  return entries;
}

function extractField(text: string, label: string): string {
  const regex = new RegExp(`\\*?\\*?${label}\\*?\\*?\\s*:\\s*(.+?)(?:\\n|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim().replace(/\*\*/g, '') : '';
}

function buildAccessTableHtml(content: string): string {
  const entries = parseAccessEntries(content);
  if (!entries.length) {
    return '<p class="empty-notice">Nenhum dado de acesso compartilhado no periodo.</p>';
  }

  let html = `<table class="access-table">
    <thead>
      <tr>
        <th>Cliente / Sistema</th>
        <th>Login</th>
        <th>Senha</th>
        <th>Informado por</th>
        <th>Data e Hora</th>
      </tr>
    </thead>
    <tbody>`;

  for (const entry of entries) {
    html += `
      <tr>
        <td>${escapeHtml(entry.system)}</td>
        <td>${escapeHtml(entry.login)}</td>
        <td><span class="credential">${escapeHtml(entry.password)}</span></td>
        <td>${escapeHtml(entry.informedBy)}</td>
        <td>${escapeHtml(entry.dateTime)}</td>
      </tr>`;
  }

  html += '</tbody></table>';
  return html;
}

function buildRawLogHtml(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim());
  if (!lines.length) return '<p class="empty-notice">Nenhuma mensagem encontrada.</p>';

  let html = '<table class="log-table"><tbody>';

  for (const line of lines) {
    // Parse [DD/MM/AAAA - HH:mm:ss] [Name]: Message
    const match = line.match(/^\[(.+?)\]\s*\[?([^\]:]+?)\]?\s*:\s*(.*)$/);
    if (match) {
      html += `<tr>
        <td class="log-time">${escapeHtml(match[1])}</td>
        <td class="log-sender">${escapeHtml(match[2])}</td>
        <td class="log-msg">${escapeHtml(match[3])}</td>
      </tr>`;
    } else {
      html += `<tr><td colspan="3" class="log-msg">${escapeHtml(line)}</td></tr>`;
    }
  }

  html += '</tbody></table>';
  return html;
}

function buildHtml(text: string, report: ReportData): string {
  const sections = parseMarkdownSections(text);
  const now = new Date().toLocaleString('pt-BR');

  let body = '';

  // Header
  body += `
    <div class="header">
      <div class="logo-badge">INTELEXIA</div>
      <h1>Relatorio CAT-IA</h1>
      <div class="subtitle">${escapeHtml(report.clientLabel)} &mdash; Gerado em ${now}</div>
    </div>`;

  // Sections
  for (const section of sections) {
    if (section.title === 'DADOS DE ACESSO') {
      body += `
        <div class="access-section">
          <div class="section-title">${escapeHtml(section.title)}</div>
          ${buildAccessTableHtml(section.content)}
        </div>`;
    } else if (section.title === 'RELATORIO BRUTO COMPLETO') {
      body += `
        <div class="section raw-log">
          <div class="section-title">${escapeHtml(section.title)}</div>
          ${buildRawLogHtml(section.content)}
        </div>`;
    } else {
      body += `
        <div class="section">
          <div class="section-title">${escapeHtml(section.title)}</div>
          <div class="section-content">
            ${markdownToHtml(section.content)}
          </div>
        </div>`;
    }
  }

  // Footer
  body += `<div class="page-footer">Intelexia CAT-IA &bull; Relatorio Confidencial</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>${CSS}</style>
</head>
<body>
  ${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Puppeteer PDF Renderer
// ---------------------------------------------------------------------------

async function renderPdf(text: string, report: ReportData): Promise<Buffer> {
  const html = buildHtml(text, report);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;text-align:center;font-size:8px;color:#999;font-family:sans-serif;">
          Intelexia CAT-IA &bull; Pagina <span class="pageNumber"></span> de <span class="totalPages"></span>
        </div>`,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateReport(records: MessageRecord[], query: ClientQuery, format: 'pdf' | 'gdoc', nameMap?: Map<string, string>) {
  const report = buildReportData(records, query, nameMap);
  const rawText = buildReportText(report);
  const text = await analyzeWithAI(rawText, records);
  const pdf = format === 'pdf' ? await renderPdf(text, report) : undefined;

  return { report, text, pdf } satisfies ReportOutput;
}
