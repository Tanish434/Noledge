/**
 * @file constants.ts
 * @description Application-wide constants for the Noledge PWA.
 *
 * This file is the single source of truth for "magic numbers" and string
 * literals used across multiple files. Instead of scattering raw values
 * throughout the codebase, every constant lives here with a name that
 * explains its purpose.
 *
 * Naming conventions:
 *   - All exports are SCREAMING_SNAKE_CASE (standard for constants)
 *   - Groups are separated with a comment banner
 *   - Each constant has a JSDoc comment explaining what it is, why this
 *     value was chosen, and what happens if it's changed
 *
 * This file has no imports — it's a leaf node that everything else can
 * safely import without creating circular dependencies.
 */

// =============================================================================
// App Identity
// =============================================================================

/**
 * APP_NAME — the display name of the application.
 *
 * Appears in: browser title bar, PWA install prompt, splash screen,
 * error messages, and the manifest.json.
 */
export const APP_NAME = 'Noledge' as const;

/**
 * APP_VERSION — semantic version string.
 *
 * Updated manually on each release. Also appears in the
 * X-App-Version response header (added in Next.js middleware).
 */
export const APP_VERSION = '1.0.0' as const;

/**
 * APP_DESCRIPTION — one-line description for SEO and PWA metadata.
 */
export const APP_DESCRIPTION =
  'Your revision system — connected to Obsidian and GitHub, synced across all devices.' as const;

// =============================================================================
// Local Storage Keys
// =============================================================================

/**
 * STORAGE_KEYS — all localStorage / sessionStorage key strings.
 *
 * Centralizing these prevents typos (mistyped key = silent read-nothing bugs)
 * and makes it easy to audit what we're storing in the browser.
 */
export const STORAGE_KEYS = {
  /** The user's preferred theme ('dark' | 'light' | 'system') */
  THEME: 'noledge:theme',
  /** Stable device UUID — generated once on first app load, never changed */
  DEVICE_ID: 'noledge:device_id',
  /** ISO 8601 timestamp of last successful Supabase sync */
  LAST_SYNC: 'noledge:last_sync',
  /** Encrypted GitHub PAT references (JSON array of {source_id, encrypted_token}) */
  GITHUB_TOKENS: 'noledge:github_tokens',
  /** Encrypted Obsidian API tokens */
  OBSIDIAN_TOKENS: 'noledge:obsidian_tokens',
  /** The current active session ID (if a study session is in progress) */
  ACTIVE_SESSION: 'noledge:active_session',
  /** User's study session preferences */
  SESSION_PREFS: 'noledge:session_prefs',
} as const;

// =============================================================================
// IndexedDB
// =============================================================================

/**
 * IDB_DB_NAME — the IndexedDB database name.
 *
 * If this changes, existing users' offline data becomes inaccessible
 * (different name = different database). A migration would be needed.
 * Change this only on breaking schema changes, with a migration script.
 */
export const IDB_DB_NAME = 'noledge-db' as const;

/**
 * IDB_VERSION — the current schema version of the IndexedDB database.
 *
 * Increment this when the object store structure changes. The idb library
 * (installed as a dependency) calls the `upgrade` handler when the stored
 * version is less than this number, allowing schema migrations.
 *
 * History:
 *   1 → Initial schema (questions, decks, sync_log, pending_events)
 */
export const IDB_VERSION = 1 as const;

/**
 * IDB_STORES — names of all IndexedDB object stores.
 *
 * Used in lib/storage.ts when opening the database and in queries.
 * Centralizing prevents typos in store name strings.
 */
export const IDB_STORES = {
  QUESTIONS: 'questions',
  DECKS: 'decks',
  SYNC_LOG: 'sync_log',
  /** Events queued while offline, replayed when connection returns */
  PENDING_EVENTS: 'pending_events',
  /** SRS schedule cache — maps question_id to next_review date */
  SRS_CACHE: 'srs_cache',
} as const;

// =============================================================================
// Supabase Realtime
// =============================================================================

/**
 * REALTIME_CHANNEL — the Supabase Realtime channel name.
 *
 * All devices for the same user subscribe to this channel. The channel is
 * user-scoped by appending the user ID at runtime: `${REALTIME_CHANNEL}:${userId}`.
 * This prevents cross-user event leakage.
 */
export const REALTIME_CHANNEL = 'noledge-sync' as const;

/**
 * REALTIME_TABLES — which Supabase tables emit realtime events.
 *
 * These must match the tables with REPLICA IDENTITY FULL set in Supabase
 * (required for Realtime to include the full row in UPDATE/DELETE events).
 */
export const REALTIME_TABLES = ['questions', 'decks', 'study_sessions'] as const;

// =============================================================================
// Sync Configuration
// =============================================================================

