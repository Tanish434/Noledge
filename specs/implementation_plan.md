# Noledge — PWA Revision & Study System

A cross-device Progressive Web App for spaced-revision learning. Connects to Obsidian vaults and GitHub repos. Displays content as swipeable cards. Supports MCQ, typing, voice, image-selection, and more question types. GSAP-animated, enterprise-grade, live-synced, and documented to the standard of the `hash_identifier.py` reference (every function, every constant, every decision explained in detail).

---

> [!IMPORTANT]
> **Documentation Standard**: Every file in this project will follow the `hash_identifier.py` Jupyter-style documentation standard — exhaustive inline comments explaining **what**, **why**, and **how** for every block, constant, function, and design decision. No lazy comments. No `// TODO`. No `// ...`. Full production commentary.

---

## User Review Required

> [!WARNING]
> **Data Source Decisions**: The plan assumes GitHub API (REST/GraphQL) and local Obsidian vault access via file-system or Obsidian Local REST API plugin. Please confirm:
> 1. Do you use the **Obsidian Local REST API** plugin, or should we read vault files directly from a synced folder (e.g., via iCloud/OneDrive/Syncthing)?
> 2. For GitHub — do you want to use a **Personal Access Token (PAT)** for private repo access, or public repos only?
> 3. For live sync — is **Supabase** (free tier, real-time PostgreSQL) acceptable, or do you prefer Firebase Firestore?

> [!IMPORTANT]
> **Question Format Specification**: You mentioned a "specific format for each question type." Should we define a custom markdown-based format inside your Obsidian/GitHub files (e.g., `:::mcq`, `:::typing`, `:::voice`), or do you want a JSON schema stored alongside the markdown?

> [!IMPORTANT]
> **Voice Input**: Voice-based questions require microphone access (Web Speech API). This works on Chrome/Edge (good), Safari (partial), Firefox (limited). Confirm this is acceptable.

---

## Open Questions

1. **Obsidian Vault Location** — Is your vault synced to a cloud folder, or do you run the Obsidian Local REST API plugin?
2. **GitHub Repo Structure** — What does your revision content look like? Markdown files in folders? A specific naming convention?
3. **Authentication** — Should Noledge support multi-user login, or is this a single-user personal tool?
4. **Hosting Target** — Vercel, Netlify, GitHub Pages, or self-hosted?
5. **Haptics** — Do you mean device vibration feedback (Vibration API) on correct/incorrect answers, or visual haptic-like animations (press-in, shake, bounce)?
6. **Spaced Repetition** — Should the card system use an SRS algorithm (like SM-2 / Anki-style) to schedule review intervals, or is it purely manual navigation?

---

## Proposed Architecture

### Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Framework** | Next.js 15 (App Router) | RSC, API routes, PWA support, SSR/SSG |
| **Styling** | Vanilla CSS + CSS Custom Properties | Per user rules — no Tailwind unless asked |
| **Animation** | GSAP (ScrollTrigger, Flip, Draggable) | User explicitly requested GSAP |
| **State** | Zustand + React Context | Lightweight, works with RSC |
| **Realtime Sync** | Supabase Realtime (PostgreSQL) | Free tier, real-time subscriptions, auth |
| **PWA** | next-pwa + Web App Manifest | Installable on phone + laptop |
| **Voice** | Web Speech API (SpeechRecognition) | Browser-native, no dependency |
| **Haptics** | Vibration API + GSAP spring animations | Real device feedback + visual feedback |
| **Testing** | Vitest + Playwright | Unit + E2E |
| **CI/CD** | GitHub Actions | Lint → Test → Build → Deploy |
| **Logging** | Structured JSON logger (custom) | Enterprise-grade error tracking |

### Design Direction

**Design Read:** "Reading this as: personal knowledge/revision tool for a power-user, with a dark-tech/premium-consumer language, leaning toward native CSS + GSAP + custom design system."

**Dials:** `DESIGN_VARIANCE: 7` / `MOTION_INTENSITY: 7` / `VISUAL_DENSITY: 4`

