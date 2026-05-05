import crypto from 'node:crypto';
import { env } from '../config/env.js';

export interface SessionPayload {
  email: string;
  exp: number;
}

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function hmac(body: string): Buffer {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(body).digest();
}

export function signSession(payload: SessionPayload): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(hmac(body));
  return `${body}.${sig}`;
}

export function verifySession(raw: string | undefined): SessionPayload | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;

  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  const expected = b64urlEncode(hmac(body));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString('utf-8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const payload = parsed as Partial<SessionPayload>;
  if (typeof payload.email !== 'string' || !payload.email) return null;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (payload.exp * 1000 < Date.now()) return null;

  return { email: payload.email, exp: payload.exp };
}

export function buildSessionCookie(value: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ].join('; ');
}

export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
