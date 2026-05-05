import type { Request, Response, NextFunction } from 'express';
import { verifySession, readCookie, SESSION_COOKIE_NAME } from '../auth/session.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { email: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const raw = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  const payload = verifySession(raw);
  if (!payload) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  req.user = { email: payload.email };
  next();
}
