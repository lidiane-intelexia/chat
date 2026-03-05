import { google, chat_v1 } from 'googleapis';
import pLimit from 'p-limit';
import { toRFC3339 } from '../utils/text.js';
import { logger } from '../utils/logger.js';
import type { OAuth2Client } from 'google-auth-library';


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
    const response = await chat.spaces.list({
      pageSize: 1000,
      pageToken,
      filter: 'spaceType = "DIRECT_MESSAGE" OR spaceType = "GROUP_CHAT" OR spaceType = "SPACE"'
    });

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
    const response = await chat.spaces.messages.list({
      parent: spaceName,
      pageSize: 1000,
      pageToken,
      filter: filter || undefined
    });

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
