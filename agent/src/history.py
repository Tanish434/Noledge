import sqlite3
import time
import uuid
from pathlib import Path
from typing import List, Dict, Optional, Any

DB_PATH = Path(__file__).parent / "history.db"

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                message_count INTEGER DEFAULT 0
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                speaker TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp REAL NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC)")
        conn.commit()

init_db()

def create_session(title: Optional[str] = None) -> Dict[str, Any]:
    session_id = f"sess_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    if not title:
        title = f"Discussion {time.strftime('%b %d, %H:%M')}"
    now = time.time()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?)",
            (session_id, title, now, now, 0)
        )
        conn.commit()
    return {
        "id": session_id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "message_count": 0
    }

def cleanup_empty_sessions(max_age_seconds: float = 3600.0):
    """Delete only stale empty sessions (older than max_age) to avoid hiding freshly created chats.

    Previous behavior deleted ALL message_count==0 rows on every get_sessions() call,
    which made newly created sessions invisible until the first message landed.
    """
    cutoff = time.time() - max_age_seconds
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM sessions WHERE message_count = 0 AND created_at < ?",
            (cutoff,),
        )
        conn.commit()

def get_sessions() -> List[Dict[str, Any]]:
    cleanup_empty_sessions()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, created_at, updated_at, message_count FROM sessions ORDER BY updated_at DESC")
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

def ensure_session(session_id: Optional[str] = None, title: Optional[str] = None) -> Dict[str, Any]:
    """Return existing session or create a persistent one. Single source of truth for IDs."""
    if session_id:
        existing = get_session(session_id)
        if existing:
            return existing
    return create_session(title=title)

