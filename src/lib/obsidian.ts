/**
 * @file lib/obsidian.ts
 * @description Obsidian vault integration via the Local REST API plugin.
 *
 * Obsidian itself is a desktop app — it doesn't expose a web API by default.
 * We use the "Local REST API" community plugin, which runs a local HTTP server
 * inside Obsidian (default port: 27123). This allows Noledge to:
 *   1. List all Markdown files in the vault
 *   2. Read file content by path
 *   3. Create and update files (for writing back progress metadata)
 *   4. Watch for changes (via polling, since the API doesn't support WebSockets)
 *
 * SETUP REQUIREMENTS:
 *   1. Install the "Local REST API" plugin in Obsidian
 *   2. Enable HTTPS in the plugin settings (required for browser security)
 *   3. Copy the API key from the plugin settings
 *   4. In Noledge, enter the vault URL (https://127.0.0.1:27123) + API key
 *
 * HTTPS NOTE:
 * The Local REST API plugin uses a self-signed certificate. Browsers block
 * HTTPS requests to self-signed certs by default. The user must:
 *   1. Visit https://127.0.0.1:27123 in their browser
 *   2. Click "Advanced" → "Proceed to 127.0.0.1"
 *   3. This adds a security exception for that origin
 * This is a one-time setup step.
 *
 * MOBILE NOTE:
 * On mobile, Obsidian is not on the same device, so the Obsidian integration
 * only works when the phone is on the same network as the Obsidian machine,
 * OR when Obsidian is configured to expose the API over the local network.
 * For mobile-first usage, GitHub is the recommended data source.
 */

import { decrypt } from '@/utils/crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('sync');

// =============================================================================
// Types
// =============================================================================

/**
 * ObsidianConfig — connection details for an Obsidian vault.
 */
export interface ObsidianConfig {
  vault_url: string;     // e.g. 'https://127.0.0.1:27123'
  token_key: string;     // localStorage key for encrypted API key
  vault_path: string;    // Root path within vault for question files (default: '/')
}

/**
 * ObsidianFile — file entry from the Obsidian vault file listing.
 */
export interface ObsidianFile {
  path: string;
  basename: string;
  extension: string;
  stat: {
    ctime: number;   // Creation timestamp (ms)
    mtime: number;   // Modification timestamp (ms)
    size: number;
  };
}

// =============================================================================
// Token Management
// =============================================================================

async function getToken(tokenKey: string): Promise<string> {
  const encrypted = localStorage.getItem(tokenKey);
  if (!encrypted) {
    throw new Error(`Obsidian API key not found. Please reconnect your Obsidian vault.`);
  }
  return decrypt(encrypted);
}

// =============================================================================
// HTTP Client
// =============================================================================

/**
 * obsidianFetch — authenticated fetch to the Obsidian Local REST API.
 *
 * Uses the `Authorization: Bearer <token>` header required by the plugin.
 * The `mode: 'cors'` is required because the request crosses from the PWA
 * origin to the localhost API origin.
 */
async function obsidianFetch(
  vaultUrl: string,
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${vaultUrl.replace(/\/$/, '')}${path}`;

  const response = await fetch(url, {
    ...options,
    mode: 'cors',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ObsidianAPIError(`Obsidian API error ${response.status}: ${body}`, response.status);
  }

  return response;
}

// =============================================================================
// Error Type
// =============================================================================

export class ObsidianAPIError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ObsidianAPIError';
  }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * listMarkdownFiles — list all Markdown files in the configured vault path.
 *
 * @param config  Obsidian connection configuration
 * @returns       Array of ObsidianFile entries
 */
export async function listMarkdownFiles(config: ObsidianConfig): Promise<ObsidianFile[]> {
  const done = log.timed('info', 'obsidian_list_files', 'Listing Obsidian vault files');
  const token = await getToken(config.token_key);

  const response = await obsidianFetch(config.vault_url, '/vault/', token);
  const data = await response.json() as { files: ObsidianFile[] };

  // Filter to Markdown files in the configured path
  const rootPath = config.vault_path === '/' ? '' : config.vault_path;
  const mdFiles = data.files.filter(
    (f) => f.extension === 'md' && f.path.startsWith(rootPath)
  );

  done({ count: mdFiles.length });
  return mdFiles;
}

/**
 * fetchFileContent — read a single Obsidian vault file's content.
 *
 * Uses the /vault/{path} endpoint which returns raw file content.
 *
 * @param filePath  Vault-relative file path (e.g. 'decks/biology/cell-theory.md')
 * @param config    Obsidian connection configuration
 * @returns         File content as a string
 */
export async function fetchFileContent(filePath: string, config: ObsidianConfig): Promise<string> {
  const token = await getToken(config.token_key);
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/');
  const response = await obsidianFetch(config.vault_url, `/vault/${encodedPath}`, token);
  return response.text();
}

/**
 * writeFileContent — write content back to a vault file.
 *
 * Used for writing back metadata (e.g., SRS data as YAML frontmatter) to
 * question files so the vault stays in sync with study progress.
 *
 * Note: This is an optional feature. Most users prefer to keep their vault
 * read-only from Noledge's perspective. The write-back is disabled by default.
 *
 * @param filePath  Vault-relative file path
 * @param content   New file content
 * @param config    Obsidian connection configuration
 */
export async function writeFileContent(
  filePath: string,
  content: string,
  config: ObsidianConfig
): Promise<void> {
  const token = await getToken(config.token_key);
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/');

  await obsidianFetch(config.vault_url, `/vault/${encodedPath}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown' },
    body: content,
  });

  log.info('obsidian_write', `Written ${filePath} to Obsidian vault`);
}

/**
 * validateConnection — verify the Obsidian API is reachable with the given config.
 *
 * @param config  Obsidian connection configuration
 * @param token   Plaintext API key (not yet stored)
 * @returns       null if valid, error message string if invalid
 */
export async function validateConnection(
  config: Omit<ObsidianConfig, 'token_key'>,
  token: string
): Promise<string | null> {
  try {
    const response = await fetch(`${config.vault_url.replace(/\/$/, '')}/`, {
      mode: 'cors',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 401) return 'Invalid API key. Copy it from Obsidian → Settings → Local REST API.';
    if (!response.ok) return `Could not connect to Obsidian (status ${response.status}).`;

    return null;
  } catch (error) {
    const msg = (error as Error).message || '';
    if (msg.includes('CORS') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return 'Cannot reach Obsidian Local REST API. Make sure the plugin is installed, enabled, and HTTPS is set up. You may need to visit https://127.0.0.1:27123 in your browser to accept the certificate.';
    }
    return `Connection error: ${msg}`;
  }
}
