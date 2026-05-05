import { Router } from 'express';
import crypto from 'node:crypto';
import {
  getAuthUrl,
  setTokensFromCode
} from '../auth/oauth.js';
import {
  getLoginUrl,
  verifyLoginCode
} from '../auth/googleSignIn.js';
import {
  signSession,
  buildSessionCookie,
  buildLogoutCookie,
  readCookie,
  SESSION_TTL_SECONDS
} from '../auth/session.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const authRouter = Router();

const STATE_COOKIE_NAME = 'oauth_state';
const STATE_COOKIE_PATH = '/auth/login/callback';
const STATE_COOKIE_MAX_AGE = 600;

function buildStateCookie(value: string): string {
  return `${STATE_COOKIE_NAME}=${value}; Path=${STATE_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_COOKIE_MAX_AGE}`;
}

function buildStateClearCookie(): string {
  return `${STATE_COOKIE_NAME}=; Path=${STATE_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ===== OAuth do robo do Drive (pre-existente) =====

authRouter.get('/url', async (_req, res, next) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/google/url', async (_req, res, next) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/callback', async (req, res, next) => {
  try {
    const code = req.query.code;
    if (typeof code !== 'string') {
      res.status(400).json({ error: 'Missing code query parameter.' });
      return;
    }
    await setTokensFromCode(code);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

// ===== Google Sign-In (humano) =====

authRouter.get('/login', (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', buildStateCookie(state));
  res.redirect(getLoginUrl(state));
});

authRouter.get('/login/callback', async (req, res, next) => {
  try {
    const code = req.query.code;
    const returnedState = req.query.state;
    const expectedState = readCookie(req.headers.cookie, STATE_COOKIE_NAME);

    if (
      !expectedState ||
      typeof returnedState !== 'string' ||
      returnedState !== expectedState
    ) {
      res.status(400).json({ error: 'invalid_state' });
      return;
    }
    if (typeof code !== 'string') {
      res.status(400).json({ error: 'missing_code' });
      return;
    }

    const profile = await verifyLoginCode(code);

    if (!profile.emailVerified) {
      logger.warn({ email: profile.email }, 'login rejeitado: email nao verificado');
      res.status(403).json({ error: 'email_not_verified' });
      return;
    }
    if (profile.hd !== env.ALLOWED_HD) {
      logger.warn({ email: profile.email, hd: profile.hd }, 'login rejeitado: dominio nao autorizado');
      res.status(403).json({ error: 'forbidden_domain' });
      return;
    }

    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const session = signSession({ email: profile.email, exp });

    res.setHeader('Set-Cookie', [buildSessionCookie(session), buildStateClearCookie()]);
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ email: req.user!.email });
});

authRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', buildLogoutCookie());
  res.status(204).end();
});
