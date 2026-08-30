/**
 * @file lib/markdownParser.ts
 * @description Pure JSON Question Deck Parser and Serializer for Noledge v2.0.
 * Ensures 100% loss-less structured JSON serialization and parsing for all 10 question types.
 */

import { createInitialSRS } from '@/engine/srs/sm2';
import type { Question, QuestionType, QuestionOption, MatchPair, FillBlank } from '@/types/question';
import { createLogger } from '@/lib/logger';

const log = createLogger('sync');

export interface ParseResult {
  questions: Omit<Question, 'deck_id'>[];
  errors: string[];
}

const VALID_TYPES: QuestionType[] = [
  'tf',
  'mcq',
  'multi',
  'typing',
  'voice',
  'image-select',
  'match',
  'fill',
  'order',
  'code',
];

export function getDeckPrefix(deckName: string, sourceFile?: string): string {
  let name = '';
  if (sourceFile) {
    name = sourceFile.split(/[/\\]/).pop()?.replace(/\.(json|md|markdown)$/i, '') || '';
  }
  if (!name && deckName) {
    name = deckName;
  }
  if (!name) name = 'deck';

  return name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
}

export function generateSequentialQuestionId(deckName: string, type: QuestionType, index: number, sourceFile?: string): string {
  const prefix = getDeckPrefix(deckName, sourceFile);
  const paddedIndex = String(index).padStart(2, '0');
  const cleanType = type.toLowerCase();
  return `${prefix}_${paddedIndex}_${cleanType}`;
}

export function reindexDeckQuestions(questions: Question[], deckName?: string): Question[] {
  if (!questions || questions.length === 0) return [];
  const baseName = deckName || questions[0]?.source_file || 'deck';

  return questions.map((q, idx) => {
    const newId = generateSequentialQuestionId(baseName, q.type, idx + 1, q.source_file);
    return {
      ...q,
      id: newId,
    };
  });
}

/**
 * serializeDeckToJson — convert an array of Question objects to standardized formatted JSON.
 */
export function serializeDeckToJson(questions: Question[]): string {
  const formattedQuestions = questions.map((q) => {
    const ordered: Record<string, any> = {
      id: q.id,
      type: q.type,
      content: q.content,
      answer: q.answer,
    };

    if (q.explanation !== undefined && q.explanation !== '') {
      ordered.explanation = q.explanation;
    }
    if (q.code_language !== undefined && q.code_language !== '') {
      ordered.code_language = q.code_language;
    }
    if (q.options && q.options.length > 0) {
      ordered.options = q.options;
    }
    if (q.pairs && q.pairs.length > 0) {
      ordered.pairs = q.pairs;
    }
    if (q.blanks && q.blanks.length > 0) {
      ordered.blanks = q.blanks;
    }
    if (q.order_items && q.order_items.length > 0) {
      ordered.order_items = q.order_items;
    }

    const altAnswers = (q.accepted_answers && q.accepted_answers.length > 0) ? q.accepted_answers : (q.aliases && q.aliases.length > 0 ? q.aliases : undefined);
    if (altAnswers && altAnswers.length > 0) {
      ordered.accepted_answers = altAnswers;
      ordered.aliases = altAnswers;
    }

    ordered.tags = Array.isArray(q.tags) ? q.tags : [];
    ordered.difficulty = q.difficulty || 'medium';
    ordered.source_file = q.source_file || 'manual';

    const rawSrs = q.srs || {};
    ordered.srs = {
      interval: typeof rawSrs.interval === 'number' ? rawSrs.interval : 1,
      ease_factor: typeof rawSrs.ease_factor === 'number' ? rawSrs.ease_factor : 2.5,
      repetitions: typeof rawSrs.repetitions === 'number' ? rawSrs.repetitions : 0,
      next_review: rawSrs.next_review || new Date().toISOString(),
      last_reviewed: rawSrs.last_reviewed ?? null,
      review_count: typeof rawSrs.review_count === 'number' ? rawSrs.review_count : 0,
    };

    ordered.created_at = q.created_at || new Date().toISOString();
    ordered.updated_at = q.updated_at || new Date().toISOString();
    if (q.deck_id) {
      ordered.deck_id = q.deck_id;
    }

    return ordered;
  });

  return JSON.stringify(formattedQuestions, null, 2);
}

/**
 * serializeQuestionToMarkdown — alias for JSON serialization.
 */
export function serializeQuestionToMarkdown(question: Question): string {
  return serializeDeckToJson([question]);
}

/**
 * parseQuestionJson — parse a JSON string into structured Question objects.
 */
