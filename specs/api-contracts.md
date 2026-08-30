# Noledge API Contracts

**Version:** 1.0  
**Status:** Active  

---

## Internal API Routes

All routes are Next.js App Router Route Handlers under `src/app/api/`.

---

## POST /api/github

Secure proxy for GitHub API. Avoids exposing PATs in browser network traffic.

### Request

```typescript
{
  action: 'tree' | 'file';
  owner: string;       // GitHub username or org
  repo: string;        // Repository name
  branch?: string;     // Branch name (default: 'main')
  path?: string;       // File path within repo (required for action=file)
  token?: string;      // GitHub PAT (optional for public repos)
}
```

### Response: action=tree

```typescript
{
  files: Array<{
    path: string;  // e.g. "biology/cells.json"
    sha: string;   // Git blob SHA for change detection
  }>;
}
```

### Response: action=file

```typescript
{
  content: string;  // Raw JSON file content (UTF-8 decoded)
}
```

### Error Response

```typescript
{
  error: string;  // Human-readable error message
}
```

### HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Missing required fields (owner, repo, path) |
| 401 | GitHub authentication failed |
| 404 | Repo or file not found |
| 500 | Internal server error |

---

## POST /api/obsidian

Secure proxy for the Obsidian Local REST API plugin. Bypasses browser CORS restrictions when the app is hosted publicly.

### Request

```typescript
{
  action: 'list' | 'file';
  vault_url?: string;   // Obsidian REST API URL (default: 'https://127.0.0.1:27123')
  path?: string;        // File path within vault (required for action=file)
  token: string;        // Obsidian REST API key
}
```

### Response: action=list

```typescript
{
  files: string[];  // Array of .md file paths in the vault
}
```

### Response: action=file

```typescript
{
  content: string;  // Raw Markdown file content
}
```

### Error Response

```typescript
{
  error: string;
}
```

### Notes
- When deployed to Vercel, this proxy cannot reach `127.0.0.1` on the user's machine. The client will fall back to a direct browser request in that case.
- The proxy is primarily useful when running Noledge locally at `localhost:3000`.

---

## Supabase REST API (via SDK)

All Supabase access goes through the `@supabase/supabase-js` client. Direct HTTP calls to the Supabase REST API are not made — the SDK handles auth headers, JWT refresh, and Realtime.

### Tables

| Table | Primary Key | RLS |
|---|---|---|
| `noledge_decks` | `id UUID` | `user_id = auth.uid()` |
| `noledge_questions` | `id UUID` | `user_id = auth.uid()` |
| `noledge_srs_progress` | `user_id + question_id` | `user_id = auth.uid()` |
| `noledge_study_sessions` | `id UUID` | `user_id = auth.uid()` |

### Upsert Semantics

All `pushX()` functions in `supabaseSync.ts` use `supabase.from(table).upsert(row, { onConflict: primaryKeyColumns })`.

This is equivalent to PostgreSQL `INSERT ... ON CONFLICT DO UPDATE SET ...`.

---

## Auth Flows

### Magic Link

1. Client calls `supabase.auth.signInWithOtp({ email })`
2. Supabase sends an email with a magic link
3. User clicks the link → redirected to `NEXT_PUBLIC_APP_URL/auth/callback`
4. Supabase SDK on the callback page detects the `#access_token` hash and exchanges it for a session
5. `onAuthStateChange` fires in `AppProviders.tsx` → `authStore.setSession(session)` is called

### Email + Password

1. Client calls `supabase.auth.signInWithPassword({ email, password })`
2. Supabase returns a session immediately
3. `onAuthStateChange` fires → same update path as magic link

### Session Persistence

Sessions are stored in `localStorage` under the key `noledge:auth` (configured in `supabase.ts`).
Auto-refresh is enabled — the SDK refreshes the JWT token before it expires automatically.
