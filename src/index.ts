import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { authRouter } from './routes/authRoutes.js';
import { reportRouter } from './routes/reportRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/requireAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../frontend/dist');

const app = express();

// O Traefik termina TLS na frente; precisamos do `trust proxy` para
// `req.ip`/`X-Forwarded-For` chegarem corretos no rate limiter.
app.set('trust proxy', 1);

// Cabecalhos de seguranca padrao (CSP, X-Frame-Options, HSTS, etc.).
app.use(helmet());

app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '2mb' }));

// /health vem ANTES de qualquer rate limit para nao bloquear liveness probes
// de Traefik/k8s/uptime checks. E uma rota barata, sem efeito colateral.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Rate limit global mais frouxo: protege contra varredura de baixa intensidade.
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
app.use(globalLimiter);

// Rate limit mais agressivo nos pontos de ataque mais provaveis:
//  - /auth/login: tentativa de forca-bruta de IP
//  - /reports: gera carga pesada (Chat + Gemini + Puppeteer)
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const reportsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

app.use('/auth', authLimiter, authRouter);
app.use('/reports', reportsLimiter, requireAuth, reportRouter);

app.use(express.static(frontendDist));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  // Nao deixar GETs em rotas de API caírem no fallback HTML do SPA -
  // confunde clientes e mascara bugs.
  if (
    req.path.startsWith('/auth') ||
    req.path.startsWith('/reports') ||
    req.path.startsWith('/health')
  ) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});
