/**
 * @file components/questions/QuestionRenderer.tsx
 * @description Dispatcher that renders the correct question type component.
 *
 * This is a thin router component. It reads question.type and renders the
 * appropriate question-type-specific component. All 10 question types are
 * implemented here, with each type getting its own section.
 *
 * For small types (TrueFalse, MCQ), the component is defined inline in this
 * file to reduce the number of files. For complex types (Voice, Code), they
 * are separate files imported here.
 *
 * QUESTION TYPES IMPLEMENTED:
 *   1. tf          — True/False binary choice
 *   2. mcq         — Multiple choice (single correct)
 *   3. multi       — Multiple select (multiple correct)
 *   4. typing      — Free text input with fuzzy matching
 *   5. voice       — Speech-to-text (falls back to typing if unsupported)
 *   6. image-select — Image grid selection
 *   7. match        — Drag-and-match pairs
 *   8. fill         — Fill in the blank
 *   9. order        — Ordering/sequencing
 *   10. code        — Code completion/correction
 */

'use client';

import React, { useState, useCallback, useRef } from 'react';
import type { Question, QuestionOption } from '@/types/question';
import { RotateCcw, X, Check, Type, ArrowRight, Square, CheckSquare, ChevronUp, ChevronDown, GripVertical, Terminal, Play, Mic } from 'lucide-react';
import { useVoice } from '@/hooks/useVoice';
import { useSettingsStore } from '@/stores/settingsStore';
import { sanitizeHtml, renderMarkdownToHtml } from '@/utils/sanitize';
import { cn } from '@/utils/cn';
import styles from './QuestionRenderer.module.css';

// =============================================================================
// Props
// =============================================================================

interface QuestionRendererProps {
  question: Question;
  isActive: boolean;
  onAnswer: (answer: string | string[]) => Promise<void>;
}

// =============================================================================
// Question Content Renderer (shared by all types)
// =============================================================================

/**
 * QuestionContent — renders the question text as sanitized HTML & Markdown.
 */
function QuestionContent({ content }: { content: string }) {
  return (
    <div
      className={styles.questionContent}
      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(content) }}
    />
  );
}

// =============================================================================
// 1. True/False Question
// =============================================================================

function TrueFalseQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string) => Promise<void>;
  isActive: boolean;
}) {
  const [answered, setAnswered] = useState<string | null>(null);

  const handleSelect = async (value: 'true' | 'false') => {
    if (!isActive || answered !== null) return;
    setAnswered(value);
    await onAnswer(value);
  };

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />
      <div className={styles.tfOptions}>
        <button
          id="tf-true"
          type="button"
          className={cn(
            styles.tfBtn,
            styles.tfBtnTrue,
            answered === 'true' && styles.selected,
          )}
          onClick={() => handleSelect('true')}
          disabled={!isActive || answered !== null}
          aria-pressed={answered === 'true'}
        >
          <div className={styles.tfIconBadge}>
            <Check size={16} strokeWidth={2.5} />
          </div>
          <span className={styles.tfLabel}>True</span>
        </button>
        <button
          id="tf-false"
          type="button"
          className={cn(
            styles.tfBtn,
            styles.tfBtnFalse,
            answered === 'false' && styles.selected,
          )}
          onClick={() => handleSelect('false')}
          disabled={!isActive || answered !== null}
          aria-pressed={answered === 'false'}
        >
          <div className={styles.tfIconBadge}>
            <X size={16} strokeWidth={2.5} />
          </div>
          <span className={styles.tfLabel}>False</span>
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// 2. MCQ Question (single correct)
// =============================================================================

function MCQQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string) => Promise<void>;
  isActive: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { shuffle_options } = useSettingsStore();

  const options = React.useMemo(() => {
    const opts = question.options ?? [];
    return [...opts].sort(() => Math.random() - 0.5);
  }, [question.id]);

  const handleSelect = async (option: QuestionOption) => {
    if (!isActive || selected !== null) return;
    setSelected(option.id);
    await onAnswer(option.id);
  };

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />
      <div className={styles.optionGrid} role="radiogroup" aria-label="Answer options">
        {options.map((option, i) => (
          <button
            key={option.id}
            id={`mcq-option-${i}`}
            role="radio"
            aria-checked={selected === option.id}
            className={cn(
              styles.optionBtn,
              selected === option.id && styles.optionSelected,
            )}
            onClick={() => handleSelect(option)}
            disabled={!isActive || selected !== null}
          >
            <span className={styles.optionLetter}>
              {String.fromCharCode(65 + i)}
            </span>
            <span className={styles.optionText}>{option.content}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// 3. Multi-Select Question
// =============================================================================

function MultiQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string[]) => Promise<void>;
  isActive: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const options = React.useMemo(() => {
    const opts = question.options ?? [];
    return [...opts].sort(() => Math.random() - 0.5);
  }, [question.id]);
  const hasSubtextInContent = /select all that apply/i.test(question.content);

  const toggleOption = (id: string) => {
    if (!isActive || submitted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!isActive || submitted || selected.size === 0) return;
    setSubmitted(true);
    await onAnswer(Array.from(selected));
  };

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />
      {!hasSubtextInContent && (
        <div className={styles.multiInstructionRow}>
          <span className="text-xs text-secondary">
            {selected.size > 0 ? `${selected.size} selected` : 'Select all that apply'}
          </span>
        </div>
      )}
      <div className={styles.optionGrid} role="group" aria-label="Answer options">
        {options.map((option, i) => {
          const isChecked = selected.has(option.id);

          return (
            <button
              key={option.id}
              id={`multi-option-${i}`}
              role="checkbox"
              aria-checked={isChecked}
              className={cn(
                styles.optionBtn,
                isChecked && styles.optionSelected
              )}
              onClick={() => toggleOption(option.id)}
              disabled={!isActive || submitted}
            >
              <span className={cn(styles.soothingCheckCircle, isChecked && styles.soothingCheckCircleActive)}>
                {isChecked && <Check size={13} strokeWidth={2.5} />}
              </span>
              <span className={styles.optionText}>{option.content}</span>
            </button>
          );
        })}
      </div>
      <button
        id="multi-submit"
        className={cn('btn', 'btn-primary', styles.submitBtn)}
        onClick={handleSubmit}
        disabled={!isActive || submitted || selected.size === 0}
      >
        {submitted
          ? 'Submitted'
          : selected.size > 0
          ? `Submit Answer (${selected.size} selected)`
          : 'Submit Answer'}
      </button>
    </div>
  );
}

// =============================================================================
// 4. Typing Question
// =============================================================================

function TypingQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string) => Promise<void>;
  isActive: boolean;
}) {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isActive && !submitted && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive, submitted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive || submitted || !value.trim()) return;
    setSubmitted(true);
    await onAnswer(value.trim());
  };

  const handleClear = () => {
    if (submitted) return;
    setValue('');
    inputRef.current?.focus();
  };

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />
      <form onSubmit={handleSubmit} className={styles.typingForm}>
        <div className={styles.typingInputWrapper}>
          <input
            ref={inputRef}
            id="typing-input"
            type="text"
            className={styles.typingInputContainer}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type your answer here..."
            disabled={!isActive || submitted}
            autoComplete="off"
            spellCheck={false}
            aria-label="Your answer"
          />
          {value && !submitted && (
            <button
              type="button"
              className={styles.typingClearBtn}
              onClick={handleClear}
              title="Clear text"
              aria-label="Clear input"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          id="typing-submit"
          type="submit"
          className={cn('btn', 'btn-primary', styles.typingSubmitBtn)}
          disabled={!isActive || submitted || !value.trim()}
        >
          {submitted ? 'Submitted' : 'Submit'} <ArrowRight size={16} />
        </button>
      </form>
    </div>
  );
}

// =============================================================================
// 5. Voice Question
// =============================================================================

function VoiceQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string) => Promise<void>;
  isActive: boolean;
}) {
  const { voice_language } = useSettingsStore();
  const { state, transcript, finalTranscript, start, stop, reset, isSupported } = useVoice(voice_language);
  const [inputText, setInputText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Synchronize transcript from voice hook
  React.useEffect(() => {
    const liveText = finalTranscript || transcript;
    if (liveText) {
      setInputText(liveText);
    }
  }, [transcript, finalTranscript]);

  const handleMicClick = () => {
    if (submitted) return;

    if (!isSupported) {
      if (state === 'listening') {
        stop();
      } else {
        start();
      }
      return;
    }

    if (state === 'listening') {
      stop();
    } else {
      reset();
      start();
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isActive || submitted || !inputText.trim()) return;
    setSubmitted(true);
    await onAnswer(inputText.trim());
  };

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />

      <div className={styles.voiceContainer}>
        {/* Voice Microphone Button */}
        <button
          id="voice-mic"
          type="button"
          className={cn(
            styles.micPulseBtn,
            state === 'listening' && styles.micPulseActive
          )}
          onClick={handleMicClick}
          disabled={!isActive || submitted}
          aria-label="Toggle voice recording"
        >
          <div className={styles.micIconWrapper}>
            <Mic size={32} strokeWidth={2} />
          </div>
        </button>

        <p className={styles.voiceStatusText}>
          {state === 'listening'
            ? 'Listening to your voice… tap mic to stop'
            : !isSupported
            ? 'Speech Recognition API disabled in Firefox — tap mic or speak below:'
            : 'Tap microphone to start speaking'}
        </p>

        {/* Live Transcript / Response Input */}
        <form onSubmit={handleSubmit} className={styles.voiceTranscriptForm}>
          <div className={styles.voiceTranscriptWrapper}>
            <input
              id="voice-transcript-input"
              type="text"
              className={styles.voiceTranscriptInput}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Your spoken answer will appear here..."
              disabled={!isActive || submitted}
              autoComplete="off"
            />
            {inputText && !submitted && (
              <button
                type="button"
                className={styles.typingClearBtn}
                onClick={() => setInputText('')}
                title="Clear text"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            id="voice-submit"
            type="submit"
            className={cn('btn', 'btn-primary', styles.typingSubmitBtn)}
            disabled={!isActive || submitted || !inputText.trim()}
          >
            <span>{submitted ? 'Submitted' : 'Submit'}</span>
            <ArrowRight size={16} strokeWidth={2.5} />
          </button>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// 6. Image Select Question
// =============================================================================

function ImageSelectQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string) => Promise<void>;
  isActive: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const options = React.useMemo(() => {
    const opts = question.options ?? [];
    return [...opts].sort(() => Math.random() - 0.5);
  }, [question.id]);

  const handleSelect = async (option: QuestionOption) => {
    if (!isActive || selected !== null) return;
    setSelected(option.id);
    await onAnswer(option.id);
  };

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />
      <div className={styles.imageGrid} role="radiogroup">
        {options.map((option, i) => (
          <button
            key={option.id}
            id={`img-option-${i}`}
            role="radio"
            aria-checked={selected === option.id}
            className={cn(styles.imageOption, selected === option.id && styles.optionSelected)}
            onClick={() => handleSelect(option)}
            disabled={!isActive || selected !== null}
            aria-label={option.content || `Option ${i + 1}`}
          >
            {option.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={option.image_url} alt={option.content || `Option ${i + 1}`} className={styles.optionImage} />
            )}
            {option.content && <span className={styles.imageCaption}>{option.content}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// 7. Match Pairs Question
// =============================================================================

function MatchQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string[]) => Promise<void>;
  isActive: boolean;
}) {
  const pairs = (question.pairs && question.pairs.length > 0)
    ? question.pairs
    : (typeof question.answer === 'string' && question.answer
        ? question.answer.split(',').map((pairStr, idx) => {
            const [left, right] = pairStr.split(':');
            return { id: `p-${idx + 1}`, left: left || `Item ${idx + 1}`, right: right || '' };
          })
        : []);
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [matches, setMatches] = useState<Record<string, string>>({}); // leftId -> rightId
  const [submitted, setSubmitted] = useState(false);

  const leftItems = React.useMemo(
    () => [...pairs].sort(() => Math.random() - 0.5),
    [question.id]
  );

  const rightItems = React.useMemo(
    () => [...pairs].sort(() => Math.random() - 0.5),
    [question.id]
  );

  const leftLabelMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    leftItems.forEach((p, idx) => {
      map[p.id] = String.fromCharCode(65 + idx);
    });
    return map;
  }, [leftItems]);

  const handleLeftClick = (leftId: string) => {
    if (!isActive || submitted) return;

    // If already matched, UN-MATCH / UNDO this selection!
    if (matches[leftId]) {
      setMatches((prev) => {
        const copy = { ...prev };
        delete copy[leftId];
        return copy;
      });
      if (selectedLeft === leftId) setSelectedLeft(null);
      return;
    }

    setSelectedLeft((prev) => (prev === leftId ? null : leftId));
  };

  const handleRightClick = (rightId: string) => {
    if (!isActive || submitted) return;

    const matchedLeftId = Object.keys(matches).find((lId) => matches[lId] === rightId);

    // If already matched, UN-MATCH / UNDO this selection!
    if (matchedLeftId) {
      setMatches((prev) => {
        const copy = { ...prev };
        delete copy[matchedLeftId];
        return copy;
      });
      return;
    }

    // If left item is selected, create match!
    if (selectedLeft) {
      setMatches((prev) => ({ ...prev, [selectedLeft]: rightId }));
      setSelectedLeft(null);
    }
  };

  const handleReset = () => {
    if (submitted) return;
    setMatches({});
    setSelectedLeft(null);
  };

  const handleSubmit = async () => {
    if (!isActive || submitted) return;
    setSubmitted(true);
    const answerPairs = Object.entries(matches).map(([l, r]) => `${l}:${r}`);
    await onAnswer(answerPairs);
  };

  const matchedCount = Object.keys(matches).length;
  const isComplete = matchedCount === pairs.length;

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />

      <div className={styles.matchHeaderRow}>
        <span className={styles.matchInstruction}>
          {selectedLeft
            ? `Select matching right option for (${leftLabelMap[selectedLeft]})`
            : matchedCount > 0
            ? `${matchedCount} of ${pairs.length} pairs matched (click matched pair to undo)`
            : 'Tap left item, then tap right item to pair them'}
        </span>
        {matchedCount > 0 && !submitted && (
          <button className={styles.resetMatchesBtn} onClick={handleReset} type="button">
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      <div className={styles.matchContainer}>
        {/* Left Column */}
        <div className={styles.matchColumn}>
          {leftItems.map((pair) => {
            const isSelected = selectedLeft === pair.id;
            const matchedRightId = matches[pair.id];
            const label = leftLabelMap[pair.id];
            const isCorrectMatch = matchedRightId ? matchedRightId === pair.id : null;

            return (
              <button
                key={pair.id}
                id={`match-left-${pair.id}`}
                type="button"
                className={cn(
                  styles.matchItem,
                  isSelected && styles.matchSelected,
                  matchedRightId && (isCorrectMatch ? styles.matchMatchedCorrect : styles.matchMatchedWrong)
                )}
                onClick={() => handleLeftClick(pair.id)}
                disabled={submitted}
                title={matchedRightId ? 'Click to un-match' : undefined}
              >
                <span className={styles.matchIndexBadge}>{label}</span>
                <span className={styles.matchText}>{pair.left}</span>
                {matchedRightId && (
                  <span className={cn(styles.matchedTag, isCorrectMatch ? styles.matchedTagCorrect : styles.matchedTagWrong)}>
                    {isCorrectMatch ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Column */}
        <div className={styles.matchColumn}>
          {rightItems.map((pair) => {
            const matchedLeftId = Object.keys(matches).find((lId) => matches[lId] === pair.id);
            const matchedLabel = matchedLeftId ? leftLabelMap[matchedLeftId] : null;
            const isCorrectMatch = matchedLeftId ? matchedLeftId === pair.id : null;

            return (
              <button
                key={pair.id}
                id={`match-right-${pair.id}`}
                type="button"
                className={cn(
                  styles.matchItem,
                  matchedLeftId && (isCorrectMatch ? styles.matchMatchedCorrect : styles.matchMatchedWrong),
                  selectedLeft && !matchedLeftId && styles.matchTargetable
                )}
                onClick={() => handleRightClick(pair.id)}
                disabled={submitted || (!selectedLeft && !matchedLeftId)}
                title={matchedLeftId ? 'Click to un-match' : undefined}
              >
                {matchedLabel ? (
                  <span className={styles.matchIndexBadgeActive}>{matchedLabel}</span>
                ) : (
                  <span className={styles.matchRightBadge}>•</span>
                )}
                <span className={styles.matchText}>{pair.right}</span>
                {matchedLeftId && (
                  <span className={cn(styles.matchedTag, isCorrectMatch ? styles.matchedTagCorrect : styles.matchedTagWrong)}>
                    {isCorrectMatch ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.matchFooter}>
        <button
          id="match-submit"
          type="button"
          className={cn('btn', 'btn-primary', styles.submitBtn)}
          onClick={handleSubmit}
          disabled={submitted || !isComplete}
        >
          {submitted ? 'Matches Submitted' : `Submit Matches (${matchedCount}/${pairs.length})`}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// 8. Fill in the Blank Question
// =============================================================================

function FillQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string[]) => Promise<void>;
  isActive: boolean;
}) {
  const inlineMatches = Array.from(question.content.matchAll(/\{\{(.*?)\}\}/g));
  const rawAnswers = Array.isArray(question.answer)
    ? question.answer
    : typeof question.answer === 'string'
      ? question.answer.split(/[/|,\n]/).map((s) => s.trim()).filter(Boolean)
      : [];

  let blanks = question.blanks && question.blanks.length > 0 ? question.blanks : [];

  if (inlineMatches.length > 1 && inlineMatches.length > blanks.length) {
    blanks = inlineMatches.map((m, idx) => {
      const val = m[1].trim();
      const accs = val ? val.split(/[/|,]/).map((s) => s.trim()).filter(Boolean) : [];
      return {
        id: `blank-${idx + 1}`,
        accepted_answers: accs.length > 0 ? accs : [val || `Blank ${idx + 1}`],
      };
    });
  }

  if (blanks.length <= 1 && rawAnswers.length > 1) {
    blanks = rawAnswers.map((ans, idx) => ({ id: `blank-${idx + 1}`, accepted_answers: [ans] }));
  }

  if (blanks.length === 0) {
    blanks = [{ id: 'blank-1', accepted_answers: [''] }];
  }
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (blankId: string, value: string) => {
    setValues((prev) => ({ ...prev, [blankId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive || submitted) return;
    setSubmitted(true);
    const answers = blanks.map((b) => values[b.id] ?? '');
    await onAnswer(answers);
  };

  // Render content with blanks as input fields
  const renderContent = () => {
    let cleanText = question.content
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('accepted_answers:') && !t.startsWith('- id:') && !t.startsWith('id:');
      })
      .join('\n');

    let placeholderCount = 0;
    cleanText = cleanText.replace(/\{\{[^}]+\}\}/g, () => {
      const marker = `___FILL_BLANK_${placeholderCount}___`;
      placeholderCount++;
      return marker;
    });

    const parts = cleanText.split(/___FILL_BLANK_\d+___/);
    const count = parts.length - 1;

    if (count <= 0) {
      const blank = blanks[0] ?? { id: 'blank-1', accepted_answers: [] };
      const keyId = blank.id ?? 'blank-1';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(cleanText) }} />
          <div className={styles.typingInputWrapper}>
            <input
              id="fill-blank-single"
              type="text"
              className={styles.typingInputContainer}
              value={values[keyId] ?? ''}
              onChange={(e) => handleChange(keyId, e.target.value)}
              disabled={!isActive || submitted}
              placeholder="Type your answer here..."
              aria-label="Answer input"
              autoComplete="off"
            />
          </div>
        </div>
      );
    }

    return parts.map((part, i) => {
      const blank = blanks[i] ?? { id: String(i), accepted_answers: [] };
      const keyId = blank.id ?? String(i);
      return (
        <React.Fragment key={i}>
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(part) }} />
          {i < count && (
            <input
              id={`fill-blank-${i}`}
              type="text"
              className={styles.fillInput}
              value={values[keyId] ?? ''}
              onChange={(e) => handleChange(keyId, e.target.value)}
              disabled={!isActive || submitted}
              placeholder="____"
              aria-label={`Blank ${i + 1}`}
              style={{ width: `${Math.max(70, (blank.accepted_answers?.[0]?.length ?? 6) * 12)}px` }}
            />
          )}
        </React.Fragment>
      );
    });
  };

  const hasAnswers = blanks.every((b) => (values[b.id] ?? '').trim().length > 0);

  return (
    <form className={styles.questionBody} onSubmit={handleSubmit}>
      <div className={styles.fillContent}>
        {renderContent()}
      </div>
      <button
        id="fill-submit"
        type="submit"
        className={cn('btn', 'btn-primary', styles.submitBtn)}
        disabled={!isActive || submitted || !hasAnswers}
      >
        Submit
      </button>
    </form>
  );
}

// =============================================================================
// 9. Ordering Question
// =============================================================================

function OrderQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string[]) => Promise<void>;
  isActive: boolean;
}) {
  const rawItems = (question.order_items && question.order_items.length > 0)
    ? question.order_items
    : (Array.isArray(question.answer)
        ? question.answer
        : (typeof question.answer === 'string' && question.answer ? question.answer.split(',') : []));

  const items = React.useMemo(
    () => [...rawItems].sort(() => Math.random() - 0.5),
    [question.id, question.order_items, question.answer] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [order, setOrder] = useState<string[]>(items);
  const [submitted, setSubmitted] = useState(false);

  React.useEffect(() => {
    setOrder(items);
    setSubmitted(false);
  }, [items]);

  // Drag State (Grip Handle Reorder)
  const [activeDragIndex, setActiveDragIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<number>(0);
  const startYRef = useRef<number>(0);

  // DOM Refs for FLIP & Clamping
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevCleanTopsRef = useRef<Map<string, number>>(new Map());

  const hasSubtextInContent = /arrange|correct order/i.test(question.content);

  // Record clean untransformed positions BEFORE updating order state
  const recordCleanPositions = () => {
    const map = new Map<string, number>();
    itemRefs.current.forEach((el, itemKey) => {
      if (el) {
        const savedTransform = el.style.transform;
        el.style.transform = 'none';
        const cleanTop = el.getBoundingClientRect().top;
        el.style.transform = savedTransform;
        map.set(itemKey, cleanTop);
      }
    });
    prevCleanTopsRef.current = map;
  };

  // FLIP Layout Animation on order state changes (Arrow buttons & Drag release)
  React.useLayoutEffect(() => {
    const prevTops = prevCleanTopsRef.current;
    const currentMap = itemRefs.current;

    currentMap.forEach((el, itemKey) => {
      if (!el) return;
      const prevTop = prevTops.get(itemKey);
      if (prevTop !== undefined) {
        el.style.transform = 'none';
        const newTop = el.getBoundingClientRect().top;
        const deltaY = prevTop - newTop;

        if (deltaY !== 0) {
          el.style.transition = 'none';
          el.style.transform = `translate3d(0, ${deltaY}px, 0)`;

          requestAnimationFrame(() => {
            el.offsetHeight; // Force reflow
            el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
            el.style.transform = 'translate3d(0, 0, 0)';
          });
        }
      }
    });
  }, [order]);

  const moveUp = (index: number) => {
    if (index === 0 || submitted) return;
    recordCleanPositions();
    const next = [...order];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setOrder(next);
  };

  const moveDown = (index: number) => {
    if (index === order.length - 1 || submitted) return;
    recordCleanPositions();
    const next = [...order];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setOrder(next);
  };

  const handleGripPointerDown = (e: React.PointerEvent, index: number) => {
    if (submitted) return;
    e.stopPropagation();

    setActiveDragIndex(index);
    startYRef.current = e.clientY;
    setDragOffset(0);

    const target = e.currentTarget as HTMLElement;
    if (target.setPointerCapture) {
      try {
        target.setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
  };

  const handleGripPointerMove = (e: React.PointerEvent, index: number) => {
    if (activeDragIndex !== index || submitted) return;
    e.stopPropagation();

    const dy = e.clientY - startYRef.current;

    // Step height (58px height + gap)
    const listEl = listRef.current;
    const stepHeight = listEl && order.length > 0 ? listEl.offsetHeight / order.length : 58;

    // Strict boundary clamping so items NEVER get stuck or go out of bounds!
    const minDy = -index * stepHeight;
    const maxDy = (order.length - 1 - index) * stepHeight;
    const clampedDy = Math.max(minDy, Math.min(maxDy, dy));

    setDragOffset(clampedDy);
  };

  const handleGripPointerUp = (e: React.PointerEvent, index: number) => {
    if (activeDragIndex === null) return;
    e.stopPropagation();

    const listEl = listRef.current;
    const stepHeight = listEl && order.length > 0 ? listEl.offsetHeight / order.length : 58;
    const stepsMoved = Math.round(dragOffset / stepHeight);
    const targetIndex = Math.max(0, Math.min(order.length - 1, index + stepsMoved));

    // Record clean untransformed positions BEFORE setOrder
    recordCleanPositions();

    if (targetIndex !== index) {
      const next = [...order];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      setOrder(next);
    }

    setActiveDragIndex(null);
    setDragOffset(0);

    const target = e.currentTarget as HTMLElement;
    if (target.releasePointerCapture) {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
  };

  const handleSubmit = async () => {
    if (!isActive || submitted) return;
    setSubmitted(true);
    await onAnswer(order);
  };

  // Live hover target index during drag for smooth CSS slot displacement
  const listEl = listRef.current;
  const stepHeight = listEl && order.length > 0 ? listEl.offsetHeight / order.length : 58;
  const hoverTargetIndex = activeDragIndex !== null
    ? Math.max(0, Math.min(order.length - 1, activeDragIndex + Math.round(dragOffset / stepHeight)))
    : null;

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />
      {!hasSubtextInContent && (
        <div className={styles.orderInstructionRow}>
          <span className="text-xs text-secondary">
            Drag grip handles or use arrows to arrange steps
          </span>
        </div>
      )}
      <div className={styles.orderList} ref={listRef}>
        {order.map((item, i) => {
          const isDragging = activeDragIndex === i;

          // Calculate visual displacement for non-dragged items to open slot!
          let translateY = 0;
          if (activeDragIndex !== null && hoverTargetIndex !== null && !isDragging) {
            if (activeDragIndex < hoverTargetIndex && i > activeDragIndex && i <= hoverTargetIndex) {
              translateY = -stepHeight; // Shift up
            } else if (activeDragIndex > hoverTargetIndex && i >= hoverTargetIndex && i < activeDragIndex) {
              translateY = stepHeight; // Shift down
            }
          }

          return (
            <div
              key={item}
              ref={(el) => {
                if (el) itemRefs.current.set(item, el);
                else itemRefs.current.delete(item);
              }}
              className={cn(
                styles.orderItem,
                isDragging && styles.orderItemDraggingActive
              )}
              style={
                isDragging
                  ? {
                      transform: `translate3d(0, ${dragOffset}px, 0)`,
                      zIndex: 100,
                      boxShadow: '0 16px 36px -4px rgba(16, 185, 129, 0.22)',
                      borderColor: 'var(--color-accent)',
                      background: 'var(--color-bg-elevated)',
                      transition: 'none',
                      cursor: 'grabbing',
                    }
                  : {
                      transform: translateY ? `translate3d(0, ${translateY}px, 0)` : undefined,
                      transition: 'transform 0.22s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s, border-color 0.2s',
                    }
              }
            >
              <div
                className={styles.orderGripWrapper}
                onPointerDown={(e) => handleGripPointerDown(e, i)}
                onPointerMove={(e) => handleGripPointerMove(e, i)}
                onPointerUp={(e) => handleGripPointerUp(e, i)}
                onPointerCancel={(e) => handleGripPointerUp(e, i)}
                title="Drag grip to reorder"
              >
                <GripVertical size={18} className={styles.orderGripIconActive} />
              </div>
              <span className={styles.soothingOrderBadge}>{i + 1}</span>
              <span className={styles.orderText}>{item}</span>
              <div
                className={styles.orderControls}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  id={`order-up-${i}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveUp(i);
                  }}
                  disabled={submitted || i === 0}
                  aria-label="Move up"
                  className={styles.orderMoveBtn}
                  title="Move up"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  id={`order-down-${i}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveDown(i);
                  }}
                  disabled={submitted || i === order.length - 1}
                  aria-label="Move down"
                  className={styles.orderMoveBtn}
                  title="Move down"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button
        id="order-submit"
        type="button"
        className={cn('btn', 'btn-primary', styles.submitBtn)}
        onClick={handleSubmit}
        disabled={!isActive || submitted}
      >
        {submitted ? 'Submitted' : 'Submit Order'} <ArrowRight size={16} />
      </button>
    </div>
  );
}

// =============================================================================
// 10. Code Question
// =============================================================================

function CodeQuestion({ question, onAnswer, isActive }: {
  question: Question;
  onAnswer: (a: string) => Promise<void>;
  isActive: boolean;
}) {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive || submitted || !value.trim()) return;
    setSubmitted(true);
    await onAnswer(value.trim());
  };

  const lang = (question.code_language ?? 'python').toLowerCase();

  return (
    <div className={styles.questionBody}>
      <QuestionContent content={question.content} />
      <form onSubmit={handleSubmit} className={styles.codeForm}>
        <div className={styles.codeWindow}>
          <div className={styles.codeWindowHeader}>
            <div className={styles.codeDots}>
              <span className={styles.dotRed} />
              <span className={styles.dotYellow} />
              <span className={styles.dotGreen} />
            </div>
            <div className={styles.codeLangBadge}>
              <Terminal size={14} />
              <span>{lang.toUpperCase()}</span>
            </div>
            {value && !submitted ? (
              <button
                type="button"
                className={styles.codeClearBtn}
                onClick={() => setValue('')}
                title="Clear code"
              >
                <X size={13} />
              </button>
            ) : (
              <div style={{ width: 22 }} />
            )}
          </div>
          <textarea
            id="code-input"
            className={cn(styles.codeEditor, 'font-mono')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`# Write your ${lang} code here...`}
            disabled={!isActive || submitted}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Code answer"
            rows={7}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                const start = e.currentTarget.selectionStart;
                const end = e.currentTarget.selectionEnd;
                setValue(value.slice(0, start) + '  ' + value.slice(end));
              }
            }}
          />
        </div>
        <button
          id="code-submit"
          type="submit"
          className={cn('btn', 'btn-primary', styles.codeSubmitBtn)}
          disabled={!isActive || submitted || !value.trim()}
        >
          <Play size={15} fill="currentColor" />
          <span>{submitted ? 'Submitted' : 'Run & Submit'}</span>
        </button>
      </form>
    </div>
  );
}

// =============================================================================
// Main Dispatcher
// =============================================================================

/**
 * QuestionRenderer — routes to the correct question type component.
 *
 * The switch statement is the single place where question types are mapped
 * to components. Adding a new type requires:
 *   1. Adding a case here
 *   2. Creating/defining the component
 *   3. Ensuring the type is in the QuestionType union (types/question.ts)
 */
export default function QuestionRenderer({ question, isActive, onAnswer }: QuestionRendererProps) {
  const handleAnswer = useCallback(async (answer: string | string[]) => {
    await onAnswer(answer);
  }, [onAnswer]);

  switch (question.type) {
    case 'tf':
      return <TrueFalseQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'mcq':
      return <MCQQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'multi':
      return <MultiQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'typing':
      return <TypingQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'voice':
      return <VoiceQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'image-select':
      return <ImageSelectQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'match':
      return <MatchQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'fill':
      return <FillQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'order':
      return <OrderQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    case 'code':
      return <CodeQuestion question={question} onAnswer={(a) => handleAnswer(a)} isActive={isActive} />;
    default:
      return (
        <div className={styles.questionBody}>
          <p className="text-secondary">Unknown question type: {(question as Question).type}</p>
        </div>
      );
  }
}
