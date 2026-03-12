import { Router } from 'express';
// use the environment-driven OAuth helper instead of the legacy file-based
// googleAuth module. this removes the requirement for a credentials.json file
// inside the container.
import {
  getAuthUrl,
  setTokensFromCode
} from '../auth/oauth.js';


export const authRouter = Router();

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
