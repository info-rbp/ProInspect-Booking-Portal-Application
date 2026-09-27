import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import type { AccessDetails } from '../types/booking.js';
import type { SensitiveAccessSecrets } from './bookingValidation.js';

export interface EncryptedAccessSecretsDocument {
  version: 1;
  algorithm: 'aes-256-gcm';
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

function encryptionKey(): Buffer | null {
  const raw = process.env.ACCESS_DATA_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  const normalized = raw.startsWith('base64:') ? raw.slice(7) : raw;
  const decoded = Buffer.from(normalized, 'base64');

  if (decoded.length !== 32) {
    throw new Error(
      'ACCESS_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.'
    );
  }

  return decoded;
}

export function accessEncryptionIsConfigured(): boolean {
  return Boolean(process.env.ACCESS_DATA_ENCRYPTION_KEY?.trim());
}

export function encryptAccessSecrets(
  bookingId: string,
  secrets: SensitiveAccessSecrets
): EncryptedAccessSecretsDocument {
  const key = encryptionKey();
  if (!key) {
    throw new Error('Sensitive access encryption is not configured.');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`booking:${bookingId}`, 'utf8'));

  const plaintext = Buffer.from(JSON.stringify(secrets), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const now = new Date().toISOString();

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    keyId: process.env.ACCESS_DATA_ENCRYPTION_KEY_ID?.trim() || 'v1',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    createdAt: now,
    updatedAt: now,
  };
}

export function decryptAccessSecrets(
  bookingId: string,
  encrypted: EncryptedAccessSecretsDocument
): SensitiveAccessSecrets {
  if (encrypted.version !== 1 || encrypted.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted access-secret format.');
  }

  const key = encryptionKey();
  if (!key) {
    throw new Error('Sensitive access encryption is not configured.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64')
  );
  decipher.setAAD(Buffer.from(`booking:${bookingId}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(plaintext) as SensitiveAccessSecrets;
}

export function restoreSensitiveAccess(
  access: AccessDetails,
  secrets?: SensitiveAccessSecrets
): AccessDetails {
  if (!secrets) return access;

  return {
    ...access,
    ...(access.lockbox
      ? {
          lockbox: {
            ...access.lockbox,
            ...(secrets.lockboxCode ? { code: secrets.lockboxCode } : {}),
          },
        }
      : {}),
    ...(access.vacant
      ? {
          vacant: {
            ...access.vacant,
            ...(secrets.securityAlarm ? { securityAlarm: secrets.securityAlarm } : {}),
          },
        }
      : {}),
  };
}
