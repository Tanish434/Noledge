/**
 * @file engine/scoring/scoreEngine.ts
 * @description Per-question-type answer scoring engine.
 *
 * WHY THIS FILE EXISTS:
 * The original answer-checking logic in questionStore.answerCurrentCard() used
 * a single generic fuzzy substring match for ALL question types. This breaks
 * correctness for:
 *   - MCQ: the user answer is an option ID string (UUID), not the option text.
 *     Substring matching against the correct option ID is unreliable.
 *   - Multi-select: ALL correct IDs must be selected — none more, none less.
 *   - Fill: each blank slot has its own accepted_answers list.
 *   - Order: the user answer array must match exact order.
 *   - Match: each pair must be matched correctly.
 *
 * This file replaces that generic check with a per-type switch that correctly
 * handles each question format. It is the SINGLE place where correctness is
 * determined — every change to how answers are evaluated happens here.
 *
 * DESIGN DECISIONS:
 *   - Returns a ScoreResult object (not just boolean) so the UI can show
 *     partial credit feedback in the future (score: 0.0-1.0).
 *   - All string comparisons are case-insensitive and trim-normalized.
 *   - Fuzzy matching for typing/voice uses inclusion check: if the user types
 *     "Paris" and the answer is "Paris, France", the user is correct. This
 *     matches how teachers grade short-answer questions.
 *   - Code questions: match after normalizing whitespace per line. This avoids
 *     penalising students for trailing spaces or indentation differences
 *     (within reason — different indentation IS wrong for Python, so we only
 *     strip trailing whitespace, not leading).
 */

import type { Question, QuestionType } from '@/types/question';
import { createLogger } from '@/lib/logger';

const log = createLogger('scoring');

// =============================================================================
// Result Type
// =============================================================================

/**
 * ScoreResult — the result of evaluating a user's answer.
 *
 * Fields:
 *   is_correct      — Whether the answer is considered correct. This is what
 *                     drives SRS interval calculation.
 *   score           — Partial credit score 0.0–1.0. Currently only 0.0 or 1.0
 *                     (binary), but structured for future partial credit.
 *   feedback        — A human-readable explanation of why the answer was
 *                     correct or incorrect. Shown on the answer reveal screen.
 *   matched_answer  — The canonical correct answer string (for display).
 *                     May differ from question.answer in format (e.g., joined array).
 */
export interface ScoreResult {
  is_correct: boolean;
  score: number;
  feedback: string;
  matched_answer: string;
}

// =============================================================================
// Utility Helpers
// =============================================================================

/**
 * normalize — lowercase, trim, and collapse internal whitespace.
 *
 * Used for all string comparisons so "  Paris  " === "paris" === "PARIS".
 *
 * @param s  Input string
 * @returns  Normalized string
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * fuzzyMatch — check if two strings are "the same" for short-answer grading.
 *
 * Rules (applied in order — first match wins):
 *   1. Exact match after normalization → correct
 *   2. Correct answer contains the user answer → correct
 *      (user typed a valid subset: "Au" matches "Au (Gold)")
 *   3. User answer contains the correct answer → correct
 *      (user typed more than needed but the core is right)
 *   4. Otherwise → incorrect
 *
 * WHY substring matching: Short-answer questions are imprecise by nature.
 * A user typing "mitochondria" when the answer is "the mitochondria" should
 * be graded correct. This mirrors how Anki's "type answer" feature works.
 *
 * @param userAnswer     What the user typed/said
 * @param correctAnswer  The expected answer
 * @returns              true if considered correct
 */
function fuzzyMatch(userAnswer: string, correctAnswer: string): boolean {
  const u = normalize(userAnswer);
  const c = normalize(correctAnswer);
  return u === c || c.includes(u) || u.includes(c);
}

/**
 * normalizeCodeLine — strip trailing whitespace from a single line of code.
 *
 * We strip trailing whitespace but PRESERVE leading whitespace (indentation).
 * This means "  return x;   " → "  return x;" which is correct.
 * But "return x;" and "  return x;" are still different — indentation matters.
 *
 * @param line  A line of code
 * @returns     Line with trailing whitespace removed
 */
function normalizeCodeLine(line: string): string {
  return line.replace(/\s+$/, '');
}

// =============================================================================
// Per-Type Scorers
// =============================================================================

/**
 * scoreTrueFalse — score a tf (true/false) question.
 *
 * The user answer must be exactly 'true' or 'false' (set by the TrueFalse
 * component). The correct answer stored in question.answer is 'true' or 'false'.
 * Case-insensitive comparison is used as a safety measure.
 */