def resolve_session(
    identifier: Optional[str] = None,
    exclude_id: Optional[str] = None,
    current_session_id: Optional[str] = None,
    fallback_to_current: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Canonical session resolver. Unifies ID lookup, title matching, and content search.
    Matches session by:
      1. Direct Session ID match
      2. 'current' / 'this' / 'active' keywords -> current_session_id
      3. Cleaned title exact match (case-insensitive)
      4. Title substring match
      5. Full-text search across messages
      6. Fallback to current_session_id if requested
    """
    raw = (identifier or "").strip()

    if raw.lower() in ("current", "this", "this_session", "this chat", "active"):
        if current_session_id:
            return get_session(current_session_id)

    with get_connection() as conn:
        cursor = conn.cursor()

        if raw:
            # 1. Direct ID match
            cursor.execute("SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE id = ?", (raw,))
            row = cursor.fetchone()
            if row:
                return dict(row)

            import re
            q = raw.lower()
            clean_q = re.sub(r'^(please\s+)?(delete|remove|clear|load|switch\s+to|open|show|read)\s+', '', q).strip()
            clean_q = re.sub(r'^(the|a|this|that)\s+', '', clean_q).strip()
            clean_q = re.sub(r'\s+(session|chat|discussion)$', '', clean_q).strip()

            # 2. Exact Title Match (case-insensitive)
            query_sql = "SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE (LOWER(title) = ? OR LOWER(title) = ?)"
            params = [q, clean_q]
            if exclude_id:
                query_sql += " AND id != ?"
                params.append(exclude_id)
            query_sql += " ORDER BY updated_at DESC LIMIT 1"
            cursor.execute(query_sql, params)
            row = cursor.fetchone()
            if row:
                return dict(row)

            # 3. Substring match on Title
            query_sql = "SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE (LOWER(title) LIKE ? OR LOWER(title) LIKE ?)"
            params = [f"%{q}%", f"%{clean_q}%"]
            if exclude_id:
                query_sql += " AND id != ?"
                params.append(exclude_id)
            query_sql += " ORDER BY updated_at DESC LIMIT 1"
            cursor.execute(query_sql, params)
            row = cursor.fetchone()
            if row:
                return dict(row)

            # 4. Message Content Fallback
            query_sql = """
                SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at, s.message_count
                FROM sessions s
                JOIN messages m ON s.id = m.session_id
                WHERE (s.title LIKE ? OR m.content LIKE ?)
            """
            params = [f"%{clean_q}%", f"%{clean_q}%"]
            if exclude_id:
                query_sql += " AND s.id != ?"
                params.append(exclude_id)
            query_sql += " ORDER BY s.updated_at DESC LIMIT 1"
            cursor.execute(query_sql, params)
            row = cursor.fetchone()
            if row:
                return dict(row)

    if fallback_to_current and current_session_id:
        return get_session(current_session_id)

    return None

def find_session_by_title(title_query: str) -> Optional[Dict[str, Any]]:
    """Backward-compatible delegate to canonical resolve_session."""
    return resolve_session(identifier=title_query)

def search_sessions(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Search sessions by matching against session title or message contents."""
    q = query.strip()
    if not q:
        return []
    wildcard = f"%{q}%"
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at, s.message_count
            FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            WHERE s.title LIKE ? OR m.content LIKE ?
            ORDER BY s.updated_at DESC
            LIMIT ?
            """,
            (wildcard, wildcard, limit)
        )
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

def get_session_messages(session_id: str) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, session_id, role, speaker, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,)
        )
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

def add_message(session_id: str, role: str, content: str, speaker: str = "User") -> Dict[str, Any]:
    msg_id = f"msg_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    now = time.time()
    with get_connection() as conn:
        cursor = conn.cursor()
        # Safe duplicate check: only ignore exact same message within 2 seconds (network retry)
        cursor.execute(
            "SELECT id, session_id, role, speaker, content, timestamp FROM messages WHERE session_id = ? AND role = ? AND content = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 1",
            (session_id, role, content, now - 2.0)
        )
        existing = cursor.fetchone()
        if existing:
            return dict(existing)

        # Verify or create session
        cursor.execute("SELECT id, title, message_count FROM sessions WHERE id = ?", (session_id,))
        sess = cursor.fetchone()
        if not sess:
            if role == "user":
                auto_title = content[:32] + "..." if len(content) > 32 else content
            else:
                auto_title = f"Discussion {time.strftime('%b %d, %H:%M')}"
            if not auto_title.strip():
                auto_title = f"Discussion {time.strftime('%b %d, %H:%M')}"
            cursor.execute(
                "INSERT INTO sessions (id, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?)",
                (session_id, auto_title, now, now, 1)
            )
        else:
            new_count = (sess["message_count"] or 0) + 1
            curr_title = (sess["title"] or "").strip()
            is_generic_title = curr_title.startswith("Discussion ") or curr_title in ("New Chat", "Discussion", "")
            should_update_title = (role == "user") and is_generic_title
            if should_update_title:
                short_title = content[:32] + "..." if len(content) > 32 else content
                cursor.execute(
                    "UPDATE sessions SET title = ?, updated_at = ?, message_count = ? WHERE id = ?",
                    (short_title, now, new_count, session_id)
                )
            else:
                cursor.execute(
                    "UPDATE sessions SET updated_at = ?, message_count = ? WHERE id = ?",
                    (now, new_count, session_id)
                )

        cursor.execute(
            "INSERT INTO messages (id, session_id, role, speaker, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (msg_id, session_id, role, speaker, content, now)
        )
        conn.commit()

    return {
        "id": msg_id,
        "session_id": session_id,
        "role": role,
        "speaker": speaker,
        "content": content,
        "timestamp": now
    }

def rename_session(session_id: str, new_title: str) -> bool:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", (new_title.strip(), time.time(), session_id))
        conn.commit()
        return cursor.rowcount > 0

def delete_session(session_id: str) -> bool:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        return cursor.rowcount > 0

def clear_all_history() -> bool:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages")
        cursor.execute("DELETE FROM sessions")
        conn.commit()
        return True

def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

# Backward compatibility alias
list_sessions = get_sessions

