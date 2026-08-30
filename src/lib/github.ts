/**
 * @file lib/github.ts
 * @description GitHub REST API client for fetching question files from repos.
 *
 * Noledge connects to a GitHub repo as a data source. Questions are stored
 * as Markdown files in the repo using the Noledge question format (see
 * lib/markdownParser.ts for format spec). This module handles all GitHub API
 * communication: listing files, fetching content, and watching for changes.
 *
 * AUTHENTICATION:
 * GitHub tokens are stored encrypted in localStorage (via lib/utils/crypto.ts)
 * and decrypted on-demand when making API calls. Tokens are NEVER sent to our
 * backend or stored in a database — all GitHub API calls go directly from
 * the browser to api.github.com.
 *
 * RATE LIMITS:
 * Unauthenticated: 60 requests/hour
 * Authenticated:   5,000 requests/hour
 * We always require a token to avoid the unauthenticated limit.
 *
 * CACHING:
 * GitHub API responses include ETag and Last-Modified headers. We store these
 * in localStorage alongside the repo data and send them as If-None-Match /
 * If-Modified-Since on subsequent requests. GitHub returns 304 Not Modified
 * when nothing has changed — this doesn't count against rate limits.
 *
 * FILE STRUCTURE:
 * The connected repo should have question files at paths matching a configured
 * glob pattern. Default: any *.md file anywhere in the repo.
 * Example layout:
 *   /decks/biology/cell-theory.md
 *   /decks/chemistry/periodic-table.md
 *   /README.md (ignored — no Noledge question frontmatter)
 */

import { decrypt } from '@/utils/crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('sync');

// =============================================================================
// Types
// =============================================================================

/**
 * GitHubConfig — the connection details for a GitHub source.
 *
 * Stored (encrypted) in the source store. Decrypted only when making API calls.
 */
export interface GitHubConfig {
  owner: string;       // GitHub username or org
  repo: string;        // Repository name
  branch: string;      // Branch to watch (default: 'main')
  path: string;        // Root path within repo (default: '/')
  token_key: string;   // localStorage key where the encrypted token is stored
}

/**
 * GitHubFile — a file entry from the GitHub Tree API.
 */
export interface GitHubFile {
  path: string;
  sha: string;
  size: number;
  url: string;
  download_url: string | null;
}

/**
 * GitHubContent — response from the GitHub Contents API (single file).
 */
interface GitHubContent {
  content: string;     // Base64-encoded file content
  encoding: 'base64';
  sha: string;
  name: string;
  path: string;
}

// =============================================================================
// HTTP Client
// =============================================================================

/**
 * githubFetch — authenticated fetch to the GitHub REST API.
 *
 * Adds the Authorization header with the decrypted PAT token.
 * Uses the GitHub REST API v3 base URL and sets the accept header
 * to request the v3 JSON response format.
 *
 * @param url     GitHub API URL (relative to https://api.github.com or absolute)
 * @param token   GitHub Personal Access Token (plaintext, already decrypted)
 * @param options Additional fetch options
 */
async function githubFetch(
  url: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const fullUrl = url.startsWith('http') ? url : `https://api.github.com${url}`;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Noledge-App',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }

  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  // Log rate limit info for debugging
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');
  if (remaining) {
    log.debug('github_rate_limit', `GitHub API: ${remaining} requests remaining`, {
      remaining,
      reset_at: reset ? new Date(parseInt(reset) * 1000).toISOString() : null,
    });
  }

  if (!response.ok && response.status !== 304) {
    const errorBody = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new GitHubAPIError(
      `GitHub API error ${response.status}: ${(errorBody as { message?: string }).message ?? response.statusText}`,
      response.status
    );
  }

  return response;
}

// =============================================================================
// Error Type
// =============================================================================

/**
 * GitHubAPIError — thrown when the GitHub API returns an error status.
 *
 * Extends Error with an HTTP status code for error handling by callers.
 */
export class GitHubAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

// =============================================================================
// Token Management
// =============================================================================

/**
 * getToken — decrypt and retrieve a GitHub PAT from localStorage.
 *
 * @param tokenKey  The localStorage key for the encrypted token
 * @returns         The plaintext token
 * @throws          If the token is not found or decryption fails
 */
