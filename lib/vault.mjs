// Encryption for secrets GiroTrack must be able to read back: vendor portal
// passwords and authenticator seeds. AES-256-GCM, a fresh random 96-bit nonce
// per encryption, and associated data binding each value to its owner (a
// password copied onto another vendor fails to decrypt).
//
// Keys are versioned so they can be rotated without losing data:
//   GIROTRACK_VAULT_KEY      current key, base64 of 32 random bytes (encrypts everything new)
//   GIROTRACK_VAULT_KEY_ID   its id (default "1")
//   GIROTRACK_VAULT_OLD_KEYS earlier keys still needed to read older values: "1:<base64>,2:<base64>"
// Values written before versioning (no key id) were encrypted with key "1".
// Keys never leave the server; errors never include them.

const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;
const LEGACY_KEY_ID = '1';

export class VaultError extends Error {}

function decodeKey(text, id) {
  let raw;
  try {
    raw = Uint8Array.from(atob(String(text).trim()), (c) => c.charCodeAt(0));
  } catch {
    raw = null;
  }
  if (!raw || raw.length !== 32) throw new VaultError(`Vault key "${id}" must be 32 random bytes, base64-encoded.`);
  return raw;
}

/**
 * The configured keys, or null when no key is configured. `config` is the
 * runtime environment (or, for older callers and tests, the current key as a
 * string). Throws VaultError when a key is malformed, so a broken
 * configuration stops instead of silently writing unreadable data.
 */
export function keyring(config) {
  const env = typeof config === 'string' || config == null ? { GIROTRACK_VAULT_KEY: config } : config;
  if (!env.GIROTRACK_VAULT_KEY) return null;
  const currentId = env.GIROTRACK_VAULT_KEY_ID || LEGACY_KEY_ID;
  if (!KEY_ID.test(currentId)) throw new VaultError('GIROTRACK_VAULT_KEY_ID may use letters, digits, - and _ (up to 16).');
  const keys = new Map([[currentId, decodeKey(env.GIROTRACK_VAULT_KEY, currentId)]]);
  for (const part of String(env.GIROTRACK_VAULT_OLD_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(':');
    const id = part.slice(0, at);
    if (at < 1 || !KEY_ID.test(id) || keys.has(id)) throw new VaultError('GIROTRACK_VAULT_OLD_KEYS must look like "1:<base64>,2:<base64>" with distinct ids.');
    keys.set(id, decodeKey(part.slice(at + 1), id));
  }
  return { currentId, keys, imported: new Map() };
}

async function cryptoKey(ring, id) {
  const raw = ring.keys.get(id);
  if (!raw) throw new VaultError(`Vault key "${id}" is not configured, so this value can't be opened. Add it to GIROTRACK_VAULT_OLD_KEYS.`);
  if (!ring.imported.has(id)) ring.imported.set(id, crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  return ring.imported.get(id);
}

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const encode = (text) => new TextEncoder().encode(text);

/** Encrypt with the current key: {v:2, kid, iv, data}. */
export async function encryptSecret(ring, plaintext, aad) {
  if (!ring) throw new VaultError('Credential storage is not configured.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(aad) }, await cryptoKey(ring, ring.currentId), encode(plaintext));
  return { v: 2, kid: ring.currentId, iv: toBase64(iv), data: toBase64(data) };
}

/** Which key a stored value needs (null when it isn't a value this module wrote). */
export function keyIdOf(box) {
  if (box?.v === 2 && typeof box.kid === 'string') return box.kid;
  if (Array.isArray(box?.iv) && Array.isArray(box?.cipher)) return LEGACY_KEY_ID; // portal passwords before versioning
  if (typeof box?.iv === 'string' && typeof box?.data === 'string' && box.v === undefined) return LEGACY_KEY_ID; // authenticator seeds before versioning
  return null;
}

/** Decrypt any stored format. Throws on a missing key, wrong owner or tampering. */
export async function decryptSecret(ring, box, aad) {
  if (!ring) throw new VaultError('Credential storage is not configured.');
  const id = keyIdOf(box);
  if (!id) throw new VaultError('Unrecognized encrypted value.');
  let iv, data, params;
  if (box.v === 2) {
    iv = fromBase64(box.iv);
    data = fromBase64(box.data);
    params = { name: 'AES-GCM', iv, additionalData: encode(aad) };
  } else if (Array.isArray(box.iv)) {
    iv = new Uint8Array(box.iv);
    data = new Uint8Array(box.cipher);
    params = { name: 'AES-GCM', iv };
  } else {
    iv = fromBase64(box.iv);
    data = fromBase64(box.data);
    params = { name: 'AES-GCM', iv };
  }
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt(params, await cryptoKey(ring, id), data));
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError('An encrypted value could not be opened (wrong key or altered data).');
  }
}

/** True when a value should be re-encrypted with the current key (older key or older format). */
export const needsReencryption = (ring, box) => !!ring && (box?.v !== 2 || box.kid !== ring.currentId);

export const credentialAad = (payer) => `girotrack:credential:${payer}`;
export const totpAad = (userId) => `girotrack:totp:${userId}`;
