/**
 * @file api.ts
 * @description Shared API response and request types for Next.js route handlers.
 *
 * All API routes in Noledge return a standardized response envelope. This
 * consistency means the client-side fetch utilities can apply a single error
 * handler pattern, and logging middleware can parse every response shape
 * without type-specific logic.
 *
 * The envelope pattern is inspired by the JSend specification:
 *   https://github.com/omniti-labs/jsend
 * We add Noledge-specific fields (request_id, duration_ms) for observability.
 */

// =============================================================================
// Standard API Response Envelope
// =============================================================================

/**
 * ApiResponse<T> — the standard JSON response shape for all API routes.
 *
 * Generic parameter T is the shape of the `data` field on success.
 * On error, `data` is null and `error` is populated.
 *
 * Fields:
 *   success     — true on 2xx responses, false on 4xx/5xx
 *   data        — the response payload on success; null on error
 *   error       — error details on failure; null on success
 *   request_id  — a UUID generated per-request for log correlation.
 *                 Sent as X-Request-ID header AND in the body.
 *   duration_ms — how long the API route took to process, for performance
 *                 monitoring. Computed from request start to response end.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  request_id: string;
  duration_ms: number;
}

// =============================================================================
// API Error Shape
// =============================================================================

/**
 * ApiError — structured error details returned in the response envelope.
 *
 * Fields:
 *   code     — A machine-readable error code. Never a raw HTTP status code —
 *              always a descriptive string like 'GITHUB_RATE_LIMITED',
 *              'PARSE_FAILED', 'VALIDATION_ERROR', 'AUTH_REQUIRED'.
 *              This lets the client switch on specific errors without
 *              parsing human-readable messages.
 *   message  — A human-readable error description, suitable for display
 *              in developer tools. NOT displayed directly to end users.
 *   details  — Additional context for debugging. May contain field-level
 *              validation errors, API response bodies from upstream services,
 *              stack traces in development mode (NEVER in production).
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// Specific API Request/Response Types
// =============================================================================

/**
 * GitHubFetchRequest — body for POST /api/github
 *
 * Requests content from a GitHub repository. The token is a short-lived
 * reference ID (looked up server-side from the encrypted session store).
 * The raw token is NEVER sent in the request body.
 *
 * Fields:
 *   owner    — GitHub repo owner
 *   repo     — GitHub repo name
 *   branch   — Branch to read from
 *   path     — Specific file or folder path to fetch. Empty string = repo root.
 *   token_ref — Reference to the encrypted token in the user's session.
 *               The API route decrypts it server-side using the session key.
 */
export interface GitHubFetchRequest {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token_ref?: string;
}

/**
 * GitHubFetchResponse — the shape of data returned by /api/github
 *
 * Fields:
 *   files — list of fetched files with their markdown content
 *   tree_sha — the git tree SHA of the fetched state, for change detection
 */
export interface GitHubFetchResponse {
  files: GitHubFile[];
  tree_sha: string;
}

/**
 * GitHubFile — a single markdown file fetched from GitHub.
 */
export interface GitHubFile {
  path: string;
  content: string;         // Raw markdown string
  sha: string;             // Git blob SHA for change detection
  size: number;
  last_modified: string;   // ISO 8601 from commit timestamp
}

/**
 * ObsidianFetchRequest — body for POST /api/obsidian
 *
 * Fields:
 *   vault_path   — Absolute path to the vault (cloud-sync method)
 *   folder_path  — Relative path within the vault to read
 *   api_port     — Port for local REST API method
 *   token_ref    — Token reference for local REST API auth
 *   method       — Which read method to use
 */
export interface ObsidianFetchRequest {
  vault_path?: string;
  folder_path: string;
  api_port?: number;
  token_ref?: string;
  method: 'local-rest-api' | 'cloud-sync';
}

/**
 * ParseRequest — body for POST /api/parse
 *
 * Sends raw markdown files to be parsed into structured Question objects.
 *
 * Fields:
 *   files   — The markdown files to parse
 *   deck_id — Which deck these questions should be associated with
 */
export interface ParseRequest {
  files: Array<{ path: string; content: string }>;
  deck_id: string;
}

/**
 * ParseResponse — shape of data returned by /api/parse
 *
 * Fields:
 *   questions     — Successfully parsed questions
 *   errors        — Files that failed to parse, with reason
 *   warnings      — Files that parsed but had non-fatal issues
 */
export interface ParseResponse {
  questions: import('./question').Question[];
  errors: Array<{ file: string; reason: string }>;
  warnings: Array<{ file: string; reason: string }>;
}

/**
 * SyncRequest — body for POST /api/sync
 *
 * Fields:
 *   device_id     — The sending device's UUID
 *   events        — Queued events to sync (for offline → online replay)
 *   last_sync_at  — ISO 8601 of last successful sync (to fetch missed events)
 */
export interface SyncRequest {
  device_id: string;
  events: import('./sync').SyncEvent[];
  last_sync_at: string | null;
}