function scoreTrueFalse(question: Question, userAnswer: string): ScoreResult {
  const correct = normalize(String(question.answer));
  const given = normalize(userAnswer);
  const is_correct = given === correct;

  return {
    is_correct,
    score: is_correct ? 1 : 0,
    feedback: is_correct
      ? `Correct! The answer is ${correct}.`
      : `Incorrect. The answer is ${correct}, not ${given}.`,
    matched_answer: correct,
  };
}

/**
 * scoreMCQ — score a single-select multiple choice question.
 *
 * The user answer is an option ID (UUID string). We find which option in
 * question.options has is_correct=true and compare IDs.
 *
 * WHY ID comparison (not text): The correct answer stored in question.answer
 * is already the option ID. Comparing IDs is exact and immune to text
 * normalization issues.
 */
function scoreMCQ(question: Question, userAnswer: string): ScoreResult {
  const correctOption = question.options?.find((o) => o.is_correct);
  if (!correctOption) {
    log.warn('score_mcq_no_correct', `MCQ question ${question.id} has no correct option`);
    return { is_correct: false, score: 0, feedback: 'No correct option configured.', matched_answer: '' };
  }

  const is_correct = userAnswer === correctOption.id;

  return {
    is_correct,
    score: is_correct ? 1 : 0,
    feedback: is_correct
      ? `Correct! "${correctOption.content}" is right.`
      : `Incorrect. The correct answer is "${correctOption.content}".`,
    matched_answer: correctOption.content,
  };
}

/**
 * scoreMulti — score a multi-select question.
 *
 * The user must select ALL correct options and NO incorrect ones.
 * Partial credit is NOT given (all-or-nothing), consistent with how
 * multi-select is graded in standardised tests.
 *
 * Algorithm:
 *   correctIds = options where is_correct === true
 *   givenIds   = userAnswer (array of selected option IDs)
 *   is_correct = correctIds and givenIds are identical sets
 */
function scoreMulti(question: Question, userAnswer: string[]): ScoreResult {
  const correctIds = new Set(
    (question.options ?? []).filter((o) => o.is_correct).map((o) => o.id)
  );
  const givenIds = new Set(userAnswer);

  const allCorrectSelected = [...correctIds].every((id) => givenIds.has(id));
  const noWrongSelected = [...givenIds].every((id) => correctIds.has(id));
  const is_correct = allCorrectSelected && noWrongSelected;

  const correctTexts = (question.options ?? [])
    .filter((o) => o.is_correct)
    .map((o) => o.content)
    .join(', ');

  return {
    is_correct,
    score: is_correct ? 1 : 0,
    feedback: is_correct
      ? `Correct! All ${correctIds.size} correct options selected.`
      : `Incorrect. The correct answers are: ${correctTexts}.`,
    matched_answer: correctTexts,
  };
}

/**
 * extractAcronym — extract uppercase initials from a multi-word phrase.
 * E.g. "Domain Name System" -> "DNS", "Domain Name Server" -> "DNS".
 */
function extractAcronym(phrase: string): string {
  if (!phrase) return '';
  const words = phrase.trim().split(/\s+/).filter((w) => w.length > 0 && !/^(and|or|of|the|to|in|for|with|a|an)$/i.test(w));
  if (words.length >= 2) {
    return words.map((w) => w[0].toUpperCase()).join('');
  }
  return '';
}

/**
 * getAllAcceptedAnswers — collect primary answer, aliases, accepted_answers, alternates & acronyms.
 */
function getAllAcceptedAnswers(question: Question): string[] {
  const rawList: string[] = [];

  if (Array.isArray(question.answer)) {
    rawList.push(...question.answer.map(String));
  } else if (question.answer) {
    rawList.push(String(question.answer));
  }

  if (question.accepted_answers && Array.isArray(question.accepted_answers)) {
    rawList.push(...question.accepted_answers.map(String));
  }
  if (question.aliases && Array.isArray(question.aliases)) {
    rawList.push(...question.aliases.map(String));
  }

  const expanded: string[] = [];
  for (const item of rawList) {
    if (typeof item === 'string' && (item.includes('|') || item.includes('/') || item.includes(','))) {
      expanded.push(...item.split(/[/|,]/).map((s) => s.trim()).filter(Boolean));
    } else {
      expanded.push(item);
    }
  }

  const acronyms: string[] = [];
  for (const item of expanded) {
    const acr = extractAcronym(item);
    if (acr && acr.length >= 2) {
      acronyms.push(acr);
    }
  }

  return Array.from(new Set([...expanded, ...acronyms].map((s) => s.trim()).filter(Boolean)));
}

