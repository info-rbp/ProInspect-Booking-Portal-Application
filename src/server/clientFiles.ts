import { randomUUID } from 'crypto';
import { adminStorageBucket } from './firebaseAdmin.js';

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
]);

function safeFileName(value: string): string {
  const base = value
    .trim()
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
  return base || 'document';
}

export function validateClientUpload(params: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): string | null {
  if (!params.fileName.trim()) return 'A file name is required.';
  if (!ALLOWED_CONTENT_TYPES.has(params.contentType)) {
    return 'This file type is not supported.';
  }
  if (params.sizeBytes <= 0) return 'The uploaded file is empty.';
  if (params.sizeBytes > 10 * 1024 * 1024) {
    return 'Files must be 10 MB or smaller.';
  }
  return null;
}

export async function saveClientFile(params: {
  organisationId: string;
  uploadedByUid: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}): Promise<{ storagePath: string; fileName: string; sizeBytes: number }> {
  const fileName = safeFileName(params.fileName);
  const storagePath = [
    'client-files',
    params.organisationId,
    params.uploadedByUid,
    randomUUID(),
    fileName,
  ].join('/');

  const file = adminStorageBucket.file(storagePath);
  await file.save(params.bytes, {
    resumable: false,
    contentType: params.contentType,
    metadata: {
      cacheControl: 'private, max-age=0, no-store',
    },
  });

  return {
    storagePath,
    fileName,
    sizeBytes: params.bytes.length,
  };
}

export async function saveGeneratedClientFile(params: {
  organisationId: string;
  generatedByUid: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}): Promise<{ storagePath: string; fileName: string; sizeBytes: number }> {
  return saveClientFile({
    organisationId: params.organisationId,
    uploadedByUid: params.generatedByUid,
    fileName: params.fileName,
    contentType: params.contentType,
    bytes: params.bytes,
  });
}

export function openClientFileStream(storagePath: string) {
  return adminStorageBucket.file(storagePath).createReadStream();
}

export async function clientFileExists(storagePath: string): Promise<boolean> {
  const [exists] = await adminStorageBucket.file(storagePath).exists();
  return exists;
}

export async function deleteClientFile(storagePath: string): Promise<void> {
  if (!storagePath.startsWith('client-files/') || storagePath.includes('..')) throw new Error('Invalid file cleanup path.');
  await adminStorageBucket.file(storagePath).delete({ ignoreNotFound: true });
}