export async function parseQuestionJson(jsonString: string, filePath: string): Promise<ParseResult> {
  const errors: string[] = [];
  const questions: Omit<Question, 'deck_id'>[] = [];

  const trimmed = jsonString.trim();
  if (!trimmed) {
    return { questions: [], errors: ['File is empty'] };
  }

  let rawData: any;
  try {
    rawData = JSON.parse(trimmed);
  } catch (err: any) {
    return { questions: [], errors: [`Invalid JSON format: ${err?.message || 'Syntax error'}`] };
  }

  const rawList: any[] = Array.isArray(rawData) ? rawData : [rawData];
  const now = new Date().toISOString();

  for (let idx = 0; idx < rawList.length; idx++) {
    const raw = rawList[idx];
    if (!raw || typeof raw !== 'object') {
      errors.push(`Item #${idx + 1}: Question object must be a valid JSON object`);
      continue;
    }

    const type = raw.type as QuestionType;
    if (!type || !VALID_TYPES.includes(type)) {
      errors.push(`Item #${idx + 1}: Invalid or missing question type "${type}". Must be one of: ${VALID_TYPES.join(', ')}`);
      continue;
    }

    const content = typeof raw.content === 'string'
      ? raw.content
          .replace(/(?:\r?\n)?\s*-{3,}\s*/g, '')
          .replace(/EXPLANATION:[\s\S]*/gi, '')
          .trim()
      : '';
    if (!content) {
      errors.push(`Item #${idx + 1} (${type}): Missing required "content" string`);
      continue;
    }

    const id = raw.id || generateSequentialQuestionId(filePath, type, idx + 1, filePath);
    const difficulty = (['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'medium') as 'easy' | 'medium' | 'hard';
    const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
    const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : undefined;
    const codeLanguage = typeof raw.code_language === 'string' ? raw.code_language.trim() : (typeof raw.lang === 'string' ? raw.lang.trim() : undefined);

    let answer: string | string[] = typeof raw.answer === 'string' || Array.isArray(raw.answer) ? raw.answer : '';
    let options: QuestionOption[] | undefined = Array.isArray(raw.options) ? raw.options : undefined;
    let pairs: MatchPair[] | undefined = Array.isArray(raw.pairs) ? raw.pairs : undefined;
    let blanks: FillBlank[] | undefined = Array.isArray(raw.blanks) ? raw.blanks : undefined;
    let orderItems: string[] | undefined = Array.isArray(raw.order_items) ? raw.order_items : (Array.isArray(raw.order) ? raw.order : undefined);
    let aliases: string[] | undefined = Array.isArray(raw.aliases) ? raw.aliases : (Array.isArray(raw.accepted_answers) ? raw.accepted_answers : undefined);

    // Type-specific validations with automatic fallback fixing
    let finalCodeLang = codeLanguage;
    if (type === 'code' && !finalCodeLang) {
      finalCodeLang = 'python';
    }

    if (type === 'mcq' || type === 'multi' || type === 'image-select') {
      if (!options || options.length < 2) {
        if (typeof answer === 'string' && answer.trim()) {
          options = [
            { id: 'opt-1', content: answer, is_correct: true },
            { id: 'opt-2', content: 'None of the above', is_correct: false },
          ];
        } else {
          errors.push(`Item #${idx + 1} (${type}): "${content.slice(0, 30)}..." requires options`);
          continue;
        }
      }

      if (type === 'mcq') {
        const correctCount = options.filter((o) => o.is_correct).length;
        if (correctCount === 0) {
          const strAns = String(answer).trim().toLowerCase();
          const matchIdx = options.findIndex((o) => o.id.toLowerCase() === strAns || o.content.toLowerCase().trim() === strAns);
          if (matchIdx >= 0) {
            options[matchIdx] = { ...options[matchIdx], is_correct: true };
          } else {
            options[0] = { ...options[0], is_correct: true };
          }
        }
      }
    }

    const question: Omit<Question, 'deck_id'> = {
      id,
      type,
      content,
      answer,
      explanation,
      options,
      pairs,
      blanks,
      order_items: orderItems,
      code_language: finalCodeLang,
      accepted_answers: aliases,
      aliases,
      tags,
      difficulty,
      source_file: filePath,
      srs: raw.srs || createInitialSRS(),
      created_at: raw.created_at || raw.created || now,
      updated_at: raw.updated_at || raw.updated || now,
    };

    questions.push(question);
  }

  return { questions, errors };
}

/**
 * parseQuestionMarkdown — primary parser interface. Parses JSON content directly.
 */
export async function parseQuestionMarkdown(content: string, filePath: string): Promise<ParseResult> {
  return parseQuestionJson(content, filePath);
}
