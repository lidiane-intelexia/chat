import { similarityRatio } from '../utils/similarity.js';
import { digitsOnly, normalizeText, tokenize, STOPWORDS_PT } from '../utils/text.js';
import { replaceIdsWithNames } from './aiService.js';
import type { MessageRecord } from './chatService.js';

export interface ClientQuery {
  name?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  link?: string;
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

/**
 * Extracts the username/handle from a social media or website URL.
 * e.g. "https://instagram.com/conta1" -> "conta1"
 *      "https://www.facebook.com/empresa.oficial" -> "empresa.oficial"
 */
function extractUsernameFromLink(link: string): string | null {
  try {
    const url = new URL(link.startsWith('http') ? link : `https://${link}`);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // Return the first meaningful path segment (the username)
    return pathParts[0] || null;
  } catch {
    // If URL parsing fails, try to extract after the last /
    const match = link.match(/\/([^/?#]+)\s*$/);
    return match?.[1] || null;
  }
}

function buildQueryTokens(query: ClientQuery) {
  const tokens: string[] = [];
  if (query.name) tokens.push(...tokenize(query.name));
  if (query.email) tokens.push(normalizeText(query.email));
  if (query.cnpj) tokens.push(digitsOnly(query.cnpj));
  if (query.phone) tokens.push(digitsOnly(query.phone));
  return tokens.filter(Boolean);
}

/**
 * Builds link-specific search terms from the provided URL.
 * Returns the full URL (normalized) and the extracted username for @mention matching.
 */
function buildLinkTerms(link?: string): { url: string; username: string | null } | null {
  if (!link) return null;
  const normalized = link.trim().toLowerCase();
  const username = extractUsernameFromLink(normalized);
  return { url: normalized, username };
}

/**
 * Checks if a message matches the provided link (URL or @username).
 */
function matchByLink(messageText: string, linkTerms: { url: string; username: string | null }): boolean {
  const textLower = messageText.toLowerCase();

  // Match exact URL or partial URL
  if (textLower.includes(linkTerms.url)) return true;

  // Match without protocol (e.g. "instagram.com/conta1")
  const withoutProtocol = linkTerms.url.replace(/^https?:\/\/(www\.)?/, '');
  if (textLower.includes(withoutProtocol)) return true;

  // Match @username mention (e.g. "@conta1")
  if (linkTerms.username) {
    const usernameLower = linkTerms.username.toLowerCase();
    // Match @username or just the username as a standalone word
    if (textLower.includes(`@${usernameLower}`)) return true;
    // Match username as a whole word (not partial)
    const wordBoundary = new RegExp(`\\b${usernameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (wordBoundary.test(messageText)) return true;
  }

  return false;
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
  const linkTerms = buildLinkTerms(query.link);

  // Hybrid search: if link matches, include this message regardless of other filters
  if (linkTerms && matchByLink(messageTextRaw, linkTerms)) return true;

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
    const spaceName = record.space.displayName
      || nameMap?.get(record.space.name || '')
      || '';
    let sender = record.message.sender?.displayName
      || nameMap?.get(senderId)
      || '';

    // If sender is unknown, attribute to the space/group as automated message
    if (!sender || sender === 'Desconhecido') {
      sender = spaceName
        ? `${spaceName} - Automatica`
        : 'Sistema - Automatica';
    }
    participants.add(sender);

    const time = record.message.createTime || '';
    const rawText = safeText(record.message.text) || '[Mensagem sem texto]';
    const text = nameMap ? replaceIdsWithNames(rawText, nameMap) : rawText;

    timeline.push({
      time,
      sender,
      space: spaceName || 'Espaco',
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
