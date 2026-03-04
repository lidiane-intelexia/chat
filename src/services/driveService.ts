import { google, drive_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';

export interface UploadResult {
  fileId: string;
  webViewLink?: string | null;
}

function buildFolderQuery(name: string, parentId?: string) {
  const escapedName = name.replace(/'/g, "\\'");
  const parentFilter = parentId ? ` and '${parentId}' in parents` : '';
  return `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false${parentFilter}`;
}

export async function findOrCreateFolder(
  auth: OAuth2Client,
  name: string,
  parentId?: string
) {
  const drive = google.drive({ version: 'v3', auth });

  const listResponse = await drive.files.list({
    q: buildFolderQuery(name, parentId),
    fields: 'files(id, name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  const existing = listResponse.data.files?.[0];
  if (existing?.id) return existing.id;

  const createResponse = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined
    },
    fields: 'id',
    supportsAllDrives: true
  });

  return createResponse.data.id as string;
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
    ? { mimeType: 'application/pdf', body: options.pdfBuffer as Buffer }
    : { mimeType: 'text/plain', body: options.textContent };

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

  return {
    fileId: response.data.id as string,
    webViewLink: response.data.webViewLink
  };
}

export async function ensureClientFolder(
  auth: OAuth2Client,
  clientFolderName: string,
  year: number
) {
  const rootId = env.DRIVE_ROOT_FOLDER_ID;
  const clientFolderId = await findOrCreateFolder(auth, clientFolderName, rootId);
  const yearFolderId = await findOrCreateFolder(auth, String(year), clientFolderId);
  return { clientFolderId, yearFolderId };
}
