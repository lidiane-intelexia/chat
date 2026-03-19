import { google } from 'googleapis';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { MessageRecord } from './chatService.js';
import type { OAuth2Client } from 'google-auth-library';

const SYSTEM_INSTRUCTION = `Voce e o Analista de Operacoes da Intelexia (Chat Intelligence). Sua tarefa e transformar um log bruto de mensagens do Google Chat em um Relatorio Executivo de Alta Relevancia.

Responda estritamente em formato Markdown usando codificacao UTF-8.

IMPORTANTE: NAO use emojis no output. Use apenas texto puro ASCII para os titulos.

FORMATO DO OUTPUT (siga esta estrutura exata):

**[RESUMO EXECUTIVO]**
Periodo, total de mensagens, participantes principais — em no maximo 3 linhas.

**[DADOS CRITICOS]**
Filtre senhas, tokens, links de acesso e credenciais compartilhadas nas conversas. Se nao houver, escreva "Nenhum dado critico identificado."

**[DADOS DE ACESSO]**
Varra o log em busca de padroes que indiquem credenciais compartilhadas. Palavras-chave a identificar: 'login', 'senha', 'user', 'password', 'acesso', 'link de acesso', 'credencial', 'usuario', 'pass', 'pwd', seguidos de valores.
Para cada credencial encontrada, liste com esta estrutura exata:
- **Cliente/Sistema:** (empresa ou ferramenta a que o acesso pertence)
  **Login:** (usuario ou e-mail identificado)
  **Senha:** (a senha identificada)
  **Informado por:** (nome real do usuario que enviou a mensagem — nunca use IDs tecnicos)
  **Data e Hora:** [DD/MM/AAAA - HH:mm:ss] (timestamp exato da mensagem original)

Se nenhum dado de acesso for encontrado no periodo, escreva: "Nenhum dado de acesso compartilhado no periodo."

**[DECISOES]**
Liste APENAS decisoes que mudaram o rumo do trabalho (ex: aprovacoes, mudancas de escopo, definicoes tecnicas). Ignore conversas triviais ou confirmacoes simples.
Formato: - [DATA HH:mm] Descricao concisa da decisao.

**[PENDENCIAS]**
Liste compromissos diretos extraidos das conversas.
Se uma mensagem contem uma mencao (@Nome) seguida de um pedido ou instrucao, isso DEVE ser priorizado como pendencia.
Formato: - **Nome do Responsavel**: Descricao da acao pendente.

**[CRONOGRAMA]**
Extraia datas de publicacoes, prazos de entrega e horarios de reunioes.
Ao listar eventos no Cronograma, preserve SEMPRE o horario exato [HH:mm:ss] da mensagem original.
Formato: - [DATA HH:mm:ss] Evento ou prazo.

**[PARTICIPANTES]**
Liste os participantes com uma breve descricao do papel observado nas conversas.
Use SEMPRE o nome real do participante. Nunca use "Desconhecido" ou "Participante".

REGRAS DE FORMATACAO:
- Use titulos em CAIXA ALTA e **negrito** entre colchetes como mostrado acima.
- Adicione uma linha em branco entre cada secao.
- NAO use emojis, icones ou caracteres especiais Unicode. Apenas texto ASCII puro.
- NAO use bordas, linhas decorativas ou separadores feitos de caracteres especiais.
- Use apenas tracos simples (---) para separadores quando necessario.
- Seja conciso: elimine saudacoes e conversas sem impacto operacional.
- Nunca inclua IDs tecnicos (users/123..., spaces/ABC...) — use apenas nomes reais.
- Onde aparecer "Espaco" ou nome generico de grupo, substitua pelo nome real do grupo de chat que aparece no log (ex: "Operacional Intelexia", "Suporte Tecnico", etc).
- Se um participante nao tiver nome identificavel em nenhum lugar do log, use o formato "Membro #N" (onde N e um numero sequencial).

Ao final, insira:

---

**[RELATORIO BRUTO COMPLETO]**
Anexe o log completo original formatado como tabela de log tecnica.
Preserve SEMPRE o horario exato [HH:mm:ss] da mensagem original.
Use estritamente este formato para cada linha:
[DD/MM/AAAA - HH:mm:ss] [NOME DO USUARIO]: MENSAGEM

Nunca omita ou arredonde horarios. Nunca use "Desconhecido" se houver um nome disponivel no log.`;

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// ---------------------------------------------------------------------------
// Global identity cache — persists across report generations within the
// same process lifetime.
// ---------------------------------------------------------------------------
const globalUserCache = new Map<string, string>();