/**
 * SYNC_INTERVAL_MS — how often the background sync timer fires.
 *
 * 5 minutes. This is a fallback for when the Realtime WebSocket is not
 * connected (the WebSocket handles instant sync when connected). The interval
 * sync catches up on any missed events.
 *
 * Chosen as 5 minutes to balance freshness vs. battery/CPU impact on mobile.
 * Lower = more battery drain. Higher = longer staleness window.
 */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * SYNC_LOG_MAX_ENTRIES — maximum number of sync log entries in IndexedDB.
 *
 * When this limit is reached, the oldest entries are pruned. 1000 entries
 * represents roughly a week of normal usage (sync every 5 min = 288/day,
 * but only entries that change data are logged, so real throughput is lower).
 */
export const SYNC_LOG_MAX_ENTRIES = 1000;

/**
 * OFFLINE_QUEUE_MAX — maximum pending events to queue while offline.
 *
 * If the user answers more than this many questions without connectivity,
 * the oldest events are dropped (SRS data may be slightly out of date after
 * reconnect, but no crash occurs). This prevents unbounded IndexedDB growth
 * from extended offline periods.
 */
export const OFFLINE_QUEUE_MAX = 500 as const;

// =============================================================================
// GitHub API
// =============================================================================

/**
 * GITHUB_API_BASE — base URL for the GitHub REST API v3.
 *
 * All GitHub API calls go through the Next.js /api/github route which
 * adds authentication headers server-side. The client never calls this
 * URL directly.
 */
export const GITHUB_API_BASE = 'https://api.github.com' as const;

/**
 * GITHUB_RATE_LIMIT_THRESHOLD — minimum remaining rate limit before throttling.
 *
 * GitHub's unauthenticated rate limit is 60 requests/hour; authenticated is
 * 5000/hour. We stop proactive fetching when remaining < this threshold to
 * preserve quota for user-initiated actions.
 */
export const GITHUB_RATE_LIMIT_THRESHOLD = 50 as const;

/**
 * GITHUB_FETCH_TIMEOUT_MS — timeout for individual GitHub API requests.
 *
 * 10 seconds. Chosen to be long enough for large files on slow connections
 * but short enough to fail fast and retry rather than hanging indefinitely.
 */
export const GITHUB_FETCH_TIMEOUT_MS = 10_000 as const;

/**
 * GITHUB_MAX_RETRIES — maximum retry attempts for failed GitHub requests.
 *
 * Uses exponential backoff: delay = GITHUB_RETRY_BASE_MS * (2 ^ attempt).
 * 3 retries = waits 1s, 2s, 4s before giving up.
 */
export const GITHUB_MAX_RETRIES = 3 as const;

/**
 * GITHUB_RETRY_BASE_MS — base delay for GitHub request retry backoff.
 */
export const GITHUB_RETRY_BASE_MS = 1_000 as const;

// =============================================================================
// Obsidian Local REST API
// =============================================================================

/**
 * OBSIDIAN_DEFAULT_PORT — default port for the Obsidian Local REST API plugin.
 *
 * The plugin listens on this port by default. Users can change it in the
 * plugin settings, in which case they configure the custom port in Noledge.
 */
export const OBSIDIAN_DEFAULT_PORT = 27123 as const;

/**
 * OBSIDIAN_API_TIMEOUT_MS — timeout for calls to the local Obsidian REST API.
 *
 * 5 seconds. Shorter than GitHub since this is a local network call.
 * If Obsidian isn't running, we get a connection refused quickly anyway.
 */
export const OBSIDIAN_API_TIMEOUT_MS = 5_000 as const;

// =============================================================================
// Markdown / Parser
// =============================================================================

/**
 * SUPPORTED_FILE_EXTENSIONS — file extensions that the parser will process.
 *
 * Only .md and .mdx files are considered question files. Other files
 * (images, PDFs, scripts) in the same folder are silently skipped.
 */
export const SUPPORTED_FILE_EXTENSIONS = ['.md', '.mdx'] as const;

/**
 * MAX_FILE_SIZE_BYTES — maximum file size the parser will process.
 *
 * 500 KB. Files larger than this are skipped with a warning. An Obsidian
 * note this large almost certainly isn't a pure question file — it's
 * probably a long-form note that accidentally ended up in a revision folder.
 * This prevents memory spikes from accidentally including giant files.
 */
export const MAX_FILE_SIZE_BYTES = 500 * 1024;

/**
 * MAX_QUESTIONS_PER_FILE — maximum questions to parse from a single file.
 *
 * 50. If a file contains more than this many questions (separated by
 * frontmatter blocks), only the first 50 are parsed and a warning is emitted.
 * This encourages splitting large files into smaller, more focused files.
 */
export const MAX_QUESTIONS_PER_FILE = 50 as const;

// =============================================================================
// Study Session
// =============================================================================

/**
 * DEFAULT_SESSION_CARD_LIMIT — how many cards to show in one session by default.
 *
 * 20. Research on spaced repetition (Ebbinghaus, Wozniak/SM-2 documentation)
 * suggests sessions of 20-30 items per day for sustainable long-term retention.
 * Users can increase this in session settings.
 */
