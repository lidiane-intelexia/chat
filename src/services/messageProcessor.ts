import { similarityRatio } from '../utils/similarity.js';
import { digitsOnly, normalizeText, tokenize, STOPWORDS_PT } from '../utils/text.js';
import { replaceIdsWithNames } from './aiService.js';
import type { MessageRecord } from './chatService.js';

export interface ClientQuery {
  name?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
}

export interface ActionItem {
  type: 'decision' | 'pending' | 'deadline';
  text: string;
  dateMention?: string;
  messageTime?: string;
}

export interface TimelineEntry {
  time: string;
  sender: string;
  space: string;
  text: string;
}

export interface ReportData {
  clientLabel: string;
  periodStart?: string;
  periodEnd?: string;
  participants: string[];
  topics: string[];
  decisions: ActionItem[];
  pendings: ActionItem[];
  deadlines: ActionItem[];
  timeline: TimelineEntry[];
}

const DECISION_PATTERNS = [
  /decidimos/i,
  /decis(ao|ão)/i,
  /aprovad[oa]/i,
  /ficou combinado/i,
  /definid[oa]/i,
  /vamos fazer/i
];

const PENDING_PATTERNS = [
  /penden/i,
  /pendente/i,
  /aguardando/i,
  /em aberto/i,
  /falta/i,
  /precisa/i
];

const DEADLINE_PATTERNS = [
  /prazo/i,
  /até\s+\d{1,2}\/\d{1,2}\/\d{2,4}/i,
  /até\s+\d{1,2}\s+de\s+[a-zçã]+/i,
  /deadline/i
];

const DATE_REGEX = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+de\s+[a-zçã]+\s+de\s+\d{2,4})/i;

function safeText(value?: string | null) {
  return value?.trim() || '';
}



function buildClientLabel(query: ClientQuery) {
  return query.name || query.cnpj || query.email || query.phone || 'Cliente';
}

function buildQueryTokens(query: ClientQuery) {
  const tokens: string[] = [];
  if (query.name) tokens.push(...tokenize(query.name));
  if (query.email) tokens.push(normalizeText(query.email));
  if (query.cnpj) tokens.push(digitsOnly(query.cnpj));
  if (query.phone) tokens.push(digitsOnly(query.phone));
  return tokens.filter(Boolean);
}

function extractMessageText(record: MessageRecord) {
  const textParts = [
    safeText(record.message.text),
    safeText(record.message.sender?.displayName),
    safeText(record.space.displayName)
  ];
  return textParts.filter(Boolean).join(' ');
}

/**
 * Common words that cause false positives when a client name overlaps
 * with everyday vocabulary (e.g. "conta" in "conta de anuncio").
 */
const NEGATIVE_CONTEXT_PATTERNS = [
  /conta\s+d[eao]\s+(anuncio|insta|facebook|google|banco|luz|agua|telefone|email|e-mail)/i,
  /conta\s+comercial/i,
  /conta\s+pessoal/i,
  /minha\s+conta/i,
  /sua\s+conta/i,
  /criar\s+conta/i,
  /trocar\s+de\s+conta/i,
];

/**
 * Returns true if the message text uses the query term in a system/generic
 * context rather than referring to the actual client.
 */
function isNegativeContext(messageText: string, query: ClientQuery): boolean {
  if (!query.name) return false;
  const nameLower = query.name.toLowerCase();
  // Only apply negative context filtering for short/ambiguous names
  if (nameLower.length > 8) return false;

  for (const pattern of NEGATIVE_CONTEXT_PATTERNS) {
    if (pattern.test(messageText)) return true;
  }
  return false;
}