/**
 * Resolve user IDs to display names using the Google People API.
 * Uses directory lookup (requires domain-wide visibility or contacts scope).
 * Results are merged into the global cache.
 */
export async function resolveUserNames(
  auth: OAuth2Client,
  userIds: string[]
): Promise<Map<string, string>> {
  const unresolved = userIds.filter((id) => !globalUserCache.has(id));
  if (!unresolved.length) return new Map(globalUserCache);

  const people = google.people({ version: 'v1', auth });

  // People API expects "people/ID" format, not "users/ID"
  const toPeopleFormat = (id: string) => id.replace(/^users\//, 'people/');
  const toUsersFormat = (id: string) => id.replace(/^people\//, 'users/');

  // People API supports batch requests of up to 200 resource names
  const BATCH_SIZE = 200;
  for (let i = 0; i < unresolved.length; i += BATCH_SIZE) {
    const batch = unresolved.slice(i, i + BATCH_SIZE);
    const peopleBatch = batch.map(toPeopleFormat);
    try {
      const response = await people.people.getBatchGet({
        resourceNames: peopleBatch,
        personFields: 'names,emailAddresses',
      });

      for (const personResponse of response.data.responses || []) {
        const resourceName = personResponse.requestedResourceName;
        const displayName = personResponse.person?.names?.[0]?.displayName;
        if (resourceName && displayName) {
          // Store with original "users/ID" key for lookup compatibility
          globalUserCache.set(toUsersFormat(resourceName), displayName);
        }
      }
    } catch (err) {
      logger.warn({ err, batch: batch.slice(0, 3) }, 'People API batch lookup failed, falling back to message history');
    }
  }

  return new Map(globalUserCache);
}

/**
 * Scans all records and builds/updates a persistent identity map.
 * Phase 1: extract names from message sender.displayName
 * Phase 2 (if auth provided): resolve remaining IDs via People API
 * Rule: never use "Desconhecido" if a name exists anywhere in history.
 */
export function syncUserDatabase(records: MessageRecord[]): Map<string, string> {
  for (const record of records) {
    const sender = record.message.sender;
    if (sender?.name && sender.displayName) {
      globalUserCache.set(sender.name, sender.displayName);
    }

    const space = record.space;
    if (space?.name && space.displayName) {
      globalUserCache.set(space.name, space.displayName);
    }
  }

  return new Map(globalUserCache);
}

/**
 * Full identity resolution: message history + People API.
 * Call this from reportRoutes with the auth client.
 */
export async function resolveAllIdentities(
  auth: OAuth2Client,
  records: MessageRecord[]
): Promise<Map<string, string>> {
  // Phase 1: extract from message history
  syncUserDatabase(records);

  // Phase 2: collect unresolved user IDs
  const unresolvedIds = new Set<string>();
  for (const record of records) {
    const senderId = record.message.sender?.name;
    if (senderId && !globalUserCache.has(senderId)) {
      unresolvedIds.add(senderId);
    }
    // Also check for user mentions in message text
    const text = record.message.text || '';
    const mentions = text.match(/users\/\d+/g) || [];
    for (const mention of mentions) {
      if (!globalUserCache.has(mention)) {
        unresolvedIds.add(mention);
      }
    }
  }

  // Phase 3: resolve via People API
  if (unresolvedIds.size > 0) {
    await resolveUserNames(auth, [...unresolvedIds]);
  }

  return new Map(globalUserCache);
}

/**
 * Replaces all user/space IDs in the text with human-readable names.
 * Handles formats: users/123, <users/123>, spaces/ABC, <spaces/ABC>
 */
export function replaceIdsWithNames(text: string, nameMap: Map<string, string>): string {
  let result = text;

  // Sort by ID length descending to avoid partial replacements
  const entries = [...nameMap.entries()].sort((a, b) => b[0].length - a[0].length);

  for (const [id, name] of entries) {
    result = result.replaceAll(`<${id}>`, name);
    result = result.replaceAll(id, name);
  }

  // Clean up remaining IDs — use "Membro #N" for truly unknown users
  let memberCounter = 1;
  const unknownMap = new Map<string, string>();

  result = result.replace(/<users\/\d+>/g, (match) => {
    if (!unknownMap.has(match)) unknownMap.set(match, `Membro #${memberCounter++}`);
    return unknownMap.get(match)!;
  });
  result = result.replace(/users\/\d+/g, (match) => {
    const key = `<${match}>`;
    if (!unknownMap.has(key)) {
      if (!unknownMap.has(match)) unknownMap.set(match, `Membro #${memberCounter++}`);
    }
    return unknownMap.get(match) || unknownMap.get(key)!;
  });

  // Replace space IDs with their names or remove
  result = result.replace(/<spaces\/[A-Za-z0-9_-]+>/g, '');
  result = result.replace(/spaces\/[A-Za-z0-9_-]+/g, '');

  return result;
}

export interface AnalyzeOptions {
  clientName?: string;
  similarity?: number;
  totalFiltered?: number;
}

export async function analyzeWithAI(rawLog: string, records: MessageRecord[], options?: AnalyzeOptions): Promise<string> {
  const nameMap = syncUserDatabase(records);
  const cleanedLog = replaceIdsWithNames(rawLog, nameMap);

  // Build dynamic context instruction based on similarity/query
  let contextInstruction = '';

  if (options?.clientName) {
    const precision = options.similarity ?? 0.82;
    const clientName = options.clientName;

    contextInstruction += `\n\nCONTEXTO DA BUSCA:
- O usuario pesquisou pelo cliente: "${clientName}".
- Nivel de precisao configurado: ${(precision * 100).toFixed(0)}%.`;

    if (precision >= 0.9) {
      contextInstruction += `
- ALTA PRECISAO: Inclua no relatorio APENAS mensagens que mencionem explicitamente "${clientName}" como cliente, empresa ou pessoa.
- DESCARTE mensagens que usem a palavra "${clientName}" em contextos genericos de sistema (ex: "conta de anuncio", "conta do Instagram", "trocar de conta").
- Se uma mensagem nao tem relacao direta com o cliente "${clientName}", NAO a inclua no resumo executivo, decisoes ou pendencias.`;
    } else if (precision >= 0.7) {
      contextInstruction += `
- PRECISAO MEDIA: Priorize mensagens que mencionem diretamente "${clientName}". Inclua mensagens relacionadas ao contexto do cliente mesmo que nao citem o nome explicitamente, mas DESCARTE mensagens claramente genericas que usem a palavra em contexto de sistema.`;
    }
  }

  if (options?.totalFiltered) {
    contextInstruction += `\n- Total de mensagens que passaram no filtro de precisao: ${options.totalFiltered}. Use ESTE numero no [RESUMO EXECUTIVO], nao o total bruto do log.`;
  }

  const fullInstruction = SYSTEM_INSTRUCTION + contextInstruction;

  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    config: {
      systemInstruction: fullInstruction,
    },
    contents: cleanedLog,
  });

  return response.text ?? '';
}
