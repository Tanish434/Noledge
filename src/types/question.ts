/**
 * @file question.ts
 * @description Central type registry for all question formats supported by Noledge.
 *
 * Noledge supports 10 distinct question types. Each type has a unique string
 * literal that appears in the `type:` frontmatter of Obsidian/GitHub markdown
 * files, and maps to a corresponding React renderer component. This file is
 * the single source of truth for that mapping — every part of the codebase
 * that needs to know "what types exist?" imports from here.
 *
 * Design decision: We use TypeScript string literal unions instead of enums
 * because:
 *   1. String literals are transparent in JSON and frontmatter — you can see
 *      "mcq" in the markdown file instead of a numeric enum value.
 *   2. They play well with runtime typeof checks without needing an enum
 *      reverse-mapping.
 *   3. The `as const` pattern + `typeof` extraction gives us the same
 *      exhaustiveness checking that enums provide.
 */

// =============================================================================
// Question Type Literal Union
// =============================================================================

/**
 * QuestionType — the complete set of valid `type:` frontmatter values.
 *
 * Each value maps 1-to-1 to:
 *   - A frontmatter `type:` value in markdown files
 *   - A renderer component in src/components/questions/
 *   - A scoring strategy in src/engine/scoring/scoreEngine.ts
 *   - A format spec in specs/question-format.md
 *
 * When adding a new question type:
 *   1. Add the string literal here
 *   2. Add a renderer component
 *   3. Add a case in QuestionRenderer.tsx
 *   4. Add a scoring strategy in scoreEngine.ts
 *   5. Document the format in specs/question-format.md
 */
export type QuestionType =
  | 'mcq'           // Multiple choice — one correct answer from a list
  | 'multi'         // Multiple select — several correct answers from a list
  | 'typing'        // Free text — typed answer matched with fuzzy logic
  | 'voice'         // Voice answer — speech-to-text matched with fuzzy logic
  | 'image-select'  // Image grid — pick the correct image(s)
  | 'match'         // Drag-and-match — connect left items to right items
  | 'fill'          // Fill-in-the-blank — complete sentences with missing words
  | 'order'         // Ordering — arrange shuffled items in correct sequence
  | 'tf'            // True/False — binary answer with optional explanation
  | 'code';         // Code question — write/complete/correct a code snippet

// =============================================================================
// Difficulty Level
// =============================================================================

/**
 * DifficultyLevel — how hard a question is rated.
 *
 * Used by:
 *   - The SM-2 spaced repetition algorithm (harder = shorter interval initially)
 *   - The study session filter (user can choose to study only hard cards)
 *   - The deck analytics dashboard (shows distribution of difficulty)
 */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

// =============================================================================
// Option Types (for questions with selectable choices)
// =============================================================================

/**
 * QuestionOption — a single selectable choice in an MCQ, multi-select, or
 * image-select question.
 *
 * Fields:
 *   id        — A stable unique identifier for this option. Stable means it
 *               does NOT change when options are shuffled for display. The
 *               answer field stores option IDs, not display-order indexes.
 *   content   — The text or markdown content of the option. May contain
 *               inline code, bold, etc.
 *   image_url — If present, this is an image-select question option. The image
 *               is displayed instead of (or alongside) the text content.
 *   is_correct — Whether this option is correct. Stored in the DB so the
 *               front-end can reveal answers after a session. Never sent to
 *               the client before the user answers (handled by API filtering).
 */
export interface QuestionOption {
  id: string;
  content: string;
  image_url?: string;
  is_correct: boolean;
}

/**
 * MatchPair — a single pair in a match-pairs question.
 *
 * The left side is always shown in order; the right side is shuffled for
 * display. The user drags right-side items to match left-side items.
 *
 * Fields:
 *   id    — Stable pair identifier. Links left and right together.
 *   left  — The prompt/concept on the left column.
 *   right — The answer/definition on the right column.
 */
export interface MatchPair {
  id: string;
  left: string;
  right: string;
}

/**
 * BlankSlot — a single blank in a fill-in-the-blank question.
 *
 * The question content uses `{{BLANK_ID}}` placeholder syntax to mark where
 * blanks appear in the sentence. Each blank slot defines the accepted answer(s)
 * for that position.
 *
 * Fields:
 *   id            — Matches the `{{ID}}` placeholder in the question content.
 *   accepted_answers — Array of strings any of which is considered correct.
 *                      Allows for synonym/alternate phrasing.
 */
export interface BlankSlot {
  id: string;
  accepted_answers: string[];
}

/** FillBlank — alias for BlankSlot, used in the markdown parser */
export type FillBlank = BlankSlot;

/**
 * MediaAttachment — a file (image, audio, video) attached to a question.
 *
 * Media is stored separately from question content for performance reasons:
 * the question card renders text immediately; media loads async. The `type`
 * field tells the renderer which HTML element to use.
 *
 * Fields:
 *   url     — Full URL to the asset (CDN, GitHub raw, Obsidian attachment, etc.)
 *   type    — The MIME category of the asset.
 *   alt_text — Accessibility description for screen readers and failed loads.
 *   caption — Optional visible caption rendered below the media.
 */
export interface MediaAttachment {
  url: string;
  type: 'image' | 'audio' | 'video';
  alt_text: string;
  caption?: string;
}

// =============================================================================
// SRS (Spaced Repetition System) Metadata
// =============================================================================

