import { Router } from 'express';
import { z } from 'zod';
import { getAuthorizedClient } from '../auth/oauth.js';
import { findMessagesAcrossSpaces } from '../services/chatService.js';
import { matchMessage, type ClientQuery } from '../services/messageProcessor.js';
import { generateReport } from '../services/reportService.js';
import { ensureClientFolder, uploadReportToDrive } from '../services/driveService.js';
import { env } from '../config/env.js';

const requestSchema = z.object({
  query: z.object({
    name: z.string().optional(),
    cnpj: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional()
  }).refine((value) => Boolean(value.name || value.cnpj || value.email || value.phone), {
    message: 'Informe ao menos um identificador (nome, CNPJ, e-mail ou telefone).'
  }),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  format: z.enum(['pdf', 'gdoc']).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  concurrency: z.number().min(1).max(10).optional()
});

function sanitizeFolderName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'cliente';
}

export const reportRouter = Router();

reportRouter.post('/', async (req, res, next) => {
  try {
    const payload = requestSchema.parse(req.body);
    const auth = await getAuthorizedClient();
    const query = payload.query as ClientQuery;
    const threshold = payload.similarityThreshold ?? 0.82;

    const records = await findMessagesAcrossSpaces(
      auth,
      (record) => matchMessage(record, query, threshold),
      {
        startDate: payload.startDate,
        endDate: payload.endDate,
        concurrency: payload.concurrency
      }
    );

    if (!records.length) {
      res.status(404).json({ error: 'Nenhuma mensagem encontrada para o filtro informado.' });
      return;
    }

    const format = payload.format ?? env.REPORT_FORMAT_DEFAULT;
    const reportOutput = await generateReport(records, query, format);

    const periodEnd = reportOutput.report.periodEnd ? new Date(reportOutput.report.periodEnd) : new Date();
    const year = Number.isNaN(periodEnd.getTime()) ? new Date().getFullYear() : periodEnd.getFullYear();

    const clientFolderName = sanitizeFolderName(query.cnpj || reportOutput.report.clientLabel);
    const { yearFolderId } = await ensureClientFolder(auth, clientFolderName, year);

    const fileName = `Relatorio-${clientFolderName}-${year}.${format === 'pdf' ? 'pdf' : 'gdoc'}`;

    const upload = await uploadReportToDrive(auth, {
      fileName,
      format,
      parentId: yearFolderId,
      pdfBuffer: reportOutput.pdf,
      textContent: reportOutput.text
    });

    res.json({
      status: 'ok',
      fileId: upload.fileId,
      webViewLink: upload.webViewLink,
      summary: {
        client: reportOutput.report.clientLabel,
        periodStart: reportOutput.report.periodStart,
        periodEnd: reportOutput.report.periodEnd,
        totalMessages: reportOutput.report.timeline.length,
        participants: reportOutput.report.participants.length
      }
    });
  } catch (error) {
    next(error);
  }
});
