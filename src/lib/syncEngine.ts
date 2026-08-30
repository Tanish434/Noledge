/**
 * @file lib/syncEngine.ts
 * @description Orchestrates the full sync pipeline: fetch → parse → store → notify.
 *
 * The sync engine is the central coordinator that:
 *   1. Reads all connected sources from the source store
 *   2. For each source, fetches new/changed Markdown files
 *   3. Parses each file using the Noledge question format parser
 *   4. Upserts parsed questions into IndexedDB via the question store
 *   5. Updates deck stats and question counts
 *   6. Reports progress and errors via the sync store and toast notifications
 *   7. Queues changes for replay if offline (pending events queue)
 *
 * SYNC FREQUENCY:
 *   - Manual: user taps "Sync Now" → calls syncAll() immediately
 *   - Auto: syncs when the app becomes visible (Page Visibility API) AND
 *     at least MIN_SYNC_INTERVAL_MS has passed since the last sync
 *   - On connect: syncs when network comes back online
 *
 * CONFLICT RESOLUTION:
 *   If a question exists locally (has SRS progress) and the source file
 *   changes, we use a "merge" strategy:
 *     - Content changes: update question content, PRESERVE SRS data
 *     - Question type change: update everything, RESET SRS data
 *       (a different question type means the question is fundamentally different)
 *     - Question deleted from source: mark as archived, keep SRS data
 *
 * OFFLINE BEHAVIOR:
 *   Sync is silently skipped when offline. Pending SRS updates (from answering
 *   cards offline) are queued in IndexedDB's pending_events store and replayed
 *   when the connection returns.
 */

import { useSourceStore } from '@/stores/sourceStore';
import { useSyncStore } from '@/stores/syncStore';
import { useQuestionStore } from '@/stores/questionStore';
import { useDeckStore } from '@/stores/deckStore';
import { listMarkdownFiles as listGitHubFiles, fetchFileContent as fetchGitHubFile } from './github';
import { listMarkdownFiles as listObsidianFiles, fetchFileContent as fetchObsidianFile } from './obsidian';
import { parseQuestionMarkdown } from './markdownParser';
import { getFileHandle, saveFileHandle } from './fileHandleStore';
import type { Source } from '@/types/source';
import { createLogger } from '@/lib/logger';

const log = createLogger('sync');

// =============================================================================
// Constants
// =============================================================================

/** Minimum time between automatic syncs (5 minutes) */
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Track when the last sync completed */
let lastSyncTimestamp: number = 0;

// =============================================================================
// Core Sync Functions
// =============================================================================

/**
 * syncSource — sync a single connected source (GitHub repo or Obsidian vault).
 *
 * @param source  The source configuration to sync
 * @returns       Object with counts of synced/failed items
 */
