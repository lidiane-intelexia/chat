import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';

//*Tratamento de exeções.

function isGeminiOverloadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; status?: number; error?: { code?: number } };
  const status = e.status ?? e.error?.code;
  return e.name === 'ApiError' && (status === 503 || status === 429);
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    logger.error({ err: error }, 'Error after headers sent');
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ error: error.flatten() });
    return;
  }

  if (error instanceof AppError) {
    logger.warn({ err: error, statusCode: error.statusCode }, 'AppError');
    res.status(error.statusCode).json({ error: error.safeMessage });
    return;
  }

  if (isGeminiOverloadError(error)) {
    logger.warn({ err: error }, 'Gemini sobrecarregado apos retries');
    res.status(503).json({
      error: 'O modelo de IA esta temporariamente sobrecarregado. Tente novamente em alguns instantes.'
    });
    return;
  }

  logger.error({ err: error }, 'Unhandled error');
  const message = error instanceof Error ? error.message : 'Unexpected error';
  res.status(500).json({ error: message });
}
