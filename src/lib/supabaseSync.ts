/**
 * @file lib/supabaseSync.ts
 * @description Supabase Auth bridge — Cloud DB data table sync removed.
 *              All question/deck/study data stays in local files, Obsidian, and GitHub.
 *              Supabase handles Auth login credentials only.
 */

export function toUUID(id: string): string {
  if (!id) return '00000000-0000-4000-a000-000000000000';
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  if (isUUID) return id;

  let hash1 = 5381;
  let hash2 = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 31) + char;
  }
  const hex1 = Math.abs(hash1).toString(16).padStart(8, '0');
  const hex2 = Math.abs(hash2).toString(16).padStart(8, '0');
  const fullHex = (hex1 + hex2 + hex1 + hex2).padEnd(32, '0').slice(0, 32);

  return `${fullHex.slice(0, 8)}-${fullHex.slice(8, 12)}-4${fullHex.slice(13, 16)}-a${fullHex.slice(17, 20)}-${fullHex.slice(20, 32)}`;
}

export async function syncSupabaseCloud(): Promise<{ synced: number; failed: number }> {
  return { synced: 0, failed: 0 };
}

export async function pushDeck(): Promise<void> {}
export async function pushQuestion(): Promise<void> {}
export async function pushSRSProgress(): Promise<void> {}
export async function deleteQuestionFromSupabase(): Promise<void> {}
export async function deleteDeckFromSupabase(): Promise<void> {}
