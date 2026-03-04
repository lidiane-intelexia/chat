import { Router } from 'express';
import { getAuthUrl, setTokensFromCode } from '../auth/oauth.js';

export const authRouter = Router();

authRouter.get('/url', (_req, res) => {
  const url = getAuthUrl();
  res.json({ url });
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
