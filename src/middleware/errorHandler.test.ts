import { describe, it, expect, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { errorHandler } from './errorHandler.js';
import { AppError } from '../errors/AppError.js';

interface FakeRes extends Response {
  _status?: number;
  _json?: { error: unknown };
  headersSent: boolean;
}

function makeRes(): FakeRes {
  const res = {
    headersSent: false,
    _status: undefined as number | undefined,
    _json: undefined as { error: unknown } | undefined,
    status(code: number) {
      this._status = code;
      return this as unknown as Response;
    },
    json(body: { error: unknown }) {
      this._json = body;
      return this as unknown as Response;
    }
  };
  return res as unknown as FakeRes;
}

const fakeReq = {} as Request;
const noopNext = (() => {}) as NextFunction;

describe('errorHandler', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('ZodError -> 400 com flatten', () => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const res = makeRes();

    errorHandler(parsed.error, fakeReq, res, noopNext);

    expect(res._status).toBe(400);
    expect(res._json).toBeDefined();
    expect(res._json!.error).toBeDefined();
  });

  it('AppError -> usa statusCode e safeMessage', () => {
    const err = new AppError(418, 'eu sou um bule');
    const res = makeRes();

    errorHandler(err, fakeReq, res, noopNext);

    expect(res._status).toBe(418);
    expect(res._json).toEqual({ error: 'eu sou um bule' });
  });

  it('Erro do Gemini sobrecarregado (ApiError 503) -> 503 com mensagem em pt-BR', () => {
    const err = Object.assign(new Error('overloaded'), {
      name: 'ApiError',
      status: 503
    });
    const res = makeRes();

    errorHandler(err, fakeReq, res, noopNext);

    expect(res._status).toBe(503);
    expect(typeof res._json!.error).toBe('string');
    expect(res._json!.error).toMatch(/sobrecarregad/i);
  });

  it('Erro do Gemini com 429 tambem cai no fallback amigavel', () => {
    const err = Object.assign(new Error('rate limited'), {
      name: 'ApiError',
      status: 429
    });
    const res = makeRes();

    errorHandler(err, fakeReq, res, noopNext);

    expect(res._status).toBe(503);
  });

  it('Erro generico em dev/test -> 500 expoe error.message (debug local)', () => {
    process.env.NODE_ENV = 'test';
    const err = new Error('detalhe interno');
    const res = makeRes();

    errorHandler(err, fakeReq, res, noopNext);

    expect(res._status).toBe(500);
    expect(res._json!.error).toBe('detalhe interno');
  });

  it('Erro generico em PRODUCAO -> 500 com mensagem amigavel pt-BR e SEM error.message', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('detalhe-secreto-que-nao-pode-vazar');
    const res = makeRes();

    errorHandler(err, fakeReq, res, noopNext);

    expect(res._status).toBe(500);
    expect(typeof res._json!.error).toBe('string');
    expect(res._json!.error).toMatch(/erro interno/i);
    expect(JSON.stringify(res._json)).not.toContain('detalhe-secreto-que-nao-pode-vazar');
  });

  it('headersSent true -> nao chama res.status', () => {
    const res = makeRes();
    res.headersSent = true;

    errorHandler(new Error('x'), fakeReq, res, noopNext);

    expect(res._status).toBeUndefined();
    expect(res._json).toBeUndefined();
  });
});
