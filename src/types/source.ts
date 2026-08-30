/**
 * @file source.ts
 * @description Types for external data sources (GitHub, Obsidian).
 *
 * A "Source" in Noledge is a configured connection to an external content
 * repository — either a GitHub repository or an Obsidian vault. Sources are
 * the origin of question content; they're not question containers themselves
 * (that's the Deck's job).
 *
 * One Source can back multiple Decks. For example, a GitHub repo named
 * "my-revision-notes" might contain folders "biology/", "chemistry/", and
 * "physics/" — each of which becomes its own Deck, all backed by the same
 * Source record.
 *
 * Sources are stored in localStorage / Zustand (not Supabase) because they
 * contain authentication tokens that should not be synced to a cloud DB.
 * The Supabase `decks` table stores source configuration minus the token.
 */

// =============================================================================
// GitHub Source Configuration
// =============================================================================

/**
 * GitHubSource — configuration for a connected GitHub repository.
 *
 * Fields:
 *   id         — Locally-generated UUID (not from GitHub)
 *   owner      — GitHub username or organization name
 *   repo       — Repository name (without owner prefix)
 *   branch     — Branch to read from. Defaults to 'main'.
 *   token      — Personal Access Token (PAT) for private repo access.
 *                IMPORTANT: This is stored encrypted in localStorage using
 *                the Web Crypto API. It is NEVER sent to Supabase. It is
 *                passed to the Next.js API route on the same origin via
 *                a short-lived session reference.
 *   tree_sha   — The git tree SHA of the last successfully fetched state.
 *                Used to detect changes without fetching full file content
 *                on every sync (compare tree SHA first, only diff if changed).
 *   label      — Human-readable label shown in the UI (defaults to owner/repo)
 *   created_at — ISO 8601 when this source was connected
 */
export interface GitHubSource {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  token?: string;       // encrypted in storage, see lib/crypto.ts
  tree_sha?: string;
  label: string;
  path?: string;
  vault_path?: string;
  is_folder?: boolean;
  file_list?: Array<{ path: string; name: string; question_count: number }>;
  created_at: string;
}

// =============================================================================
// Obsidian Source Configuration
// =============================================================================

/**
 * ObsidianSource — configuration for a connected Obsidian vault.
 *
 * Obsidian vaults are local-first. Noledge reads them via one of two methods
 * (determined by the `access_method` field):
 *
 *   'local-rest-api' — The user has the "Local REST API" community plugin
 *     installed in Obsidian. Noledge calls it at http://localhost:27123.
 *     This method works on desktop only (laptop). On phone, Obsidian's
 *     local REST API is not accessible from a browser (CORS + no localhost).
 *
 *   'cloud-sync'     — The vault is synced to a cloud folder (iCloud,
 *     OneDrive, Syncthing, Dropbox). On desktop, the Next.js API route reads
 *     the synced folder directly from the filesystem. On phone, this method
 *     requires the sync to be up-to-date. Noledge treats the cloud-synced
 *     state as the source of truth.
 *
 * Fields:
 *   id            — Locally-generated UUID
 *   vault_name    — The name of the vault (folder name on disk)
 *   vault_path    — Absolute filesystem path to the vault root.
 *                   Only used for 'cloud-sync' method via the API route.
 *   access_method — Which of the two read methods to use
 *   api_port      — (local-rest-api only) Port the plugin listens on.
 *                   Default: 27123. Configurable per the plugin settings.
 *   api_token     — (local-rest-api only) Bearer token shown in plugin settings.
 *                   Stored encrypted. Never sent to Supabase.
 *   label         — Human-readable label in the UI
 *   created_at    — ISO 8601
 */
export interface ObsidianSource {
  id: string;
  vault_name: string;
  vault_path?: string;
  access_method: 'local-rest-api' | 'cloud-sync';
  api_port?: number;
  api_token?: string;   // encrypted in storage
  label: string;
  is_folder?: boolean;
  file_list?: Array<{ path: string; name: string; question_count: number }>;
  created_at: string;
}

// =============================================================================
// Unified Source Type
// =============================================================================

/**
 * Source — a discriminated union of all source types.
 *
 * The `kind` field is the discriminant. Code that handles both source types
 * can switch on `source.kind` for type-safe narrowing:
 *
 *   if (source.kind === 'github') {
 *     // TypeScript knows this is GitHubSource here
 *   }
 */
export type Source =
  | ({ kind: 'github' } & GitHubSource)
  | ({ kind: 'obsidian' } & ObsidianSource);

// =============================================================================
// Source Status
// =============================================================================

/**
 * SourceStatus — runtime connection status of a source.
 *
 * Polled periodically and on sync attempts. Displayed in the UI as a
 * colored indicator next to each connected source.
 *
 * 'connected'    — Successfully fetched content in the last sync attempt
 * 'disconnected' — Cannot reach the source (network down, plugin off, etc.)
 * 'error'        — Reached the source but got an error (401, 404, parse fail)
 * 'syncing'      — Currently fetching content
 * 'pending'      — Source configured but never synced yet
 */
export type SourceStatus = 'connected' | 'disconnected' | 'error' | 'syncing' | 'pending';

/**
 * SourceWithStatus — a source bundled with its runtime connection status.
 *
 * This is what the SourceManager component displays. The status is NOT
 * persisted — it's derived fresh each time the app loads and updated
 * during sync operations.
 */
export interface SourceWithStatus {
  source: Source;
  status: SourceStatus;
  error_message?: string;
  last_synced?: string;
  file_count?: number;
}
