/**
 * @file src/lib/agentTools.ts
 * @description Client-side execution bridge for AI Agent website tools.
 * Empowers the AI agent to create/manage decks, add/edit/delete/convert questions,
 * navigate the application, and toggle system themes.
 */

import { useDeckStore } from '@/stores/deckStore';
import { useQuestionStore } from '@/stores/questionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getAllQuestions, getQuestionsByDeck } from '@/lib/storage';
import { createInitialSRS } from '@/engine/srs/sm2';
import type { Question, QuestionType, QuestionOption, DifficultyLevel } from '@/types/question';

export interface SiteActionResult {
  success: boolean;
  message: string;
  data?: any;
}

export async function executeSiteAction(action: string, params: Record<string, any> = {}): Promise<SiteActionResult> {
  try {
    switch (action) {
      // ─── 1. Decks Management ────────────────────────────────────────────────
      case 'create_deck': {
        const name = params.name?.trim();
        if (!name) return { success: false, message: 'Deck name is required.' };
        const description = params.description || '';
        const tags = Array.isArray(params.tags) ? params.tags : [];
        const deck = await useDeckStore.getState().createDeck({
          name,
          description,
          tags,
          color: params.color || '#6366f1',
          icon: params.icon || 'Cards',
        });
        return { success: true, message: `Deck "${deck.name}" created successfully!`, data: deck };
      }

      case 'delete_deck': {
        const deckId = params.deck_id?.trim();
        if (!deckId) return { success: false, message: 'deck_id is required.' };
        await useDeckStore.getState().deleteDeck(deckId);
        return { success: true, message: `Deck "${deckId}" deleted.` };
      }

      case 'get_decks': {
        await useDeckStore.getState().loadDecks();
        const decks = Object.values(useDeckStore.getState().decks);
        return {
          success: true,
          message: `Found ${decks.length} decks.`,
          data: decks.map((d) => ({
            id: d.id,
            name: d.name,
            question_count: d.question_count || 0,
            tags: d.tags || [],
            description: d.description,
          })),
        };
      }

      // ─── 2. Question / Flashcard CRUD & Transformation ─────────────────────
      case 'add_question': {
        const deckId = params.deck_id || Object.keys(useDeckStore.getState().decks)[0];
        if (!deckId) return { success: false, message: 'No deck found to add question to.' };

        const type: QuestionType = params.type || 'mcq';
        const content = params.content || 'New Flashcard Question';
        const answer = params.answer || '';
        const explanation = params.explanation || '';
        const hints = Array.isArray(params.hints) ? params.hints : [];
        const difficulty: DifficultyLevel = params.difficulty || 'medium';

        let options: QuestionOption[] | undefined = undefined;
        if (['mcq', 'multi'].includes(type) && Array.isArray(params.options)) {
          options = params.options.map((opt: any, idx: number) => ({
            id: opt.id || `opt_${idx + 1}`,
            content: typeof opt === 'string' ? opt : opt.content || '',
            is_correct: typeof opt === 'object' ? Boolean(opt.is_correct) : opt === answer,
          }));
        } else if (type === 'tf') {
          options = [
            { id: 'opt_true', content: 'True', is_correct: String(answer).toLowerCase() === 'true' },
            { id: 'opt_false', content: 'False', is_correct: String(answer).toLowerCase() === 'false' },
          ];
        }

        const newQuestion: Question = {
          id: params.id || `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          deck_id: deckId,
          type,
          content,
          options,
          answer,
          explanation,
          hints,
          difficulty,
          tags: Array.isArray(params.tags) ? params.tags : [],
          source_file: params.source_file || 'manual',
          code_language: params.code_language || (type === 'code' ? 'python' : undefined),
          pairs: params.pairs || params.match_pairs,
          order_items: params.order_items,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          srs: createInitialSRS(),
        };

        await useQuestionStore.getState().upsertQuestion(newQuestion);
        await useDeckStore.getState().loadDecks();

        return {
          success: true,
          message: `Added new ${type.toUpperCase()} question to deck "${deckId}".`,
          data: newQuestion,
        };
      }

      case 'edit_question': {
        const questionId = params.id?.trim();
        if (!questionId) return { success: false, message: 'Question ID required for edit.' };

        const allQuestions = await getAllQuestions();
        const currentQ = allQuestions.find((q) => q.id === questionId);
        if (!currentQ) return { success: false, message: `Question ${questionId} not found.` };

        const updatedQ: Question = {
          ...currentQ,
          content: params.content !== undefined ? params.content : currentQ.content,
          answer: params.answer !== undefined ? params.answer : currentQ.answer,
          explanation: params.explanation !== undefined ? params.explanation : currentQ.explanation,
          hints: params.hints !== undefined ? params.hints : currentQ.hints,
          type: params.type !== undefined ? params.type : currentQ.type,
          options: params.options !== undefined ? params.options : currentQ.options,
          code_language: params.code_language !== undefined ? params.code_language : currentQ.code_language,
          updated_at: new Date().toISOString(),
        };

        await useQuestionStore.getState().upsertQuestion(updatedQ);
        return { success: true, message: `Question ${questionId} updated successfully.`, data: updatedQ };
      }

      case 'delete_question': {
        const questionId = params.id?.trim();
        if (!questionId) return { success: false, message: 'Question ID required for deletion.' };

        const allQuestions = await getAllQuestions();
        const currentQ = allQuestions.find((q) => q.id === questionId);
        const deckId = currentQ?.deck_id || params.deck_id || '';

        await useQuestionStore.getState().deleteQuestion(questionId, deckId);
        await useDeckStore.getState().loadDecks();
        return { success: true, message: `Question ${questionId} deleted.` };
      }

      case 'change_question_type': {
        const questionId = params.id?.trim();
        const newType: QuestionType = params.new_type;
        if (!questionId || !newType) return { success: false, message: 'id and new_type are required.' };

        const allQuestions = await getAllQuestions();
        const currentQ = allQuestions.find((q) => q.id === questionId);
        if (!currentQ) return { success: false, message: `Question ${questionId} not found.` };

        const adaptedQ: Question = {
          ...currentQ,
          type: newType,
          code_language: newType === 'code' ? currentQ.code_language || 'python' : undefined,
          updated_at: new Date().toISOString(),
        };

        if (newType === 'tf') {
          adaptedQ.options = [
            { id: 'opt_true', content: 'True', is_correct: String(adaptedQ.answer).toLowerCase() === 'true' },
            { id: 'opt_false', content: 'False', is_correct: String(adaptedQ.answer).toLowerCase() === 'false' },
          ];
        }

        await useQuestionStore.getState().upsertQuestion(adaptedQ);
        return {
          success: true,
          message: `Converted question ${questionId} to ${newType.toUpperCase()}.`,
          data: adaptedQ,
        };
      }

      case 'move_question': {
        const questionId = params.id?.trim();
        const targetDeckId = params.target_deck_id?.trim();
        if (!questionId || !targetDeckId) return { success: false, message: 'id and target_deck_id required.' };

        const allQuestions = await getAllQuestions();
        const currentQ = allQuestions.find((q) => q.id === questionId);
        if (!currentQ) return { success: false, message: `Question ${questionId} not found.` };

        const movedQ: Question = {
          ...currentQ,
          deck_id: targetDeckId,
          updated_at: new Date().toISOString(),
        };

        await useQuestionStore.getState().upsertQuestion(movedQ);
        await useDeckStore.getState().loadDecks();
        return { success: true, message: `Question moved to deck ${targetDeckId}.`, data: movedQ };
      }

      case 'sort_deck': {
        const deckId = params.deck_id?.trim();
        const sortBy = params.sort_by || 'difficulty'; // 'difficulty' | 'type' | 'title'
        if (!deckId) return { success: false, message: 'deck_id required.' };

        const allQ: Question[] = await getQuestionsByDeck(deckId);
        if (sortBy === 'difficulty') {
          const diffRank: Record<DifficultyLevel, number> = { hard: 1, medium: 2, easy: 3 };
          allQ.sort((a, b) => (diffRank[a.difficulty] || 2) - (diffRank[b.difficulty] || 2));
        } else if (sortBy === 'type') {
          allQ.sort((a, b) => a.type.localeCompare(b.type));
        } else {
          allQ.sort((a, b) => a.content.localeCompare(b.content));
        }

        for (const q of allQ) {
          await useQuestionStore.getState().upsertQuestion(q);
        }

        return { success: true, message: `Deck ${deckId} sorted by ${sortBy}.` };
      }

      // ─── 3. Navigation & App Controls ─────────────────────────────────────
      case 'navigate_to': {
        const path = params.path || '/study';
        if (typeof window !== 'undefined') {
          window.location.href = path;
        }
        return { success: true, message: `Navigating to ${path}.` };
      }

      case 'change_theme': {
        const targetTheme = params.theme === 'dark' ? 'dark' : 'light';
        useSettingsStore.getState().updateSetting('theme', targetTheme);
        if (typeof document !== 'undefined') {
          if (targetTheme === 'dark') {
            document.documentElement.classList.add('dark');
            document.documentElement.setAttribute('data-theme', 'dark');
          } else {
            document.documentElement.classList.remove('dark');
            document.documentElement.setAttribute('data-theme', 'light');
          }
        }
        return { success: true, message: `Theme switched to ${targetTheme} mode.` };
      }

      default:
        return { success: false, message: `Unknown site action: "${action}".` };
    }
  } catch (err: any) {
    return { success: false, message: `Action execution error: ${err.message || String(err)}` };
  }
}

// ─── Shared Code Evaluation Service ──────────────────────────────────────────
export interface CodeEvaluationResult {
  success: boolean;
  is_correct: boolean;
  score: number;
  feedback: string;
}

export async function judgeCodeSnippet(question: Question, code: string): Promise<CodeEvaluationResult> {
  try {
    const res = await fetch('/api/agent/judge-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id: question.id,
        question_content: question.content,
        code,
        expected_answer: question.answer,
        explanation: question.explanation,
        hints: question.hints,
        language: question.code_language || 'python',
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        is_correct: Boolean(data.is_correct),
        score: typeof data.score === 'number' ? Math.round(data.score <= 1 ? data.score * 100 : data.score) : 0,
        feedback: data.feedback || 'Code evaluated.',
      };
    }
  } catch (err: any) {
    console.warn('[judgeCodeSnippet] Evaluation request failed:', err);
  }

  return {
    success: false,
    is_correct: false,
    score: 0,
    feedback: 'Evaluation service temporarily unavailable. Please verify code locally.',
  };
}

