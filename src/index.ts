import 'dotenv/config';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { authRouter } from './routes/authRoutes.js';
import { reportRouter } from './routes/reportRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/reports', reportRouter);


app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});
