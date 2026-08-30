/**
 * @file logger.ts
 * @description Structured JSON logger for enterprise-level observability.
 *
 * Every significant event in Noledge — fetch attempts, parse failures,
 * sync conflicts, user actions, API errors — is logged through this module.
 * Logs are structured as JSON objects (not free-form strings) so they can
 * be parsed, filtered, and aggregated by log management tools.
 *
 * Architecture:
 *   - In development: logs go to console.log (with color-coded levels)
 *   - In production: logs are batched and could be sent to a log sink
 *     (Supabase logs table, Axiom, Better Stack, etc.) — currently
 *     the sink is console.error for server-side, structured console on client
 *
 * The logger is deliberately synchronous and never throws. A logger that
 * crashes the application when it fails to log is worse than no logger.
 * All internal errors are swallowed silently after a console.error.
 *
 * Inspired by:
 *   - Bunyan (Node.js structured logging)
 *   - Pino (fast JSON logger)
 *   - Google Cloud Logging structured payload format
 */

import { APP_NAME, APP_VERSION } from './constants';

// =============================================================================
// Log Level Types
// =============================================================================

/**
 * LogLevel — severity levels in ascending order of urgency.
 *
 * - 'debug'  : Verbose development output. Never shown in production.
 *              Examples: "parsing line 42", "cache hit for SHA abc123"
 * - 'info'   : Normal operational events. Shown in production.
 *              Examples: "sync completed", "session started"
 * - 'warn'   : Unexpected but recoverable situations.
 *              Examples: "rate limit approaching", "file skipped: too large"
 * - 'error'  : Failures that affect functionality but don't crash the app.
 *              Examples: "GitHub fetch failed after 3 retries"
 * - 'fatal'  : Unrecoverable errors that will crash or break core features.
 *              Examples: "Supabase connection permanently failed"
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * LogComponent — which subsystem produced the log entry.
 *
 * Used for filtering: "show me only sync-related logs" or "only parser logs".
 * Every logger instance is tagged with a component when created.
 */
export type LogComponent =
  | 'app'        // Top-level application events
  | 'api'        // Next.js API routes
  | 'auth'       // Authentication (Supabase auth)
  | 'parser'     // Markdown parser and question extractor
  | 'sync'       // Sync pipeline and Supabase Realtime
  | 'storage'    // IndexedDB operations
  | 'github'     // GitHub API client
  | 'obsidian'   // Obsidian reader
  | 'srs'        // Spaced repetition system
  | 'scoring'    // Answer scoring engine and streak tracker
  | 'streak'     // Daily study streak tracking
  | 'study'      // Study session engine
  | 'ui';        // Component-level UI events (errors, interactions)

// =============================================================================
// Log Entry Shape
// =============================================================================

/**
 * LogEntry — the shape of every structured log record.
 *
 * This interface is the canonical log schema. All fields except `message`
 * are designed to be machine-parseable. Human-readable text goes in `message`.
 *
 * Fields:
 *   timestamp    — ISO 8601, always UTC. Set at log-call time, not flush time.
 *   level        — Severity level
 *   component    — Which subsystem produced this log
 *   action       — A short verb phrase naming the specific operation being
 *                  logged. Use snake_case: 'fetch_github', 'parse_question',
 *                  'apply_sync_event'. This is used as the primary search key
 *                  in log queries ("show me all fetch_github events").
 *   message      — Human-readable description. Always in English. Complete
 *                  sentences with enough context to understand without other
 *                  logs. Not a format string — format before passing here.
 *   duration_ms  — If this log records the end of a timed operation, how
 *                  long it took in milliseconds. Undefined otherwise.
 *   error        — Structured error info if this is an error/fatal log.
 *   context      — Arbitrary additional key/value pairs for this specific log.
 *                  Use sparingly — prefer specific typed fields over a blob.
 *   app_version  — Current APP_VERSION, injected automatically.
 *   environment  — 'development' | 'production'. Injected automatically.
 *   request_id   — If this log is within an API request context, the
 *                  request's UUID for correlation across logs.
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: LogComponent;
  action: string;
  message: string;
  duration_ms?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  context?: Record<string, unknown>;
  app_version: string;
  environment: 'development' | 'production';
  request_id?: string;
}

// =============================================================================
// Log Level Numeric Mapping (for level comparison)
// =============================================================================

/**
 * LOG_LEVEL_PRIORITY — numeric priority for each log level.
 *
 * Used to compare levels: logger.shouldLog('warn') checks if the configured
 * minimum level is <= warn. Higher number = more severe.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// =============================================================================
// Logger Class
// =============================================================================

/**
 * Logger — the main logger instance. Create one per component/module.
 *
 * Usage:
 *   const log = createLogger('parser');
 *   log.info('parse_complete', 'Parsed 12 questions from biology.md', { count: 12 });
 *   log.error('parse_failed', 'Failed to parse question at line 42', error, { file: 'bio.md' });
 *
 * Design decision: We use a class with bound methods rather than a plain
 * object of functions so that subclasses can override specific methods
 * (e.g., a TestLogger that captures entries for assertion).
 */
