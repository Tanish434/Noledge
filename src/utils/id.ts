/**
 * @file utils/id.ts
 * @description Standard library UUID / unique ID generator for entities across Noledge.
 * Uses standard Web Crypto API crypto.randomUUID() supported natively in modern browsers and Node.js.
 */

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a prefixed unique identifier (e.g., "msg-...", "sess-...", "q-...")
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}-${generateUUID()}`;
}
