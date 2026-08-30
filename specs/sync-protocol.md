# Noledge Sync Protocol Specification

**Version:** 1.0  
**Status:** Active  

---

## Overview

The Noledge sync protocol defines how data flows between:
1. **Client** (browser IndexedDB + Zustand stores)
2. **External Sources** (GitHub repositories, Obsidian vaults via Local REST API)
3. **Cloud** (Supabase PostgreSQL + Realtime)

The protocol is designed to be **offline-first**: the app is fully functional without a network connection. Sync happens opportunistically when connectivity is available.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                      │
│                                                         │
│  ┌──────────────┐   ┌────────────────┐                  │
│  │   IndexedDB   │ ←→│ Zustand Stores │                  │
│  │  (persistent) │   │  (in-memory)   │                  │
│  └──────┬───────┘   └───────┬────────┘                  │
│         │                   │                            │
│         │    ┌──────────────┴──────────┐                 │
│         │    │     Offline Queue        │                 │
│         │    │  (PendingEvent[])        │                 │
│         │    └──────────────┬──────────┘                 │
└─────────┼────────────────── │ ──────────────────────────┘
          │                   │
          │ (when online)     │ (when online)
          ↓                   ↓
┌─────────────────┐   ┌────────────────────────────────────┐
│ GitHub / Obsidian│   │           Supabase                  │
│ (source content) │   │  (auth + decks + SRS + sessions)    │
└─────────────────┘   └────────────────────────────────────┘
```

---

## Sync Triggers

| Trigger | Action |
|---|---|
| App mount | Pull decks + SRS from Supabase |
| Tab becomes visible | If >5 minutes since last sync → `syncAll()` |
| Network reconnect | Immediate `syncAll()` |
| Manual (user button) | `syncAll()` |
| Question answered | Enqueue `PendingEvent` (offline queue) |

---

## Conflict Resolution

**Strategy:** Last-write-wins by `updated_at` timestamp.

Rules:
- If local `updated_at` > remote `updated_at` → local wins, push to remote.
- If remote `updated_at` > local `updated_at` → remote wins, pull to local.
- If timestamps are equal → treat as no conflict, skip upsert.

This means **the device that recorded the most recent answer wins**. Since SM-2 intervals compound over time, the device with the most recent review data is also the most up-to-date regarding what the user knows.

---

## Offline Queue

When the device is offline, all answer events are stored in the Offline Queue:

```typescript
interface PendingEvent {
  id: string;
  type: 'answer' | 'deck_create' | 'deck_update' | 'session_end';
  payload: Record<string, unknown>;
  created_at: string;
  retry_count: number;
}
```

Events are persisted to `localStorage` (key: `noledge:pending_events`).

On reconnect, `offlineReplay.ts` drains the queue sequentially, applying each event to the local stores and pushing to Supabase.

---

## Source Sync (GitHub / Obsidian)

Source sync is **read-only**: Noledge never writes back to GitHub or Obsidian.

### GitHub Flow
1. Fetch repo tree via `/api/github?action=tree`
2. Compare file SHAs to cached SHAs (skip unchanged files)
3. For changed files: fetch content via `/api/github?action=file`
4. Parse with `markdownParser.ts`
5. Upsert questions into `questionStore` (merge with existing SRS data by stable ID)

### Obsidian Flow
1. List vault files via `/api/obsidian?action=list`
2. For each `.md` file: fetch content via `/api/obsidian?action=file`
3. Parse and upsert same as GitHub flow

### Source Sync Interval
- Minimum: `300,000ms` (5 minutes) between source syncs
- Source syncs do NOT trigger on every tab focus — only if the threshold is met

---

## Supabase Tables Used

| Table | Purpose |
|---|---|
| `noledge_decks` | Deck metadata sync |
| `noledge_questions` | Question content sync |
| `noledge_srs_progress` | SM-2 state per card per user |
| `noledge_study_sessions` | Completed session logs |

All tables have Row Level Security (RLS) — users can only access their own rows.

---

## Security

- PATs (GitHub) and API tokens (Obsidian) are stored encrypted in `localStorage` using AES-GCM via Web Crypto API.
- Tokens are never sent to Supabase.
- API routes (`/api/github`, `/api/obsidian`) receive tokens from the client and forward them to the respective external APIs server-side.
- The Supabase service role key is only used server-side and never exposed to the browser.