export class Logger {
  // The component this logger instance is scoped to.
  // Set once at construction, included in every log entry.
  private readonly component: LogComponent;

  // Minimum log level to emit. 'debug' in development, 'info' in production.
  // Entries below this level are silently discarded.
  private readonly minLevel: LogLevel;

  // The current environment. Injected to avoid coupling to process.env
  // in client-side code (process.env is a Node.js concept, not browser).
  private readonly environment: 'development' | 'production';

  constructor(component: LogComponent) {
    this.component = component;
    // Use NODE_ENV for server-side; fallback to NEXT_PUBLIC_ prefix for client.
    const isDev =
      process.env.NODE_ENV === 'development' ||
      process.env.NEXT_PUBLIC_ENV === 'development';
    this.environment = isDev ? 'development' : 'production';
    this.minLevel = isDev ? 'debug' : 'info';
  }

  /**
   * shouldLog — whether this level passes the minimum level filter.
   *
   * Called before building the LogEntry to avoid wasting time constructing
   * objects that will be immediately discarded.
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /**
   * buildEntry — construct a fully-formed LogEntry from the call arguments.
   *
   * Note: error?.stack is only included in development mode. Stack traces
   * can contain sensitive file paths that shouldn't appear in production logs.
   */
  private buildEntry(
    level: LogLevel,
    action: string,
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>,
    options?: { duration_ms?: number; request_id?: string }
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      action,
      message,
      app_version: APP_VERSION,
      environment: this.environment,
    };

    if (options?.duration_ms !== undefined) {
      entry.duration_ms = options.duration_ms;
    }

    if (options?.request_id) {
      entry.request_id = options.request_id;
    }

    if (context) {
      entry.context = context;
    }

    if (error) {
      let e: Error;
      if (error instanceof Error) {
        e = error;
      } else if (typeof error === 'object' && error !== null) {
        const msg = (error as any).message || (error as any).error_description || JSON.stringify(error);
        e = new Error(String(msg));
      } else {
        e = new Error(String(error));
      }

      entry.error = {
        name: e.name,
        message: e.message,
        // Only include stack in development — see note above
        ...(this.environment === 'development' && e.stack ? { stack: e.stack } : {}),
      };
    }

