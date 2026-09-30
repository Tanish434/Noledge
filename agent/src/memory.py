import os
import sys
import json
import logging
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional
from pathlib import Path

_src_dir = Path(__file__).parent.resolve()
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

logger = logging.getLogger("memory_manager")

MEM0_API_KEY = os.getenv("MEM0_API_KEY", "m0-3g3I6SbmNLfsDDGcRsiWPtGXH3Tu4k6XPUwaZn66").strip()
MEM0_BASE_URL = "https://api.mem0.ai/v1"

class Mem0Client:
    """Lightweight REST client for Mem0 Long-Term Memory platform."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or MEM0_API_KEY
        self.headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "application/json"
        }

    def _request(self, method: str, path: str, payload: Optional[Dict] = None, timeout: float = 1.0) -> Any:
        url = f"{MEM0_BASE_URL}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=self.headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="ignore")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            logger.warning(f"Mem0 API HTTP error {e.code} on {path}: {err_body}")
            return None
        except Exception as ex:
            logger.warning(f"Mem0 request error on {path}: {ex}")
            return None

    def get_memories(self, user_id: str = "Kirito") -> List[Dict[str, Any]]:
        res = self._request("GET", f"/memories/?user_id={user_id}")
        return res if isinstance(res, list) else []

    def search_memories(self, query: str, user_id: str = "Kirito", limit: int = 5) -> List[Dict[str, Any]]:
        res = self._request("POST", "/memories/search/", {
            "query": query,
            "user_id": user_id,
            "top_k": limit
        })
        return res if isinstance(res, list) else []

    def add_memory(self, text_or_messages: Any, user_id: str = "Kirito", metadata: Optional[Dict] = None) -> Any:
        payload: Dict[str, Any] = {"user_id": user_id}
        if isinstance(text_or_messages, str):
            payload["messages"] = [{"role": "user", "content": text_or_messages}]
        elif isinstance(text_or_messages, list):
            payload["messages"] = text_or_messages
        else:
            payload["text"] = str(text_or_messages)

        if metadata:
            payload["metadata"] = metadata
        return self._request("POST", "/memories/", payload)

    def delete_memory(self, memory_id: str) -> bool:
        res = self._request("DELETE", f"/memories/{memory_id}/")
        return res is not None

    def update_memory(self, memory_id: str, updated_text: str, user_id: str = "Kirito") -> bool:
        # Try direct PUT update on Mem0 API
        res = self._request("PUT", f"/memories/{memory_id}/", {"text": updated_text})
        if res is not None:
            return True
        # Robust fallback: delete old and add updated fact
        self.delete_memory(memory_id)
        add_res = self.add_memory(updated_text, user_id=user_id)
        return add_res is not None

PERMANENT_MEMORY_FILE = Path(__file__).parent / "permanent_memory.json"

class MemoryStore:
    """Unified permanent memory store combining local JSON persistence with Mem0 cloud synchronization."""

    def __init__(self, api_key: Optional[str] = None, local_file: Optional[Path] = None):
        self.api_key = api_key or MEM0_API_KEY
        self.local_file = local_file or PERMANENT_MEMORY_FILE
        self._mem0 = Mem0Client(self.api_key)
        self._cloud_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._cloud_cache_time: Dict[str, float] = {}

    def get_local_memories(self, user_id: str = "Kirito") -> List[Dict[str, Any]]:
        if self.local_file.exists():
            try:
                with open(self.local_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("memories", [])
            except Exception as e:
                logger.warning(f"Error reading {self.local_file}: {e}")
        return []

    def get_all(self, user_id: str = "Kirito", limit: int = 10) -> List[Dict[str, Any]]:
        local_mems = self.get_local_memories(user_id)
        results = [{"id": m.get("id"), "text": m.get("text"), "source": "local"} for m in local_mems if m.get("text")]

        # Use cloud cache if refreshed within 60s to prevent WebRTC latency spikes
        import time
        now = time.time()
        cached = self._cloud_cache.get(user_id)
        last_time = self._cloud_cache_time.get(user_id, 0.0)

        cloud_mems = None
        if cached is not None and (now - last_time < 60.0):
            cloud_mems = cached
        elif self.api_key:
            try:
                cloud_mems = self._mem0.get_memories(user_id=user_id)
                self._cloud_cache[user_id] = cloud_mems
                self._cloud_cache_time[user_id] = now
            except Exception as ce:
                logger.debug(f"Cloud memory sync note: {ce}")
                cloud_mems = cached or []

        if cloud_mems:
            for cm in cloud_mems[:limit]:
                t = (cm.get("memory") or cm.get("text") or "").strip()
                if t and not any(t.lower() == r["text"].lower() for r in results):
                    results.append({"id": cm.get("id"), "text": t, "source": "mem0_cloud"})
        return results

    def list_all(self, user_id: str = "Kirito") -> List[Dict[str, Any]]:
        return self.get_all(user_id=user_id, limit=100)

    def search(self, query: str, user_id: str = "Kirito", limit: int = 5) -> List[Dict[str, Any]]:
        q = (query or "").strip().lower()
        all_mems = self.get_all(user_id=user_id, limit=limit * 2)
        if not q:
            return all_mems[:limit]
        return [m for m in all_mems if q in m["text"].lower()][:limit]

    def add(self, text: str, user_id: str = "Kirito", category: str = "general") -> Dict[str, Any]:
        import uuid
        import time
        clean_text = text.strip()
        memories = self.get_local_memories(user_id)
        for m in memories:
            if m.get("text", "").strip().lower() == clean_text.lower():
                return m
        new_mem = {
            "id": f"mem_{uuid.uuid4().hex[:8]}",
            "text": clean_text,
            "category": category,
            "created_at": int(time.time())
        }
        memories.append(new_mem)
        try:
            with open(self.local_file, "w", encoding="utf-8") as f:
                json.dump({"user_id": user_id, "memories": memories}, f, indent=2)
        except Exception as e:
            logger.warning(f"Error saving to {self.local_file}: {e}")

        try:
            self._mem0.add_memory(clean_text, user_id=user_id, metadata={"category": category})
        except Exception as ce:
            logger.debug(f"Mem0 cloud add note: {ce}")

        return new_mem

    def delete(self, memory_id: str, user_id: str = "Kirito") -> bool:
        memories = self.get_local_memories(user_id)
        filtered = [m for m in memories if m.get("id") != memory_id]
        changed = len(filtered) != len(memories)
        if changed:
            try:
                with open(self.local_file, "w", encoding="utf-8") as f:
                    json.dump({"user_id": user_id, "memories": filtered}, f, indent=2)
            except Exception as e:
                logger.warning(f"Error updating {self.local_file}: {e}")

        try:
            self._mem0.delete_memory(memory_id)
        except Exception as ce:
            logger.debug(f"Mem0 cloud delete note: {ce}")
        return changed

    def update(self, memory_id: str, updated_text: str, user_id: str = "Kirito") -> bool:
        self.delete(memory_id, user_id=user_id)
        res = self.add(updated_text, user_id=user_id, category="facts")
        return bool(res)

    def clear(self, topic: Optional[str] = None, keep_primary_user_name: bool = True, user_id: str = "Kirito") -> int:
        memories = self.get_local_memories(user_id)
        remaining = []
        deleted_count = 0
        topic_lower = (topic or "").strip().lower()
        for m in memories:
            txt = m.get("text", "").lower()
            if keep_primary_user_name and ("primary user" in txt or "preferred name" in txt):
                remaining.append(m)
            elif topic_lower and topic_lower not in txt:
                remaining.append(m)
            else:
                deleted_count += 1
                mem_id = m.get("id")
                if mem_id is not None:
                    try:
                        self._mem0.delete_memory(str(mem_id))
                    except Exception:
                        pass
        try:
            with open(self.local_file, "w", encoding="utf-8") as f:
                json.dump({"user_id": user_id, "memories": remaining}, f, indent=2)
        except Exception as e:
            logger.warning(f"Error clearing {self.local_file}: {e}")
        return deleted_count

# Canonical instance
memory_store = MemoryStore()

# Backward-compatible references for external callers
def load_local_permanent_memories(user_id: str = "Kirito") -> List[Dict[str, Any]]:
    return memory_store.get_local_memories(user_id)

def save_local_permanent_memory(text: str, user_id: str = "Kirito", category: str = "general") -> Dict[str, Any]:
    return memory_store.add(text, user_id, category)

def delete_local_permanent_memory(memory_id: str, user_id: str = "Kirito") -> bool:
    return memory_store.delete(memory_id, user_id)

def get_mem0_client() -> Mem0Client:
    return memory_store._mem0


def get_seed_memory_context(user_id: str = "Kirito", limit: int = 8) -> str:
    """
    Retrieve permanent memory and user preferences to inject into the system prompt.
    Strictly separate from transient chat session history.
    """
    lines = []

    # 1. Primary User Identity
    try:
        from tools import get_current_user_name
        active_name = get_current_user_name() or user_id or "Kirito"
        lines.append(f"- Primary User Identity: {active_name}")
    except Exception:
        lines.append(f"- Primary User Identity: {user_id}")

    # 2. Favorite Visual Orbs / Avatars & Aliases
    try:
        import shaders
        prefs = shaders.load_preferences()
        favs = prefs.get("favorites", [])
        if favs:
            fav_names = []
            for f_key in favs:
                if f_key in shaders.SHADERS:
                    fav_names.append(f"{shaders.SHADERS[f_key]['name']} ({f_key.upper()})")
                else:
                    fav_names.append(f_key.upper())
            lines.append(f"- Favorite Visual Orbs / Avatars: {', '.join(fav_names)}")

        aliases = prefs.get("aliases", {})
        if aliases:
            alias_strs = [f"'{a}' -> {k.upper()}" for a, k in aliases.items()]
            lines.append(f"- Visual Orb Aliases: {', '.join(alias_strs)}")
    except Exception as se:
        logger.debug(f"Shader prefs fetch note: {se}")

    # 3. Permanent Long-term Memories & Facts
    try:
        all_mems = memory_store.get_all(user_id=user_id, limit=limit)
        for m in all_mems:
            t = m.get("text", "").strip()
            if t and not any(t.lower() in existing.lower() for existing in lines):
                lines.append(f"- {t}")
    except Exception as me:
        logger.debug(f"Permanent memory fetch note: {me}")

    if lines:
        return (
            "PERMANENT LONG-TERM USER MEMORY & PREFERENCES (Permanently Preserved Across All Sessions):\n"
            + "\n".join(lines)
            + "\nNOTE: These permanent memories and preferences are independent of conversation history and are NEVER deleted when clearing chat sessions."
        )
    return ""

GEMINI_TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "save_to_long_term_memory",
                "description": "Save an important fact, user preference, or discussion summary into Mem0 long term memory.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "fact": {
                            "type": "STRING",
                            "description": "The relevant user fact, preference, or summary to remember."
                        }
                    },
                    "required": ["fact"]
                }
            },
            {
                "name": "search_long_term_memory",
                "description": "Search the user's persistent long-term memories in Mem0.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {
                            "type": "STRING",
                            "description": "Search query or topic to look up."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "delete_long_term_memory",
                "description": "Delete a specific memory by its ID from long term memory.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "memory_id": {
                            "type": "STRING",
                            "description": "The ID of the memory item to delete."
                        }
                    },
                    "required": ["memory_id"]
                }
            },
            {
                "name": "list_chat_sessions",
                "description": "List all previous conversation sessions stored in local history.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "search_chat_history",
                "description": "Search across all conversation sessions and history for specific keywords, documents, certificates, files, or topics discussed.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {
                            "type": "STRING",
                            "description": "The search term, keyword, or document name to search for (e.g. 'certificate', 'bhoomi', 'invoice')."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "read_chat_session",
                "description": "Read the conversation messages and transcript of a past session to tell the user what was discussed.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "session_id": {
                            "type": "STRING",
                            "description": "The session ID to inspect."
                        }
                    },
                    "required": ["session_id"]
                }
            },
            {
                "name": "rename_chat_session",
                "description": "Rename a conversation session title in local storage.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "session_id": {
                            "type": "STRING",
                            "description": "Optional session ID to rename. If omitted, renames the active current chat session."
                        },
                        "new_title": {
                            "type": "STRING",
                            "description": "The new title for the chat session."
                        }
                    },
                    "required": ["new_title"]
                }
            },
            {
                "name": "update_long_term_memory",
                "description": "Update, modify, or rephrase an existing memory record. First call search_long_term_memory to retrieve the target memory_id, then call this tool with the updated, rephrased fact.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "memory_id": {
                            "type": "STRING",
                            "description": "The unique ID of the memory to update."
                        },
                        "updated_fact": {
                            "type": "STRING",
                            "description": "The newly rephrased, updated, or corrected fact to store."
                        }
                    },
                    "required": ["memory_id", "updated_fact"]
                }
            },
            {
                "name": "clear_long_term_memory",
                "description": "Wipe or purge memory records. Can delete an entire specific topic or category (e.g. 'videos', 'github', 'projects') or wipe all historical records while keeping primary user identity.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "topic": {
                            "type": "STRING",
                            "description": "Optional specific topic/part to clear (e.g. 'video', 'project', 'work'). If provided, only memories related to this topic are wiped. If omitted, all historical memories are wiped."
                        },
                        "keep_primary_user_name": {
                            "type": "BOOLEAN",
                            "description": "If true, preserves the user's primary name identity. Defaults to true."
                        }
                    }
                }
            },
            {
                "name": "create_new_chat_session",
                "description": "Start a brand new conversation session / new chat for the user immediately and clear the active view. Use this whenever the user asks to start a new chat, open a new chat, or begin a new discussion.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "load_chat_session",
                "description": "Load a previous session and switch active discussion to continue from it.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "session_id": {
                            "type": "STRING",
                            "description": "The session ID to load."
                        }
                    },
                    "required": ["session_id"]
                }
            },
            {
                "name": "delete_chat_session",
                "description": "Delete a specific conversation session or the current chat session from local database storage. Use this whenever the user asks to delete a chat, delete this session, or delete a past chat discussion.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "session_id": {
                            "type": "STRING",
                            "description": "Optional specific session ID to delete. If omitted or 'current', deletes the active conversation session."
                        },
                        "query": {
                            "type": "STRING",
                            "description": "Optional search term or title of the session to find and delete (e.g. 'the chat about python')."
                        }
                    }
                }
            },
            {
                "name": "clear_chat_history",
                "description": "Permanently delete and wipe ALL past chat sessions and conversation history from local database storage. ONLY use when the user EXPLICITLY asks to delete/clear/wipe ALL chats or sessions. NEVER use this for renaming a session (use rename_chat_session instead) or for a single session (use delete_chat_session).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "switch_orb_shader",
                "description": "Switch the visual 3D orb shader displayed on the site. Accepts shader IDs (e.g. 'shdr-01' through 'shdr-33'), aliases, or descriptive names like 'cut glass', 'disco ball', 'plasma', 'crystal', 'water', 'matrix', 'lego bricks', 'godrays', 'galaxy'.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "variant_or_query": {
                            "type": "STRING",
                            "description": "The shader ID, alias, or description of the shader to switch to."
                        }
                    },
                    "required": ["variant_or_query"]
                }
            },
            {
                "name": "manage_shader_preferences",
                "description": "Save or manage shader aliases and favorite shaders in internal memory without altering frontend code.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action": {
                            "type": "STRING",
                            "description": "The action: 'set_alias', 'remove_alias', 'mark_favorite', 'remove_favorite', or 'list_preferences'."
                        },
                        "shader_id": {
                            "type": "STRING",
                            "description": "The target shader ID or name (required for set_alias, mark_favorite, remove_favorite)."
                        },
                        "alias": {
                            "type": "STRING",
                            "description": "The custom nickname or alias to assign to the shader (required for set_alias, remove_alias)."
                        }
                    },
                    "required": ["action"]
                }
            },
            {
                "name": "search_and_load_chat",
                "description": "Search past chat sessions by topic or past discussion content, and immediately load and switch the view to that conversation.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {
                            "type": "STRING",
                            "description": "The topic, keyword, or summary of the chat to search for and load."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "get_user_analytics_and_status",
                "description": "Inspect and report comprehensive system status and user analytics: active voice persona, currently selected STT and TTS engines, active AI model, visual 3D orb shader, conversation metrics, and API key quota status.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "get_system_settings",
                "description": "Inspect and retrieve current system settings, active STT, active TTS, selected voice, LLM model, OCR state, and available engine options.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "modify_system_settings",
                "description": "Change or update system settings, including switching STT ('livekit', 'speechmatics', 'elevenlabs', 'google', 'browser'), switching TTS ('cartesia', 'elevenlabs', 'google', 'livekit', 'browser'), changing active voice ('sarah', 'rachel', 'casper', 'puck', etc.), changing LLM model ('gemini-3.5-flash-lite', 'gemini-3.5-flash', etc.), or toggling OCR.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "stt": {
                            "type": "STRING",
                            "description": "Optional speech-to-text engine: 'livekit', 'speechmatics', 'cartesia', 'elevenlabs', or 'google'."
                        },
                        "tts": {
                            "type": "STRING",
                            "description": "Optional text-to-speech engine: 'cartesia', 'elevenlabs', 'google', or 'livekit'."
                        },
                        "voice": {
                            "type": "STRING",
                            "description": "Optional voice name or ID (e.g. 'Sarah', 'Rachel', 'Bella', 'Adam', 'Casper', 'Puck', 'Charon', 'Journey Female')."
                        },
                        "llm": {
                            "type": "STRING",
                            "description": "Optional Gemini LLM model: 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-lite-latest', etc."
                        },
                        "enable_ocr": {
                            "type": "BOOLEAN",
                            "description": "Optional boolean to enable or disable multimodal OCR analysis."
                        }
                    }
                }
            },
            {
                "name": "switch_speech_engine",
                "description": "Backward-compatible tool to dynamically switch STT, TTS, or voice.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "stt": {
                            "type": "STRING",
                            "description": "Speech-to-text engine: 'speechmatics', 'livekit', 'cartesia', 'elevenlabs'."
                        },
                        "tts": {
                            "type": "STRING",
                            "description": "Text-to-speech engine: 'cartesia', 'elevenlabs', or 'livekit'."
                        },
                        "voice": {
                            "type": "STRING",
                            "description": "Optional voice name or ID (e.g. 'Sarah', 'Rachel')."
                        }
                    }
                }
            },
            {
                "name": "manage_api_keys",
                "description": "Cleanly add, remove, list, or activate API keys for multiple accounts across services (Cartesia, ElevenLabs, Gemini, Speechmatics) without exposing sensitive tokens.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action": {
                            "type": "STRING",
                            "description": "The operation: 'list', 'add', 'remove', or 'set_active'."
                        },
                        "service": {
                            "type": "STRING",
                            "description": "The target service: 'cartesia', 'elevenlabs', 'gemini', 'speechmatics', or 'livekit'."
                        },
                        "api_key": {
                            "type": "STRING",
                            "description": "The API key token (required for 'add' or 'set_active' by key)."
                        },
                        "api_secret": {
                            "type": "STRING",
                            "description": "Optional API secret token (required for LiveKit accounts)."
                        },
                        "url": {
                            "type": "STRING",
                            "description": "Optional WebSocket URL (e.g. 'wss://...', used for LiveKit accounts)."
                        },
                        "account_label": {
                            "type": "STRING",
                            "description": "Optional friendly label for the account (e.g. 'Personal Account 2', 'Work LiveKit')."
                        }
                    },
                    "required": ["action", "service"]
                }
            },
            {
                "name": "manage_speakers",
                "description": "Enroll, list, rename, or delete recognized speaker voice profiles (e.g. Kirito S1, Keshav S2, etc.). Use this when an unknown speaker introduces themselves, when the user asks who is enrolled, or wants to rename or delete a secondary speaker profile.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action": {
                            "type": "STRING",
                            "description": "The speaker action: 'enroll' (add new speaker from current voice), 'list' (show all speakers), 'rename' (rename speaker), or 'delete' (remove speaker profile)."
                        },
                        "name": {
                            "type": "STRING",
                            "description": "The person's name (required for 'enroll' or 'rename', or to identify which speaker to delete/rename)."
                        },
                        "label_id": {
                            "type": "STRING",
                            "description": "Optional speaker label ID (e.g. 'S1', 'S2', 'S3')."
                        }
                    },
                    "required": ["action"]
                }
            },
            {
                "name": "set_user_name",
                "description": "Save or update the user's primary name identity when they tell you their name or ask you to call them by a name. This persists their name across sessions, updates speakers.json, and immediately changes the UI header badge.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "name": {
                            "type": "STRING",
                            "description": "The user's preferred first or full name (e.g. 'Kirito', 'John', 'Sarah')."
                        }
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "get_active_study_question",
                "description": "Retrieve the current active study question details from the user's Noledge session, including question title, type, content, options, correct answer, explanation, and hints.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "get_user_code_buffer",
                "description": "Inspect the user's current live code editor buffer for the active code question.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "judge_code_correctness",
                "description": "Evaluate and judge the user's written code against the current code question. Strictly checks if the code is correct or incorrect, identifies exact bugs/errors if any, and returns an objective score and verdict without lecturing.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "code": {
                            "type": "STRING",
                            "description": "Optional code string to evaluate. If omitted, evaluates the current live editor buffer."
                        }
                    }
                }
            },
            {
                "name": "submit_question_answer",
                "description": "Submit a verdict and score for the active study question (e.g. after the user answers verbally in a voice question, or when judging code). Updates the study session progress.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "is_correct": {
                            "type": "BOOLEAN",
                            "description": "Whether the user's answer is correct."
                        },
                        "user_answer": {
                            "type": "STRING",
                            "description": "The user's spoken or submitted answer."
                        },
                        "feedback": {
                            "type": "STRING",
                            "description": "Brief, objective feedback explaining why it is correct or incorrect. Do not lecture."
                        }
                    },
                    "required": ["is_correct", "user_answer"]
                }
            },
            {
                "name": "navigate_study_card",
                "description": "Navigate between flashcards in the study session. Actions: 'next' (next card), 'prev' (previous card), 'flip' (flip/reveal card).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action": {
                            "type": "STRING",
                            "description": "The navigation action: 'next', 'prev', or 'flip'."
                        }
                    },
                    "required": ["action"]
                }
            },
            {
                "name": "manage_site_deck",
                "description": "Create, list, delete, or sort flashcard decks on the Noledge website. Use when the user asks to create/delete/list/sort decks.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action": {
                            "type": "STRING",
                            "description": "Deck action: create_deck, delete_deck, get_decks, sort_deck."
                        },
                        "name": {
                            "type": "STRING",
                            "description": "Deck name (required for create)."
                        },
                        "deck_id": {
                            "type": "STRING",
                            "description": "Deck ID or name (required for delete/sort)."
                        },
                        "description": {
                            "type": "STRING",
                            "description": "Optional deck description."
                        },
                        "sort_by": {
                            "type": "STRING",
                            "description": "Sort key for sort_deck: difficulty, type, title."
                        }
                    },
                    "required": ["action"]
                }
            },
            {
                "name": "manage_site_question",
                "description": "Add, edit, delete, move, or convert flashcard questions across all 10 question types on the website.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action": {
                            "type": "STRING",
                            "description": "Question action: add_question, edit_question, delete_question, move_question, change_question_type."
                        },
                        "deck_id": {
                            "type": "STRING",
                            "description": "Target deck ID."
                        },
                        "question_id": {
                            "type": "STRING",
                            "description": "Question ID (for edit/delete/move/convert)."
                        },
                        "type": {
                            "type": "STRING",
                            "description": "Question type: mcq, tf, multi, typing, voice, image-select, match, fill, order, code."
                        },
                        "content": {
                            "type": "STRING",
                            "description": "Question prompt text."
                        },
                        "answer": {
                            "type": "STRING",
                            "description": "Correct answer."
                        },
                        "explanation": {
                            "type": "STRING",
                            "description": "Explanation."
                        },
                        "target_deck_id": {
                            "type": "STRING",
                            "description": "Destination deck for move_question."
                        },
                        "new_type": {
                            "type": "STRING",
                            "description": "New type for change_question_type."
                        }
                    },
                    "required": ["action"]
                }
            },
            {
                "name": "control_site_app",
                "description": "Navigate website pages (/study, /manage, /create, /settings) or toggle light/dark theme.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action": {
                            "type": "STRING",
                            "description": "App action: navigate_to or change_theme."
                        },
                        "path": {
                            "type": "STRING",
                            "description": "Target route: /study, /manage, /create, /settings, /."
                        },
                        "theme": {
                            "type": "STRING",
                            "description": "Theme: light or dark."
                        }
                    },
                    "required": ["action"]
                }
            }
        ]
    }
]

def execute_gemini_tool(
    tool_name: str,
    args: Dict[str, Any],
    user_id: str = "Kirito",
    current_session_id: Optional[str] = None,
    current_audio_pcm: Optional[bytes] = None,
    current_speaker: Optional[str] = None
) -> Dict[str, Any]:
    """Execute a function call requested by Gemini and return structured result."""
    import history
    import tools
    logger.info(f"🛠️ Executing Gemini Tool: {tool_name} with args: {args}")

    # ==========================================
    # Permanent Long-Term Memory Tools
    # ==========================================
    if tool_name == "save_to_long_term_memory":
        fact = args.get("fact", "").strip()
        if not fact:
            return {"status": "error", "message": "No fact provided."}
        res = memory_store.add(fact, user_id=user_id, category="facts")
        return {"status": "success", "message": f"Successfully saved to permanent memory: '{fact}'. This will be preserved across all future sessions.", "details": res}

    elif tool_name == "search_long_term_memory":
        query = args.get("query", "").strip()
        matches = memory_store.search(query, user_id=user_id)
        formatted = [{"id": m["id"], "memory": m["text"], "source": m.get("source", "permanent")} for m in matches]
        return {"status": "success", "query": query, "results": formatted}

    elif tool_name == "delete_long_term_memory":
        mem_id = args.get("memory_id", "").strip()
        success = memory_store.delete(mem_id, user_id=user_id)
        return {"status": "success" if success else "error", "message": f"Memory {mem_id} deleted" if success else "Failed to delete memory"}

    elif tool_name == "update_long_term_memory":
        mem_id = args.get("memory_id", "").strip()
        updated_fact = args.get("updated_fact", "").strip()
        if not mem_id or not updated_fact:
            return {"status": "error", "message": "Missing memory_id or updated_fact."}
        success = memory_store.update(mem_id, updated_fact, user_id=user_id)
        return {
            "status": "success" if success else "error",
            "message": f"Successfully updated memory {mem_id} to: '{updated_fact}'" if success else "Failed to update memory"
        }

    elif tool_name == "clear_long_term_memory":
        topic = (args.get("topic") or "").strip()
        keep_name = args.get("keep_primary_user_name", True)
        deleted_count = memory_store.clear(topic=topic, keep_primary_user_name=keep_name, user_id=user_id)
        scope = f"related to '{topic}'" if topic else "all historical"
        return {"status": "success", "message": f"Purged {deleted_count} permanent memory records {scope} for user {user_id}."}

    # ==========================================
    # Chat Session & Conversation History Tools
    # ==========================================
    elif tool_name == "list_chat_sessions":
        sessions = history.get_sessions()
        formatted = [{"id": s["id"], "title": s["title"], "message_count": s["message_count"]} for s in sessions[:10]]
        count = len(formatted)
        if count == 0:
            summary_msg = "You currently have no saved chat sessions."
        elif count == 1:
            summary_msg = f"You have 1 chat session: '{formatted[0]['title']}'."
        else:
            titles = ", ".join([f"'{s['title']}'" for s in formatted[:3]])
            summary_msg = f"You have {count} chat sessions, including {titles}."
        return {"status": "success", "total_sessions": count, "sessions": formatted, "message": summary_msg}

    elif tool_name == "search_chat_history":
        query = (args.get("query") or "").strip()
        if not query:
            return {"status": "error", "message": "query is required to search chat history."}
        matches = history.search_sessions(query, limit=5)
        if not matches:
            return {"status": "success", "results": [], "message": f"No chat history matching '{query}' was found."}
        detailed = []
        for m in matches:
            msgs = history.get_session_messages(m["id"])
            matching_msgs = [msg["content"] for msg in msgs if query.lower() in msg["content"].lower()][:3]
            detailed.append({
                "session_id": m["id"],
                "title": m["title"],
                "matching_snippets": matching_msgs
            })
        return {
            "status": "success",
            "query": query,
            "results": detailed,
            "message": f"Found {len(matches)} chat session(s) mentioning '{query}'."
        }

    elif tool_name == "read_chat_session":
        ident = (args.get("query") or args.get("session_id") or "").strip()
        target = history.resolve_session(ident, current_session_id=current_session_id, fallback_to_current=True)
        if not target:
            recent = history.get_sessions()
            if recent:
                target = recent[0]
        if not target:
            return {"status": "error", "message": "No chat sessions found to inspect."}
        messages = history.get_session_messages(target["id"])
        return {
            "status": "success",
            "session_id": target["id"],
            "session_title": target.get("title"),
            "messages": messages
        }

    elif tool_name == "rename_chat_session":
        ident = (args.get("query") or args.get("session_id") or "").strip()
        new_title = (args.get("new_title") or "").strip()
        if not new_title:
            return {"status": "error", "message": "new_title is required to rename a chat session."}
        target = history.resolve_session(ident, current_session_id=current_session_id, fallback_to_current=True)
        if not target:
            return {"status": "error", "message": "No active or specified chat session found to rename."}
        ok = history.rename_session(target["id"], new_title)
        return {
            "status": "success" if ok else "error",
            "action": "rename_session",
            "session_id": target["id"],
            "new_title": new_title,
            "message": f"Successfully renamed chat session to '{new_title}'." if ok else "Failed to rename chat session."
        }

    elif tool_name == "create_new_chat_session":
        # Persist a real empty session so history never loses the new chat.
        try:
            created = history.create_session(title=None)
            new_sid = created.get("id")
        except Exception:
            import uuid
            from datetime import datetime
            new_sid = f"sess_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
        return {
            "status": "success",
            "session_id": new_sid,
            "action": "switch_session",
            "message": f"Successfully initiated fresh session {new_sid}. You are now in a clean new chat."
        }

    elif tool_name in ("load_chat_session", "search_and_load_chat"):
        ident = (args.get("session_id") or args.get("query") or "").strip()
        target = history.resolve_session(ident, current_session_id=current_session_id)
        if not target:
            recent = history.get_sessions()
            recent_titles = [f"'{s['title']}'" for s in recent[:3]]
            return {
                "status": "not_found",
                "message": f"Could not find a session matching '{ident}'. Available sessions: {', '.join(recent_titles) if recent_titles else 'None'}."
            }
        return {
            "status": "success",
            "session_id": target["id"],
            "session_title": target["title"],
            "action": "switch_session",
            "message": f"Successfully loaded and switched to chat session '{target['title']}' ({target['id']})."
        }

    elif tool_name == "delete_chat_session":
        sid = (args.get("session_id") or "").strip()
        query = (args.get("query") or "").strip()
        ident = query or sid
        exclude = current_session_id if query else None
        fallback = (not query)
        target = history.resolve_session(ident, exclude_id=exclude, current_session_id=current_session_id, fallback_to_current=fallback)
        if not target:
            return {"status": "error", "message": f"Could not find any chat session matching '{ident}' to delete."}

        target_id = target["id"]
        target_title = target.get("title", target_id)
        ok = history.delete_session(target_id)
        is_current = (target_id == current_session_id)
        new_sid = None
        if is_current:
            try:
                new_sid = history.create_session(title=None).get("id")
            except Exception:
                import uuid
                from datetime import datetime
                new_sid = f"sess_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"

        return {
            "status": "success" if ok else "error",
            "action": "delete_session",
            "session_id": target_id,
            "session_title": target_title,
            "is_current": is_current,
            "new_session_id": new_sid,
            "message": f"Successfully deleted chat session '{target_title}'." if ok else f"Failed to delete chat session '{target_id}'."
        }

    elif tool_name == "clear_chat_history":
        ok = history.clear_all_history()
        try:
            new_sid = history.create_session(title=None).get("id")
        except Exception:
            import uuid
            from datetime import datetime
            new_sid = f"sess_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
        return {
            "status": "success" if ok else "error",
            "action": "clear_history",
            "new_session_id": new_sid,
            "message": "Successfully wiped all past chat sessions and conversations from history. All permanent memories, user facts, and favorite avatar preferences remain safely preserved."
        }

    # ==========================================
    # Visual Shader & Orb Control Tools
    # ==========================================
    elif tool_name == "switch_orb_shader":
        import shaders
        query = args.get("variant_or_query", "").strip()
        resolved = shaders.resolve_shader(query)
        if not resolved:
            return {
                "status": "error",
                "message": f"Could not find a shader matching '{query}'. Available styles include Cut Glass (shdr-01), Plasma Globe (shdr-13), Matrix CRT (shdr-23), Cosmic Galaxy (shdr-32), Volumetric Godrays (shdr-31), etc."
            }
        skey, meta = resolved
        return {
            "status": "success",
            "action": "switch_shader",
            "variant": skey,
            "shader_name": meta["name"],
            "message": f"Switched visual orb shader to {meta['name']} ({skey})."
        }

    elif tool_name == "manage_shader_preferences":
        import shaders
        action = args.get("action", "").lower().strip()
        shader_id = args.get("shader_id", "").strip()
        alias = args.get("alias", "").strip()

        if action == "set_alias":
            if not alias or not shader_id:
                return {"status": "error", "message": "Both alias and shader_id are required to set an alias."}
            ok = shaders.set_shader_alias(alias, shader_id)
            if ok:
                memory_store.add(f"User created shader alias: '{alias}' refers to shader '{shader_id}'", user_id=user_id, category="preferences")
                return {"status": "success", "message": f"Alias '{alias}' mapped to {shader_id} in internal memory."}
            return {"status": "error", "message": f"Shader '{shader_id}' not found."}

        elif action == "remove_alias":
            if not alias:
                return {"status": "error", "message": "Alias is required to remove."}
            ok = shaders.remove_shader_alias(alias)
            return {"status": "success" if ok else "error", "message": f"Removed alias '{alias}'." if ok else "Alias not found."}

        elif action == "mark_favorite":
            if not shader_id:
                return {"status": "error", "message": "shader_id is required."}
            ok = shaders.set_shader_favorite(shader_id, True)
            if ok:
                s_name = shaders.SHADERS.get(shader_id, {}).get("name", shader_id)
                fact_str = f"User's favorite visual orb shader / avatar is {s_name} ({shader_id.upper()})."
                memory_store.add(fact_str, user_id=user_id, category="preferences")
                return {"status": "success", "message": f"Marked shader {s_name} ({shader_id}) as favorite in permanent memory."}
            return {"status": "error", "message": f"Shader '{shader_id}' not found."}

        elif action == "remove_favorite":
            if not shader_id:
                return {"status": "error", "message": "shader_id is required."}
            ok = shaders.set_shader_favorite(shader_id, False)
            return {"status": "success" if ok else "error", "message": f"Removed {shader_id} from favorites." if ok else "Shader not found."}

        elif action == "list_preferences":
            prefs = shaders.load_preferences()
            fav_names = []
            for f in prefs.get("favorites", []):
                name = shaders.SHADERS.get(f, {}).get("name", f)
                fav_names.append(f"{name} ({f.upper()})")
            return {
                "status": "success",
                "favorites": prefs.get("favorites", []),
                "favorite_names": fav_names,
                "aliases": prefs.get("aliases", {}),
                "message": f"User's favorite orbs/avatars: {', '.join(fav_names) if fav_names else 'None'}."
            }

        return {"status": "error", "message": f"Unknown action: {action}"}

    # ==========================================
    # Hardware & Audio Engine Control Tools
    # ==========================================
    elif tool_name == "get_user_analytics_and_status":
        import tools
        import history
        import shaders
        cfg = tools.load_engine_config()
        stt_info = tools.get_active_stt_info()
        tts_info = tools.get_active_tts_info()
        sessions = history.get_sessions()
        total_turns = sum(s.get("message_count", 0) for s in sessions)
        current_voice = cfg.get("selected_voice", "Default")
        active_tts = cfg.get("selected_tts", "cartesia")
        v_list = tools.VOICE_REGISTRIES.get(active_tts, [])
        v_name = next((v["name"] for v in v_list if v["id"] == current_voice), current_voice)
        current_stt = cfg.get("selected_stt", "livekit")
        current_llm = cfg.get("selected_llm", "gemini-3.5-flash-lite")
        cur_shader_key = shaders.load_preferences().get("active_shader", "shdr-31")
        cur_shader_name = shaders.SHADERS.get(cur_shader_key, {}).get("name", cur_shader_key)

        msg = (
            f"Here is your existing system status and analytics:\n"
            f"• Active Voice: {v_name} ({active_tts.title()})\n"
            f"• Speech-to-Text: {stt_info.get('name', current_stt.title())}\n"
            f"• Text-to-Speech: {tts_info.get('name', active_tts.title())}\n"
            f"• AI Model: {current_llm}\n"
            f"• Visual 3D Orb: {cur_shader_name} ({cur_shader_key.upper()})\n"
            f"• Total Conversations: {len(sessions)} sessions ({total_turns} messages recorded)\n"
            f"• Permanent Facts: {len(memory_store.list_all(user_id=user_id))} memories saved"
        )
        return {
            "status": "success",
            "active_voice": v_name,
            "selected_tts": active_tts,
            "selected_stt": current_stt,
            "selected_llm": current_llm,
            "active_shader": cur_shader_name,
            "total_sessions": len(sessions),
            "total_messages": total_turns,
            "message": msg
        }

    elif tool_name == "get_system_settings":
        import tools
        return tools.get_settings_overview()

    elif tool_name in ("modify_system_settings", "switch_speech_engine"):
        import tools
        stt = args.get("stt")
        tts = args.get("tts")
        voice = args.get("voice")
        llm = args.get("llm")
        enable_ocr = args.get("enable_ocr")
        res = tools.switch_engines(stt=stt, tts=tts, voice=voice, llm=llm, enable_ocr=enable_ocr)
        return res

    elif tool_name == "manage_api_keys":
        import tools
        action = args.get("action", "").strip()
        service = args.get("service", "").strip()
        api_key = args.get("api_key")
        api_secret = args.get("api_secret")
        url = args.get("url")
        account_label = args.get("account_label")
        res = tools.manage_api_keys_pool(
            action=action,
            service=service,
            api_key=api_key,
            api_secret=api_secret,
            url=url,
            account_label=account_label
        )
        return res

    elif tool_name == "manage_speakers":
        import tools
        action = (args.get("action") or "list").strip().lower()
        name = (args.get("name") or "").strip()
        label_id = (args.get("label_id") or "").strip()
        enroll_pcm = current_audio_pcm
        if action in ("enroll", "add"):
            # If the current speaking voice is verified as the primary owner (Kirito),
            # and is creating a profile for someone else (not themselves):
            is_self = (name.strip().lower() in (user_id.strip().lower(), "kirito") or (label_id and label_id.strip().upper() == "S1"))
            if current_speaker and current_speaker.lower() == user_id.lower() and not is_self:
                logger.info(f"Primary owner {user_id} is enrolling {name}; preserving owner audio by enrolling without audio_pcm.")
                enroll_pcm = None

        res = tools.manage_speakers(
            action=action,
            name=name,
            label_id=label_id,
            audio_pcm=enroll_pcm
        )
        return res

    elif tool_name == "set_user_name":
        import tools
        new_name = args.get("name", "").strip().title()
        if not new_name:
            return {"status": "error", "message": "Please provide a valid user name."}

        # If the speaking voice is unverified, unknown, or a guest (NOT the primary user),
        # NEVER overwrite S1 (Kirito)! Instead, enroll them as a secondary speaker profile!
        is_guest_or_unknown = (
            current_speaker is not None and
            (current_speaker.lower() in ["unknown", "guest", "unverified"] or
             (current_speaker != user_id and current_speaker != "Kirito"))
        )
        is_self = new_name.lower() in ("kirito", user_id.lower())
        if is_guest_or_unknown and not is_self:
            logger.info(f"Redirecting set_user_name to enroll_new_speaker for guest voice: {new_name}")
            return tools.manage_speakers(action="enroll", name=new_name, audio_pcm=current_audio_pcm)

        ok = tools.set_primary_user_name(new_name)
        if current_audio_pcm:
            tools.VoiceBiometricManager.get_instance().enroll_new_speaker(name=new_name, audio_pcm=current_audio_pcm, label_id="S1")
        if ok:
            memory_store.add(f"The primary user's preferred name identity is {new_name}.", user_id=new_name, category="identity")
            return {
                "status": "success",
                "action": "set_user_name",
                "user_name": new_name,
                "is_primary": True,
                "label_id": "S1",
                "message": f"Successfully updated your primary user identity to {new_name} and calibrated voice biometrics."
            }
        return {"status": "error", "message": "Failed to update user profile in speakers storage."}

    # ==========================================
    # Study Session & Code/Voice Question Tools
    # ==========================================
    elif tool_name == "get_active_study_question":
        ctx = tools.get_active_study_context()
        q = ctx.get("question")
        if not q:
            return {"status": "error", "message": "No active study question currently loaded in the session."}
        return {
            "status": "success",
            "question_id": q.get("id"),
            "type": q.get("type"),
            "content": q.get("content"),
            "options": q.get("options"),
            "answer": q.get("answer"),
            "explanation": q.get("explanation"),
            "hints": q.get("hints"),
            "code_language": q.get("code_language", "python"),
            "deck_name": ctx.get("deck_name", "")
        }

    elif tool_name == "get_user_code_buffer":
        ctx = tools.get_active_study_context()
        code = ctx.get("code_buffer", "")
        q = ctx.get("question") or {}
        return {
            "status": "success",
            "code": code,
            "language": q.get("code_language", "python"),
            "question_content": q.get("content", ""),
            "expected_answer": q.get("answer", "")
        }

    elif tool_name == "judge_code_correctness":
        ctx = tools.get_active_study_context()
        code = args.get("code") or ctx.get("code_buffer", "")
        q = ctx.get("question")
        if not code.strip():
            return {"status": "error", "message": "No code provided or editor buffer is empty."}
        res = tools.judge_code_with_llm(code, q)
        return {
            "status": "success",
            "action": "code_judged",
            "is_correct": res["is_correct"],
            "score": res["score"],
            "feedback": res["feedback"]
        }

    elif tool_name == "submit_question_answer":
        is_corr = bool(args.get("is_correct"))
        u_ans = str(args.get("user_answer", ""))
        fb = str(args.get("feedback", ""))
        return {
            "status": "success",
            "action": "submit_answer",
            "is_correct": is_corr,
            "user_answer": u_ans,
            "feedback": fb,
            "message": f"Answer recorded as {'correct' if is_corr else 'incorrect'}: {fb}"
        }

    elif tool_name == "navigate_study_card":
        act = args.get("action", "next")
        return {
            "status": "success",
            "action": "navigate_card",
            "direction": act,
            "message": f"Navigating card: {act}"
        }

    # ==========================================
    # Website Feature Tools (forwarded to Next.js client via site_action)
    # ==========================================
    elif tool_name == "manage_site_deck":
        import tools as _t
        return _t.manage_site_deck(
            action=args.get("action", ""),
            name=args.get("name"),
            deck_id=args.get("deck_id"),
            description=args.get("description"),
            tags=args.get("tags"),
            sort_by=args.get("sort_by"),
        )

    elif tool_name == "manage_site_question":
        import tools as _t
        return _t.manage_site_question(
            action=args.get("action", ""),
            deck_id=args.get("deck_id"),
            question_id=args.get("question_id"),
            type=args.get("type"),
            content=args.get("content"),
            answer=args.get("answer"),
            explanation=args.get("explanation"),
            options=args.get("options"),
            code_language=args.get("code_language"),
            new_type=args.get("new_type"),
            target_deck_id=args.get("target_deck_id"),
        )

    elif tool_name == "control_site_app":
        import tools as _t
        return _t.control_site_app(
            action=args.get("action", ""),
            path=args.get("path"),
            theme=args.get("theme"),
        )

    return {"status": "error", "message": f"Unknown tool: {tool_name}"}

