import { randomBytes } from 'crypto';
import { adminBucket } from './firebaseAdmin.js';

export const TENANT_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
]);

export const TENANT_FILE_MAX_BYTES = 20 * 1024 * 1024;

export function tenantStorageIsConfigured(): boolean {
  return Boolean(adminBucket);
}

function requireBucket() {
  if (!adminBucket) {
    throw new Error('TENANT_STORAGE_NOT_CONFIGURED');
  }
  return adminBucket;
}

function safeFileName(fileName: string): string {
  const cleaned = fileName
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._ -]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);

  return cleaned || 'attachment';
}

function uniqueObjectName(fileName: string): string {
  return `${Date.now()}-${randomBytes(5).toString('hex')}-${safeFileName(fileName)}`;
}

export function validateTenantFile(params: {
  contentType?: string;
  size: number;
}) {
  const contentType = (params.contentType || '').split(';')[0].trim().toLowerCase();
  if (!TENANT_FILE_TYPES.has(contentType)) {
    throw new Error('TENANT_FILE_TYPE_NOT_ALLOWED');
  }
  if (!Number.isFinite(params.size) || params.size <= 0 || params.size > TENANT_FILE_MAX_BYTES) {
    throw new Error('TENANT_FILE_SIZE_INVALID');
  }
  return contentType;
}

export async function saveTenantRequestAttachment(params: {
  requestId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}) {
  const bucket = requireBucket();
  const contentType = validateTenantFile({
    contentType: params.contentType,
    size: params.bytes.length,
  });
  const objectName = uniqueObjectName(params.fileName);
  const storagePath = `tenant-portal/requests/${params.requestId}/${objectName}`;
  const file = bucket.file(storagePath);

  await file.save(params.bytes, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'private, max-age=0, no-store',
      metadata: {
        requestId: params.requestId,
        originalFileName: params.fileName,
      },
    },
  });

  return {
    storagePath,
    fileName: safeFileName(params.fileName),
    contentType,
    size: params.bytes.length,
  };
}

export async function saveTenantDocumentFile(params: {
  tenancyId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}) {
  const bucket = requireBucket();
  const contentType = validateTenantFile({
    contentType: params.contentType,
    size: params.bytes.length,
  });
  const objectName = uniqueObjectName(params.fileName);
  const storagePath = `tenant-portal/documents/${params.tenancyId}/${objectName}`;
  const file = bucket.file(storagePath);

  await file.save(params.bytes, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'private, max-age=0, no-store',
      metadata: {
        tenancyId: params.tenancyId,
        originalFileName: params.fileName,
      },
    },
  });

  return {
    storagePath,
    fileName: safeFileName(params.fileName),
    contentType,
    size: params.bytes.length,
  };
}

export async function signedTenantFileUrl(storagePath: string): Promise<string> {
  const bucket = requireBucket();
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: 'read',
    version: 'v4',
    expires: Date.now() + 15 * 60_000,
  });
  return url;
}

export async function deleteTenantFile(storagePath: string): Promise<void> {
  const bucket = requireBucket();
  await bucket.file(storagePath).delete({ ignoreNotFound: true });
}
