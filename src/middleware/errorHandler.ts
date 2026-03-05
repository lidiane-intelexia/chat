import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

//*Tratamento de exeções.

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.flatten() });
    return;
  }

  logger.error({ err: error }, 'Unhandled error');
  const message = error instanceof Error ? error.message : 'Unexpected error';
  res.status(500).json({ error: message });
}
