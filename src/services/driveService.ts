import { google, drive_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { Readable } from 'node:stream';
import { logger } from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';

export interface UploadResult {
  fileId: string;
  webViewLink?: string | null;
}

interface FolderMatch {
  id: string;
  name: string;
  score: number;
}

const SHARED_DRIVE_NAME = 'Drive Clientes DPG';
const SUBFOLDER_PATH = ['Relacionamento com Cliente', 'Relatórios'];
// Pasta-inbox para relatorios cuja pasta do cliente nao existe no Drive.
// O underline forca ela a ficar no topo da listagem alfabetica — sinal visual
// de "requer triagem manual".
const PENDING_FOLDER_NAME = '_Sem-Pasta';

/**
 * Normaliza um nome para comparação fuzzy:
 * - lowercase
 * - remove acentos
 * - remove prefixos numéricos (ex: "123 - ", "01- ")
 * - remove caracteres especiais (mantém letras, números e espaços)
 * - trim e colapsa espaços múltiplos
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\d+\s*[-–—]\s*/, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula score de similaridade entre um nome de pasta e o nome buscado.
 * - 3: match exato após normalização
 * - 2: nome normalizado começa com o buscado
 * - 1: nome normalizado contém o buscado
 * - 0: sem match
 */
function matchScore(folderName: string, searchName: string): number {
  const normalizedFolder = normalizeName(folderName);
  const normalizedSearch = normalizeName(searchName);

  if (normalizedFolder === normalizedSearch) return 3;
  if (normalizedFolder.startsWith(normalizedSearch)) return 2;
  if (normalizedFolder.includes(normalizedSearch)) return 1;
  return 0;
}

/**
 * Encontra a melhor pasta correspondente entre os resultados do Drive.
 */
function findBestMatch(files: drive_v3.Schema$File[], searchName: string): FolderMatch | null {
  let best: FolderMatch | null = null;

  for (const file of files) {
    if (!file.id || !file.name) continue;
    const score = matchScore(file.name, searchName);
    if (score === 0) continue;

    if (!best || score > best.score) {
      best = { id: file.id, name: file.name, score };
    }
  }

  return best;
}

/**
 * Localiza um Drive compartilhado pelo nome, percorrendo todas as páginas.
 */
async function findSharedDrive(drive: drive_v3.Drive, name: string): Promise<string> {
  let pageToken: string | undefined;

  do {
    const res = await drive.drives.list({
      pageSize: 100,
      fields: 'nextPageToken, drives(id, name)',
      ...(pageToken ? { pageToken } : {})
    });

    logger.debug({ drives: res.data.drives?.map((d) => d.name) }, 'Drives compartilhados encontrados');

    const found = res.data.drives?.find((d) => d.name && matchScore(d.name, name) >= 3);
    if (found?.id) return found.id;

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  logger.warn(
    { sharedDriveName: name },
    'Drive compartilhado nao encontrado para a conta autenticada'
  );

  throw new AppError(
    500,
    'Não foi possível acessar o Google Drive compartilhado. ' +
    'Contate o administrador para verificar a autorização da conta de serviço.'
  );
}

/**
 * Busca uma pasta pelo nome dentro de um pai no Drive compartilhado,
 * usando fuzzy matching para lidar com variações de nome.
 * Se não existir, cria automaticamente.
 */
async function findOrCreateFolderInDrive(
  drive: drive_v3.Drive,
  name: string,
  driveId: string,
  parentId: string
): Promise<string> {
  const q = `mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;

  logger.debug({ folderName: name, normalizedName: normalizeName(name), parentId }, 'Buscando pasta no Drive compartilhado');

  const allFolders: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const listResponse = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name)',
      corpora: 'drive',
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 100,
      ...(pageToken ? { pageToken } : {})
    });

    if (listResponse.data.files) {
      allFolders.push(...listResponse.data.files);
    }
    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  const match = findBestMatch(allFolders, name);

  if (match) {
    logger.info(
      { folderId: match.id, folderName: match.name, searchName: name, score: match.score },
      `Pasta encontrada via fuzzy match (score ${match.score})`
    );
    return match.id;
  }

  logger.info({ folderName: name, parentId }, 'Nenhuma pasta correspondente encontrada, criando...');

  const createResponse = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id',
    supportsAllDrives: true
  });

  const newId = createResponse.data.id as string;
  logger.info({ folderId: newId, folderName: name }, 'Pasta criada com sucesso');
  return newId;
}

/**
 * Busca a pasta do cliente na raiz do Drive compartilhado usando fuzzy matching.
 * NUNCA cria a pasta automaticamente. Quando nao encontra, retorna null —
 * cabe ao chamador decidir se aborta ou usa um caminho de fallback.
 */
async function findClientFolderInDrive(
  drive: drive_v3.Drive,
  driveId: string,
  clientName: string
): Promise<string | null> {
  const q = `mimeType = 'application/vnd.google-apps.folder' and '${driveId}' in parents and trashed = false`;

  logger.debug({ clientName, normalizedName: normalizeName(clientName) }, 'Buscando pasta do cliente na raiz do Drive');

  const allFolders: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const listResponse = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name)',
      corpora: 'drive',
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 100,
      ...(pageToken ? { pageToken } : {})
    });

    if (listResponse.data.files) {
      allFolders.push(...listResponse.data.files);
    }
    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  const match = findBestMatch(allFolders, clientName);

  if (match) {
    logger.info(
      { folderId: match.id, folderName: match.name, searchName: clientName, score: match.score },
      `Pasta do cliente encontrada via fuzzy match (score ${match.score})`
    );
    return match.id;
  }

  logger.warn(
    {
      clientName,
      normalizedClientName: normalizeName(clientName),
      availableFolderCount: allFolders.length
    },
    'Pasta do cliente nao encontrada no Drive — chamador deve usar fallback'
  );

  return null;
}

export async function uploadReportToDrive(
  auth: OAuth2Client,
  options: {
    fileName: string;
    format: 'pdf' | 'gdoc';
    parentId: string;
    pdfBuffer?: Buffer;
    textContent: string;
  }
): Promise<UploadResult> {
  const drive = google.drive({ version: 'v3', auth });
  if (options.format === 'pdf' && !options.pdfBuffer) {
    throw new Error('PDF buffer not provided for PDF report.');
  }
  const mimeType = options.format === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.google-apps.document';

  const media = options.format === 'pdf'
    ? { mimeType: 'application/pdf', body: Readable.from(options.pdfBuffer as Buffer) }
    : { mimeType: 'text/plain', body: Readable.from(options.textContent) };

  logger.debug({ fileName: options.fileName, parentId: options.parentId }, 'Enviando relatório para o Drive');

  const response = await drive.files.create({
    requestBody: {
      name: options.fileName,
      mimeType,
      parents: [options.parentId]
    },
    media,
    fields: 'id, webViewLink',
    supportsAllDrives: true
  });

  logger.info({ fileId: response.data.id, fileName: options.fileName }, 'Relatório enviado com sucesso');

  return {
    fileId: response.data.id as string,
    webViewLink: response.data.webViewLink
  };
}

/**
 * Resolve a pasta-destino do relatorio no Drive compartilhado.
 *
 * Caminho feliz (location = 'client'):
 *   Drive Clientes DPG / [Cliente] / Relacionamento com Cliente / Relatorios / [Ano]
 *
 * Caminho de fallback (location = 'pending') — quando a pasta do cliente NAO
 * existe no Drive:
 *   Drive Clientes DPG / _Sem-Pasta / [Ano]
 *
 * Garantia: nunca lanca por "pasta do cliente inexistente". Pasta do cliente
 * NUNCA e criada automaticamente — typos virariam pastas duplicadas.
 */
export async function ensureClientFolder(
  auth: OAuth2Client,
  clientFolderName: string,
  year: number
): Promise<{ yearFolderId: string; location: 'client' | 'pending' }> {
  const drive = google.drive({ version: 'v3', auth });

  const driveId = await findSharedDrive(drive, SHARED_DRIVE_NAME);
  logger.info({ driveId }, `Drive compartilhado "${SHARED_DRIVE_NAME}" localizado`);

  const clientFolderId = await findClientFolderInDrive(drive, driveId, clientFolderName);

  if (clientFolderId === null) {
    logger.warn(
      { clientFolderName, fallback: PENDING_FOLDER_NAME, year },
      `Cliente sem pasta no Drive — relatorio sera salvo em fallback "${PENDING_FOLDER_NAME}/${year}"`
    );
    const pendingFolderId = await findOrCreateFolderInDrive(drive, PENDING_FOLDER_NAME, driveId, driveId);
    const yearFolderId = await findOrCreateFolderInDrive(drive, String(year), driveId, pendingFolderId);
    return { yearFolderId, location: 'pending' };
  }

  let currentParentId = clientFolderId;
  for (const folderName of SUBFOLDER_PATH) {
    currentParentId = await findOrCreateFolderInDrive(drive, folderName, driveId, currentParentId);
  }

  const yearFolderId = await findOrCreateFolderInDrive(drive, String(year), driveId, currentParentId);

  return { yearFolderId, location: 'client' };
}