**Theme:** Dual-theme (dark + light) with system preference detection. Dark default. Deep OLED blacks, accent color (emerald or electric blue), monospace secondary type for code/meta, sans-serif primary (Geist or Outfit).

---

## Proposed Changes

### Component 1: Project Scaffold & PWA Shell

#### [NEW] [d:\Etsy\noledge\](file:///d:/Etsy/noledge/) — Root project directory

```
noledge/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint + Test + Build pipeline
│       └── deploy.yml                # Deploy to Vercel/Netlify
├── public/
│   ├── manifest.json                 # PWA manifest (name, icons, theme)
│   ├── sw.js                         # Service worker (offline + caching)
│   ├── icons/                        # PWA icons (192, 512, maskable)
│   └── sounds/                       # Feedback sounds (correct, wrong, swipe)
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Root layout (theme provider, fonts, meta)
│   │   ├── page.tsx                  # Landing / dashboard
│   │   ├── globals.css               # Design system tokens + base styles
│   │   ├── study/
│   │   │   └── page.tsx              # Card study view (swipe interface)
│   │   ├── create/
│   │   │   └── page.tsx              # Question creation interface
│   │   ├── manage/
│   │   │   └── page.tsx              # Deck & source management
│   │   ├── settings/
│   │   │   └── page.tsx              # Theme, sync, source config
│   │   └── api/
│   │       ├── github/
│   │       │   └── route.ts          # GitHub API proxy (fetch content)
│   │       ├── obsidian/
│   │       │   └── route.ts          # Obsidian vault reader proxy
│   │       ├── sync/
│   │       │   └── route.ts          # Supabase sync endpoint
│   │       └── parse/
│   │           └── route.ts          # Markdown → Question parser
│   ├── components/
│   │   ├── cards/
│   │   │   ├── CardStack.tsx         # GSAP-powered swipeable card stack
│   │   │   ├── FlashCard.tsx         # Individual card (flip animation)
│   │   │   ├── SwipeHandler.tsx      # Touch/mouse swipe detection
│   │   │   └── CardProgress.tsx      # Progress bar / counter
│   │   ├── questions/
│   │   │   ├── MCQQuestion.tsx       # Multiple choice question renderer
│   │   │   ├── TypingQuestion.tsx    # Free-text typing answer
│   │   │   ├── VoiceQuestion.tsx     # Voice recognition answer
│   │   │   ├── ImageSelectQuestion.tsx # Image-based selection
│   │   │   ├── MatchPairsQuestion.tsx  # Drag-and-match pairs
│   │   │   ├── FillBlanksQuestion.tsx  # Fill-in-the-blanks
│   │   │   ├── OrderingQuestion.tsx    # Order/sequence items
│   │   │   ├── TrueFalseQuestion.tsx   # True/False with explanation
│   │   │   ├── CodeQuestion.tsx        # Code completion/correction
│   │   │   └── QuestionRenderer.tsx    # Dynamic question type dispatcher
│   │   ├── ui/
│   │   │   ├── ThemeToggle.tsx       # Dark/Light theme switcher
│   │   │   ├── Navigation.tsx        # Bottom nav (mobile) / side nav (desktop)
│   │   │   ├── Modal.tsx             # Reusable modal with GSAP enter/exit
│   │   │   ├── Toast.tsx             # Notification toast system
│   │   │   ├── Skeleton.tsx          # Loading skeleton components
│   │   │   ├── Button.tsx            # Premium button with press physics
│   │   │   └── IconButton.tsx        # Icon-only button variant
│   │   ├── sync/
│   │   │   ├── SyncStatus.tsx        # Live sync indicator (green dot, pulse)
│   │   │   └── ConflictResolver.tsx  # Handle sync conflicts
│   │   ├── sources/
│   │   │   ├── GitHubConnector.tsx   # GitHub repo browser + file picker
│   │   │   ├── ObsidianConnector.tsx # Obsidian vault connector
│   │   │   └── SourceManager.tsx     # Manage connected sources
│   │   └── create/
│   │       ├── QuestionEditor.tsx    # WYSIWYG question creator
│   │       ├── DeckEditor.tsx        # Deck/collection manager
│   │       └── FormatPreview.tsx     # Live preview of question format
│   ├── engine/
│   │   ├── parser/
│   │   │   ├── markdownParser.ts     # Parse Obsidian/GitHub markdown
│   │   │   ├── questionExtractor.ts  # Extract questions from parsed content
│   │   │   ├── formatRegistry.ts     # Registry of all question formats
│   │   │   └── validators.ts         # Validate question data integrity
│   │   ├── pipeline/
│   │   │   ├── fetchPipeline.ts      # Async pipeline: fetch → parse → validate → store
│   │   │   ├── syncPipeline.ts       # Bidirectional sync pipeline
│   │   │   └── transformPipeline.ts  # Content transformation chain
│   │   ├── scoring/
│   │   │   ├── scoreEngine.ts        # Calculate scores per question type
│   │   │   ├── streakTracker.ts      # Track answer streaks
│   │   │   └── analytics.ts          # Study session analytics
│   │   └── srs/
│   │       ├── sm2.ts                # SM-2 spaced repetition algorithm
│   │       └── scheduler.ts          # Next-review scheduler
│   ├── lib/
│   │   ├── github.ts                 # GitHub REST API client
│   │   ├── obsidian.ts               # Obsidian vault reader
│   │   ├── supabase.ts               # Supabase client + realtime setup
│   │   ├── storage.ts                # IndexedDB wrapper (offline support)
│   │   ├── haptics.ts                # Vibration API + visual haptics
│   │   ├── logger.ts                 # Structured JSON logger
│   │   ├── errorBoundary.ts          # Global error boundary
│   │   └── constants.ts              # App-wide constants
│   ├── hooks/
│   │   ├── useSwipe.ts               # Touch/pointer swipe detection hook
│   │   ├── useTheme.ts               # Theme management hook
│   │   ├── useSync.ts                # Real-time sync hook
│   │   ├── useVoice.ts               # Speech recognition hook
│   │   ├── useHaptics.ts             # Haptic feedback hook
│   │   ├── useGSAP.ts               # GSAP animation lifecycle hook
│   │   ├── useOffline.ts             # Offline detection + queue hook
│   │   └── useKeyboard.ts           # Keyboard shortcuts hook
│   ├── stores/
│   │   ├── deckStore.ts              # Zustand store: decks & cards
│   │   ├── studyStore.ts             # Zustand store: active study session
│   │   ├── settingsStore.ts          # Zustand store: user preferences
│   │   ├── syncStore.ts              # Zustand store: sync state
│   │   └── sourceStore.ts            # Zustand store: connected sources
│   ├── types/
│   │   ├── question.ts               # Question type definitions
│   │   ├── deck.ts                   # Deck/collection types
│   │   ├── source.ts                 # Data source types
│   │   ├── sync.ts                   # Sync event types
│   │   └── api.ts                    # API response types
│   └── utils/
│       ├── cn.ts                     # Class name merger utility
│       ├── debounce.ts               # Debounce utility
│       ├── throttle.ts               # Throttle utility
│       ├── sanitize.ts               # HTML/markdown sanitizer
│       └── crypto.ts                 # Token encryption helpers
├── tests/
│   ├── unit/
│   │   ├── parser.test.ts            # Markdown parser tests
│   │   ├── scoreEngine.test.ts       # Scoring tests
│   │   ├── sm2.test.ts               # SRS algorithm tests
│   │   └── validators.test.ts        # Validation tests
│   ├── integration/
│   │   ├── github.test.ts            # GitHub API integration tests
│   │   ├── sync.test.ts              # Sync pipeline tests
│   │   └── pipeline.test.ts          # Full pipeline tests
│   └── e2e/
│       ├── study-flow.spec.ts        # Study session E2E
│       ├── create-question.spec.ts   # Question creation E2E
│       └── sync-flow.spec.ts         # Cross-device sync E2E
├── specs/
│   ├── question-format.md            # Question format specification
│   ├── sync-protocol.md              # Sync protocol specification
│   └── api-contracts.md              # API contract specification
├── next.config.ts                    # Next.js config (PWA, headers)
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript config (strict)
├── vitest.config.ts                  # Test config
├── .env.example                      # Environment variables template
├── .eslintrc.json                    # Linting rules
├── .prettierrc                       # Formatting rules
└── README.md                         # Project documentation
```

