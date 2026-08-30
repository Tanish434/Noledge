# Supabase User Auth & Security Reference

This document serves as the authoritative reference for user authentication, password hashing, session tokens, and database inspection queries for the **Noledge** application.

---

## 1. Authentication Architecture & Storage Model

```
[ User Browser ]
       │
       ├── 1. Enters Email & Password (/auth)
       │
       ▼
[ Supabase Auth Engine ]
       │
       ├── 2. Hashes Password with Bcrypt / Argon2
       ├── 3. Validates Credentials against auth.users
       │
       ▼
[ Browser LocalStorage ]
       │
       └── 4. Stores JWT Session Tokens (sb-<project>-auth-token)
```

### Storage Separation:
* **User Credentials & Auth**: Managed by Supabase System Schema (`auth.users`).
* **Decks, Cards, SRS & Study Data**: Stored 100% locally in IndexedDB, local disk JSON files (`questions/*.json`), Obsidian Vaults, and GitHub repositories. No user content is stored in remote database tables.

---

## 2. `auth.users` Table Schema Breakdown

| Column Name | Data Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID` | Unique identifier assigned to the user on registration. |
| `email` | `VARCHAR` | User's registered email address. |
| `encrypted_password` | `VARCHAR` | Cryptographic Bcrypt hash of the user's password. |
| `email_confirmed_at` | `TIMESTAMPTZ` | Timestamp when the user confirmed their email. |
| `last_sign_in_at` | `TIMESTAMPTZ` | Timestamp of the user's most recent login session. |
| `raw_app_meta_data` | `JSONB` | Provider info (e.g. `{"provider": "email", "providers": ["email"]}`). |
| `raw_user_meta_data` | `JSONB` | Custom user metadata attached during sign-up. |
| `created_at` | `TIMESTAMPTZ` | Registration timestamp. |
| `updated_at` | `TIMESTAMPTZ` | Profile last modified timestamp. |

---

## 3. Useful SQL Queries for Supabase SQL Editor

Run these queries in your **Supabase SQL Editor** to inspect user data and login history easily:

### A. Inspect All Users & Hashed Passwords
```sql
SELECT 
  id,
  email,
  encrypted_password AS bcrypt_hash,
  raw_app_meta_data->>'provider' AS auth_provider,
  created_at,
  last_sign_in_at
FROM auth.users
ORDER BY created_at DESC;
```

### B. Create an Easy Table Editor View (`public.user_auth_summary`)
Run this script once in SQL Editor to expose a clean, readable view in your Supabase **Table Editor**:

```sql
CREATE OR REPLACE VIEW public.user_auth_summary AS
SELECT 
  id AS user_id,
  email,
  encrypted_password AS password_hash,
  raw_app_meta_data->>'provider' AS provider,
  created_at AS registered_at,
  last_sign_in_at AS last_login
FROM auth.users;

-- Grant read permission to authenticated admins
GRANT SELECT ON public.user_auth_summary TO postgres, service_role;
```

---

## 4. How Passwords Are Secured

1. **One-Way Cryptographic Hashing**:
   * Passwords are processed with **Bcrypt** algorithm before touching storage.
   * Plaintext passwords cannot be decrypted back from the hash by anyone (including database administrators).

2. **Session Security**:
   * Upon successful authentication, Supabase issues a cryptographically signed JWT token.
   * Tokens expire automatically and are refreshed securely without re-transmitting passwords.
