/**
 * @file utils/crypto.ts
 * @description Web Crypto API wrappers for encrypting sensitive tokens.
 *
 * Noledge stores GitHub Personal Access Tokens and Obsidian API tokens in
 * localStorage. Storing tokens in plain text is a security risk — if the
 * user's browser is compromised (XSS, malicious extension), attackers can
 * read localStorage and steal the tokens.
 *
 * Defense strategy:
 *   - Tokens are encrypted with AES-GCM (256-bit key, authenticated encryption)
 *   - The encryption key is derived from a per-session secret using PBKDF2
 *   - The key material never leaves the browser; only ciphertext is stored
 *   - This doesn't protect against a fully-compromised browser, but raises
 *     the bar significantly above plaintext storage
 *
 * Why AES-GCM?
 *   - It's authenticated encryption: it detects if the ciphertext was tampered
 *     with (the decrypt will fail with an error rather than producing garbage)
 *   - It's available in the Web Crypto API (browser-native, no library needed)
 *   - 256-bit keys are future-proof against brute force
 *
 * Note: This module is client-side only. It uses the Web Crypto API
 * (window.crypto.subtle), which is available in modern browsers but not
 * in Node.js. Server-side code must NOT import this module.
 */

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * PBKDF2_ITERATIONS — number of PBKDF2 iterations for key stretching.
 *
 * 100,000 iterations is the OWASP recommendation for PBKDF2 with SHA-256 as
 * of 2024. More iterations = slower to brute-force the key from the password,
 * but also slower to derive the key on each app load. 100k takes ~20ms on
 * a modern device, which is imperceptible to the user.
 */
const PBKDF2_ITERATIONS = 100_000;

/**
 * PBKDF2_HASH — the hash algorithm used in PBKDF2 key derivation.
 *
 * SHA-256 produces a 256-bit output, matching our AES-GCM key length.
 */
const PBKDF2_HASH = 'SHA-256';

/**
 * AES_KEY_LENGTH — AES-GCM key length in bits.
 *
 * 256 bits is the strongest AES variant. 128 bits is also secure, but we
 * use 256 for maximum headroom against future hardware improvements.
 */
const AES_KEY_LENGTH = 256;

/**
 * GCM_IV_LENGTH_BYTES — AES-GCM initialization vector (IV) length.
 *
 * 12 bytes (96 bits) is the recommended IV length for AES-GCM. A random IV
 * is generated for each encryption operation. The IV is stored alongside the
 * ciphertext (not secret) so it can be used for decryption.
 */
const GCM_IV_LENGTH_BYTES = 12;

// =============================================================================
// Utility: encode/decode between ArrayBuffer and base64
// =============================================================================

/**
 * bufferToBase64 — convert an ArrayBuffer to a base64 string.
 *
 * Used to serialize encrypted bytes and IVs for localStorage storage.
 * localStorage only stores strings, so binary data must be encoded.
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * base64ToBuffer — convert a base64 string back to an ArrayBuffer.
 *
 * Used when reading encrypted tokens from localStorage before decryption.
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * deriveKey — derive an AES-GCM key from a password string using PBKDF2.
 *
 * The password used in Noledge is a per-session random secret stored in
 * sessionStorage (not localStorage — sessionStorage is cleared when the
 * browser tab closes). The salt is stored alongside the ciphertext.
 *
 * Using a derived key (rather than a raw key) means the encryption depends
 * on the session secret — tokens become unreadable after the session ends.
 *
 * @param password  The secret string to derive the key from
 * @param salt      A random salt (to prevent precomputed attacks)
 * @returns         A CryptoKey object usable for AES-GCM operations
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  // Step 1: Import the password as a PBKDF2 key material.
  const passwordBuffer = new TextEncoder().encode(password);
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,          // Key is not extractable (cannot be exported)
    ['deriveKey']   // Allowed operations
  );

  // Step 2: Derive the actual AES-GCM key using PBKDF2.
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: AES_KEY_LENGTH,
    },
    false,                    // Derived key is also not extractable
    ['encrypt', 'decrypt']    // Can be used for both operations
  );
}

// =============================================================================
// Encrypt / Decrypt
// =============================================================================

/**
 * EncryptedData — the serialized form of an encrypted token stored in localStorage.
 *
 * All fields are base64-encoded strings (since localStorage is string-only).
 *
 * Fields:
 *   ciphertext — the encrypted token bytes
 *   iv         — the initialization vector used for this encryption (not secret)
 *   salt       — the PBKDF2 salt used for key derivation (not secret)
 */