    return entry;
  }

  /**
   * emit — output the log entry to the configured sink.
   *
   * In development: pretty-prints with colors using console methods.
   * In production: outputs as a single-line JSON string (log aggregators
   * expect one JSON object per line for structured log ingestion).
   *
   * This method NEVER throws. If JSON.stringify fails (circular reference,
   * etc.), it falls back to a minimal error log via console.error.
   */
  private emit(entry: LogEntry): void {
    try {
      if (this.environment === 'development') {
        // Development: colorized, human-readable output
        const colorMap: Record<LogLevel, string> = {
          debug: '\x1b[90m',   // gray
          info: '\x1b[36m',    // cyan
          warn: '\x1b[33m',    // yellow
          error: '\x1b[31m',   // red
          fatal: '\x1b[35m',   // magenta
        };
        const reset = '\x1b[0m';
        const color = colorMap[entry.level];
        const prefix = `${color}[${APP_NAME}:${entry.component}:${entry.level.toUpperCase()}]${reset}`;
        const suffix = entry.duration_ms !== undefined ? ` (${entry.duration_ms}ms)` : '';
        // Use the appropriate console method so browser devtools categorize correctly
        const consoleFn = entry.level === 'error' || entry.level === 'fatal'
          ? console.error
          : entry.level === 'warn'
          ? console.warn
          : entry.level === 'debug'
          ? console.debug
          : console.log;
        if (entry.context && Object.keys(entry.context).length > 0) {
          consoleFn(`${prefix} ${entry.action}${suffix}: ${entry.message}`, entry.context);
        } else {
          consoleFn(`${prefix} ${entry.action}${suffix}: ${entry.message}`);
        }
        if (entry.error) {
          consoleFn('  Error:', entry.error);
        }
      } else {
        // Production: single-line JSON for log aggregator ingestion
        const line = JSON.stringify(entry);
        if (entry.level === 'error' || entry.level === 'fatal') {
          console.error(line);
        } else {
          console.log(line);
        }
      }
    } catch (internalError) {
      // If the logger itself crashes, we MUST NOT propagate the error.
      // Use a raw console.error with minimal info to avoid infinite loops.
      console.error(
        `[${APP_NAME}:logger] INTERNAL LOGGER ERROR — could not emit log entry`,
        internalError
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public logging methods — one per log level
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * debug — verbose development-only logging.
   *
   * @param action   Short verb phrase ('cache_hit', 'parse_line')
   * @param message  Human-readable message
   * @param context  Optional additional key/value context
   */
  debug(action: string, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return;
    this.emit(this.buildEntry('debug', action, message, undefined, context));
  }

  /**
   * info — normal operational events.
   */
  info(
    action: string,
    message: string,
    context?: Record<string, unknown>,
    options?: { duration_ms?: number; request_id?: string }
  ): void {
    if (!this.shouldLog('info')) return;
    this.emit(this.buildEntry('info', action, message, undefined, context, options));
  }

  /**
   * warn — unexpected but recoverable situations.
   */
  warn(action: string, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return;
    this.emit(this.buildEntry('warn', action, message, undefined, context));
  }

  /**
   * error — failures that affect functionality.
   *
   * @param error  The caught error object (or any unknown thrown value)
   */
  error(
    action: string,
    message: string,
    error: Error | unknown,
    context?: Record<string, unknown>,
    options?: { duration_ms?: number; request_id?: string }
  ): void {
    if (!this.shouldLog('error')) return;
    this.emit(this.buildEntry('error', action, message, error, context, options));
  }

  /**
   * fatal — unrecoverable errors.
   */
  fatal(
    action: string,
    message: string,
    error: Error | unknown,
    context?: Record<string, unknown>
  ): void {
    // Fatal logs always emit regardless of minLevel — they indicate the app is broken.
    this.emit(this.buildEntry('fatal', action, message, error, context));
  }

  /**
   * timed — a helper for logging the duration of async operations.
   *
   * Returns a function that, when called, logs the completion with duration.
   *
   * Usage:
   *   const done = log.timed('info', 'fetch_github', 'Fetching repo tree');
   *   const result = await fetchTree();
   *   done({ count: result.files.length }); // logs with duration_ms
   *
   * @returns A completion function that accepts optional context.
   */
  timed(
    level: Exclude<LogLevel, 'debug'>,
    action: string,
    message: string
  ): (context?: Record<string, unknown>) => void {
    const startTime = performance.now();
    return (context?: Record<string, unknown>) => {
      const duration_ms = Math.round(performance.now() - startTime);
      if (!this.shouldLog(level)) return;
      this.emit(this.buildEntry(level, action, message, undefined, context, { duration_ms }));
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * createLogger — factory function to create a Logger instance for a component.
 *
 * Usage:
 *   // At the top of each module file:
 *   const log = createLogger('parser');
 *
 *   // Then use throughout the module:
 *   log.info('parse_start', 'Starting to parse biology.md');
 */
export function createLogger(component: LogComponent): Logger {
  return new Logger(component);
}

// =============================================================================
// Default App-Level Logger
// =============================================================================

/**
 * appLogger — a convenience singleton logger for the 'app' component.
 *
 * Used in layout.tsx and page.tsx for top-level lifecycle events.
 * Other modules should create their own logger with createLogger().
 */
export const appLogger = createLogger('app');
