import { google, chat_v1 } from 'googleapis';
import pLimit from 'p-limit';
import { toRFC3339 } from '../utils/text.js';
import { logger } from '../utils/logger.js';
import { buildFieldMatchers, type ClientQuery } from './messageProcessor.js';
import type { OAuth2Client } from 'google-auth-library';
import type { GaxiosError } from 'gaxios';


//*Aqui está a lógica  de negócio para varrer o histórico e gerar o relatório.

export interface MessageRecord {
  space: chat_v1.Schema$Space;
  message: chat_v1.Schema$Message;
}

export interface MessageSearchOptions {
  startDate?: string;
  endDate?: string;
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isGaxiosError(err: unknown): err is GaxiosError {
  return err != null && typeof err === 'object' && 'response' in err;
}

async function withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isGaxiosError(err)) {
        const status = err.response?.status;

        if (status === 401 || status === 403) {
          throw new Error(
            `Authentication error (${status}) while ${context}. ` +
            'Your token may have been revoked or lacks the required scopes. ' +
            'Please reauthorize via GET /auth/url.'
          );
        }

        if (status === 429 && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn({ attempt: attempt + 1, delay, context }, 'Rate limited (429), retrying');
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw err;
    }
  }
  throw new Error(`Max retries exceeded while ${context}`);
}

function buildMessageFilter(startDate?: string, endDate?: string) {
  const filters: string[] = [];
  if (startDate) {
    filters.push(`createTime > \"${toRFC3339(startDate)}\"`);
  }
  if (endDate) {
    filters.push(`createTime < \"${toRFC3339(endDate)}\"`);
  }
  return filters.join(' AND ');
}

export async function listAllSpaces(auth: OAuth2Client) {
  const chat = google.chat({ version: 'v1', auth });
  const spaces: chat_v1.Schema$Space[] = [];
  let pageToken: string | undefined;

  do {
    const currentPageToken = pageToken;
    const response = await withRetry(
      () => chat.spaces.list({
        pageSize: 1000,
        pageToken: currentPageToken,
        filter: 'spaceType = "DIRECT_MESSAGE" OR spaceType = "GROUP_CHAT" OR spaceType = "SPACE"'
      }),
      'listing spaces'
    );

    if (response.data.spaces?.length) {
      spaces.push(...response.data.spaces);
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return spaces;
}

export async function listMessagesForSpace(
  auth: OAuth2Client,
  spaceName: string,
  options: MessageSearchOptions = {}
) {
  const chat = google.chat({ version: 'v1', auth });
  const messages: chat_v1.Schema$Message[] = [];
  let pageToken: string | undefined;
  const filter = buildMessageFilter(options.startDate, options.endDate);

  do {
    const currentPageToken = pageToken;
    const response = await withRetry(
      () => chat.spaces.messages.list({
        parent: spaceName,
        pageSize: 1000,
        pageToken: currentPageToken,
        filter: filter || undefined
      }),
      `listing messages for space ${spaceName}`
    );

    if (response.data.messages?.length) {
      messages.push(...response.data.messages);
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return messages;
}

export async function findMessagesAcrossSpaces(
  auth: OAuth2Client,
  predicate: (record: MessageRecord) => boolean,
  options: MessageSearchOptions = {}
) {
  const spaces = await listAllSpaces(auth);
  const limit = pLimit(options.concurrency ?? DEFAULT_CONCURRENCY);
  const matches: MessageRecord[] = [];

  await Promise.all(
    spaces.map((space) =>
      limit(async () => {
        if (!space.name) return;
        try {
          const messages = await listMessagesForSpace(auth, space.name, options);
          for (const message of messages) {
            const record = { space, message };
            if (predicate(record)) {
              matches.push(record);
            }
          }
        } catch (error) {
          logger.warn({ err: error, space: space.name }, 'Failed to list messages for space');
        }
      })
    )
  );

  return matches;
}

/**
 * Busca mensagens de forma independente por cada campo do query (nome, CNPJ, email, phone, link).
 * Cada campo gera uma busca separada e os resultados são unidos (UNION) com deduplicação por message.name.
 */
export async function findMatchingMessagesByField(
  auth: OAuth2Client,
  query: ClientQuery,
  options: MessageSearchOptions & { threshold?: number } = {}
) {
  const matchers = buildFieldMatchers(query, options.threshold ?? 0.7);

  if (!matchers.length) return [];

  const spaces = await listAllSpaces(auth);
  const limit = pLimit(options.concurrency ?? DEFAULT_CONCURRENCY);

  // Coleta todas as mensagens de todos os spaces uma única vez
  const allRecords: MessageRecord[] = [];

  await Promise.all(
    spaces.map((space) =>
      limit(async () => {
        if (!space.name) return;
        try {
          const messages = await listMessagesForSpace(auth, space.name, options);
          for (const message of messages) {
            allRecords.push({ space, message });
          }
        } catch (error) {
          logger.warn({ err: error, space: space.name }, 'Failed to list messages for space');
        }
      })
    )
  );

  // Aplica cada matcher independentemente e faz UNION com deduplicação
  const seen = new Set<string>();
  const results: MessageRecord[] = [];

  for (const matcher of matchers) {
    for (const record of allRecords) {
      const messageId = record.message.name;
      if (!messageId || seen.has(messageId)) continue;
      if (matcher(record)) {
        seen.add(messageId);
        results.push(record);
      }
    }
  }

  logger.info(
    { totalMessages: allRecords.length, matched: results.length, matcherCount: matchers.length },
    'Busca independente por campo concluída'
  );

  return results;
}