export interface EncryptedData {
  ciphertext: string;
  iv: string;
  salt: string;
}

/**
 * encryptToken — encrypt a plaintext token string using AES-GCM.
 *
 * @param plaintext  The token to encrypt (e.g. a GitHub PAT)
 * @param password   The session secret used for key derivation
 * @returns          An EncryptedData object ready for localStorage storage
 * @throws           If the Web Crypto API is not available or encryption fails
 */
export async function encryptToken(plaintext: string, password: string): Promise<EncryptedData> {
  // Generate fresh random IV and salt for this encryption.
  // Using a new random IV for each encryption prevents ciphertext patterns
  // from revealing that the same plaintext was encrypted multiple times.
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH_BYTES));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await deriveKey(password, salt);

  const plaintextBuffer = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintextBuffer
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv.buffer),
    salt: bufferToBase64(salt.buffer),
  };
}

/**
 * decryptToken — decrypt an EncryptedData object back to the plaintext token.
 *
 * @param encrypted  The stored encrypted data from localStorage
 * @param password   The session secret (must match the one used to encrypt)
 * @returns          The decrypted plaintext token string
 * @throws           If decryption fails (wrong password, tampered data, etc.)
 */
export async function decryptToken(encrypted: EncryptedData, password: string): Promise<string> {
  const iv = new Uint8Array(base64ToBuffer(encrypted.iv));
  const salt = new Uint8Array(base64ToBuffer(encrypted.salt));
  const ciphertextBuffer = base64ToBuffer(encrypted.ciphertext);

  const key = await deriveKey(password, salt);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertextBuffer
  );

  return new TextDecoder().decode(plaintextBuffer);
}

// =============================================================================
// Session Secret Management
// =============================================================================

/**
 * SESSION_SECRET_KEY — sessionStorage key for the per-session secret.
 *
 * Stored in sessionStorage (not localStorage) so it's cleared when the
 * browser tab closes. This means tokens become unreadable after closing
 * the tab — the user must re-enter them. This is an intentional security
 * trade-off: convenience (auto-loaded on re-open) vs. security (tokens
 * locked after tab close).
 *
 * TODO: In a future version, offer a "remember me" option that derives the
 * key from a user-set PIN stored in a more persistent (but still ephemeral)
 * way.
 */
const SESSION_SECRET_KEY = 'noledge:session_secret';

/**
 * getOrCreateSessionSecret — retrieve or generate the per-session secret.
 *
 * If a secret already exists in sessionStorage, return it.
 * If not, generate a new random 32-byte secret, store it, and return it.
 * The secret is stored as a hex string for reliability across JSON parsing.
 *
 * @returns The hex-encoded session secret string
 */
export function getOrCreateSessionSecret(): string {
  const existing = sessionStorage.getItem(SESSION_SECRET_KEY);
  if (existing) return existing;

  // Generate 32 random bytes (256 bits) as the session secret.
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(secret).map((b) => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(SESSION_SECRET_KEY, hex);
  return hex;
}

/**
 * generateDeviceId — generate a stable UUID for this device.
 *
 * Uses the Web Crypto API's randomUUID() method (available in modern browsers).
 * Falls back to a manual UUID v4 construction for older environments.
 *
 * @returns A UUID v4 string
 */
export function generateDeviceId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// =============================================================================
// Convenience wrappers (auto-manage session secret)
// =============================================================================

/**
 * encrypt — convenience wrapper: encrypt a string using the session secret.
 * Returns a JSON-serialised string safe for localStorage.
 */
export async function encrypt(plaintext: string): Promise<string> {
  const password = getOrCreateSessionSecret();
  const data = await encryptToken(plaintext, password);
  return JSON.stringify(data);
}

/**
 * decrypt — convenience wrapper: decrypt a JSON-serialised EncryptedData string.
 */
export async function decrypt(serialised: string): Promise<string> {
  const password = getOrCreateSessionSecret();
  const data = JSON.parse(serialised) as EncryptedData;
  return decryptToken(data, password);
}