/**
 * SRSData — SM-2 algorithm state for a single question.
 *
 * Stored alongside each question so the scheduler can compute when it should
 * next appear in a study session. Updated after every answer.
 *
 * Fields:
 *   interval      — Days until next review. Starts at 1. Grows exponentially
 *                   as the user keeps getting the question right.
 *   ease_factor   — Multiplier applied to interval on a correct answer.
 *                   Starts at 2.5. Decreases on wrong answers (minimum 1.3).
 *   repetitions   — How many times in a row the user got this correct.
 *                   Resets to 0 on any wrong answer.
 *   next_review   — ISO 8601 datetime for the next scheduled review.
 *   last_reviewed — ISO 8601 datetime of the most recent review.
 *   review_count  — Cumulative total reviews across all time.
 */
export interface SRSData {
  interval: number;
  ease_factor: number;
  repetitions: number;
  next_review: string;
  last_reviewed: string | null;
  review_count: number;
}

// =============================================================================
// Core Question Interface
// =============================================================================

/**
 * Question — the central data model for every question in Noledge.
 *
 * This interface is the canonical shape stored in Supabase. Every question,
 * regardless of type, shares these fields. Type-specific data is stored in
 * the fields that apply to that type (options, pairs, blanks, etc.) — unused
 * fields are undefined/null, not omitted, to keep the DB schema uniform.
 *
 * Fields by category:
 *
 * IDENTITY
 *   id        — UUID (generated by Supabase uuid_generate_v4())
 *   deck_id   — Foreign key to the parent Deck
 *   type      — Which of the 10 question types this is
 *
 * CONTENT
 *   content   — The question text, in markdown. Rendered with remark.
 *   options   — For MCQ, multi, image-select: the selectable choices.
 *   pairs     — For match questions: the left/right pair list.
 *   blanks    — For fill questions: the blank slot definitions.
 *   order_items — For ordering questions: the items in CORRECT order.
 *               The renderer shuffles them for display.
 *   answer    — The correct answer. For MCQ: option ID. For typing/voice:
 *               the expected string. For tf: 'true' or 'false'. For code:
 *               the complete correct code string.
 *   explanation — Why this answer is correct. Shown after the user answers.
 *   media     — Attached images/audio/video.
 *   code_language — For code questions: the syntax highlighting language
 *               (e.g. 'python', 'javascript', 'rust').
 *
 * METADATA
 *   tags          — Topic tags for filtering (e.g. ['biology', 'cells'])
 *   difficulty    — Rated difficulty level
 *   source_file   — Path to the originating markdown file in Git or Obsidian
 *   source_line   — Line number in that file where this question starts
 *   created_at    — ISO 8601 creation timestamp
 *   updated_at    — ISO 8601 last-modification timestamp
 *
 * SRS
 *   srs           — Complete SM-2 spaced repetition state
 */
export interface Question {
  // Identity
  id: string;
  deck_id: string;
  type: QuestionType;

  // Core content
  content: string;
  options?: QuestionOption[];
  pairs?: MatchPair[];
  blanks?: BlankSlot[];
  order_items?: string[];
  answer: string | string[];
  accepted_answers?: string[];
  aliases?: string[];
  explanation?: string;
  hints?: string[] | string;
  media?: MediaAttachment[];
  code_language?: string;

  // Metadata
  tags: string[];
  difficulty: DifficultyLevel;
  source_file: string;
  source_line?: number;
  created_at: string;
  updated_at: string;

  // Spaced repetition state
  srs: SRSData;
}

// =============================================================================
// Answer Attempt (session-level, not persisted between sessions)
// =============================================================================

/**
 * AnswerAttempt — the user's answer to a single question in a study session.
 *
 * Stored in sessionStorage during a session, flushed to Supabase when the
 * session ends. NOT stored in Supabase per-question indefinitely — only the
 * aggregated SRS data is persistent. This prevents unbounded storage growth.
 *
 * Fields:
 *   question_id   — Which question was answered
 *   session_id    — Which study session this belongs to
 *   user_answer   — What the user actually provided (typed, selected, etc.)
 *   is_correct    — Whether the answer was judged correct
 *   time_taken_ms — How long the user spent before answering (milliseconds)
 *   answered_at   — ISO 8601 timestamp of the answer
 */
export interface AnswerAttempt {
  question_id: string;
  session_id: string;
  user_answer: string | string[];
  is_correct: boolean;
  time_taken_ms: number;
  answered_at: string;
}

// =============================================================================
// Study Session
// =============================================================================

/**
 * StudySession — a complete study session record.
 *
 * Created when the user starts a study session, updated as they answer
 * questions, finalized when they finish or abandon the session.
 *
 * Fields:
 *   id            — UUID
 *   deck_id       — Which deck was studied (null if multi-deck)
 *   deck_ids      — All deck IDs if multi-deck session
 *   mode          — 'srs' uses the SM-2 scheduler, 'review-all' shows every
 *                   card in the deck once regardless of SRS schedule,
 *                   'random' shows random cards from the deck.
 *   question_ids  — Ordered list of question IDs in this session
 *   attempts      — All answer attempts in this session
 *   started_at    — ISO 8601
 *   finished_at   — ISO 8601, null if session is still active
 *   score         — 0-100 percentage correct
 *   total_cards   — How many cards were shown
 *   correct_count — How many were answered correctly
 */
export interface StudySession {
  id: string;
  deck_id: string | null;
  deck_ids: string[];
  mode: 'srs' | 'review-all' | 'random';
  question_ids: string[];
  scheduled_timers?: Record<string, number>;
  attempts: AnswerAttempt[];
  started_at: string;
  finished_at: string | null;
  score: number;
  total_cards: number;
  correct_count: number;
}
