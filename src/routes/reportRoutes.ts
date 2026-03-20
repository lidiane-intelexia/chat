// Importa o Router do Express, o zod para validacao e os servicos internos (Auth, Chat, Processamento, Relatorio e Drive).
import { Router } from 'express';
import { z } from 'zod';
import { getAuthorizedClient } from '../auth/oauth.js';
import { findMessagesAcrossSpaces } from '../services/chatService.js';
import { matchMessage, type ClientQuery } from '../services/messageProcessor.js';
import { generateReport } from '../services/reportService.js';
import { resolveAllIdentities } from '../services/aiService.js';
import { ensureClientFolder, uploadReportToDrive } from '../services/driveService.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

// Define as regras do que o usuario pode enviar, exigindo ao menos um identificador e permitindo filtros e opcoes tecnicas.
const requestSchema = z.object({
  query: z.object({
    name: z.string().optional(),
    cnpj: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    link: z.string().optional()
  }).refine((value) => Boolean(value.name || value.cnpj || value.email || value.phone || value.link), {
    message: 'Informe ao menos um identificador (nome, CNPJ, e-mail, telefone ou link).'
  }),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  format: z.enum(['pdf', 'gdoc']).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  concurrency: z.number().min(1).max(10).optional()
});

// Remove caracteres invalidos para nomes de pasta no sistema de arquivos/Drive.
function sanitizeFolderName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'cliente';
}

function buildSearchTerm(query: ClientQuery) {
  const terms = [query.name, query.cnpj, query.email, query.phone]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return terms.join(' | ');
}

export const reportRouter = Router();

// Define a rota principal (POST /) e usa async para nao travar enquanto espera as APIs do Google.
reportRouter.post('/', async (req, res, next) => {
  try {
    // Valida os dados do usuario; se estiverem invalidos, lanca erro e cai no catch.
    const payload = requestSchema.parse(req.body);
    const query = payload.query as ClientQuery;
    // Recupera as credenciais OAuth 2.0 para agir em nome do usuario no Google.
    const auth = await getAuthorizedClient();
    const threshold = payload.similarityThreshold ?? 0.82;

    await prisma.searchLog.create({
      data: {
        term: buildSearchTerm(query)
      }
    });

    // Faz a busca real no Google Chat, aplicando matchMessage e filtros de data.
    const records = await findMessagesAcrossSpaces(
      auth,
      (record) => matchMessage(record, query, threshold),
      {
        startDate: payload.startDate,
        endDate: payload.endDate,
        concurrency: payload.concurrency
      }
    );

    // Se nao houver mensagens, retorna 404 (Nao Encontrado).
    if (!records.length) {
      res.status(404).json({ error: 'Nenhuma mensagem encontrada para o filtro informado.' });
      return;
    }

    const format = payload.format ?? env.REPORT_FORMAT_DEFAULT;
    // Resolve identidades: message history + People API
    const nameMap = await resolveAllIdentities(auth, records);
    // Gera o relatorio estruturado com contexto de precisao para o Gemini.
    const reportOutput = await generateReport(records, query, format, nameMap, {
      clientName: query.name,
      similarity: threshold,
      totalFiltered: records.length,
    });

    // Calcula o ano da pasta pelo fim do periodo; se falhar, usa o ano atual.
    const periodEnd = reportOutput.report.periodEnd ? new Date(reportOutput.report.periodEnd) : new Date();
    const year = Number.isNaN(periodEnd.getTime()) ? new Date().getFullYear() : periodEnd.getFullYear();

    // Define o nome da pasta do cliente priorizando o CNPJ, quando disponivel.
    const clientFolderName = sanitizeFolderName(query.cnpj || reportOutput.report.clientLabel);
    // Garante a pasta do cliente dentro de 'chat' e a subpasta do ano.
    const { yearFolderId } = await ensureClientFolder(auth, clientFolderName, year);

    const fileName = `Relatorio-${clientFolderName}-${year}.${format === 'pdf' ? 'pdf' : 'gdoc'}`;

    // Envia o arquivo final para a subpasta do ano correta no Drive.
    const upload = await uploadReportToDrive(auth, {
      fileName,
      format,
      parentId: yearFolderId,
      pdfBuffer: reportOutput.pdf,
      textContent: reportOutput.text
    });

    const driveLink = upload.webViewLink ?? `https://drive.google.com/file/d/${upload.fileId}/view`;
    const downloadLink = `https://drive.google.com/uc?export=download&id=${upload.fileId}`;

    const summary = {
      client: reportOutput.report.clientLabel,
      periodStart: reportOutput.report.periodStart,
      periodEnd: reportOutput.report.periodEnd,
      totalMessages: reportOutput.report.timeline.length,
      participants: reportOutput.report.participants.length
    };

    const clientWhere: Array<{ cnpj?: string; email?: string; phone?: string; name?: string }> = [];
    if (query.cnpj) clientWhere.push({ cnpj: query.cnpj });
    if (query.email) clientWhere.push({ email: query.email });
    if (query.phone) clientWhere.push({ phone: query.phone });
    if (query.name) clientWhere.push({ name: query.name });

    const existingClient = clientWhere.length
      ? await prisma.client.findFirst({ where: { OR: clientWhere } })
      : null;

    const clientData = {
      name: query.name || reportOutput.report.clientLabel,
      cnpj: query.cnpj,
      email: query.email,
      phone: query.phone
    };

    const client = existingClient
      ? await prisma.client.update({
          where: { id: existingClient.id },
          data: {
            name: clientData.name || existingClient.name,
            cnpj: clientData.cnpj ?? existingClient.cnpj,
            email: clientData.email ?? existingClient.email,
            phone: clientData.phone ?? existingClient.phone
          }
        })
      : await prisma.client.create({ data: clientData });

    await prisma.report.create({
      data: {
        clientId: client.id,
        driveFileId: upload.fileId,
        driveLink,
        summary
      }
    });

    // Resposta final com link, ID e resumo do processamento.
    res.json({
      status: 'ok',
      fileId: upload.fileId,
      webViewLink: driveLink,
      downloadLink,
      summary: {
        client: summary.client,
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        totalMessages: summary.totalMessages,
        participants: summary.participants
      }
    });
    // Encaminha qualquer erro (auth, rede, etc.) para o errorHandler global.
  } catch (error) {
    next(error);
  }
});
