/** Read old ciphertext with its original key ID; encrypt only with the current key. */
export function encryptionKey(keyId?: string): Buffer | null {
  const currentId = process.env.ACCESS_DATA_ENCRYPTION_KEY_ID?.trim() || 'v1';
  const requestedId = keyId || currentId;
  let raw: string | undefined;
  if (requestedId === currentId) raw = process.env.ACCESS_DATA_ENCRYPTION_KEY?.trim();
  else {
    let ring: Record<string, unknown>;
    try { ring = JSON.parse(process.env.ACCESS_DATA_ENCRYPTION_KEYRING || '{}'); }
    catch { throw new Error('Encryption keyring is not valid JSON.'); }
    if (!ring || Array.isArray(ring) || typeof ring !== 'object') throw new Error('Encryption keyring must map key IDs to base64 keys.');
    if (Object.hasOwn(ring, requestedId) && typeof ring[requestedId] === 'string') raw = String(ring[requestedId]).trim();
    else throw new Error('The historical encryption key is unavailable. Retain old keys until every dependent record has been re-encrypted and verified.');
  }
  if (!raw) return null;
  const normalized = raw.startsWith('base64:') ? raw.slice(7) : raw;
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(normalized)) throw new Error('Encryption keys must be base64-encoded 32-byte values.');
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) throw new Error('Invalid encryption key encoding.');
  return decoded;
}