async function getToken(tokenKey: string): Promise<string> {
  if (!tokenKey) return '';
  const encrypted = localStorage.getItem(tokenKey);
  if (!encrypted) return '';
  try {
    return await decrypt(encrypted);
  } catch {
    return '';
  }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * listMarkdownFiles — get all Question files (.json, .md, .markdown) in a repo directory (recursive).
 *
 * Uses the Git Trees API with recursive=1 to get the full file tree in one
 * request. This is more efficient than traversing directories recursively
 * with the Contents API.
 *
 * @param config  GitHub source configuration
 * @returns       Array of GitHubFile entries for question files
 */
export async function listMarkdownFiles(config: GitHubConfig): Promise<GitHubFile[]> {
  const done = log.timed('info', 'github_list_files', `Listing markdown and json files in ${config.owner}/${config.repo}`);
  const token = await getToken(config.token_key);

  const response = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/trees/${config.branch}?recursive=1`,
    token
  );

  const data = await response.json() as { tree: Array<{ type: string; path: string; sha: string; size?: number; url: string }> };

  const cleanConfigPath = (config.path || '/').replace(/^\//, '').replace(/\/$/, '');

  // Filter to only Markdown & JSON files within the configured path
  const mdFiles = data.tree
    .filter((item) => {
      if (item.type !== 'blob') return false;
      const lower = item.path.toLowerCase();
      const validExt = lower.endsWith('.json') || lower.endsWith('.md') || lower.endsWith('.markdown');
      if (!validExt) return false;
      if (!cleanConfigPath) return true;
      return item.path === cleanConfigPath || item.path.startsWith(cleanConfigPath + '/');
    })
    .map((item) => ({
      path: item.path,
      sha: item.sha,
      size: item.size ?? 0,
      url: item.url,
      download_url: `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${item.path}`,
    }));

  done({ count: mdFiles.length });
  return mdFiles;
}

/**
 * fetchFileContent — download a single file's text content.
 *
 * Uses raw.githubusercontent.com for file content (no auth required for
 * public repos, and faster than the API for large files). For private repos,
 * falls back to the Contents API with authentication.
 *
 * Implements conditional fetching with ETag: if the file hasn't changed since
 * the last fetch (sha matches), returns null to avoid unnecessary parsing.
 *
 * @param file    The GitHubFile to fetch
 * @param config  Source configuration (for auth)
 * @param cachedSha  The previously fetched SHA (if any) — skip if unchanged
 * @returns       File content string, or null if unchanged
 */
export async function fetchFileContent(
  file: GitHubFile,
  config: GitHubConfig,
  cachedSha?: string
): Promise<string | null> {
  // If SHA matches what we have cached, skip the download
  if (cachedSha && cachedSha === file.sha) {
    log.debug('github_cache_hit', `Skipping ${file.path} — SHA unchanged`);
    return null;
  }

  const token = await getToken(config.token_key);

  // Try raw URL first (faster, no rate limit for public repos)
  if (file.download_url) {
    const rawHeaders: Record<string, string> = { 'User-Agent': 'Noledge-App' };
    if (token && token.trim()) {
      rawHeaders['Authorization'] = `Bearer ${token.trim()}`;
    }
    try {
      const response = await fetch(file.download_url, { headers: rawHeaders });
      if (response.ok) return await response.text();
    } catch {
      // Fallback to Contents API
    }
  }

  // Fall back to Contents API
  const response = await githubFetch(file.url, token);
  const data = await response.json() as GitHubContent;

  if (data.content && data.encoding === 'base64') {
    return atob(data.content.replace(/\n/g, ''));
  }
  return typeof data.content === 'string' ? data.content : null;
}

/**
 * getLatestCommitSha — get the SHA of the latest commit on a branch.
 *
 * Used to detect if there are new commits since the last sync without
 * fetching the full file tree.
 *
 * @param config  GitHub source configuration
 * @returns       The latest commit SHA on the configured branch
 */
export async function getLatestCommitSha(config: GitHubConfig): Promise<string> {
  const token = await getToken(config.token_key);

  const response = await githubFetch(
    `/repos/${config.owner}/${config.repo}/commits/${config.branch}`,
    token,
    {
      // Only fetch the commit SHA header, not the full body
      headers: { 'Accept': 'application/vnd.github.v3.sha' },
    }
  );

  // The response body IS the SHA when using the .sha accept header
  return response.text();
}

/**
 * validateConnection — verify that a GitHub token and repo are accessible.
 *
 * Called when the user first connects a GitHub source, and on reconnect.
 * Returns a human-readable error message if the connection fails.
 *
 * @param config  GitHub source configuration (with plaintext token for initial validation)
 * @param token   Plaintext token (not yet stored)
 * @returns       null if valid, error message string if invalid
 */
export async function validateConnection(
  config: Omit<GitHubConfig, 'token_key'>,
  token: string
): Promise<string | null> {
  try {
    const response = await githubFetch(
      `/repos/${config.owner}/${config.repo}`,
      token
    );
    const data = await response.json() as { private: boolean; permissions?: { pull: boolean } };

    // Check if we have read access
    if (data.private && !data.permissions?.pull) {
      return 'No read access to this repository. Please check your token permissions.';
    }

    return null; // Valid!
  } catch (error) {
    if (error instanceof GitHubAPIError) {
      if (error.status === 401) return 'Invalid GitHub token. Please create a new Personal Access Token.';
      if (error.status === 403) return 'Token lacks required permissions. Enable "repo" scope in your PAT.';
      if (error.status === 404) return 'Repository not found. Check the owner/repo name.';
      return `GitHub API error: ${error.message}`;
    }
    return 'Connection failed. Please check your internet connection.';
  }
}