/**
 * scoreTyping — score a free-text typed answer.
 *
 * Uses fuzzyMatch + alias expansion + acronym extraction.
 */
function scoreTyping(question: Question, userAnswer: string): ScoreResult {
  const acceptedList = getAllAcceptedAnswers(question);
  const is_correct = acceptedList.some((ans) => fuzzyMatch(userAnswer, ans));
  const primary = Array.isArray(question.answer) ? question.answer.join(' / ') : String(question.answer ?? '');

  return {
    is_correct,
    score: is_correct ? 1 : 0,
    feedback: is_correct
      ? 'Correct!'
      : `Incorrect. Expected: "${primary}". You wrote: "${userAnswer}".`,
    matched_answer: primary,
  };
}

/**
 * scoreFill — score a fill-in-the-blank question.
 */
function scoreFill(question: Question, userAnswers: string[]): ScoreResult {
  if (!question.blanks || question.blanks.length === 0) {
    return scoreTyping(question, userAnswers[0] ?? '');
  }

  const results = question.blanks.map((blank, i) => {
    const given = userAnswers[i] ?? '';
    const rawAcc = Array.isArray(blank.accepted_answers) ? blank.accepted_answers : [blank.accepted_answers];
    const expanded: string[] = [];

    for (const item of rawAcc) {
      if (typeof item === 'string' && (item.includes('|') || item.includes('/') || item.includes(','))) {
        expanded.push(...item.split(/[/|,]/).map((s) => s.trim()).filter(Boolean));
      } else {
        expanded.push(item);
      }
    }

    const acronyms = expanded.map(extractAcronym).filter((a) => a.length >= 2);
    const allAccepted = Array.from(new Set([...expanded, ...acronyms]));

    return allAccepted.some((acc) => fuzzyMatch(given, acc));
  });

  const is_correct = results.every(Boolean);
  const wrongCount = results.filter((r) => !r).length;
  const canonicalAnswer = question.blanks.map((b) => Array.isArray(b.accepted_answers) ? b.accepted_answers[0] : b.accepted_answers).join(', ');

  return {
    is_correct,
    score: results.filter(Boolean).length / results.length,
    feedback: is_correct
      ? 'All blanks filled correctly!'
      : `${wrongCount} of ${results.length} blank(s) incorrect. Correct: ${canonicalAnswer}.`,
    matched_answer: canonicalAnswer,
  };
}

/**
 * scoreOrder — score an ordering/sequencing question.
 *
 * The user answer is an array of items in the order the user placed them.
 * question.order_items is the CORRECT order.
 * Comparison is done element-by-element using normalize().
 *
 * WHY not fuzzy for order: Ordering questions test sequence memory precisely.
 * "Step 2 before Step 3" is either right or wrong — there's no partial order.
 */
function scoreOrder(question: Question, userAnswers: string[]): ScoreResult {
  const correct = question.order_items ?? [];
  if (correct.length === 0) {
    return { is_correct: true, score: 1, feedback: 'No order items configured.', matched_answer: '' };
  }

  const is_correct =
    correct.length === userAnswers.length &&
    correct.every((item, i) => normalize(item) === normalize(userAnswers[i] ?? ''));

  return {
    is_correct,
    score: is_correct ? 1 : 0,
    feedback: is_correct
      ? 'Correct order!'
      : `Incorrect order. Correct sequence: ${correct.join(' → ')}.`,
    matched_answer: correct.join(' → '),
  };
}

/**
 * scoreMatch — score a drag-and-match pairs question.
 *
 * question.pairs is an array of MatchPair: { id, left, right }.
 * The user answer is an array of strings in format "pairId:pairId"
 * indicating which left item was matched to which right item.
 *
 * For simplicity, we check that each pair was matched to itself
 * (left.id matched to right of same pair). The answer format stored is
 * "pairId:pairId" (same ID on both sides = correct self-match).
 *
 * WHY self-match format: The markdownParser stores answer as
 * pairs.map(p => `${p.id}:${p.id}`). The renderer shuffles the right side
 * and the user drags to re-pair them. Correct = re-creating the original pairs.
 */