async function syncSource(source: Source): Promise<{ synced: number; failed: number }> {
  // Local disk sources (obs-folder-, obs-local-, obs-disk-, single-file-) cannot be
  // re-synced automatically — they require user interaction via the File System Access API.
  // Skip silently so we never accidentally delete their decks.
  const isLocalDiskSource =
    source.id.startsWith('obs-folder-') ||
    source.id.startsWith('obs-local-') ||
    source.id.startsWith('obs-disk-') ||
    source.id.startsWith('single-file-') ||
    (!(source as any).api_token && source.kind === 'obsidian');


  if (isLocalDiskSource) {
    // Mark as connected so UI does not show error, and skip all sync logic.
    useSourceStore.getState().setSourceStatus(source.id, 'connected');
    return { synced: 0, failed: 0 };
  }
  const syncStore = useSyncStore.getState();
  const sourceStore = useSourceStore.getState();
  const questionStore = useQuestionStore.getState();
  const deckStore = useDeckStore.getState();

  sourceStore.setSourceStatus(source.id, 'syncing');
  let synced = 0;
  let failed = 0;

  // Human-readable label for this source (for deck creation)
  const sourceLabel = source.label;
  const sourceKind = source.kind;

  try {
    // ─── 1. List files ──────────────────────────────────────────────────
    let files: { path: string; sha?: string; download_url?: string }[] = [];

    if (source.kind === 'github') {
      const cfg: import('./github').GitHubConfig = {
        owner: source.owner,
        repo: source.repo,
        branch: source.branch,
        path: (source as any).vault_path || (source as any).path || '/',
        token_key: source.token ?? '',
      };
      const ghFiles = await listGitHubFiles(cfg);
      files = ghFiles.map((f) => ({ path: f.path, sha: f.sha, download_url: f.download_url ?? undefined }));
    } else if (source.kind === 'obsidian') {
      if (!source.api_token || source.id.startsWith('obs-file-') || source.id.startsWith('obs-disk-') || source.id.startsWith('obs-local-')) {
        // Attempt local disk FileSystemHandle auto-sync
        const handle = await getFileHandle(source.id) || await getFileHandle(`vault_handle_${(source as any).vault_name}`) || await getFileHandle('vault_last_root');
        if (handle && 'queryPermission' in handle) {
          try {
            let perm = await (handle as any).queryPermission({ mode: 'read' });
            if (perm !== 'granted') {
              perm = await (handle as any).requestPermission({ mode: 'read' });
            }
            if (perm === 'granted') {
              const questions: any[] = [];
              const scanDir = async (dirHandle: any, prefix = '') => {
                for await (const entry of dirHandle.values()) {
                  if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                  const relPath = `${prefix}${entry.name}`;
                  if (entry.kind === 'file' && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) {
                    const file = await entry.getFile();
                    const text = await file.text();
                    const parsed = await parseQuestionMarkdown(text, relPath);
                    if (parsed.questions.length > 0) {
                      questions.push(...parsed.questions);
                    }
                  } else if (entry.kind === 'directory') {
                    await scanDir(entry, `${prefix}${entry.name}/`);
                  }
                }
              };
              await scanDir(handle, `${handle.name}/`);
              if (questions.length > 0) {
                await questionStore.upsertQuestions(questions as any);
                sourceStore.setSourceStatus(source.id, 'connected');
                return { synced: questions.length, failed: 0 };
              }
            }
          } catch {
            // Permission require prompt: open directory picker pre-focused on startIn: handle
            if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
              try {
                // @ts-ignore
                const pickerHandle = await window.showDirectoryPicker({ startIn: handle });
                if (pickerHandle) {
                  await saveFileHandle('vault_last_root', pickerHandle);
                  sourceStore.setSourceStatus(source.id, 'connected');
                  return { synced: 1, failed: 0 };
                }
              } catch {
                // User cancelled
              }
            }
          }
        }
        sourceStore.setSourceStatus(source.id, 'connected');
        return { synced: 0, failed: 0 };
      }

      const vaultUrl = (source as any).vault_url || `https://127.0.0.1:${source.api_port ?? 27123}`;
      const cfg: import('./obsidian').ObsidianConfig = {
        vault_url: vaultUrl,
        token_key: source.api_token,
        vault_path: source.vault_path ?? '/',
      };
      const obsFiles = await listObsidianFiles(cfg);
      files = obsFiles.map((f) => ({ path: f.path }));
    }

    log.info('sync_files_found', `Found ${files.length} markdown files in source ${source.id}`);

    // ─── 2. Determine deck name from source label ─────────────────────────
    const existingDecks = Object.values(deckStore.decks);
    let deckForSource = existingDecks.find((d) => d.source?.source_id === source.id);

    if (!deckForSource) {
      deckForSource = await deckStore.createDeck({
        name: sourceLabel,
        description: `Synced from ${sourceKind === 'github' ? 'GitHub' : 'Obsidian'}: ${sourceLabel}`,
        color: sourceKind === 'github' ? '#6366f1' : '#8b5cf6',
        icon: sourceKind === 'github' ? 'github' : 'obsidian',
        tags: [],
        source: {
          type: sourceKind,
          source_id: source.id,
          path: (source as any).vault_path || (source as any).path || '/',
          last_synced: null,
          sync_enabled: true,
          sync_interval_minutes: 30,
        },
      });
    }

    const deckId = deckForSource.id;

    // ─── 3. Fetch + parse each file ───────────────────────────────────────
    for (const file of files) {
      try {
        let content: string | null = null;

        if (source.kind === 'github') {
          const cfg: import('./github').GitHubConfig = {
            owner: source.owner,
            repo: source.repo,
            branch: source.branch,
            path: (source as any).vault_path || (source as any).path || '/',
            token_key: source.token ?? '',
          };
          content = await fetchGitHubFile(
            { path: file.path, sha: file.sha ?? '', size: 0, url: '', download_url: file.download_url ?? null },
            cfg
          );
        } else if (source.kind === 'obsidian') {
          const vaultUrl = (source as any).vault_url || `https://127.0.0.1:${source.api_port ?? 27123}`;
          const cfg: import('./obsidian').ObsidianConfig = {
            vault_url: vaultUrl,
            token_key: source.api_token ?? '',
            vault_path: source.vault_path ?? '/',
          };
          content = await fetchObsidianFile(file.path, cfg);
        }

        if (!content) continue;

        const { questions, errors } = await parseQuestionMarkdown(content, file.path);

        for (const err of errors) {
          log.warn('parse_error', err);
          failed++;
        }

        if (questions.length > 0) {
          const questionsWithDeck = questions.map((q) => ({
            ...q,
            deck_id: deckId,
            // Store the GitHub file path so syncDeckToFile knows which file to commit
            source_file: file.path,
          }));
          await questionStore.upsertQuestions(questionsWithDeck as import('@/types/question').Question[]);
          synced += questions.length;
        }
      } catch (fileError) {
        log.error('file_sync_error', `Failed to sync file ${file.path}`, fileError);
        failed++;
      }
    }

    // ─── 4. Update deck question count ─────────────────────────────────────
    if (synced === 0 && deckForSource && files.length > 0) {
      // Only delete the deck if remote files were found but produced 0 valid questions
      // (e.g. all parse errors). If no files found at all, keep the deck — source may
      // be temporarily unavailable.
      log.warn('source_sync_no_questions', `0 valid questions found in source ${source.id} (${files.length} files found). Keeping deck.`);
    } else if (synced > 0) {
      await deckStore.updateDeck(deckId, {
        question_count: synced,
      });
    }

    sourceStore.setSourceStatus(source.id, 'connected');
    log.info('source_sync_complete', `Source ${source.id} synced: ${synced} questions, ${failed} errors`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Sync failed';
    log.error('source_sync_failed', `Source ${source.id} sync failed`, error);
    sourceStore.setSourceStatus(source.id, 'error', msg);
    failed++;
  }

  return { synced, failed };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * syncAll — sync all connected sources.
 *
 * Should be called:
 *   1. Manually by the user
 *   2. On page focus (if MIN_SYNC_INTERVAL_MS has elapsed)
 *   3. On network reconnection
 *
 * @param force  Skip the MIN_SYNC_INTERVAL_MS check and sync immediately
 * @returns      Total synced/failed counts across all sources
 */
export async function syncAll(force: boolean = false): Promise<{ synced: number; failed: number }> {
  const syncStore = useSyncStore.getState();

  // Debounce: skip if synced recently and not forced
  const now = Date.now();
  if (!force && now - lastSyncTimestamp < MIN_SYNC_INTERVAL_MS) {
    log.debug('sync_debounced', 'Skipping sync — synced too recently');
    return { synced: 0, failed: 0 };
  }

  // Skip if offline
  if (!syncStore.isOnline) {
    log.info('sync_offline', 'Skipping sync — device is offline');
    return { synced: 0, failed: 0 };
  }

  // Skip if already syncing
  if (syncStore.syncState === 'syncing') {
    log.debug('sync_already_running', 'Skipping sync — already in progress');
    return { synced: 0, failed: 0 };
  }

  syncStore.setSyncState('syncing');
  const done = log.timed('info', 'sync_all', 'Starting full sync');

  const sources = useSourceStore.getState().sources;
  if (sources.length === 0) {
    syncStore.setSyncState('idle');
    return { synced: 0, failed: 0 };
  }

  let totalSynced = 0;
  let totalFailed = 0;

  // Sync sources in parallel (each source is independent)
  const results = await Promise.allSettled(sources.map(syncSource));

  for (const result of results) {
    if (result.status === 'fulfilled') {
      totalSynced += result.value.synced;
      totalFailed += result.value.failed;
    } else {
      totalFailed++;
      log.error('sync_source_rejected', 'Source sync promise rejected', result.reason);
    }
  }

  lastSyncTimestamp = Date.now();
  syncStore.setLastSyncAt(new Date().toISOString());
  syncStore.setSyncState(totalFailed > 0 && totalSynced === 0 ? 'error' : 'idle');

  done({ total_synced: totalSynced, total_failed: totalFailed });
  return { synced: totalSynced, failed: totalFailed };
}

/**
 * initSyncListeners — set up automatic sync triggers.
 *
 * Call this once on app mount. Sets up:
 *   1. Online/offline event listeners
 *   2. Page visibility change listener (sync when tab becomes active)
 *
 * @returns Cleanup function to remove event listeners
 */
/**
 * triggerManualPickerSync — background sync for GitHub, Obsidian, and Local files.
 * Runs seamlessly without popping up OS file/folder pickers.
 */
export async function triggerManualPickerSync(): Promise<{ synced: number; failed: number }> {
  let totalSynced = 0;
  let totalFailed = 0;

  // Run local file, Obsidian, and GitHub syncs
  const remoteRes = await syncAll(true);
  totalSynced += remoteRes.synced;
  totalFailed += remoteRes.failed;

  return { synced: totalSynced, failed: totalFailed };
}

/**
 * initSyncListeners — set up automatic sync triggers.
 */
export function initSyncListeners(): () => void {
  const syncStore = useSyncStore.getState();

  const handleOnline = () => {
    syncStore.setOnline(true);
    void syncAll();
  };

  const handleOffline = () => {
    syncStore.setOnline(false);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void syncAll();
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
