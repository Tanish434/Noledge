/**
 * @file app/create/page.tsx
 * @description Create card page — multi-step wizard.
 *
 * Steps:
 *   1. Question Type (tilt/glow/morph cards)
 *   2. Question content
 *   3. Answers
 *   4. Explanation
 *   5. Preview
 *   6. Save
 *
 * Animated progress indicator, step transitions (GSAP).
 */

'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import {
  ListChecks,
  HelpCircle,
  CheckSquare,
  FileText,
  Eye,
  Save,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  Circle,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useQuestionStore } from '@/stores/questionStore';
import { useDeckStore } from '@/stores/deckStore';
import { useToast } from '@/components/ui/Toast';
import { useGSAP, getReducedMotion } from '@/hooks/useGSAP';
import { createInitialSRS } from '@/engine/srs/sm2';
import PageTransition from '@/components/ui/PageTransition';
import CustomSelect from '@/components/ui/CustomSelect';
import { cn } from '@/utils/cn';
import type { Question, QuestionType, QuestionOption, MatchPair } from '@/types/question';
import { getQuestion } from '@/lib/storage';
import { generateSequentialQuestionId } from '@/lib/markdownParser';
import styles from './create.module.css';

// =============================================================================
// Wizard Steps
// =============================================================================

interface Step {
  id: number;
  label: string;
  icon: LucideIcon;
}

const STEPS: Step[] = [
  { id: 0, label: 'Type', icon: ListChecks },
  { id: 1, label: 'Question', icon: HelpCircle },
  { id: 2, label: 'Answers', icon: CheckSquare },
  { id: 3, label: 'Explanation', icon: FileText },
  { id: 4, label: 'Preview', icon: Eye },
  { id: 5, label: 'Save', icon: Save },
];

const QUESTION_TYPES: Array<{ value: QuestionType; label: string; desc: string }> = [
  { value: 'mcq', label: 'Multiple Choice', desc: 'One correct answer from a list' },
  { value: 'multi', label: 'Multiple Select', desc: 'Several correct answers' },
  { value: 'typing', label: 'Typing / Free Text', desc: 'Free text typed response' },
  { value: 'tf', label: 'True/False', desc: 'Binary true or false answer' },
  { value: 'fill', label: 'Text Selection / Fill Blank', desc: 'Highlight text or fill missing words' },
  { value: 'order', label: 'Ordering', desc: 'Arrange in correct sequence' },
  { value: 'match', label: 'Match Pairs', desc: 'Connect items' },
  { value: 'code', label: 'Code Snippet', desc: 'Write/complete code' },
];

// =============================================================================
// Create Page Content
// =============================================================================

function CreatePageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const deckId = params.get('deck') ?? '';
  const questionIdParam = params.get('id');

  const { upsertQuestion: saveQuestion } = useQuestionStore();
  const { decks, loadDecks } = useDeckStore();
  const { addToast } = useToast();
  const deckList = Object.values(decks);

  const [selectedDeckId, setSelectedDeckId] = useState<string>(deckId);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [questionType, setQuestionType] = useState<QuestionType>('mcq');
  const [questionContent, setQuestionContent] = useState('');
  const [answer, setAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [aliasesInput, setAliasesInput] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [saving, setSaving] = useState(false);

  // Structured states for all 10 question formats
  const [options, setOptions] = useState<Array<{ id: string; content: string; image_url?: string; is_correct: boolean }>>([
    { id: 'opt-1', content: '', is_correct: true },
    { id: 'opt-2', content: '', is_correct: false },
    { id: 'opt-3', content: '', is_correct: false },
    { id: 'opt-4', content: '', is_correct: false },
  ]);
  const [pairs, setPairs] = useState<Array<{ id: string; left: string; right: string }>>([
    { id: 'p-1', left: '', right: '' },
    { id: 'p-2', left: '', right: '' },
    { id: 'p-3', left: '', right: '' },
  ]);
  const [orderItems, setOrderItems] = useState<string[]>(['', '', '']);
  const [codeLanguage, setCodeLanguage] = useState<string>('javascript');

  const stepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadDecks();
  }, [loadDecks]);

  useEffect(() => {
    if (deckId) {
      setSelectedDeckId(deckId);
    } else if (deckList.length > 0 && !selectedDeckId) {
      setSelectedDeckId(deckList[0].id);
    }
  }, [deckId, deckList, selectedDeckId]);

  // Load existing question for editing if ?id= parameter is present
  useEffect(() => {
    if (!questionIdParam) return;
    void (async () => {
      const existing = await getQuestion(questionIdParam);
      if (existing) {
        setEditingQuestion(existing);
        setSelectedDeckId(existing.deck_id);
        setQuestionType(existing.type);
        setQuestionContent(existing.content);
        setExplanation(existing.explanation || '');
        const existingAlts = existing.accepted_answers || existing.aliases;
        setAliasesInput(existingAlts && existingAlts.length > 0 ? existingAlts.join(', ') : '');
        setDifficulty(existing.difficulty || 'medium');
        setCodeLanguage(existing.code_language || 'javascript');

        if (typeof existing.answer === 'string') {
          setAnswer(existing.answer);
        } else if (Array.isArray(existing.answer)) {
          setAnswer(existing.answer.join(', '));
        }

        if (existing.options && existing.options.length > 0) {
          setOptions(existing.options);
        }
        if (existing.pairs && existing.pairs.length > 0) {
          setPairs(existing.pairs);
        }
        if (existing.order_items && existing.order_items.length > 0) {
          setOrderItems(existing.order_items);
        }
      }
    })();
  }, [questionIdParam]);

  const activeDeck = selectedDeckId ? decks[selectedDeckId] : null;

  // ─── GSAP step transition animation ──────────────────────────────────
  useGSAP(
    () => {
      if (!stepRef.current || getReducedMotion()) return;
      gsap.fromTo(
        stepRef.current,
        { x: 30, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }
      );
    },
    undefined,
    [currentStep]
  );

  // ─── Step navigation ─────────────────────────────────────────────────
  const nextStep = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  // ─── Save handler ────────────────────────────────────────────────────
  const handleSave = async () => {
    const targetDeckId = selectedDeckId || deckId;
    if (!targetDeckId) {
      addToast('Please select a deck first', 'error');
      return;
    }
    if (!questionContent.trim()) {
      addToast('Question content is required', 'error');
      return;
    }

    setSaving(true);
    try {
      let formattedOptions: QuestionOption[] | undefined;
      let formattedPairs: MatchPair[] | undefined;
      let formattedOrderItems: string[] | undefined;
      let finalAnswer = answer;

      if (questionType === 'mcq' || questionType === 'multi' || questionType === 'image-select') {
        formattedOptions = options.filter((o) => o.content.trim().length > 0);
        const correctOpts = formattedOptions.filter((o) => o.is_correct).map((o) => o.id);
        finalAnswer = correctOpts.join(',');
      } else if (questionType === 'match') {
        formattedPairs = pairs.filter((p) => p.left.trim().length > 0 && p.right.trim().length > 0);
        finalAnswer = formattedPairs.map((p) => `${p.left}:${p.right}`).join(',');
      } else if (questionType === 'order') {
        formattedOrderItems = orderItems.filter((item) => item.trim().length > 0);
        finalAnswer = formattedOrderItems.join(',');
      }

      const deckQuestions = Object.values(useQuestionStore.getState().questionsByDeck)
        .flat()
        .filter((q) => q.deck_id === targetDeckId);
      const existingSource = deckQuestions.find(
        (q) => q.source_file && q.source_file !== 'manual' && q.source_file !== 'unknown'
      )?.source_file;
      const activeDeckObj = decks[targetDeckId];
      const targetSourceFile = editingQuestion
        ? editingQuestion.source_file
        : existingSource || (activeDeckObj ? `noledge/questions/${activeDeckObj.name.toLowerCase().replace(/\s+/g, '-')}-deck.json` : 'noledge/questions/tech-mastery-deck.json');

      const newQuestionId = editingQuestion
        ? editingQuestion.id
        : generateSequentialQuestionId(
          activeDeckObj?.name || 'deck',
          questionType,
          deckQuestions.length + 1,
          targetSourceFile
        );

      const userAliases = aliasesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const finalAliases = userAliases.length > 0 ? userAliases : undefined;

      const question: Question = {
        id: newQuestionId,
        deck_id: targetDeckId,
        type: questionType,
        content: questionContent,
        answer: finalAnswer,
        options: formattedOptions,
        pairs: formattedPairs,
        order_items: formattedOrderItems,
        code_language: questionType === 'code' ? codeLanguage : undefined,
        explanation: explanation || undefined,
        accepted_answers: finalAliases,
        aliases: finalAliases,
        tags: [],
        difficulty,
        source_file: targetSourceFile,
        created_at: editingQuestion ? editingQuestion.created_at : new Date().toISOString(),
        updated_at: new Date().toISOString(),
        srs: editingQuestion ? editingQuestion.srs : createInitialSRS(),
      };

      await saveQuestion(question);
      addToast(editingQuestion ? 'Question updated successfully!' : 'Question saved successfully!', 'success');
      router.push('/manage');
    } catch {
      addToast('Failed to save question', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Step validation ─────────────────────────────────────────────────
  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return !!questionType;
      case 1:
        return questionContent.trim().length > 0;
      case 2:
        if (questionType === 'mcq' || questionType === 'multi' || questionType === 'image-select') {
          return options.some((o) => o.content.trim() && o.is_correct);
        }
        if (questionType === 'match') {
          return pairs.some((p) => p.left.trim() && p.right.trim());
        }
        if (questionType === 'order') {
          return orderItems.filter((i) => i.trim()).length >= 2;
        }
        return answer.trim().length > 0 || questionType === 'tf';
      case 3:
        return true;
      case 4:
        return true;
      default:
        return true;
    }
  };

  return (
    <PageTransition>
      <main className={styles.create}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className={styles.headerCard}>
          <div className={styles.headerGlow} />
          <div className={styles.headerLeft}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrowBadge}>
                <Plus size={12} strokeWidth={2} /> {editingQuestion ? 'Edit Card' : 'New Card'}
              </span>
            </div>
            <h1 className={styles.headerTitle}>{editingQuestion ? 'Edit Question' : 'Create Question'}</h1>
            <div className={styles.headerMetaRow} style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="text-sm text-secondary font-mono">Target Deck:</span>
              <CustomSelect
                value={selectedDeckId}
                onChange={(val) => setSelectedDeckId(val)}
                options={
                  deckList.length === 0
                    ? [{ value: '', label: 'No decks found — create one in Manage' }]
                    : deckList.map((d) => ({
                      value: d.id,
                      label: `📚 ${d.name} (${d.question_count} cards)`,
                    }))
                }
                aria-label="Select Target Deck"
              />
            </div>
          </div>
        </header>

        {/* ── Step Progress ──────────────────────────────────────────── */}
        <div className={styles.stepProgress}>
          {STEPS.map((step, i) => {
            const StepIcon = step.icon;
            const isComplete = i < currentStep;
            const isCurrent = i === currentStep;
            return (
              <React.Fragment key={step.id}>
                <div
                  className={cn(
                    styles.stepIndicator,
                    isComplete && styles.stepComplete,
                    isCurrent && styles.stepCurrent
                  )}
                  onClick={() => setCurrentStep(i)}
                  style={{ cursor: 'pointer' }}
                  title={`Jump to step ${i + 1}: ${step.label}`}
                >
                  <div className={styles.stepIcon}>
                    {isComplete ? (
                      <Check size={16} strokeWidth={2} />
                    ) : (
                      <StepIcon size={16} strokeWidth={1.75} />
                    )}
                  </div>
                  <span className={styles.stepLabel}>{step.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn(styles.stepConnector, isComplete && styles.stepConnectorComplete)} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Step Content ───────────────────────────────────────────── */}
        <div ref={stepRef} className={cn('card-shell', styles.stepContent)}>
          {/* Step 1: Question Type */}
          {currentStep === 0 && (
            <div className={styles.stepBody}>
              <h2 className="text-card-title">Choose Question Type</h2>
              <p className="text-secondary text-sm">Select the format for your question</p>
              <div className={styles.typeGrid}>
                {QUESTION_TYPES.map(({ value, label, desc }) => (
                  <button
                    key={value}
                    className={cn(
                      styles.typeCard,
                      questionType === value && styles.typeCardActive
                    )}
                    onClick={() => setQuestionType(value)}
                  >
                    <span className={styles.typeLabel}>{label}</span>
                    <span className={styles.typeDesc}>{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Question Content */}
          {currentStep === 1 && (
            <div className={styles.stepBody}>
              <h2 className="text-card-title">Write the Question</h2>
              <p className="text-secondary text-sm">Enter your question content (markdown supported)</p>
              <textarea
                className={styles.textarea}
                value={questionContent}
                onChange={(e) => setQuestionContent(e.target.value)}
                placeholder="e.g. What is the powerhouse of the cell?"
                rows={6}
                autoFocus
              />
              <div className={styles.fieldRow}>
                <label className="text-sm text-secondary">Difficulty</label>
                <div className={styles.difficultyRow}>
                  {(['easy', 'medium', 'hard'] as const).map((d) => (
                    <button
                      key={d}
                      className={cn(
                        styles.difficultyBtn,
                        difficulty === d && styles.difficultyBtnActive
                      )}
                      onClick={() => setDifficulty(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Answers */}
          {currentStep === 2 && (
            <div className={styles.stepBody}>
              <h2 className="text-card-title">Configure Answers & Format</h2>
              <p className="text-secondary text-sm">
                {questionType === 'mcq' && 'Enter options and select the single correct answer'}
                {questionType === 'multi' && 'Enter options and check all correct answers'}
                {questionType === 'image-select' && 'Enter options and image URLs for image selection'}
                {questionType === 'tf' && 'Select the correct binary answer (True or False)'}
                {questionType === 'match' && 'Enter left prompts and matching right definitions'}
                {questionType === 'order' && 'Enter items in their correct sequence'}
                {questionType === 'code' && 'Select programming language and enter code solution'}
                {questionType === 'fill' && 'Define blank slots syntax or accepted blank answers'}
                {(questionType === 'typing' || questionType === 'voice') && 'Enter the exact or expected answer text'}
              </p>

              {/* ── MCQ / Multi-Select / Image-Select Options ──────────── */}
              {(questionType === 'mcq' || questionType === 'multi' || questionType === 'image-select') && (
                <div className={styles.answersList}>
                  {options.map((opt, idx) => (
                    <div
                      key={opt.id}
                      className={cn(styles.optionCard, opt.is_correct && styles.optionCardActive)}
                    >
                      <div className={styles.optionTopRow}>
                        <input
                          type={questionType === 'mcq' ? 'radio' : 'checkbox'}
                          name="correctOption"
                          checked={opt.is_correct}
                          className={styles.radioCheck}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setOptions(
                              options.map((o) =>
                                questionType === 'mcq'
                                  ? { ...o, is_correct: o.id === opt.id }
                                  : o.id === opt.id
                                    ? { ...o, is_correct: isChecked }
                                    : o
                              )
                            );
                          }}
                          title={opt.is_correct ? 'Correct Answer' : 'Mark as Correct'}
                        />
                        <span className={styles.optionBadge}>Option {idx + 1}</span>
                        <input
                          type="text"
                          value={opt.content}
                          onChange={(e) =>
                            setOptions(options.map((o) => (o.id === opt.id ? { ...o, content: e.target.value } : o)))
                          }
                          placeholder={`Enter text for option ${idx + 1}...`}
                          className={styles.optionInput}
                        />
                        {options.length > 2 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-danger"
                            onClick={() => setOptions(options.filter((o) => o.id !== opt.id))}
                            title="Delete Option"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {questionType === 'image-select' && (
                        <input
                          type="text"
                          value={opt.image_url ?? ''}
                          onChange={(e) =>
                            setOptions(options.map((o) => (o.id === opt.id ? { ...o, image_url: e.target.value } : o)))
                          }
                          placeholder="Image URL (e.g. https://images.unsplash.com/...)"
                          className={styles.optionInput}
                          style={{ marginLeft: 32 }}
                        />
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ alignSelf: 'flex-start', marginTop: 4, gap: 6 }}
                    onClick={() =>
                      setOptions([
                        ...options,
                        { id: `opt-${Date.now()}`, content: '', is_correct: false },
                      ])
                    }
                  >
                    + Add Option
                  </button>
                </div>
              )}

              {/* ── True / False ─────────────────────────────────────────── */}
              {questionType === 'tf' && (
                <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                  <button
                    type="button"
                    className={cn('btn', answer === 'true' ? 'btn-primary' : 'btn-secondary')}
                    style={{ flex: 1, padding: '20px 0', fontSize: '1.1rem' }}
                    onClick={() => setAnswer('true')}
                  >
                    ✓ True
                  </button>
                  <button
                    type="button"
                    className={cn('btn', answer === 'false' ? 'btn-primary' : 'btn-secondary')}
                    style={{ flex: 1, padding: '20px 0', fontSize: '1.1rem' }}
                    onClick={() => setAnswer('false')}
                  >
                    ✕ False
                  </button>
                </div>
              )}

              {/* ── Match Pairs ──────────────────────────────────────────── */}
              {questionType === 'match' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {pairs.map((p, idx) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: 10,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <span className="font-mono text-xs text-tertiary">Pair {idx + 1}</span>
                      <input
                        type="text"
                        value={p.left}
                        onChange={(e) =>
                          setPairs(pairs.map((pair) => (pair.id === p.id ? { ...pair, left: e.target.value } : pair)))
                        }
                        placeholder="Left item / term..."
                        className="btn btn-secondary"
                        style={{ flex: 1, textAlign: 'left', background: 'var(--color-bg-secondary)' }}
                      />
                      <span className="text-tertiary">↔</span>
                      <input
                        type="text"
                        value={p.right}
                        onChange={(e) =>
                          setPairs(pairs.map((pair) => (pair.id === p.id ? { ...pair, right: e.target.value } : pair)))
                        }
                        placeholder="Right item / definition..."
                        className="btn btn-secondary"
                        style={{ flex: 1, textAlign: 'left', background: 'var(--color-bg-secondary)' }}
                      />
                      {pairs.length > 2 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm text-danger"
                          onClick={() => setPairs(pairs.filter((pair) => pair.id !== p.id))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    onClick={() => setPairs([...pairs, { id: `p-${Date.now()}`, left: '', right: '' }])}
                  >
                    + Add Pair
                  </button>
                </div>
              )}

              {/* ── Ordering / Sequence ─────────────────────────────────── */}
              {questionType === 'order' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  <p className="text-xs text-tertiary">Enter items in their <strong>correct order</strong>. The system will shuffle them for students.</p>
                  {orderItems.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="font-mono text-xs text-accent font-bold" style={{ width: 24 }}>
                        {idx + 1}.
                      </span>
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOrderItems(orderItems.map((it, i) => (i === idx ? val : it)));
                        }}
                        placeholder={`Step ${idx + 1}...`}
                        className="btn btn-secondary"
                        style={{ flex: 1, textAlign: 'left', background: 'var(--color-bg-tertiary)' }}
                      />
                      {orderItems.length > 2 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm text-danger"
                          onClick={() => setOrderItems(orderItems.filter((_, i) => i !== idx))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    onClick={() => setOrderItems([...orderItems, ''])}
                  >
                    + Add Step
                  </button>
                </div>
              )}

              {/* ── Code Snippet ────────────────────────────────────────── */}
              {questionType === 'code' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label className="text-xs text-secondary font-medium">Language:</label>
                    <CustomSelect
                      value={codeLanguage}
                      onChange={(val) => setCodeLanguage(val)}
                      options={[
                        { value: 'javascript', label: 'JavaScript' },
                        { value: 'typescript', label: 'TypeScript' },
                        { value: 'python', label: 'Python' },
                        { value: 'rust', label: 'Rust' },
                        { value: 'html', label: 'HTML' },
                        { value: 'css', label: 'CSS' },
                        { value: 'sql', label: 'SQL' },
                        { value: 'cpp', label: 'C++' },
                        { value: 'java', label: 'Java' },
                      ]}
                      aria-label="Select Code Language"
                    />
                  </div>
                  <textarea
                    className={styles.textarea}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Enter correct solution code string..."
                    rows={6}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                    autoFocus
                  />
                </div>
              )}

              {/* ── Text Selection / Fill Blank / Typing / Voice ───────── */}
              {(questionType === 'fill' || questionType === 'typing' || questionType === 'voice') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                  {questionType === 'fill' && (
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        background: 'oklch(0.97 0.02 160 / 0.06)',
                        border: '1px solid var(--color-accent-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <span className="text-xs text-accent font-bold">💡 How to create Text Selection / Blank Spots:</span>
                      <ul className="text-xs text-secondary" style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <li>
                          <strong>Method 1 (Inline `{"{{...}}"}`):</strong> Put answers inside <code>{"{{answer}}"}</code> in your question text (e.g. <code>Photosynthesis produces {"{{oxygen}}"}</code>).
                        </li>
                        <li>
                          <strong>Method 2 (Comma / Pipe Separated):</strong> Enter expected answer(s) below (e.g. <code>oxygen, O2</code> for synonyms).
                        </li>
                      </ul>
                    </div>
                  )}

                  {questionType === 'typing' && (
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        background: 'oklch(0.97 0.02 160 / 0.06)',
                        border: '1px solid var(--color-accent-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <span className="text-xs text-accent font-bold">💡 How Free Text Answer Matching Works:</span>
                      <ul className="text-xs text-secondary" style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <li>
                          <strong>Case & Trim Insensitive:</strong> Letter casing and extra spaces are automatically ignored (e.g. <code>paris</code> matches <code>PARIS</code>).
                        </li>
                        <li>
                          <strong>Fuzzy & Synonyms:</strong> Enter multiple accepted answers separated by commas (e.g. <code>Paris, Paris France</code>).
                        </li>
                      </ul>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="text-xs text-secondary font-medium">Expected Main Answer:</label>
                    <textarea
                      className={styles.textarea}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="e.g. Oxygen"
                      rows={3}
                      autoFocus
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="text-xs text-secondary font-medium">Alternate Accepted Answers / Aliases (Optional, comma-separated):</label>
                    <input
                      type="text"
                      className={styles.textarea}
                      style={{ height: '42px', minHeight: '42px' }}
                      value={aliasesInput}
                      onChange={(e) => setAliasesInput(e.target.value)}
                      placeholder="e.g. O2, Oxygen Gas, Pure Oxygen"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Explanation & Aliases */}
          {currentStep === 3 && (
            <div className={styles.stepBody}>
              <h2 className="text-card-title">Add Explanation & Alternate Answers</h2>
              <p className="text-secondary text-sm">Provide explanation context and optional alternate answers</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="text-xs text-secondary font-medium">Explanation (Optional)</label>
                <textarea
                  className={styles.textarea}
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder="e.g. Mitochondria are organelles that generate ATP through cellular respiration..."
                  rows={4}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                <label className="text-xs text-secondary font-medium">Alternate Accepted Answers / Aliases (Optional, comma-separated):</label>
                <input
                  type="text"
                  className={styles.textarea}
                  style={{ height: '42px', minHeight: '42px' }}
                  value={aliasesInput}
                  onChange={(e) => setAliasesInput(e.target.value)}
                  placeholder="e.g. O2, Oxygen Gas, Pure Oxygen"
                />
                {aliasesInput.trim() && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {aliasesInput.split(',').map((s) => s.trim()).filter(Boolean).map((alias) => (
                      <span key={alias} className="badge badge-neutral" style={{ fontSize: '0.75rem', color: 'var(--color-accent)' }}>
                        ✓ Alias: {alias}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 5: Preview */}
          {currentStep === 4 && (
            <div className={styles.stepBody}>
              <h2 className="text-card-title">Preview</h2>
              <p className="text-secondary text-sm">Review your question before saving</p>
              <div className={styles.previewCard}>
                <div className={styles.previewHeader}>
                  <span className="badge badge-accent">{questionType}</span>
                  <span className="badge badge-neutral">{difficulty}</span>
                  {questionType === 'code' && <span className="badge badge-neutral">{codeLanguage}</span>}
                </div>

                <div className={styles.previewQuestion}>
                  <span className="eyebrow">Question Content</span>
                  <p className="text-body" style={{ whiteSpace: 'pre-wrap' }}>{questionContent || 'No question content written'}</p>
                </div>

                <div className={styles.previewAnswer}>
                  <span className="eyebrow">Configured Answer / Structure</span>
                  {(questionType === 'mcq' || questionType === 'multi' || questionType === 'image-select') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      {options.filter((o) => o.content.trim()).map((o, i) => (
                        <div
                          key={o.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            background: o.is_correct ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
                            border: `1px solid ${o.is_correct ? 'var(--color-accent-border)' : 'var(--color-border)'}`,
                          }}
                        >
                          {o.is_correct ? (
                            <CheckCircle2 size={16} className="text-accent" style={{ flexShrink: 0 }} />
                          ) : (
                            <Circle size={16} className="text-tertiary" style={{ flexShrink: 0 }} />
                          )}
                          <span className={cn('text-sm', o.is_correct ? 'font-semibold text-accent' : 'text-secondary')}>
                            Option {i + 1}: {o.content}
                          </span>
                          {o.is_correct && (
                            <span className="badge badge-accent btn-sm" style={{ marginLeft: 'auto', fontSize: '0.65rem' }}>
                              Correct Answer
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {questionType === 'match' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {pairs.filter((p) => p.left.trim() && p.right.trim()).map((p, i) => (
                        <div
                          key={p.id}
                          className="text-sm text-secondary"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <span><strong className="text-primary">Pair {i + 1}: </strong>{p.left}</span>
                          <span className="text-accent font-bold">↔</span>
                          <span>{p.right}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {questionType === 'order' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {orderItems.filter((it) => it.trim()).map((it, i) => (
                        <div
                          key={i}
                          className="text-sm text-secondary"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <span className="badge badge-accent font-bold" style={{ width: 24, justifyContent: 'center' }}>
                            {i + 1}
                          </span>
                          <span>{it}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {questionType === 'tf' && (
                    <div style={{ marginTop: 6 }}>
                      <span className="badge badge-accent" style={{ fontSize: '0.9rem', padding: '6px 16px' }}>
                        Answer: {answer === 'true' ? '✓ True' : '✕ False'}
                      </span>
                    </div>
                  )}

                  {questionType === 'code' && (
                    <pre
                      style={{
                        marginTop: 6,
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                        color: 'var(--color-text-primary)',
                        overflowX: 'auto',
                      }}
                    >
                      {answer || '// Solution code here'}
                    </pre>
                  )}

                  {(questionType === 'fill' || questionType === 'typing' || questionType === 'voice') && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-accent)',
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {answer || 'No answer text provided'}
                    </div>
                  )}
                </div>

                {explanation && (
                  <div className={styles.previewExplanation}>
                    <span className="eyebrow">Explanation</span>
                    <p className="text-sm text-secondary">{explanation}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 6: Save */}
          {currentStep === 5 && (
            <div className={styles.stepBody}>
              <h2 className="text-card-title">Ready to Save Question</h2>
              <p className="text-secondary text-sm">Review final details before committing to deck</p>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  padding: 20,
                  borderRadius: 'var(--radius-xl)',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-strong)',
                  boxShadow: 'var(--shadow-sm), inset 0 1px 0 0 oklch(1 0 0 / 0.05)',
                  marginTop: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-accent" style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      📚 {activeDeck?.name ?? 'Selected Deck'}
                    </span>
                    <span className="badge badge-neutral" style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      Format: {questionType.toUpperCase()}
                    </span>
                  </div>
                  <span className="badge badge-neutral" style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontWeight: 600, textTransform: 'capitalize' }}>
                    Difficulty: {difficulty}
                  </span>
                </div>

                <div style={{ padding: 16, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
                  <span className="eyebrow" style={{ display: 'block', marginBottom: 6, fontSize: 'var(--text-xs)', letterSpacing: '0.08em' }}>Question Snippet</span>
                  <p className="text-base text-primary" style={{ whiteSpace: 'pre-wrap', margin: 0, fontWeight: 600 }}>
                    {questionContent || '(No question content)'}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'oklch(0.97 0.02 160 / 0.06)', border: '1px solid var(--color-accent-border)' }}>
                  <CheckCircle2 size={20} className="text-accent" style={{ flexShrink: 0 }} />
                  <span className="text-sm text-accent font-medium">
                    Question is validated and will be appended directly to the end of <strong>{activeDeck?.name ?? 'selected deck'}</strong> in the correct schema format.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Navigation ─────────────────────────────────────────────── */}
        <div className={styles.nav}>
          {currentStep > 0 ? (
            <button className="btn btn-secondary" onClick={prevStep} style={{ height: '2.375rem', fontSize: 'var(--text-sm)' }}>
              <ChevronLeft size={16} strokeWidth={1.75} /> Back
            </button>
          ) : <div />}
          <div className={styles.navRight} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-secondary" onClick={() => router.push('/manage')} style={{ height: '2.375rem', fontSize: 'var(--text-sm)' }}>
              Cancel
            </button>
            {currentStep < STEPS.length - 1 ? (
              <button
                className="btn btn-primary"
                onClick={nextStep}
                disabled={!canProceed()}
                style={{ height: '2.375rem', fontSize: 'var(--text-sm)', padding: '0 20px' }}
              >
                Next <ChevronRight size={16} strokeWidth={1.75} />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
                style={{ height: '2.375rem', fontSize: 'var(--text-sm)', padding: '0 20px' }}
              >
                <Save size={16} strokeWidth={1.75} />
                {saving ? 'Saving…' : editingQuestion ? 'Save Changes' : 'Save Question'}
              </button>
            )}
          </div>
        </div>
      </main>
    </PageTransition>
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="p-8 text-secondary">Loading…</div>}>
      <CreatePageContent />
    </Suspense>
  );
}