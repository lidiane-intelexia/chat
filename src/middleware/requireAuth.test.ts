import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from './requireAuth.js';
import { signSession } from '../auth/session.js';

interface FakeRes extends Response {
  _status?: number;
  _json?: unknown;
}

function makeRes(): FakeRes {
  const res = {
    _status: undefined as number | undefined,
    _json: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this as unknown as Response;
    },
    json(body: unknown) {
      this._json = body;
      return this as unknown as Response;
    }
  };
  return res as unknown as FakeRes;
}

describe('requireAuth', () => {
  it('responde 401 quando nao ha cookie', () => {
    const req = { headers: {} } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(res._status).toBe(401);
    expect(res._json).toEqual({ error: 'unauthenticated' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responde 401 quando o cookie de sessao e invalido', () => {
    const req = { headers: { cookie: 'session=invalido' } } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('aceita sessao valida, injeta req.user.email e chama next', () => {
    const token = signSession({
      email: 'fulano@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });
    const req = {
      headers: { cookie: `session=${encodeURIComponent(token)}` }
    } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(req.user).toEqual({ email: 'fulano@example.com' });
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });

  it('rejeita 401 quando o token esta expirado', () => {
    const expired = signSession({
      email: 'fulano@example.com',
      exp: Math.floor(Date.now() / 1000) - 10
    });
    const req = {
      headers: { cookie: `session=${encodeURIComponent(expired)}` }
    } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
