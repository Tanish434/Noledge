# Noledge Question Format Specification v2.0 (JSON Format)

> **Single source of truth for the Noledge JSON question format.**
> Follow every rule here precisely. The parser enforces all of them.

> [!NOTE]
> **Markdown Support**: Both the **Question Area** (`"content"`) and **Explanation Area** (`"explanation"`) fully support Markdown formatting (code blocks, inline code, bold `**text**`, italic `*text*`, headings `#`, blockquotes `>`, lists `- item`, and line breaks).

---

## Table of Contents

1. [Core Concepts](#1-core-concepts)
2. [File Structure Rules](#2-file-structure-rules)
3. [Question Schema & Common Properties](#3-question-schema--common-properties)
4. [Question Types — Correct JSON Format](#4-question-types--correct-json-format)
5. [Things You MUST NEVER Do](#5-things-you-must-never-do)
6. [Parser Validation & Robustness Notes](#6-parser-validation--robustness-notes)
7. [Validation Checklist](#7-validation-checklist)

---

## 1. Core Concepts

### What is a Noledge JSON Question File?

A `.json` file that contains one or more question objects. It must be valid JSON:

- **Deck file**: A JSON array of question objects `[ { ... }, { ... } ]`
- **Single-question file**: A JSON object `{ ... }` or array `[ { ... } ]`

### Example JSON Deck File

```json
[
  {
    "id": "q_91a2b3c4",
    "type": "mcq",
    "difficulty": "easy",
    "tags": ["geography", "capitals"],
    "content": "What is the capital of France?",
    "answer": "opt-2",
    "options": [
      { "id": "opt-1", "content": "London", "is_correct": false },
      { "id": "opt-2", "content": "Paris", "is_correct": true },
      { "id": "opt-3", "content": "Berlin", "is_correct": false },
      { "id": "opt-4", "content": "Madrid", "is_correct": false }
    ],
    "explanation": "Paris is the capital of France."
  }
]
```

---

## 2. File Structure Rules

### Rule 2.1 — Must be valid JSON UTF-8
- Double quotes `"` for keys and string values.
- No trailing commas.
- Outer container: Array `[...]` for decks, or Object `{...}` for single questions.

### Rule 2.2 — Top-Level Properties Required
Every question object MUST contain:
- `"id"`: Unique string identifier (e.g. `"q_12345"` or UUID).
- `"type"`: One of 10 valid question types (see Section 3.1).
- `"content"`: The question text / prompt string.

---

## 3. Question Schema & Common Properties

### 3.1 `type` Property (Required)
Must be one of the following 10 valid values:
- `"tf"` — True / False
- `"mcq"` — Multiple choice (one correct option)
- `"multi"` — Multiple select (one or more correct options)
- `"typing"` — Keyboard text input
- `"voice"` — Voice speech input
- `"image-select"` — Image choice question
- `"match"` — Pair matching
- `"fill"` — Fill in the blank
- `"order"` — Arrange items in order
- `"code"` — Code solution question

### 3.2 `difficulty` Property (Optional)
Must be one of: `"easy"`, `"medium"`, or `"hard"`. Defaults to `"medium"`.

### 3.3 `tags` Property (Optional)
Array of strings: `["tag1", "tag2"]`. Defaults to `[]`.

### 3.4 `explanation` Property (Optional)
String explanation of the answer.

### 3.5 `code_language` Property (Required for `code` type)
Language string (e.g. `"python"`, `"javascript"`, `"java"`, `"cpp"`).

---

## 4. Question Types — Correct JSON Format

### 4.1 True/False (`tf`)

```json
{
  "id": "q_tf_1",
  "type": "tf",
  "difficulty": "easy",
  "tags": ["biology"],
  "content": "The mitochondria is the powerhouse of the cell.",
  "answer": "true",
  "explanation": "This is a well-known biological fact."
}
```

- `"answer"` must be `"true"` or `"false"` (string or boolean).

---

### 4.2 Multiple Choice (`mcq`)

```json
{
  "id": "q_mcq_1",
  "type": "mcq",
  "difficulty": "medium",
  "tags": ["geography"],
  "content": "What is the capital of France?",
  "answer": "opt-2",
  "options": [
    { "id": "opt-1", "content": "London", "is_correct": false },
    { "id": "opt-2", "content": "Paris", "is_correct": true },
    { "id": "opt-3", "content": "Berlin", "is_correct": false }
  ],
  "explanation": "Paris is the capital and largest city of France."
}
```

- `"options"` array: At least 2 options.
- Exactly ONE option has `"is_correct": true`.

---

### 4.3 Multi-Select (`multi`)

```json
{
  "id": "q_multi_1",
  "type": "multi",
  "difficulty": "medium",
  "tags": ["chemistry"],
  "content": "Which of the following are noble gases?",
  "answer": "opt-1,opt-3,opt-4",
  "options": [
    { "id": "opt-1", "content": "Helium", "is_correct": true },
    { "id": "opt-2", "content": "Nitrogen", "is_correct": false },
    { "id": "opt-3", "content": "Argon", "is_correct": true },
    { "id": "opt-4", "content": "Neon", "is_correct": true }
  ]
}
```

- `"options"` array: At least 2 options.
- One or more options have `"is_correct": true`.

---

### 4.4 Typing (`typing`) and Voice (`voice`)

```json
{
  "id": "q_typing_1",
  "type": "typing",
  "difficulty": "easy",
  "tags": ["chemistry"],
  "content": "What is the chemical symbol for Gold?",
  "answer": "Au",
  "aliases": ["gold", "au", "aurum"],
  "explanation": "Au comes from the Latin word for gold, aurum."
}
```

- `"answer"`: Primary correct answer string.
- `"aliases"`: Array of alternate accepted answer strings.

---

### 4.5 Match Pairs (`match`)

```json
{
  "id": "q_match_1",
  "type": "match",
  "difficulty": "hard",
  "tags": ["computer-science"],
  "content": "Match each programming language to its creator:",
  "answer": "Python:Guido van Rossum,Java:James Gosling,C:Dennis Ritchie",
  "pairs": [
    { "id": "p-1", "left": "Python", "right": "Guido van Rossum" },
    { "id": "p-2", "left": "Java", "right": "James Gosling" },
    { "id": "p-3", "left": "C", "right": "Dennis Ritchie" }
  ]
}
```

- `"pairs"` array: At least 1 pair object `{ "id": "...", "left": "...", "right": "..." }`.

---

### 4.6 Fill in the Blank (`fill`)

```json
{
  "id": "q_fill_1",
  "type": "fill",
  "difficulty": "medium",
  "tags": ["science"],
  "content": "Plants use {{blank-1}} to produce {{blank-2}}.",
  "answer": "photosynthesis,oxygen",
  "blanks": [
    { "id": "blank-1", "accepted_answers": ["photosynthesis", "photosynthesise"] },
    { "id": "blank-2", "accepted_answers": ["oxygen", "O2", "o2"] }
  ],
  "explanation": "Photosynthesis produces oxygen."
}
```

- `{{blank_id}}` in `"content"`.
- `"blanks"` array matching `id` to `"accepted_answers"` list.

---

### 4.7 Sequence Ordering (`order`)

```json
{
  "id": "q_order_1",
  "type": "order",
  "difficulty": "medium",
  "tags": ["history"],
  "content": "Arrange these historical events in chronological order:",
  "answer": "World War I begins,Russian Revolution,World War II begins,Moon Landing",
  "order_items": [
    "World War I begins",
    "Russian Revolution",
    "World War II begins",
    "Moon Landing"
  ]
}
```

- `"order_items"` array: Array of strings in the correct sequence. At least 2 items required.

---

### 4.8 Code Solution (`code`)

```json
{
  "id": "q_code_1",
  "type": "code",
  "difficulty": "hard",
  "code_language": "python",
  "tags": ["python", "math"],
  "content": "Write a Python function that returns the factorial of n:",
  "answer": "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)",
  "explanation": "Recursive factorial function implementation."
}
```

- `"code_language"`: Required programming language.
- `"answer"`: The reference code solution string.

---

### 4.9 Image Select (`image-select`)

```json
{
  "id": "q_img_1",
  "type": "image-select",
  "difficulty": "medium",
  "tags": ["animals"],
  "content": "Which image shows a Golden Retriever?",
  "answer": "opt-2",
  "options": [
    { "id": "opt-1", "content": "Labrador", "image_url": "https://example.com/labrador.jpg", "is_correct": false },
    { "id": "opt-2", "content": "Golden Retriever", "image_url": "https://example.com/golden.jpg", "is_correct": true },
    { "id": "opt-3", "content": "Poodle", "image_url": "https://example.com/poodle.jpg", "is_correct": false }
  ]
}
```

- `"options"` array: Option objects contain `"content"`, `"image_url"`, `"is_correct"`.

---

## 5. Things You MUST NEVER Do

| # | Rule | Wrong | Right |
|---|------|-------|-------|
| 1 | Invalid JSON Syntax | Trailing comma `[1, 2,]` | Valid JSON `[1, 2]` |
| 2 | Single quotes in JSON | `'type': 'mcq'` | `"type": "mcq"` |
| 3 | Missing required `id` | `{ "type": "tf", "content": "..." }` | Include `"id": "q_1"` |
| 4 | Missing required `type` | `{ "id": "q1", "content": "..." }` | Include `"type": "mcq"` |
| 5 | MCQ with < 2 options | `"options": [{ "id": "1", ... }]` | At least 2 option objects |
| 6 | MCQ with multiple correct options | Two options with `"is_correct": true` | Exactly 1 correct option for MCQ (use `multi` for multiple) |
| 7 | Code type without `code_language` | `"type": "code"` without `"code_language"` | Include `"code_language": "python"` |
| 8 | Order type with < 2 items | `"order_items": ["One"]` | At least 2 order items |
| 9 | Invalid difficulty string | `"difficulty": "Hard!"` | `"difficulty": "hard"` |
| 10 | Multiline strings without `\n` | Raw newline in JSON string | Use `\n` escape sequence |

---

## 6. Parser Validation & Robustness Notes

The parser enforces strict JSON structure validation:
- Validates JSON format via `JSON.parse`.
- Ensures top-level container is Object or Array.
- Validates presence of `id`, `type`, and `content`.
- Validates question type is one of the 10 supported types.
- Default fallback values generated for missing optional metadata (`tags: []`, `difficulty: "medium"`).

---

## 7. Validation Checklist

Before saving or importing a JSON question file:

- [ ] File is valid JSON (`JSON.parse` succeeds without errors)
- [ ] Outer element is array `[...]` or object `{...}`
- [ ] Each question has valid `"id"`, `"type"`, and `"content"`
- [ ] `"type"` is one of 10 valid types (`tf`, `mcq`, `multi`, `typing`, `voice`, `image-select`, `match`, `fill`, `order`, `code`)
- [ ] MCQ questions have at least 2 options and exactly 1 correct option
- [ ] Multi-select questions have at least 2 options
- [ ] Match questions contain valid `"pairs"` array
- [ ] Fill questions contain `{{blank_id}}` markers matching `"blanks"` array entries
- [ ] Order questions contain `"order_items"` array with at least 2 strings
- [ ] Code questions specify `"code_language"`
- [ ] Image-select options specify `"image_url"`

---

*Parser: [markdownParser.ts](file:///d:/Etsy/noledge/src/lib/markdownParser.ts)*
*Master Decks: [python-master-deck.json](file:///d:/Etsy/noledge/questions/python-master-deck.json) · [anime-master-deck.json](file:///d:/Etsy/noledge/questions/anime-master-deck.json) · [networking-master-deck.json](file:///d:/Etsy/noledge/questions/networking-master-deck.json)*