---

### Component 2: Question Format Specification

#### [NEW] [question-format.md](file:///d:/Etsy/noledge/specs/question-format.md)

Defines how questions are stored in Obsidian/GitHub markdown files and in the database.

**Markdown Format (in Obsidian/GitHub files):**

```markdown
---
type: mcq
tags: [biology, cells]
difficulty: medium
deck: biology-101
---

# What is the powerhouse of the cell?

- [ ] Nucleus
- [x] Mitochondria
- [ ] Ribosome
- [ ] Golgi apparatus

> Explanation: The mitochondria generates ATP through oxidative phosphorylation.
```

**Supported question type markers:**

| Type | Frontmatter `type:` | Description |
|---|---|---|
| Multiple Choice | `mcq` | Radio select, one correct answer |
| Multiple Select | `multi` | Checkbox select, multiple correct |
| Typing | `typing` | Free-text, fuzzy-matched answer |
| Voice | `voice` | Speak the answer, speech-to-text matched |
| Image Select | `image-select` | Pick correct image from grid |
| Match Pairs | `match` | Drag items to matching pairs |
| Fill Blanks | `fill` | Complete the sentence with blanks |
| Ordering | `order` | Arrange items in correct sequence |
| True/False | `tf` | True or false with explanation |
| Code | `code` | Code completion or correction |

