import 'dotenv/config';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { authRouter } from './routes/authRoutes.js';
import { reportRouter } from './routes/reportRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { setTokensFromCode } from './auth/oauth.js';

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/oauth2callback', async (req, res, next) => {
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

app.use('/auth', authRouter);
app.use('/reports', reportRouter);


app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});