function scoreMatch(question: Question, userAnswers: string[]): ScoreResult {
  const correctPairCount = question.pairs?.length ?? 0;
  if (correctPairCount === 0) {
    return { is_correct: true, score: 1, feedback: 'No pairs configured.', matched_answer: '' };
  }

  // Each correct answer is "id:id" (matching left to its own right)
  const correctSet = new Set(question.pairs?.map((p) => `${p.id}:${p.id}`) ?? []);
  const correctCount = userAnswers.filter((a) => correctSet.has(a)).length;
  const is_correct = correctCount === correctPairCount;

  return {
    is_correct,
    score: correctCount / correctPairCount,
    feedback: is_correct
      ? 'All pairs matched correctly!'
      : `${correctCount}/${correctPairCount} pairs correct.`,
    matched_answer: question.pairs?.map((p) => `${p.left} → ${p.right}`).join(', ') ?? '',
  };
}

/**
 * scoreImageSelect — score an image-grid selection question.
 *
 * Identical logic to scoreMCQ — user selects an option ID, we compare
 * to the is_correct option. Kept separate so future image-specific logic
 * (multi-select images, partial credit for "close" images) can be added here.
 */
function scoreImageSelect(question: Question, userAnswer: string): ScoreResult {
  return scoreMCQ(question, userAnswer);
}

/**
 * scoreCode — score a code completion/correction question.
 *
 * Comparison: normalize each line (strip trailing whitespace), join, compare.
 * This is intentionally strict about indentation (meaningful in most languages)
 * but lenient about trailing spaces.
 *
 * Future enhancement: AST comparison using a WASM parser (esprima for JS,
 * pyodide for Python) would be more robust but significantly more complex.
 */
function scoreCode(question: Question, userAnswer: string): ScoreResult {
  const normalize_code = (code: string) =>
    code
      .split('\n')
      .map(normalizeCodeLine)
      .join('\n')
      .trim();

  const correct = normalize_code(
    Array.isArray(question.answer) ? question.answer.join('\n') : String(question.answer)
  );
  const given = normalize_code(userAnswer);
  const is_correct = given === correct;

  return {
    is_correct,
    score: is_correct ? 1 : 0,
    feedback: is_correct
      ? 'Code is correct!'
      : 'Code does not match the expected answer. Check indentation and logic.',
    matched_answer: correct,
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * scoreAnswer — evaluate a user's answer against a question and return a result.
 *
 * This is the ONLY function that external code should call. Everything else
 * in this file is an implementation detail.
 *
 * The switch routes to the correct per-type scorer. If a new question type
 * is added to QuestionType, TypeScript will NOT give a compile error here
 * (because the default case handles unknown types), but adding a new `case`
 * is the expected maintenance action.
 *
 * @param question      The question being answered
 * @param userAnswer    What the user submitted (string or string[])
 * @param _timeTakenMs  Time taken in ms (reserved for future speed-bonus scoring)
 * @returns             ScoreResult with is_correct, score, feedback, matched_answer
 */
export function scoreAnswer(
  question: Question,
  userAnswer: string | string[],
  _timeTakenMs: number
): ScoreResult {
  const done = log.timed('info', 'score_answer', `Scoring ${question.type} question ${question.id}`);

  let result: ScoreResult;

  switch (question.type as QuestionType) {
    case 'tf':
      result = scoreTrueFalse(question, String(userAnswer));
      break;

    case 'mcq':
      result = scoreMCQ(question, String(userAnswer));
      break;

    case 'multi':
      result = scoreMulti(
        question,
        Array.isArray(userAnswer) ? userAnswer : [String(userAnswer)]
      );
      break;

    case 'typing':
    case 'voice':
      result = scoreTyping(question, String(userAnswer));
      break;

    case 'fill':
      result = scoreFill(
        question,
        Array.isArray(userAnswer) ? userAnswer : [String(userAnswer)]
      );
      break;

    case 'order':
      result = scoreOrder(
        question,
        Array.isArray(userAnswer) ? userAnswer : [String(userAnswer)]
      );
      break;

    case 'match':
      result = scoreMatch(
        question,
        Array.isArray(userAnswer) ? userAnswer : [String(userAnswer)]
      );
      break;

    case 'image-select':
      result = scoreImageSelect(question, String(userAnswer));
      break;

    case 'code':
      result = scoreCode(question, String(userAnswer));
      break;

    default:
      // Unknown type — log warning and treat as incorrect
      log.warn('score_unknown_type', `Unknown question type: ${question.type}`);
      result = {
        is_correct: false,
        score: 0,
        feedback: `Unknown question type: ${question.type}`,
        matched_answer: '',
      };
  }

  done({ is_correct: result.is_correct, score: result.score });
  return result;
}