export const DEFAULT_SESSION_CARD_LIMIT = 20 as const;

/**
 * SESSION_IDLE_TIMEOUT_MS — how long before an inactive session auto-pauses.
 *
 * 5 minutes. If the user leaves the study view idle for longer than this,
 * the session is paused and the elapsed time is not counted in analytics
 * (we don't want a 30-minute idle to show as a 30-minute study session).
 */
export const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * ANSWER_CORRECT_THRESHOLD_MS — time under which "fast correct" is recorded.
 *
 * 3 seconds. If the user answers correctly in under 3 seconds, the SM-2
 * algorithm gives a slight bonus ease factor increase (quality = 5 vs 4).
 * This rewards genuine instant recall vs. slow deliberation.
 */
export const ANSWER_CORRECT_THRESHOLD_MS = 3_000;

// =============================================================================
// SRS / SM-2 Algorithm
// =============================================================================

/**
 * SM2_INITIAL_EASE_FACTOR — starting ease factor for new cards.
 *
 * 2.5. This is the SM-2 specification default. It means the interval
 * multiplies by 2.5 on each successful review (so: 1 day, 2.5 days,
 * 6.25 days, ~15 days, etc.). Users who struggle with a card will
 * have their ease factor decrease; users who recall easily see it increase.
 */
export const SM2_INITIAL_EASE_FACTOR = 2.5 as const;

/**
 * SM2_MIN_EASE_FACTOR — minimum ease factor (prevents intervals from
 * collapsing to near-zero for very difficult cards).
 *
 * 1.3. Per SM-2 specification. A card at minimum ease grows by 1.3x per
 * correct review. Very slow, but the card stays in the deck rather than
 * being buried forever.
 */
export const SM2_MIN_EASE_FACTOR = 1.3 as const;

/**
 * SM2_INITIAL_INTERVAL_DAYS — the interval for a brand-new card's first
 * successful review.
 *
 * 1 day. After getting a new card right for the first time, show it again
 * tomorrow. This is the SM-2 "learning phase" first step.
 */
export const SM2_INITIAL_INTERVAL_DAYS = 1 as const;

// =============================================================================
// Haptics
// =============================================================================

/**
 * HAPTIC_PATTERNS — Vibration API patterns for different feedback events.
 *
 * Each pattern is an array passed to navigator.vibrate(). Alternating values
 * are [vibrate_ms, pause_ms, vibrate_ms, ...]. Single values = one pulse.
 *
 * Chosen to feel distinct: correct = short clean pulse, wrong = two quick
 * pulses (feels like a "nope" signal), swipe = very brief tactile click.
 */
export const HAPTIC_PATTERNS = {
  /** Short single pulse for correct answers */
  CORRECT: [50] as number[],
  /** Double pulse for wrong answers */
  WRONG: [80, 40, 80] as number[],
  /** Quick click for card swipe */
  SWIPE: [20] as number[],
  /** Medium pulse for session completion */
  SESSION_COMPLETE: [100, 50, 100] as number[],
} as const;

// =============================================================================
// Animation Durations
// =============================================================================

/**
 * ANIMATION — timing constants for GSAP animations.
 *
 * All durations are in seconds (GSAP convention, not milliseconds).
 * Keeping these here means design changes require editing only this file,
 * not hunting through every animation definition.
 */
export const ANIMATION = {
  /** Card swipe exit duration */
  CARD_SWIPE: 0.35,
  /** Card flip reveal duration */
  CARD_FLIP: 0.5,
  /** Card stack enter stagger duration per card */
  CARD_STACK_STAGGER: 0.08,
  /** Modal open/close */
  MODAL: 0.3,
  /** Page transition */
  PAGE_TRANSITION: 0.25,
  /** Correct/wrong shake duration */
  ANSWER_SHAKE: 0.4,
  /** Correct pulse glow duration */
  ANSWER_PULSE: 0.6,
  /** Toast notification appear */
  TOAST: 0.2,
} as const;

// =============================================================================
// UI Limits
// =============================================================================

/**
 * UI — limits and thresholds for UI behavior.
 */
export const UI = {
  /** Maximum deck name length (characters) */
  MAX_DECK_NAME_LENGTH: 60,
  /** Maximum question content length (characters) in the editor */
  MAX_QUESTION_LENGTH: 2000,
  /** Minimum swipe distance (px) to register as intentional swipe */
  SWIPE_THRESHOLD_PX: 80,
  /** Maximum swipe velocity (px/ms) to trigger fast-swipe */
  SWIPE_VELOCITY_THRESHOLD: 0.5,
  /** Number of cards to preload in the card stack */
  CARD_PRELOAD_COUNT: 3,
  /** Toast duration (ms) */
  TOAST_DURATION_MS: 3000,
  /** Maximum number of tags per question */
  MAX_TAGS_PER_QUESTION: 10,
} as const;

