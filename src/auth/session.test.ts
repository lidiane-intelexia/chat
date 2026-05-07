import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  signSession,
  verifySession,
  readCookie,
  buildSessionCookie,
  buildLogoutCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  type SessionPayload
} from './session.js';

function validPayload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    email: 'someone@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides
  };
}

// Constroi um token com assinatura VALIDA sobre um body arbitrario, para que
// os testes consigam exercitar caminhos posteriores ao timingSafeEqual
// (JSON.parse, validacao de campos do payload, etc.).
function makeSignedToken(rawBody: string): string {
  const body = Buffer.from(rawBody).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET as string)
    .update(body)
    .digest()
    .toString('base64url');
  return `${body}.${sig}`;
}

describe('signSession + verifySession', () => {
  it('roundtrip: assina e verifica devolve o mesmo payload', () => {
    const payload = validPayload();
    const token = signSession(payload);
    expect(verifySession(token)).toEqual(payload);
  });

  it('devolve null para entrada vazia ou undefined', () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession('')).toBeNull();
  });

  it('devolve null se faltar o ponto separador', () => {
    expect(verifySession('sem-ponto')).toBeNull();
  });

  it('devolve null para assinatura adulterada', () => {
    const token = signSession(validPayload());
    const dot = token.indexOf('.');
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const tampered = `${body}.${sig.slice(0, -2)}xx`;
    expect(verifySession(tampered)).toBeNull();
  });

  it('devolve null se o body nao for JSON valido (assinatura OK)', () => {
    // makeSignedToken fecha a assinatura, garantindo que chegamos no JSON.parse
    expect(verifySession(makeSignedToken('isso nao e json'))).toBeNull();
  });

  it('devolve null se o payload for JSON valido mas nao for objeto', () => {
    expect(verifySession(makeSignedToken('"apenas-uma-string"'))).toBeNull();
    expect(verifySession(makeSignedToken('null'))).toBeNull();
    expect(verifySession(makeSignedToken('42'))).toBeNull();
  });

  it('devolve null se faltar email no payload', () => {
    const body = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(verifySession(makeSignedToken(body))).toBeNull();
  });

  it('devolve null se exp nao for numero', () => {
    const body = JSON.stringify({ email: 'a@b.com', exp: 'not-a-number' });
    expect(verifySession(makeSignedToken(body))).toBeNull();
  });

  it('devolve null se exp for nao-finito (1e500 vira Infinity no JSON.parse)', () => {
    // JSON.parse('1e500') -> Infinity em V8. Number.isFinite(Infinity) === false.
    const body = '{"email":"a@b.com","exp":1e500}';
    expect(verifySession(makeSignedToken(body))).toBeNull();
  });

  it('devolve null para token expirado', () => {
    const expired = signSession({
      email: 'a@b.com',
      exp: Math.floor(Date.now() / 1000) - 10
    });
    expect(verifySession(expired)).toBeNull();
  });
});

describe('readCookie', () => {
  it('le um cookie unico', () => {
    expect(readCookie('session=abc', 'session')).toBe('abc');
  });

  it('le cookie no meio de uma lista', () => {
    expect(readCookie('a=1; session=xyz; b=2', 'session')).toBe('xyz');
  });

  it('retorna undefined se header for undefined', () => {
    expect(readCookie(undefined, 'session')).toBeUndefined();
  });

  it('retorna undefined se o nome nao existir', () => {
    expect(readCookie('a=1; b=2', 'session')).toBeUndefined();
  });

  it('faz decodeURIComponent do valor', () => {
    expect(readCookie('session=abc%3Ddef', 'session')).toBe('abc=def');
  });
});

describe('buildSessionCookie e buildLogoutCookie', () => {
  it('cookie de sessao inclui flags de seguranca', () => {
    const cookie = buildSessionCookie('abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=abc;`)).toBe(true);
  });

  it('logout zera o valor e o Max-Age', () => {
    const cookie = buildLogoutCookie();
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
  });
});