export function matchMessage(record: MessageRecord, query: ClientQuery, threshold = 0.82) {
  const messageTextRaw = extractMessageText(record);
  const messageText = normalizeText(messageTextRaw);
  const messageDigits = digitsOnly(messageTextRaw);
  const queryTokens = buildQueryTokens(query);

  if (!queryTokens.length) return false;

  // High precision mode (threshold >= 0.9): require full name match, not individual tokens
  const highPrecision = threshold >= 0.9;

  if (highPrecision && query.name) {
    const fullNameNorm = normalizeText(query.name);
    // Must contain the full client name as-is (not just individual tokens)
    const hasFullName = messageText.includes(fullNameNorm);
    const hasExactDigits = query.cnpj && messageDigits.includes(digitsOnly(query.cnpj));
    const hasExactEmail = query.email && messageText.includes(normalizeText(query.email));
    const hasExactPhone = query.phone && messageDigits.includes(digitsOnly(query.phone));

    if (!hasFullName && !hasExactDigits && !hasExactEmail && !hasExactPhone) {
      return false;
    }
  }

  // Negative context filter: discard messages that use the search term generically
  if (isNegativeContext(messageText, query)) {
    return false;
  }

  // Standard matching
  for (const token of queryTokens) {
    if (!token) continue;
    if (token.includes('@') && messageText.includes(token)) return true;
    if (/^\d+$/.test(token) && messageDigits.includes(token)) return true;
    if (messageText.includes(token)) return true;
  }

  const messageTokens = tokenize(messageTextRaw).slice(0, 200);
  for (const token of queryTokens) {
    if (token.length < 3 || token.includes('@') || /^\d+$/.test(token)) continue;
    for (const msgToken of messageTokens) {
      if (similarityRatio(token, msgToken) >= threshold) {
        return true;
      }
    }
  }

  return false;
}

function buildTopics(records: MessageRecord[], limit = 10) {
  const counts = new Map<string, number>();

  for (const record of records) {
    const text = safeText(record.message.text);
    if (!text) continue;
    const tokens = tokenize(text);
    for (const token of tokens) {
      if (STOPWORDS_PT.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function extractItems(text: string, patterns: RegExp[], type: ActionItem['type'], time?: string) {
  if (!text) return [] as ActionItem[];
  const items: ActionItem[] = [];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      const dateMention = text.match(DATE_REGEX)?.[0];
      items.push({
        type,
        text: text.slice(0, 240),
        dateMention,
        messageTime: time
      });
      break;
    }
  }
  return items;
}

export function buildReportData(records: MessageRecord[], query: ClientQuery, nameMap?: Map<string, string>): ReportData {
  const sorted = [...records].sort((a, b) => {
    const timeA = new Date(a.message.createTime || 0).getTime();
    const timeB = new Date(b.message.createTime || 0).getTime();
    return timeA - timeB;
  });

  const participants = new Set<string>();
  const decisions: ActionItem[] = [];
  const pendings: ActionItem[] = [];
  const deadlines: ActionItem[] = [];
  const timeline: TimelineEntry[] = [];

  for (const record of sorted) {
    const senderId = record.message.sender?.name || '';
    const sender = record.message.sender?.displayName
      || nameMap?.get(senderId)
      || 'Desconhecido';
    participants.add(sender);

    const time = record.message.createTime || '';
    const rawText = safeText(record.message.text) || '[Mensagem sem texto]';
    const text = nameMap ? replaceIdsWithNames(rawText, nameMap) : rawText;

    const spaceId = record.space.name || '';
    const spaceName = record.space.displayName
      || nameMap?.get(spaceId)
      || 'Espaco';

    timeline.push({
      time,
      sender,
      space: spaceName,
      text
    });

    decisions.push(...extractItems(text, DECISION_PATTERNS, 'decision', time));
    pendings.push(...extractItems(text, PENDING_PATTERNS, 'pending', time));
    deadlines.push(...extractItems(text, DEADLINE_PATTERNS, 'deadline', time));
  }

  const periodStart = sorted[0]?.message.createTime || undefined;
  const periodEnd = sorted[sorted.length - 1]?.message.createTime || undefined;

  return {
    clientLabel: buildClientLabel(query),
    periodStart,
    periodEnd,
    participants: Array.from(participants),
    topics: buildTopics(sorted),
    decisions,
    pendings,
    deadlines,
    timeline
  };
}