**JSON Schema (in Supabase):**

```typescript
interface Question {
  id: string;                    // UUID
  deck_id: string;               // Parent deck reference
  type: QuestionType;            // Enum of all types above
  content: string;               // The question text (markdown)
  options?: QuestionOption[];     // For MCQ, multi, image-select
  answer: string | string[];     // Correct answer(s)
  explanation?: string;          // Why this is correct
  media?: MediaAttachment[];     // Images, audio, video
  metadata: {
    tags: string[];
    difficulty: 'easy' | 'medium' | 'hard';
    source_file: string;         // Origin file path in Git/Obsidian
    source_line: number;         // Line number in origin file
    created_at: string;
    updated_at: string;
    review_count: number;
    last_reviewed: string | null;
    srs_interval: number;        // SM-2 interval in days
    srs_ease: number;            // SM-2 ease factor
    srs_next_review: string;     // Next review date
  };
}
```

---

### Component 3: Sync Protocol

#### [NEW] [sync-protocol.md](file:///d:/Etsy/noledge/specs/sync-protocol.md)

**Architecture:**

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Phone      │◄───────►│   Supabase RT    │◄───────►│   Laptop    │
│  (PWA)       │  WebSocket│   (PostgreSQL)   │WebSocket│   (PWA)     │
│              │         │                  │         │             │
│  IndexedDB   │         │  questions       │         │  IndexedDB  │
│  (offline)   │         │  decks           │         │  (offline)  │
│              │         │  study_sessions  │         │             │
└──────┬───────┘         │  sync_log        │         └──────┬──────┘
       │                 └──────────────────┘                │
       │                         ▲                           │
       │                         │                           │
       ▼                         │                           ▼
  ┌──────────┐            ┌──────┴──────┐            ┌──────────┐
  │ GitHub   │            │  API Routes │            │ Obsidian │
  │ REST API │◄──────────►│  (Next.js)  │◄──────────►│ Vault    │
  └──────────┘            └─────────────┘            └──────────┘
