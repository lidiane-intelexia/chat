import puppeteer from 'puppeteer';
import { buildReportData } from './messageProcessor.js';
import type { ClientQuery, ReportData } from './messageProcessor.js';
import type { MessageRecord } from './chatService.js';
import { analyzeWithAI, type AnalyzeOptions } from './aiService.js';

export interface ReportOutput {
  report: ReportData;
  text: string;
  pdf?: Buffer;
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatDateTimePrecise(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function nowBrazil(): string {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
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
// HTML/CSS Template
// ---------------------------------------------------------------------------

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12pt;
  line-height: 1.5;
  color: #1a1a1a;
  background: #fff;
  padding: 0;
  text-align: justify;
}

/* ---- Header ---- */
.header {
  text-align: center;
  margin-bottom: 36px;
  padding-bottom: 18px;
  border-bottom: 2px solid #0f3460;
}

.header h1 {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 18pt;
  font-weight: 700;
  color: #0f3460;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.header .subtitle {
  font-size: 10pt;
  color: #555;
  font-weight: 400;
}

/* ---- Sections ---- */
.section {
  margin-bottom: 32px;
  page-break-inside: avoid;
}

.section-title {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12pt;
  font-weight: 700;
  color: #0f3460;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
  padding-bottom: 4px;
  border-bottom: 2px solid #e94560;
  display: inline-block;
}

.section-content {
  font-size: 12pt;
  color: #1a1a1a;
  line-height: 1.5;
  text-align: justify;
}

.section-content p {
  margin-bottom: 8px;
}

/* ---- Bullet list ---- */
.bullet-list {
  list-style: none;
  padding: 0;
  margin: 8px 0;
}

.bullet-list li {
  padding: 6px 0 6px 20px;
  position: relative;
  font-size: 12pt;
  line-height: 1.5;
  border-bottom: 1px solid #f0f0f0;
}

.bullet-list li:last-child { border-bottom: none; }

.bullet-list li::before {
  content: '\\203A';
  position: absolute;
  left: 4px;
  color: #0f3460;
  font-weight: 700;
  font-size: 14pt;
  line-height: 1.3;
}

.bold { font-weight: 700; color: #16213e; }

/* ---- Access Data Cards ---- */
.access-section {
  margin-bottom: 32px;
  page-break-inside: avoid;
}

.access-section .section-title {
  color: #e94560;
  border-bottom-color: #e94560;
}

.access-card {
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 12px;
  page-break-inside: avoid;
}

.access-card-title {
  font-weight: 700;
  font-size: 11pt;
  color: #0f3460;
  margin-bottom: 6px;
}

.access-card-field {
  font-size: 10.5pt;
  color: #333;
  line-height: 1.6;
  padding-left: 10px;
}

.access-card-field .label {
  color: #555;
}

.access-card-field .value {
  font-weight: 600;
  color: #1a1a1a;
}

.access-card-field .credential-value {
  font-family: 'Courier New', Courier, monospace;
  font-size: 10pt;
  background: #fff3f5;
  color: #e94560;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid #fdd;
}

.empty-notice {
  color: #888;
  font-style: italic;
  font-size: 11pt;
  padding: 12px 0;
}

/* ---- Raw Log ---- */
.raw-log {
  page-break-before: always;
}

.raw-log .section-title {
  border-bottom-color: #999;
}

.log-entry {
  margin-bottom: 2px;
}

.log-header {
  background: #f0f0f0;
  padding: 3px 8px;
  font-size: 8.5pt;
  line-height: 1.4;
}

.log-date {
  font-family: 'Courier New', Courier, monospace;
  font-size: 8pt;
  color: #555;
}

.log-sender {
  font-weight: 700;
  color: #0f3460;
  font-size: 8.5pt;
  margin-left: 6px;
}

.log-message {
  color: #1a1a1a;
  font-size: 9pt;
  line-height: 1.5;
  padding: 4px 8px 8px 20px;
  word-break: break-word;
  text-align: left;
}
`;

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

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
  // Only match section headers that contain uppercase letters (not dates/times)
  // e.g. **[RESUMO EXECUTIVO]** or [DADOS DE ACESSO] but NOT [14/06/2023 - 10:14:38]
  const sectionRegex = /(?:\*\*\[([A-Z][A-Z\s\u00C0-\u00FF]+)\]\*\*|\[([A-Z][A-Z\s\u00C0-\u00FF]+)\])\s*\n/g;
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
  html = html.replace(/\*\*(.+?)\*\*/g, '<span class="bold">$1</span>');

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
        // skip
      } else {
        result.push(`<p>${trimmed}</p>`);
      }
    }
  }
  if (inList) result.push('</ul>');

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Access Data — Card layout
// ---------------------------------------------------------------------------

interface AccessEntry {
  system: string;
  login: string;
  password: string;
  informedBy: string;
  dateTime: string;
}

function extractField(text: string, label: string): string {
  // Match the label followed by a value, including values in brackets like [14/06/2023 - 10:14:38]
  const regex = new RegExp(`\\*?\\*?${label}\\*?\\*?\\s*:\\s*(.+?)(?:\\n|$)`, 'i');
  const match = text.match(regex);
  if (!match) return '';
  let value = match[1].trim().replace(/\*\*/g, '');
  // Unwrap brackets from dates: [14/06/2023 - 10:14:38] -> 14/06/2023 - 10:14:38
  value = value.replace(/^\[(.+)\]$/, '$1');
  return value;
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

function buildAccessCardsHtml(content: string): string {
  const entries = parseAccessEntries(content);
  if (!entries.length) {
    return '<p class="empty-notice">Nenhum dado de acesso compartilhado no periodo.</p>';
  }

  let html = '';
  for (const entry of entries) {
    html += `
      <div class="access-card">
        <div class="access-card-title">Sistema/Cliente: ${escapeHtml(entry.system)}</div>
        <div class="access-card-field">
          <span class="label">&#9658; Login:</span>
          <span class="value">${escapeHtml(entry.login)}</span>
        </div>
        <div class="access-card-field">
          <span class="label">&#9658; Senha:</span>
          <span class="credential-value">${escapeHtml(entry.password)}</span>
        </div>
        <div class="access-card-field">
          <span class="label">&#9658; Informado por:</span>
          <span class="value">${escapeHtml(entry.informedBy)}</span>
        </div>
        <div class="access-card-field">
          <span class="label">&#9658; Data e Hora:</span>
          <span class="value">${escapeHtml(entry.dateTime)}</span>
        </div>
      </div>`;
  }

  return html;
}

// ---------------------------------------------------------------------------
// Raw Log — header line + indented message on next line, no body shading
// ---------------------------------------------------------------------------

function buildRawLogHtml(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim());
  if (!lines.length) return '<p class="empty-notice">Nenhuma mensagem encontrada.</p>';

  let html = '';

  for (const line of lines) {
    const match = line.match(/^\[(.+?)\]\s*\[?([^\]:]+?)\]?\s*:\s*(.*)$/);
    if (match) {
      const rawDateTime = match[1].trim();
      const dtParts = rawDateTime.split(/\s*[-,]\s*/);
      const datePart = dtParts[0] || rawDateTime;
      const timePart = dtParts[1] || '';

      html += `<div class="log-entry">
        <div class="log-header">
          <span class="log-date">[${escapeHtml(datePart)} | ${escapeHtml(timePart)}]</span>
          <span class="log-sender">${escapeHtml(match[2].trim())}:</span>
        </div>
        <div class="log-message">${escapeHtml(match[3])}</div>
      </div>`;
    } else {
      html += `<div class="log-entry">
        <div class="log-header"></div>
        <div class="log-message">${escapeHtml(line)}</div>
      </div>`;
    }
  }

  return html;
}

// ---------------------------------------------------------------------------
// Full HTML builder
// ---------------------------------------------------------------------------

function buildHtml(text: string, report: ReportData): string {
  const sections = parseMarkdownSections(text);
  const generatedAt = nowBrazil();

  let body = '';

  // Header — no INTELEXIA badge, just centered title
  body += `
    <div class="header">
      <h1>Relatorio Chat Intelligence</h1>
      <div class="subtitle">${escapeHtml(report.clientLabel)} &mdash; Gerado em ${generatedAt} (Horario de Brasilia)</div>
    </div>`;

  // Sections
  for (const section of sections) {
    if (section.title === 'DADOS DE ACESSO') {
      body += `
        <div class="access-section">
          <div class="section-title">${escapeHtml(section.title)}</div>
          ${buildAccessCardsHtml(section.content)}
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
      margin: { top: '25mm', bottom: '25mm', left: '30mm', right: '20mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;text-align:center;font-size:8pt;color:#999;font-family:Arial,Helvetica,sans-serif;padding:0 30mm;">
          Pagina <span class="pageNumber"></span> de <span class="totalPages"></span>
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

export async function generateReport(
  records: MessageRecord[],
  query: ClientQuery,
  format: 'pdf' | 'gdoc',
  nameMap?: Map<string, string>,
  analyzeOptions?: AnalyzeOptions
) {
  const report = buildReportData(records, query, nameMap);
  const rawText = buildReportText(report);
  const text = await analyzeWithAI(rawText, records, analyzeOptions);
  const pdf = format === 'pdf' ? await renderPdf(text, report) : undefined;

  return { report, text, pdf } satisfies ReportOutput;
}
