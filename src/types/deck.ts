/**
 * @file deck.ts
 * @description Type definitions for Decks (collections of questions).
 *
 * A Deck is the container unit in Noledge — similar to a "deck" in Anki or
 * a "folder" in Obsidian. Questions always belong to exactly one deck, though
 * the study interface allows mixing cards from multiple decks in a single
 * session.
 *
 * Decks have two origins:
 *   1. SOURCE-BACKED: Derived from a GitHub folder or Obsidian folder. The
 *      deck's questions are parsed from markdown files in that folder. Changes
 *      to the source files propagate to the deck on next sync.
 *   2. MANUAL: Created directly in the Noledge interface. Questions are added
 *      one by one through the creation UI. No external source backing.
 *
 * This distinction matters for sync conflict resolution: source-backed decks
 * treat the external source as authoritative; manual decks treat the Supabase
 * DB as authoritative.
 */

import type { DifficultyLevel } from './question';

// =============================================================================
// Deck Interface
// =============================================================================

/**
 * Deck — a named collection of questions.
 *
 * Fields:
 *   id          — UUID
 *   name        — Human-readable deck name (e.g. "Biology 101", "Algorithms")
 *   description — Optional longer description shown on the deck detail screen
 *   color       — Accent color for the deck card in the management UI.
 *                 Stored as a CSS color string (e.g. "#10b981", "hsl(160 60% 45%)")
 *   icon        — Phosphor icon name for visual identification (e.g. "Atom",
 *                 "Code", "Books"). Rendered with @phosphor-icons/react.
 *   source      — If this deck is backed by an external source, this describes
 *                 the source. Undefined for manual decks.
 *   tags        — Tags that apply to the whole deck (inherited by questions
 *                 that don't specify their own tags)
 *   created_at  — ISO 8601
 *   updated_at  — ISO 8601 of last question change or deck metadata change
 *   question_count — Cached count of questions. Kept in sync by DB triggers.
 *                 Used to avoid COUNT(*) queries in the deck list UI.
 *   stats       — Aggregate study statistics for this deck
 */
export interface Deck {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  source?: DeckSource;
  tags: string[];
  created_at: string;
  updated_at: string;
  question_count: number;
  stats: DeckStats;
}

// =============================================================================
// Deck Source
// =============================================================================

/**
 * DeckSourceType — where the deck's content comes from.
 *
 * 'github'   — A folder in a GitHub repository
 * 'obsidian' — A folder in a locally-synced Obsidian vault
 * 'manual'   — Created directly in Noledge, no external source
 */
export type DeckSourceType = 'github' | 'obsidian' | 'manual';

/**
 * DeckSource — describes the external source backing a source-backed deck.
 *
 * Fields:
 *   type          — Which source type this is
 *   path          — The folder path within the repo/vault. Slash-separated.
 *                   E.g. "biology/chapter-3" or "Revision/Algorithms"
 *   github_owner  — (GitHub only) Repository owner username or org name
 *   github_repo   — (GitHub only) Repository name
 *   github_branch — (GitHub only) Branch to read from. Default: "main"
 *   obsidian_vault_path — (Obsidian only) Root path of the vault on disk
 *   last_synced   — ISO 8601 of the last successful sync from this source
 *   sync_enabled  — Whether auto-sync is enabled (runs on app open + periodic)
 *   sync_interval_minutes — How often to auto-sync in background. Default: 30.
 */
export interface DeckSource {
  type: DeckSourceType;
  source_id?: string;  // ID of the Source record that backs this deck
  path: string;
  github_owner?: string;
  github_repo?: string;
  github_branch?: string;
  obsidian_vault_path?: string;
  last_synced: string | null;
  sync_enabled: boolean;
  sync_interval_minutes: number;
}

// =============================================================================
// Deck Statistics
// =============================================================================

/**
 * DeckStats — aggregate statistics for a deck, computed from study session data.
 *
 * These are cached/precomputed values updated after each session. They power
 * the deck detail screen's analytics panel without requiring expensive
 * real-time aggregation queries.
 *
 * Fields:
 *   total_reviews       — Cumulative total questions answered from this deck
 *   correct_count       — Cumulative correct answers
 *   accuracy_percent    — correct_count / total_reviews * 100, rounded
 *   streak              — Current consecutive days studied
 *   longest_streak      — All-time longest consecutive days streak
 *   due_today           — Questions whose SRS next_review is today or earlier
 *   mastered            — Questions with srs.repetitions >= 5 (well-learned)
 *   difficulty_breakdown — Count of questions by difficulty level
 */
export interface DeckStats {
  total_reviews: number;
  correct_count: number;
  accuracy_percent: number;
  streak: number;
  longest_streak: number;
  due_today: number;
  mastered: number;
  difficulty_breakdown: Record<DifficultyLevel, number>;
}

// =============================================================================
// Deck Creation / Update DTOs
// =============================================================================

/**
 * CreateDeckDTO — data required to create a new deck.
 *
 * Excludes fields that are auto-generated: id, created_at, updated_at,
 * question_count (starts at 0), stats (starts at zeros).
 */
export type CreateDeckDTO = Pick<Deck, 'name' | 'color' | 'icon' | 'tags'> & {
  description?: string;
  source?: DeckSource;
};

/**
 * UpdateDeckDTO — fields that can be updated on an existing deck.
 *
 * id, created_at, and question_count are immutable through this DTO.
 * question_count is updated only by DB triggers when questions are added/removed.
 */
export type UpdateDeckDTO = Partial<Pick<Deck,
  'name' | 'description' | 'color' | 'icon' | 'tags' | 'source' | 'question_count'
>>;