```

**Sync Flow:**
1. **Fetch** — Pull markdown files from GitHub/Obsidian
2. **Parse** — Extract questions using `questionExtractor.ts`
3. **Diff** — Compare parsed questions against Supabase state
4. **Merge** — Apply changes (last-write-wins with conflict detection)
5. **Push** — Broadcast changes via Supabase Realtime to all connected devices
6. **Cache** — Store locally in IndexedDB for offline access

**Conflict Resolution:** Last-write-wins with a `sync_log` table tracking all mutations. User can review conflicts via `ConflictResolver.tsx`.

---

### Component 4: GSAP Animation System

#### [NEW] [useGSAP.ts](file:///d:/Etsy/noledge/src/hooks/useGSAP.ts)

All animations documented Jupyter-style. Key animations:

| Animation | Where | GSAP Feature | Description |
|---|---|---|---|
| Card Swipe | Study view | `Draggable` + `gsap.to` | Physics-based swipe with spring snapback |
| Card Flip | FlashCard | `gsap.to` (rotateY) | 3D card flip reveal answer |
| Stack Enter | CardStack | `ScrollTrigger` | Cards cascade in on page enter |
| Page Transition | All pages | `gsap.timeline` | Smooth route transitions |
| Correct/Wrong Shake | Question answer | `gsap.to` (x oscillation) | Haptic shake on wrong, pulse on correct |
| Modal Open | Modal | `gsap.fromTo` | Scale + fade spring entry |
| Theme Switch | ThemeToggle | `gsap.to` | Smooth color property transitions |
| Progress Fill | CardProgress | `gsap.to` (scaleX) | Animated progress bar fill |
| Swipe Indicator | Cards | `gsap.to` (opacity, x) | Directional arrow hints |
| Score Reveal | Session end | `gsap.timeline` | Staggered score reveal sequence |

---

### Component 5: Multi-Pipeline Engine

#### [NEW] [fetchPipeline.ts](file:///d:/Etsy/noledge/src/engine/pipeline/fetchPipeline.ts)

```
                    ┌────────────────────────────────────────┐
                    │         FETCH PIPELINE                  │
                    │                                        │
   Source Config ──►│  1. SourceAdapter (GitHub | Obsidian)   │
                    │  2. RateLimiter (token bucket)          │
                    │  3. ContentFetcher (retry + backoff)    │
                    │  4. CacheLayer (ETag / Last-Modified)   │
                    │  5. MarkdownParser (remark + frontmatter)│
                    │  6. QuestionExtractor (type registry)   │
                    │  7. Validator (schema + integrity)      │
                    │  8. DiffEngine (compare vs stored)      │
                    │  9. StorageWriter (Supabase + IndexedDB)│
                    │  10. EventEmitter (notify all clients)  │
                    │                                        │
                    └────────────────────────────────────────┘
```

Each pipeline stage:
- Has its own error handler
- Emits structured JSON logs
- Can be retried independently
- Has circuit-breaker protection
- Is fully async with cancellation support

---

### Component 6: Error Handling & Logging

#### [NEW] [logger.ts](file:///d:/Etsy/noledge/src/lib/logger.ts)

**Structured JSON logging** at every layer:

```typescript
interface LogEntry {
  timestamp: string;           // ISO 8601
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  component: string;           // 'parser' | 'sync' | 'ui' | 'api'
  action: string;              // 'fetch_github' | 'parse_question' | etc
  duration_ms?: number;        // Performance tracking
  error?: {
    name: string;
    message: string;
    stack: string;
    code?: string;
  };
  context?: Record<string, unknown>;  // Additional data
}
```

**Error boundaries:**
- React ErrorBoundary at app root (catches render errors)
- API route try/catch with structured error responses
- Pipeline stage-level error isolation
- Supabase connection error recovery with exponential backoff
- Service Worker fetch error fallback to IndexedDB cache

---

### Component 7: CI/CD Pipeline

#### [NEW] [ci.yml](file:///d:/Etsy/noledge/.github/workflows/ci.yml)

```
┌──────┐    ┌──────┐    ┌──────┐    ┌───────┐    ┌────────┐
│ Push │───►│ Lint │───►│ Test │───►│ Build │───►│ Deploy │
│      │    │ESLint│    │Vitest│    │Next.js│    │Vercel  │
│      │    │Prettier│  │Playwright│ │       │    │        │
└──────┘    └──────┘    └──────┘    └───────┘    └────────┘
```

- **Lint**: ESLint (strict TypeScript rules) + Prettier
- **Test**: Vitest (unit) → Playwright (E2E)
- **Build**: Next.js production build with PWA manifest generation
- **Deploy**: Auto-deploy to Vercel on `main` branch push
- **Preview**: Deploy previews on pull requests

---

### Component 8: UI/UX Design System

#### [NEW] [globals.css](file:///d:/Etsy/noledge/src/app/globals.css)

**Design tokens (CSS Custom Properties):**

```css
:root {
  /* === Light Theme === */
  --bg-primary: #fafafa;
  --bg-secondary: #f0f0f0;
  --bg-card: #ffffff;
  --text-primary: #0a0a0a;
  --text-secondary: #6b6b6b;
  --accent: #10b981;            /* Emerald */
  --accent-hover: #059669;
  --correct: #22c55e;
  --wrong: #ef4444;
  --border: rgba(0, 0, 0, 0.08);
  --shadow-soft: 0 2px 20px rgba(0, 0, 0, 0.04);
  --radius-card: 1.25rem;
  --radius-button: 0.75rem;
  --font-primary: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', monospace;
  --transition-spring: cubic-bezier(0.32, 0.72, 0, 1);
  --transition-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
}

