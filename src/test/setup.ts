// Roda antes de qualquer modulo da aplicacao ser importado nos testes.
// Garante que `src/config/env.ts` valida o schema sem cair no boot.
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3000';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:3000/auth/callback';
process.env.GOOGLE_LOGIN_REDIRECT_URI ??= 'http://localhost:3000/auth/login/callback';
process.env.SESSION_SECRET ??= 'test-session-secret-must-be-at-least-32-chars-long-xx';
process.env.GEMINI_API_KEY ??= 'test-gemini-key';
process.env.ALLOWED_HD ??= 'example.com';
process.env.LOG_LEVEL ??= 'silent';