[data-theme="dark"] {
  --bg-primary: #050505;
  --bg-secondary: #111111;
  --bg-card: #1a1a1a;
  --text-primary: #fafafa;
  --text-secondary: #8b8b8b;
  --border: rgba(255, 255, 255, 0.06);
  --shadow-soft: 0 2px 20px rgba(0, 0, 0, 0.3);
}
```

**Haptic feedback system:**
- ✅ Correct answer → green pulse animation + short vibration (50ms)
- ❌ Wrong answer → red shake animation + double vibration (100ms, 50ms, 100ms)
- ◀️ Swipe left → card flies left with spring physics
- ▶️ Swipe right → card flies right with spring physics
- 🔄 Card flip → 3D rotateY with perspective

---

## Implementation Phases

### Phase 1: Foundation (Files: ~15)
- Project scaffold (Next.js + PWA)
- Design system (CSS tokens, theme toggle)
- Core types and constants
- Logger and error boundary
- Basic navigation shell

### Phase 2: Card Engine (Files: ~12)
- GSAP swipe card stack
- Card flip animation
- Swipe handler (touch + mouse + keyboard)
- Progress tracking
- Question type renderer (dispatcher)

### Phase 3: Question Types (Files: ~10)
- MCQ, Multiple Select
- Typing (with fuzzy matching)
- True/False
- Fill Blanks
- Ordering
- Match Pairs
- Image Select
- Code Question
- Voice Question

### Phase 4: Data Pipeline (Files: ~10)
- Markdown parser (remark)
- Question extractor (frontmatter-based)
- Format registry
- Validators
- GitHub API client
- Obsidian reader

### Phase 5: Sync & Storage (Files: ~8)
- Supabase client + schema
- Real-time subscriptions
- IndexedDB offline cache
- Sync pipeline
- Conflict resolver

### Phase 6: Management UI (Files: ~6)
- Question creation editor
- Deck manager
- Source connector (GitHub + Obsidian)
- Settings page

### Phase 7: SRS & Analytics (Files: ~5)
- SM-2 algorithm
- Scheduler
- Score engine
- Streak tracker
- Session analytics

### Phase 8: Polish & Deploy (Files: ~5)
- CI/CD pipelines
- E2E tests
- Performance optimization
- PWA final audit (Lighthouse)
- README + specs documentation

---

## Verification Plan

### Automated Tests
```bash
npm run lint              # ESLint + Prettier check
npm run test              # Vitest unit tests
npm run test:e2e          # Playwright E2E tests
npx lighthouse --view     # PWA + Performance audit
```

### Manual Verification
- Install PWA on phone (Chrome → Add to Home Screen)
- Open same URL on laptop browser
- Create question on laptop → verify appears on phone within 2 seconds
- Study session with swipe gestures on phone
- Answer questions with all input types (tap, type, voice)
- Toggle theme on phone → verify laptop does NOT change (local preference)
- Go offline on phone → verify cached content still works
- Come back online → verify queued changes sync

---

## Estimated Scope
- **~85 files** total
- **~15,000+ lines** of heavily-documented code (Jupyter-style)
- **8 phases** of implementation
- **10 question types**
- **Full CI/CD** with GitHub Actions
- **Real-time sync** across devices
- **Offline-first** with IndexedDB caching
