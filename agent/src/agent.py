import os
import sys
import re
import json
import time
import uuid
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv

_src_dir = Path(__file__).parent.resolve()
_agent_dir = _src_dir.parent.resolve()
load_dotenv(_agent_dir / ".env", override=True)
load_dotenv(_agent_dir / ".env.local", override=True)

for _p in [str(_src_dir), str(_agent_dir)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

if hasattr(sys.stdout, 'reconfigure'):
    try:
        getattr(sys.stdout, 'reconfigure')(encoding='utf-8')
        getattr(sys.stderr, 'reconfigure')(encoding='utf-8')
    except Exception:
        pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("agent_worker")

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    llm,
    ChatContext,
    AgentConfigUpdate,
    DEFAULT_API_CONNECT_OPTIONS
)
from livekit.agents.voice.room_io import RoomOptions
from livekit.plugins import silero
try:
    from livekit.plugins import elevenlabs
except Exception:
    elevenlabs = None

try:
    from livekit.plugins import cartesia
except Exception:
    cartesia = None

try:
    from livekit.plugins import speechmatics
except Exception:
    speechmatics = None

import urllib.request
import urllib.error

import tools
from tools import (
    get_stt,
    get_tts,
    get_active_stt_info,
    get_active_tts_info,
    save_engine_config,
    reset_cached_stt,
    reset_cached_tts,
    get_current_user_name,
    VoiceBiometricManager,
    get_all_active_gemini_api_keys,
    get_active_gemini_api_key,
    mark_gemini_key_rate_limited,
    mark_gemini_key_invalid,
    is_valid_token
)
import history
from memory import GEMINI_TOOLS, execute_gemini_tool, get_seed_memory_context
from cleaner import StreamSpeechFilter

recently_broadcast_assistant = set()

class GeminiLLMStream(llm.LLMStream):
    async def _run(self) -> None:
        contents = []
        system_instruction = None

        # Determine active session ID
        active_sid = getattr(self._llm, "_current_session_id", None)
        if not active_sid and hasattr(self._llm, "_session_state") and self._llm._session_state:
            active_sid = self._llm._session_state.get("id")

        user_name = getattr(self._llm, "_current_user", "Kirito")
        active_model = getattr(self._llm, "model", "gemini-3.5-flash-lite") or "gemini-3.5-flash-lite"
        mem_seed = await asyncio.to_thread(get_seed_memory_context, user_name)
        active_speaker = getattr(self._llm, "_last_turn_speaker", None) or (self._llm._session_state.get("last_turn_speaker") if hasattr(self._llm, "_session_state") else None) or user_name
        active_verified = getattr(self._llm, "_last_turn_verified", None)
        if active_verified is None and hasattr(self._llm, "_session_state"):
            active_verified = self._llm._session_state.get("last_turn_verified", True)
        if active_verified is None:
            active_verified = True

        # 1. Load persistent session history from SQLite DB (bounded to last 30 msgs to cap latency).
        seen_entries = set()
        if active_sid:
            try:
                db_msgs = await asyncio.to_thread(history.get_session_messages, active_sid)
                # Bound context: last 30 messages max, each truncated to 2000 chars.
                if len(db_msgs) > 30:
                    db_msgs = db_msgs[-30:]
                for dm in db_msgs:
                    d_role = dm.get("role", "user")
                    d_speaker = dm.get("speaker") or ("Kirito" if d_role == "user" else "aliph1")
                    d_text = (dm.get("content") or "").strip()
                    if not d_text:
                        continue
                    if len(d_text) > 2000:
                        d_text = d_text[:2000] + "… [truncated]"
                    role_key = "user" if d_role == "user" else "model"
                    if role_key == "user":
                        d_spk_str = str(d_speaker).strip()
                        d_spk_lower = d_spk_str.lower()
                        if d_spk_lower in ["unknown", "guest", "unverified"]:
                            formatted_text = f"[{d_spk_str} (Guest/Unrecognized Speaker)]: {d_text}"
                        elif d_spk_str.lower() == user_name.lower() or d_spk_str.lower() == "kirito":
                            formatted_text = f"[{user_name}]: {d_text}"
                        else:
                            formatted_text = f"[{d_spk_str} (Enrolled Speaker)]: {d_text}"
                    else:
                        formatted_text = d_text
                    contents.append({"role": role_key, "parts": [{"text": formatted_text}]})
                    norm_key = re.sub(r'\s+', ' ', d_text).strip().lower()
                    seen_entries.add((role_key, norm_key))
            except Exception as dbe:
                logger.debug(f"Error loading session history for LLM: {dbe}")

        # 2. Append in-flight turns from live WebRTC ChatContext if not already in DB
        msgs = self._chat_ctx.messages() if callable(self._chat_ctx.messages) else self._chat_ctx.messages
        for m in msgs:
            text = " ".join(str(x) for x in m.content) if isinstance(m.content, list) else str(m.content)
            clean_text = text.strip()
            if not clean_text:
                continue
            if m.role == "system":
                system_instruction = clean_text
            elif m.role == "user":
                norm_key = re.sub(r'\s+', ' ', clean_text).strip().lower()
                if ("user", norm_key) not in seen_entries:
                    act_spk_str = str(active_speaker).strip()
                    act_spk_lower = act_spk_str.lower()
                    if act_spk_lower in ["unknown", "guest", "unverified"] or not active_verified:
                        formatted_text = f"[{act_spk_str} (Guest/Unrecognized Speaker)]: {clean_text}"
                    elif act_spk_str.lower() == user_name.lower() or act_spk_str.lower() == "kirito":
                        formatted_text = f"[{user_name}]: {clean_text}"
                    else:
                        formatted_text = f"[{act_spk_str} (Enrolled Speaker)]: {clean_text}"
                    contents.append({"role": "user", "parts": [{"text": formatted_text}]})
                    seen_entries.add(("user", norm_key))
            elif m.role == "assistant":
                norm_key = re.sub(r'\s+', ' ', clean_text).strip().lower()
                if ("model", norm_key) not in seen_entries:
                    contents.append({"role": "model", "parts": [{"text": clean_text}]})
                    seen_entries.add(("model", norm_key))
        mgr = VoiceBiometricManager.get_instance()
        enrolled_speakers = mgr.list_speakers()
        enrolled_summary_lines = []
        for s in enrolled_speakers:
            role_desc = "Primary Owner & User" if s.get("is_primary") else "Enrolled Secondary Speaker"
            enrolled_summary_lines.append(f"- {s.get('label_id', 'S?')}: {s.get('name', 'User')} ({role_desc})")
        enrolled_summary_str = "\n".join(enrolled_summary_lines) if enrolled_summary_lines else "- S1: Kirito (Primary Owner & User)"

        full_sys_prompt = f"""You are aliph1, an ultra-fast, brilliant, proactive, and articulate Executive Voice and Chat AI Assistant.
The primary enrolled user is {user_name}.
Active AI Model: {active_model} (Google Gemini). When asked which model you are using, accurately identify as {active_model}.

CURRENTLY ENROLLED SPEAKERS (Total: {len(enrolled_speakers)}):
{enrolled_summary_str}
When asked who is enrolled, who you recognize, or how many users/speakers you recognize, state the exact count and list them directly using this registry without asking unnecessary clarifying questions.

MULTI-SPEAKER RECOGNITION & GUEST PROTOCOL:
- Primary Owner & User: {user_name} (Voiceprint verified at >= 80% confidence, profile S1).
  When a user turn is from [{user_name}], you are speaking with your primary partner/owner {user_name}. Address them warmly and naturally as {user_name}, and reference their personal memories, preferences, and ongoing tasks.
- Enrolled Secondary Speakers:
  When a user turn is labeled as [{active_speaker} (Enrolled Speaker)] or another name, acknowledge them warmly by name (e.g., "Hello Keshav!"). They are an enrolled secondary speaker/collaborator. Do NOT address them as {user_name}, and never treat them as primary owner {user_name}.
- Unrecognized / Unknown Speakers (Guests):
  When a user turn is labeled as [Unknown (Guest/Unrecognized Speaker)] or unverified:
  - CRITICAL: DO NOT address them as {user_name}!
  - DO NOT assume or recall them as {user_name}!
  - NEVER say "Hello again, {user_name}" or treat them as your primary user.
  - NEVER disclose {user_name}'s private personal memories, notes, or credentials to an unrecognized speaker.
  - Acknowledge them politely as an unrecognized guest/voice (e.g., "Hello! I don't recognize your voice—who am I speaking with?", "Hello there! How can I assist you?").
  - When an unknown speaker introduces themselves (e.g. "I am Keshav", "My name is Bob"), call `manage_speakers(action="enroll", name="Keshav")` so they are added as an enrolled speaker with their acoustic voiceprint without touching {user_name} (S1)!
- Speaker Management Tools:
  - List enrolled speakers: Call `manage_speakers(action="list")`.
  - Enroll guest speaker: Call `manage_speakers(action="enroll", name="...")`.
  - Rename speaker: Call `manage_speakers(action="rename", name="...", label_id="...")`.
  - Delete speaker: Call `manage_speakers(action="delete", label_id="...")` (Note: S1 / {user_name} cannot be deleted).

CORE GUIDELINES:
1. Language: Speak and communicate exclusively in English. Do not use or translate into any other languages.
2. Voice Style: Speak concisely, warmly, and naturally (1-3 sentences for voice interactions, unless detailed analysis is requested). Avoid repetitive filler questions such as repeatedly asking 'How can I help you today?' or ending turns with 'today'. DO NOT repeat greetings ("Hello <Name>!", "How can I assist you today?") on ongoing conversational turns. Greet only once at the start of a session. In active conversation, respond directly to the user's remarks.
3. Numerical & Statistical Charts (Chart.js):
   - You have full Markdown and interactive visualization capability.
   - When asked for numerical data comparisons, statistical distributions, or quantitative trends (bar chart, line chart, pie chart, doughnut chart), output a standard Chart.js JSON configuration inside a code block tagged with 'chart':
     ```chart
     {{
       "type": "bar",
       "data": {{
         "labels": ["Category A", "Category B", "Category C"],
         "datasets": [{{
           "label": "Values",
           "data": [12, 19, 8],
           "backgroundColor": ["#4F46E5", "#7C3AED", "#10B981"]
         }}]
       }},
       "options": {{
         "responsive": true,
         "maintainAspectRatio": false
       }}
     }}
     ```
   - Supported numerical chart types: 'bar', 'line', 'pie', 'doughnut', 'radar'.
   - DO NOT use Chart.js for structural relationships, hierarchies, or trees.

4. Hierarchies, Tree Charts, Flowcharts & Architectures (Mermaid):
   - When the user asks for a "tree chart", "tree diagram", "hierarchy", "decision tree", "flowchart", "system architecture", or "mind map", you MUST ALWAYS generate a valid Mermaid diagram tagged with 'mermaid' (using `graph TD` or `flowchart LR`).
   - IMPORTANT: A "tree chart" refers to a HIERARCHICAL TREE GRAPH (with a root node connected to branches and child leaves), NOT a botanical tree bar chart!
   - Example Tree Chart (Hierarchical Tree Diagram):
     ```mermaid
     graph TD
       Root["Main System / Root Topic"]
       Root --> Branch1["Architecture Core"]
       Root --> Branch2["User Interface"]
       Root --> Branch3["Data Pipeline"]
       Branch1 --> Sub1["Module A"]
       Branch1 --> Sub2["Module B"]
       Branch2 --> Sub3["Voice Engine"]
       Branch2 --> Sub4["Chat & Controls"]
       Branch3 --> Sub5["Ingestion"]
       Branch3 --> Sub6["Storage"]
     ```
   - Always enclose node labels and pipe labels in double quotes (e.g. `A["Node Label (Details)"] -->|"Connection"| B["Child Node"]`), and format subgraphs as `subgraph id ["Layer Name"]`.
5. Permanent Memory vs Transient Chat Sessions (STRICT SEPARATION):
   - Transient Chat Sessions: Past conversation transcripts saved in local SQLite history.db.
     When the user asks to "delete this chat" or "clear chat history", call `delete_chat_session` or `clear_chat_history`.
     This ONLY deletes the transient chat bubble transcripts.
   - Permanent Memory & User Preferences: Saved facts, rules, user identity, and visual preferences (such as favorite avatars/shaders like Volumetric Rays SHDR-31).
     These are stored permanently. They are NEVER deleted when clearing chat sessions!
     CRITICAL: NEVER tell the user that clearing chat history deleted their permanent memories, favorite avatar, or preferences.
     CRITICAL TRUTHFULNESS RULE: NEVER claim or pretend that you have cleared chat sessions, started a new chat, or switched the 3D orb/avatar unless you have actually called the corresponding tool in this turn. If you did not call the tool, do NOT say you did.
   - Recalling User Favorites/Preferences: When the user asks "what is my favorite avatar/shader?", "what is my name?", or asks about saved facts, consult the permanent memory context above or call `manage_shader_preferences(action="list_preferences")` or `search_long_term_memory()`. The user's favorite orb shader is Volumetric Rays (SHDR-31).
   - Storing a fact/rule/preference: Call `save_to_long_term_memory(fact="...")`.
   - Inspecting/Recalling memories: Call `search_long_term_memory(query="...")` to look up relevant facts and their unique IDs (`memory_id`).
   - Deleting a specific single item: Call `search_long_term_memory(query="...")` first to obtain the exact `memory_id`, then call `delete_long_term_memory(memory_id="...")`.
   - Updating or Rephrasing an existing memory: Call `search_long_term_memory(query="...")` to find the target `memory_id`, then call `update_long_term_memory(memory_id="...", updated_fact="...")` with the newly rephrased version.
   - Cleaning a specific part or topic of memory: When asked to clean a specific topic (e.g. video discussion, project notes, work history), call `clear_long_term_memory(topic="...")`.
   - Wiping / Emptying memory completely: Call `clear_long_term_memory(keep_primary_user_name=True)` ONLY when the user explicitly asks to delete their permanent memory.
   - Session Navigation: When the user asks to open a new chat, start fresh, or begin a new discussion, call `create_new_chat_session()`.
   - Deleting a Chat Session: When asked to delete a chat, delete this session, or delete a past chat discussion, call `delete_chat_session(session_id="...", query="...")`.
   - Wiping All Chat Sessions: When asked to delete all chats, delete every chat session, or clear chat history, call `clear_chat_history()`.
   - Renaming a Session (CRITICAL): When the user asks to rename a session/title (even with typos like "rename thsi sesson"), call `rename_chat_session(new_title="...")`. NEVER call `clear_chat_history`, `delete_chat_session`, or any destructive tool for a rename request.
   - Multi-Action Requests: If the user asks for multiple actions in one sentence (e.g. "delete all my sessions and then rename the new session"), execute EVERY requested action in sequence with multiple tool calls — do not stop after the first one.
   - Destructive Action Judgment: Only call `clear_chat_history`, `clear_long_term_memory`, or `delete_chat_session` when the user's words explicitly contain delete/clear/wipe intent. If the request is ambiguous, ask a short clarifying question instead of guessing.
   - Speaker & Name Management:
      - Primary Owner Name: When the primary user {user_name} asks to change their preferred name (e.g. "Call me Kirito"), call `set_user_name(name="...")` to update their profile and header badge. The primary user's name is Kirito.
      - Enrolling Guests & Secondary Speakers: When any guest or new voice introduces themselves (e.g. "I am Keshav", "My name is Bob"), call `manage_speakers(action="enroll", name="...")` so they are enrolled as S2, S3, etc. with acoustic voiceprint without modifying S1 (Kirito).
      - Managing Speakers: When asked to list speakers, rename a speaker, or delete a secondary speaker, call `manage_speakers(action="list"|"rename"|"delete", ...)`. S1 (Kirito) can never be deleted.
   - Managing API Keys: When the user provides an API key or asks to add/manage an API key (e.g. for Cartesia, ElevenLabs, Gemini, Speechmatics, or LiveKit), call `manage_api_keys(action="add", service="cartesia", api_key="...")` immediately to save it to their multi-account pool and persist it in .env.
   - System Settings, STT, TTS, & Voice Management:
     When asked about current settings, active voice, or what engines are active, call `get_system_settings()`.
      When the user asks you to change the voice (e.g. "Use Rachel's voice", "Switch to Sarah", "Use Casper"), switch the STT engine ('livekit', 'speechmatics', 'elevenlabs', 'google', 'browser'), switch the TTS engine ('cartesia', 'elevenlabs', 'livekit', 'google', 'browser'), switch the LLM model, or toggle OCR, call `modify_system_settings(stt="...", tts="...", voice="...", llm="...", enable_ocr=...)` immediately.
   Always confirm the memory action clearly and warmly to the user once completed.
 5. 3D Orb Visual Shaders (33 Orbkit Styles, SHDR-01..SHDR-33):
    The central 3D Orb has 33 shaders (SHDR-01 Prism Crystal … SHDR-31 Volumetric Rays (user favorite) … SHDR-32 Galactic Core, SHDR-33 Thermal Riso).
    When the user names any shader, alias, or description (e.g. 'godrays', 'plasma', 'thermal', 'galaxy', 'matrix', 'lego'),
    call `switch_orb_shader(variant_or_query="<user words>")` and let the resolver fuzzy-match. Do NOT recite the full list unless asked.
 7. Full Session Recall & Multimodal Document Awareness:
   - You have 100% immediate access to all past user messages, conversations, and multimodal document/image/video analyses conducted in this session (e.g. certificates, PDFs, diagrams, OCR extractions).
   - When the user asks about an uploaded certificate, document, file, or image, refer directly to the uploaded content and analysis in your conversation history above and answer with complete accuracy, precision, and depth.
   - If the user asks about an asset or topic from a past conversation or earlier session, call `search_chat_history(query="...")` or `read_chat_session(session_id="...")` to retrieve it immediately.
8. Educational Flashcard Study & Code/Voice Question Support:
   - You are integrated directly into the Noledge study session and have access to all tools and the user's active flashcards.
   - When the user is studying, you can call `get_active_study_question()` to know the exact active question, its type, options, expected answer, hints, and explanation.
   - When the user is on a `code` question, you can inspect their current editor buffer with `get_user_code_buffer()`.
   - When asked to check, review, judge, or grade the user's code (or when judging a code card), call `judge_code_correctness()`.
     CRITICAL CODE JUDGING RULE: State clearly and objectively whether the code is correct or incorrect. Point out exact syntax errors, missing logic, or edge cases. DO NOT preach, lecture, or teach unrequested concepts if the user didn't ask for a lesson. Be direct, authoritative, and concise.
   - When the user is on a `voice` question, they will answer verbally to you. Listen carefully, evaluate whether their spoken response matches the question's core concepts, and call `submit_question_answer(is_correct=..., user_answer=..., feedback=...)`.
   - You can also navigate cards when requested using `navigate_study_card(action="next"|"prev"|"flip")`.
{mem_seed}
"""
        if system_instruction:
            full_sys_prompt = f"{full_sys_prompt}\n\nSession Notes:\n{system_instruction}"

        # Merge consecutive turns with identical role to ensure strict alternating schema
        merged_contents = []
        for c in contents:
            if merged_contents and merged_contents[-1]["role"] == c["role"]:
                merged_contents[-1]["parts"][0]["text"] += "\n" + c["parts"][0]["text"]
            else:
                merged_contents.append(c)

        # Gemini API Schema Requirements:
        # 1. First turn MUST be 'user'
        if not merged_contents:
            merged_contents.append({"role": "user", "parts": [{"text": "Hello"}]})
        elif merged_contents[0]["role"] != "user":
            merged_contents.insert(0, {"role": "user", "parts": [{"text": "Hello"}]})

        # 2. Last turn MUST be 'user' (Gemini API returns HTTP 400 if requests end with a model turn)
        while merged_contents and merged_contents[-1]["role"] != "user":
            merged_contents.pop()

        if not merged_contents:
            merged_contents.append({"role": "user", "parts": [{"text": "Hello"}]})

        # Check for fast direct actions in user's latest utterance
        last_user_text = ""
        for m in reversed(merged_contents):
            if m.get("role") == "user":
                for p in m.get("parts", []):
                    if "text" in p and p["text"]:
                        last_user_text = p["text"]
                        break
            if last_user_text:
                break

        room = getattr(self._llm, "_room", None)
        curr_sid = getattr(self._llm, "_current_session_id", None) or (self._llm._session_state.get("id") if hasattr(self._llm, "_session_state") else None)

        async def _check_and_execute_fast_action(user_text: str) -> Optional[str]:
            u_clean = user_text.lower().strip()

            # --- Shared intent flags (typo tolerant: "sesson", "seession", "thsi" ...) ---
            destructive = any(w in u_clean for w in ["delete", "clear", "wipe", "remove", "reset", "clean", "erase", "purge"])
            # Rename intent: allow pronoun "it/this/that" for multi-action chains like
            # "delete my previous sessions, make a new session and rename it as X".
            rename_intent = bool(re.search(r'renam', u_clean)) and bool(
                re.search(r'(?:ses|chat|title|tab\b|rename\s+(?:it|this|that)\b)', u_clean)
            )
            new_title = None
            if rename_intent:
                m_title = re.search(
                    r'renam\w*\s+(?:the\s+)?(?:this\s+|thsi\s+|ths\s+|current\s+|active\s+|it\s+)?(?:new\s+)?(?:chat\s+|ses\w+\s*)?(?:title\s+)?(?:name\s+)?(?:to\s+|as\s+)?["\']?(.+?)["\']?[.?!]*$',
                    u_clean
                )
                if m_title:
                    cand = m_title.group(1).strip().strip('"\'')
                    cand = re.sub(r'^(?:this\s+|thsi\s+|ths\s+|current\s+|active\s+|new\s+|chat\s+|ses\w+\s+|it\s+)+(?:to\s+|as\s+)?', '', cand).strip()
                    cand = re.sub(r'[.?!]+$', '', cand).strip()
                    vague = cand.lower() in ("it", "that", "this", "session", "chat", "the session", "something", "anything", "something else", "else", "")
                    if cand and not vague:
                        new_title = cand
                    elif cand and vague:
                        new_title = f"Chat {time.strftime('%b %d, %I:%M %p')}"
                # Fallback: "rename it as X" where regex above captured "it as X" -> extract after to/as.
                if not new_title:
                    m2 = re.search(r'renam\w*.*? (?:to|as)\s+["\']?(.+?)["\']?[.?!]*$', u_clean)
                    if m2:
                        cand2 = m2.group(1).strip().strip('"\'')
                        if cand2 and cand2.lower() not in ("it", "that", "this", "else", "something else"):
                            new_title = cand2

            # 0. Combined: Switch to a new chat AND delete/clear all sessions (triple: + rename if requested)
            if ("new chat" in u_clean or "new session" in u_clean or "switch to a new" in u_clean) and any(w in u_clean for w in ["delete", "clear", "wipe", "remove"]):
                res = await asyncio.to_thread(execute_gemini_tool, "clear_chat_history", {}, user_id=user_name, current_session_id=curr_sid)
                new_s = res.get("new_session_id")
                if room and room.local_participant and new_s:
                    setattr(self._llm, "_current_session_id", new_s)
                    if hasattr(self._llm, "_session_state"):
                        self._llm._session_state["id"] = new_s
                    p = json.dumps({"type": "history_cleared", "new_session_id": new_s})
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                if rename_intent and new_title:
                    ren_res = await asyncio.to_thread(
                        execute_gemini_tool, "rename_chat_session",
                        {"new_title": new_title, "session_id": new_s or curr_sid},
                        user_id=user_name, current_session_id=new_s or curr_sid
                    )
                    if room and room.local_participant and ren_res.get("action") == "rename_session":
                        p = json.dumps({
                            "type": "session_renamed",
                            "session_id": ren_res.get("session_id") or new_s,
                            "new_title": ren_res.get("new_title") or new_title
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    return f"I deleted all your past chat sessions, started a fresh one, and renamed it to '{new_title}'."
                return "I have deleted all your past chat sessions and switched you to a fresh new chat."

            # 1. Switch / Open / Start / Create new chat session
            if re.search(r'(?:(?:switch\s+to|open|start|create|begin)\s+(?:a\s+)?(?:brand\s+)?new\s+chat|^new\s+chat$)', u_clean) or u_clean in ["new chat", "open new chat", "start new chat"]:
                res = await asyncio.to_thread(execute_gemini_tool, "create_new_chat_session", {}, user_id=user_name, current_session_id=curr_sid)
                new_s = res.get("session_id")
                if room and room.local_participant and new_s:
                    setattr(self._llm, "_current_session_id", new_s)
                    if hasattr(self._llm, "_session_state"):
                        self._llm._session_state["id"] = new_s
                    p = json.dumps({"type": "switch_session_ui", "session_id": new_s})
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                return "I have opened a clean new chat session for you."

            # 1b. Clear / Delete all chat history & sessions (typo tolerant: sessiions/sesseions/sesson/history)
            #     COMBINED ACTIONS: if the user ALSO asked to rename the (new) session, do BOTH in sequence.
            #     Matches "delete my previous sessions", "delete all sessions", "clear history", etc.
            if re.search(r'(?:delete|clear|wipe|remove|clean|reset|erase|purge)\s+(?:all\s+|every(?:thing)?\s+|my\s+|previous\s+|past\s+|old\s+)*(?:the\s+)?(?:chat\s+)?(?:his\w+|ses+\w*)', u_clean) or (
                destructive and re.search(r'(?:ses|his|chat)', u_clean) and not any(w in u_clean for w in ["this ", "current ", "thsi ", "ths "])
            ):
                res = await asyncio.to_thread(execute_gemini_tool, "clear_chat_history", {}, user_id=user_name, current_session_id=curr_sid)
                new_s = res.get("new_session_id")
                if room and room.local_participant and new_s:
                    setattr(self._llm, "_current_session_id", new_s)
                    if hasattr(self._llm, "_session_state"):
                        self._llm._session_state["id"] = new_s
                    p = json.dumps({"type": "history_cleared", "new_session_id": new_s})
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                if rename_intent and new_title:
                    ren_res = await asyncio.to_thread(
                        execute_gemini_tool, "rename_chat_session",
                        {"new_title": new_title, "session_id": new_s or curr_sid},
                        user_id=user_name, current_session_id=new_s or curr_sid
                    )
                    if room and room.local_participant and ren_res.get("action") == "rename_session":
                        p = json.dumps({
                            "type": "session_renamed",
                            "session_id": ren_res.get("session_id") or new_s,
                            "new_title": ren_res.get("new_title") or new_title
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    return f"I deleted all your past chat sessions, started a fresh one, and renamed it to '{new_title}'."
                return res.get("message", "I have completely wiped all past conversation history.")

            # 2. Delete current chat session
            if re.search(r'(?:delete|clear|wipe|remove)\s+(?:this|current)\s+(?:chat|sess?i+on)', u_clean) or u_clean in ["delete session", "delete this session", "clear this chat"]:
                res = await asyncio.to_thread(execute_gemini_tool, "delete_chat_session", {"session_id": curr_sid}, user_id=user_name, current_session_id=curr_sid)
                if room and room.local_participant and res.get("action") == "delete_session":
                    new_s = res.get("new_session_id")
                    if new_s:
                        setattr(self._llm, "_current_session_id", new_s)
                        if hasattr(self._llm, "_session_state"):
                            self._llm._session_state["id"] = new_s
                    p = json.dumps({
                        "type": "session_deleted",
                        "session_id": curr_sid,
                        "is_current": True,
                        "new_session_id": new_s
                    })
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                if rename_intent and new_title:
                    new_s2 = res.get("new_session_id") or curr_sid
                    ren_res = await asyncio.to_thread(
                        execute_gemini_tool, "rename_chat_session",
                        {"new_title": new_title, "session_id": new_s2},
                        user_id=user_name, current_session_id=new_s2
                    )
                    if room and room.local_participant and ren_res.get("action") == "rename_session":
                        p = json.dumps({
                            "type": "session_renamed",
                            "session_id": ren_res.get("session_id") or new_s2,
                            "new_title": ren_res.get("new_title") or new_title
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    return f"I deleted the conversation and renamed the new session to '{new_title}'."
                return res.get("message", "I have deleted this conversation session.")

            # 2b. Rename chat session (typo tolerant fast path; only when nothing destructive was asked)
            if rename_intent and new_title and not destructive:
                res = await asyncio.to_thread(execute_gemini_tool, "rename_chat_session", {"new_title": new_title, "session_id": curr_sid}, user_id=user_name, current_session_id=curr_sid)
                if room and room.local_participant and res.get("action") == "rename_session":
                    p = json.dumps({
                        "type": "session_renamed",
                        "session_id": res.get("session_id") or curr_sid,
                        "new_title": res.get("new_title") or new_title
                    })
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                return res.get("message", f"I have renamed this chat session to '{new_title}'.")

            # 3a. Switch Avatar (User profile emoji icon)
            AVATAR_MAP = {
                "sword": "⚔️", "swords": "⚔️", "shield": "🛡️", "lightning": "⚡", "thunder": "⚡",
                "crystal": "🔮", "magic": "🔮", "brain": "🧠", "mind": "🧠", "rocket": "🚀",
                "space": "🌌", "target": "🎯", "diamond": "💎", "gem": "💎", "fox": "🦊",
                "star": "⭐", "fire": "🔥", "flame": "🔥", "cat": "🐱", "robot": "🤖",
                "earth": "🌍", "globe": "🌎"
            }
            if "avatar" in u_clean and any(w in u_clean for w in ["change", "switch", "set", "to"]):
                matched_avatar = None
                for k, emoji in AVATAR_MAP.items():
                    if k in u_clean:
                        matched_avatar = emoji
                        break
                emoji_match = re.search(r'[\U0001F300-\U0001F9FF]', user_text)
                if emoji_match:
                    matched_avatar = emoji_match.group(0)
                if matched_avatar and room and room.local_participant:
                    p = json.dumps({"type": "change_avatar_ui", "avatar": matched_avatar})
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    return f"I've updated your avatar to {matched_avatar}!"

            # 3b. Switch Orb / Shader
            orb_match = re.search(r'(?:switch|change|set)\s+(?:the\s+)?(?:orb|shader|style)\s+(?:to\s+)?([a-zA-Z0-9\s-]+)', u_clean)
            if orb_match:
                target_orb = orb_match.group(1).strip()
                res = await asyncio.to_thread(execute_gemini_tool, "switch_orb_shader", {"variant_or_query": target_orb}, user_id=user_name)
                if res.get("status") == "success" and room and room.local_participant:
                    p = json.dumps({"type": "switch_shader_ui", "variant": res.get("variant")})
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    return res.get("message")

            # 4. Switch Voice / TTS / STT
            voice_match = re.search(r'(?:use|switch to|change voice to)\s+([a-zA-Z0-9\s-]+)\s*(?:voice)?', u_clean)
            if voice_match and not any(w in u_clean for w in ["orb", "shader", "chat", "session"]):
                target_v = voice_match.group(1).strip()
                res = await asyncio.to_thread(execute_gemini_tool, "modify_system_settings", {"voice": target_v}, user_id=user_name)
                if res.get("status") == "success" and room and room.local_participant:
                    p = json.dumps({
                        "type": "switch_engine_ui",
                        "stt": res.get("stt"),
                        "tts": res.get("tts"),
                        "voice": res.get("voice")
                    })
                    asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    return res.get("message")

            # 5. Clear / Delete permanent memory
            if any(phrase in u_clean for phrase in ["delete all memory", "clear all memory", "wipe permanent memory", "delete permanent memory", "clear permanent memory", "forget everything"]):
                res = await asyncio.to_thread(execute_gemini_tool, "clear_long_term_memory", {}, user_id=user_name)
                return res.get("message", "I have cleared all permanent memories.")

            # 6. Status / Analytics check
            if any(phrase in u_clean for phrase in ["what voice", "which voice", "what stt", "which stt", "what tts", "current status", "what are my settings", "existing status", "analytics on the page"]):
                res = await asyncio.to_thread(execute_gemini_tool, "get_user_analytics_and_status", {}, user_id=user_name, current_session_id=curr_sid)
                return res.get("message")

            # 7. Add API key directly
            key_match = re.search(r'(?:add|save|here is|integrate)\s+(?:my\s+)?(gemini|cartesia|elevenlabs|speechmatics|livekit)\s+(?:api\s+)?key\s+([a-zA-Z0-9_.-]+)', user_text, re.IGNORECASE)
            if key_match:
                svc = key_match.group(1).lower()
                token = key_match.group(2).strip()
                res = await asyncio.to_thread(execute_gemini_tool, "manage_api_keys", {"action": "add", "service": svc, "api_key": token}, user_id=user_name)
                return res.get("message")

            return None

        if last_user_text:
            fast_reply = await _check_and_execute_fast_action(last_user_text)
            if fast_reply:
                setattr(self._llm, "_pending_reply_text", fast_reply)
                emit_fn = getattr(self._llm, "_emit_assistant_fn", None)
                if emit_fn:
                    emit_fn(fast_reply)
                self._event_ch.send_nowait(
                    llm.ChatChunk(
                        id="fast_action",
                        delta=llm.ChoiceDelta(role="assistant", content=fast_reply)
                    )
                )
                return

        payload = {
            "contents": merged_contents,
            "systemInstruction": {"parts": [{"text": full_sys_prompt}]},
            "tools": GEMINI_TOOLS
        }
        model = getattr(self._llm, "model", "gemini-3.5-flash-lite") or "gemini-3.5-flash-lite"

        async def _fetch_stream(p, timeout=5):
            keys_to_try = get_all_active_gemini_api_keys()
            if not keys_to_try:
                env_k = getattr(self._llm, "_api_key", None) or os.getenv("GEMINI_API_KEY")
                if env_k and is_valid_token(env_k.strip()):
                    keys_to_try = [env_k.strip()]

            if not keys_to_try:
                raise RuntimeError("No active Google Gemini API key configured.")

            priority_fallbacks = [
                "gemini-3.5-flash-lite",
                "gemini-3.5-flash",
                "gemini-flash-latest",
                "gemini-pro-latest"
            ]
            models_to_try = [model] + [m for m in priority_fallbacks if m != model]
            last_err = None

            for cur_key in keys_to_try:
                for m in models_to_try:
                    target_url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:streamGenerateContent?alt=sse&key={cur_key}"
                    try:
                        req = urllib.request.Request(
                            target_url,
                            data=json.dumps(p).encode("utf-8"),
                            headers={"Content-Type": "application/json", "User-Agent": "aliph1-Assistant/1.0"}
                        )
                        r = await asyncio.to_thread(urllib.request.urlopen, req, timeout=timeout)
                        return r, m
                    except urllib.error.HTTPError as he:
                        last_err = he
                        err_body = ""
                        try:
                            err_body = he.read().decode("utf-8", errors="ignore")
                        except Exception:
                            pass
                        if he.code == 403 or (he.code == 400 and "API_KEY_INVALID" in err_body):
                            logger.warning(f"Gemini key rejected (HTTP {he.code}) on {m}: {err_body[:100]}. Skipping key.")
                            mark_gemini_key_invalid(cur_key)
                            break
                        if he.code == 429:
                            mark_gemini_key_rate_limited(cur_key, cooldown_seconds=60)
                            logger.warning(f"Gemini key rate-limited (429) on model {m}.")
                            break
                        logger.warning(f"Gemini model {m} HTTP {he.code}: {err_body[:120]}")
                    except Exception as ex:
                        last_err = ex
                        logger.warning(f"Gemini model {m} error: {ex}, trying next fallback...")
            raise last_err or RuntimeError("All Gemini candidate keys and models failed.")

        speech_filter = StreamSpeechFilter()
        full_reply_text = ""

        resp = None
        active_model = model
        try:
            resp, active_model = await _fetch_stream(payload, timeout=5)
        except Exception as fe:
            logger.info(f"Gemini primary brain: {fe}. Activating LiveKit Cloud ultra-fast second brain fallback...")
            try:
                fallback_llm = inference.LLM(model="openai/gpt-4.1-mini")
                fallback_ctx = llm.ChatContext()
                fallback_ctx.add_message(role="system", content=full_sys_prompt)
                for turn in merged_contents[-10:]:
                    turn_role = "user" if turn.get("role") == "user" else "assistant"
                    turn_text = "".join(p.get("text", "") for p in turn.get("parts", []))
                    if turn_text:
                        fallback_ctx.add_message(role=turn_role, content=turn_text)
                fb_stream = fallback_llm.chat(chat_ctx=fallback_ctx, conn_options=self._conn_options)
                async for chunk in fb_stream:
                    if chunk.delta and chunk.delta.content:
                        full_reply_text += chunk.delta.content
                        for spoken_part in speech_filter.push(chunk.delta.content):
                            self._event_ch.send_nowait(
                                llm.ChatChunk(
                                    id="fallback_chunk",
                                    delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                                )
                            )
                for spoken_part in speech_filter.flush():
                    self._event_ch.send_nowait(
                        llm.ChatChunk(
                            id="fallback_chunk",
                            delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                        )
                    )
                clean_reply = full_reply_text.strip()
                if clean_reply:
                    setattr(self._llm, "_pending_reply_text", clean_reply)
                    emit_fn = getattr(self._llm, "_emit_assistant_fn", None)
                    if emit_fn:
                        emit_fn(clean_reply)
                return
            except Exception as fb_err:
                logger.error(f"LiveKit Cloud second brain fallback also failed: {fb_err}")
                error_msg = "I encountered an issue connecting to both the primary Gemini and secondary LiveKit brains."
                self._event_ch.send_nowait(
                    llm.ChatChunk(
                        id="gemini_error",
                        delta=llm.ChoiceDelta(role="assistant", content=error_msg)
                    )
                )
                return

        function_call_detected = None
        func_args = {}
        func_call_id = None
        thought_sig = None
        full_reply_text = ""
        speech_filter = StreamSpeechFilter()

        while True:
            raw_line = await asyncio.to_thread(resp.readline)
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if line.startswith("data: "):
                try:
                    data = json.loads(line[6:])
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for p in parts:
                            if "thoughtSignature" in p and p["thoughtSignature"]:
                                thought_sig = p["thoughtSignature"]
                            if "functionCall" in p:
                                fc = p["functionCall"]
                                function_call_detected = fc.get("name")
                                func_args = fc.get("args", {})
                                func_call_id = fc.get("id")
                                if not thought_sig and p.get("thoughtSignature"):
                                    thought_sig = p.get("thoughtSignature")
                                # Clear any preliminary text chunk if a tool call is detected
                                speech_filter = StreamSpeechFilter()
                                full_reply_text = ""
                            elif "text" in p and not function_call_detected:
                                text_chunk = p.get("text", "")
                                if text_chunk:
                                    full_reply_text += text_chunk
                                    for spoken_part in speech_filter.push(text_chunk):
                                        self._event_ch.send_nowait(
                                            llm.ChatChunk(
                                                id="gemini_chunk",
                                                delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                                            )
                                        )
                except Exception:
                    pass

        if not function_call_detected:
            for spoken_part in speech_filter.flush():
                self._event_ch.send_nowait(
                    llm.ChatChunk(
                        id="gemini_chunk",
                        delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                    )
                )

        # Multi-turn tool execution loop (up to 4 turns)
        turns_left = 4
        last_tool_msg = None
        while function_call_detected and turns_left > 0:
            turns_left -= 1
            # Discard any preliminary text chunk generated before the tool call so fragments like 'today?' are not prepended
            full_reply_text = ""
            speech_filter = StreamSpeechFilter()
            curr_sid = self._llm._session_state.get("id") if hasattr(self._llm, "_session_state") else getattr(self._llm, "_current_session_id", None)
            last_pcm = self._llm._session_state.get("last_pcm") if hasattr(self._llm, "_session_state") else getattr(self._llm, "_last_pcm", None)
            curr_spk = getattr(self._llm, "_last_turn_speaker", None) or (self._llm._session_state.get("last_turn_speaker") if hasattr(self._llm, "_session_state") else None)
            # --- Judgment Gate: never execute destructive tools unless the user actually asked for it ---
            DESTRUCTIVE_TOOLS = {"clear_chat_history", "clear_long_term_memory", "delete_chat_session", "delete_speaker"}
            u_low = (last_user_text or "").lower()
            destructive_cues = ["delete", "clear", "wipe", "remove", "reset", "clean", "erase", "purge", "forget everything"]
            if function_call_detected in DESTRUCTIVE_TOOLS and not any(w in u_low for w in destructive_cues):
                logger.info(f"🛑 [Judgment Gate] Rejected '{function_call_detected}' — user did not request a destructive action. User said: '{last_user_text}'")
                tool_res = {
                    "status": "rejected",
                    "message": (
                        f"REJECTED: The user did NOT ask to delete, clear, or wipe anything. The user actually said: \"{last_user_text}\". "
                        "Re-read the request and call the CORRECT tool instead (e.g. rename_chat_session to rename a session). Do not repeat the rejected call."
                    )
                }
            else:
                tool_res = await asyncio.to_thread(
                    execute_gemini_tool,
                    function_call_detected,
                    func_args,
                    user_id=user_name,
                    current_session_id=curr_sid,
                    current_audio_pcm=last_pcm,
                    current_speaker=curr_spk
                )
            logger.info(f"Tool executed: {function_call_detected} -> {tool_res}")
            if isinstance(tool_res, dict) and tool_res.get("message"):
                last_tool_msg = tool_res.get("message")

            act = tool_res.get("action") if isinstance(tool_res, dict) else None
            room = getattr(self._llm, "_room", None)
            if room and room.local_participant:
                try:
                    if act == "switch_session":
                        new_sid = tool_res.get("session_id")
                        if hasattr(self._llm, "_session_state"):
                            self._llm._session_state["id"] = new_sid
                        setattr(self._llm, "_current_session_id", new_sid)
                        p = json.dumps({"type": "switch_session_ui", "session_id": new_sid})
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "switch_shader":
                        var_key = tool_res.get("variant")
                        p = json.dumps({"type": "switch_shader_ui", "variant": var_key})
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "switch_engine":
                        p = json.dumps({
                            "type": "switch_engine_ui",
                            "stt": tool_res.get("stt"),
                            "tts": tool_res.get("tts"),
                            "voice": tool_res.get("voice"),
                            "llm": tool_res.get("llm"),
                            "enable_ocr": tool_res.get("enable_ocr")
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act in ("enroll_speaker", "rename_speaker", "set_user_name"):
                        spk_name = tool_res.get("speaker_name") or tool_res.get("user_name")
                        is_prim = tool_res.get("is_primary", (act == "set_user_name"))
                        lid = tool_res.get("label_id", "S1" if is_prim else "S2")
                        if is_prim and spk_name:
                            setattr(self._llm, "_current_user", spk_name)
                        if spk_name:
                            setattr(self._llm, "_last_turn_speaker", spk_name)
                            setattr(self._llm, "_last_turn_verified", True)
                            if hasattr(self._llm, "_session_state"):
                                self._llm._session_state["last_turn_speaker"] = spk_name
                                self._llm._session_state["last_turn_verified"] = True
                            p = json.dumps({
                                "type": "speaker_update",
                                "speaker": spk_name,
                                "label_id": lid,
                                "is_primary": is_prim,
                                "confidence": 100.0,
                                "verified": True,
                                "pitch": 0.0
                            })
                            asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "delete_speaker":
                        p = json.dumps({
                            "type": "speaker_deleted",
                            "label_id": tool_res.get("label_id"),
                            "deleted_name": tool_res.get("deleted_name")
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "delete_session":
                        del_sid = tool_res.get("session_id")
                        is_curr = tool_res.get("is_current")
                        new_sid = tool_res.get("new_session_id")
                        if is_curr and new_sid:
                            if hasattr(self._llm, "_session_state"):
                                self._llm._session_state["id"] = new_sid
                            setattr(self._llm, "_current_session_id", new_sid)
                        p = json.dumps({
                            "type": "session_deleted",
                            "session_id": del_sid,
                            "is_current": is_curr,
                            "new_session_id": new_sid
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "clear_history":
                        new_sid = tool_res.get("new_session_id")
                        if new_sid:
                            if hasattr(self._llm, "_session_state"):
                                self._llm._session_state["id"] = new_sid
                            setattr(self._llm, "_current_session_id", new_sid)
                        p = json.dumps({
                            "type": "history_cleared",
                            "new_session_id": new_sid
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "rename_session":
                        ren_sid = tool_res.get("session_id")
                        new_t = tool_res.get("new_title")
                        p = json.dumps({
                            "type": "session_renamed",
                            "session_id": ren_sid,
                            "new_title": new_t
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "code_judged":
                        p = json.dumps({
                            "type": "study_code_judged",
                            "is_correct": tool_res.get("is_correct"),
                            "score": tool_res.get("score"),
                            "feedback": tool_res.get("feedback")
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "submit_answer":
                        p = json.dumps({
                            "type": "study_answer_submitted",
                            "is_correct": tool_res.get("is_correct"),
                            "user_answer": tool_res.get("user_answer"),
                            "feedback": tool_res.get("feedback")
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "navigate_card":
                        p = json.dumps({
                            "type": "study_navigate_card",
                            "direction": tool_res.get("direction")
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                    elif act == "site_action":
                        # Forward website controls to Next.js client (executeSiteAction).
                        p = json.dumps({
                            "type": "site_action",
                            "action": tool_res.get("site_action"),
                            "params": tool_res.get("params", {})
                        })
                        asyncio.create_task(room.local_participant.publish_data(p.encode()))
                except Exception as e:
                    logger.warning(f"Error publishing tool action to room data channel: {e}")

            if (act in ("clear_history", "delete_session", "switch_shader", "switch_engine", "enroll_speaker", "rename_speaker", "set_user_name", "delete_speaker", "clear_long_term_memory", "rename_session", "site_action") or function_call_detected in ("save_to_long_term_memory", "rename_chat_session", "delete_long_term_memory", "update_long_term_memory", "manage_site_deck", "manage_site_question", "control_site_app")) and last_tool_msg:
                full_reply_text = last_tool_msg
                for spoken_part in speech_filter.push(last_tool_msg):
                    self._event_ch.send_nowait(
                        llm.ChatChunk(
                            id="gemini_tool_ack",
                            delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                        )
                    )
                for spoken_part in speech_filter.flush():
                    self._event_ch.send_nowait(
                        llm.ChatChunk(
                            id="gemini_tool_ack",
                            delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                        )
                    )
                function_call_detected = None
                break

            model_part = {"functionCall": {"name": function_call_detected, "args": func_args}}
            if func_call_id:
                model_part["functionCall"]["id"] = func_call_id
            if thought_sig:
                model_part["thoughtSignature"] = thought_sig

            resp_part = {
                "functionResponse": {
                    "name": function_call_detected,
                    "response": {"name": function_call_detected, "content": tool_res}
                }
            }
            if func_call_id:
                resp_part["functionResponse"]["id"] = func_call_id

            merged_contents = merged_contents + [
                {"role": "model", "parts": [model_part]},
                {"role": "function", "parts": [resp_part]}
            ]
            follow_payload = {
                "contents": merged_contents,
                "systemInstruction": {"parts": [{"text": full_sys_prompt}]},
                "tools": GEMINI_TOOLS
            }

            function_call_detected = None
            func_args = {}
            func_call_id = None
            thought_sig = None

            resp2 = None
            try:
                resp2, _ = await _fetch_stream(follow_payload, timeout=15)
            except Exception as fe2:
                logger.warning(f"Tool follow-up all fallbacks failed: {fe2}")
                resp2 = None

            if resp2:
                try:
                    while True:
                        raw_line2 = await asyncio.to_thread(resp2.readline)
                        if not raw_line2:
                            break
                        line2 = raw_line2.decode("utf-8", errors="ignore").strip()
                        if line2.startswith("data: "):
                            try:
                                data2 = json.loads(line2[6:])
                                candidates2 = data2.get("candidates", [])
                                if candidates2:
                                    for p in candidates2[0].get("content", {}).get("parts", []):
                                        if "thoughtSignature" in p and p["thoughtSignature"]:
                                            thought_sig = p["thoughtSignature"]
                                        if "functionCall" in p:
                                            fc = p["functionCall"]
                                            function_call_detected = fc.get("name")
                                            func_args = fc.get("args", {})
                                            func_call_id = fc.get("id")
                                            if not thought_sig and p.get("thoughtSignature"):
                                                thought_sig = p.get("thoughtSignature")
                                        elif "text" in p:
                                            text_chunk2 = p.get("text", "")
                                            if text_chunk2:
                                                full_reply_text += text_chunk2
                                                for spoken_part in speech_filter.push(text_chunk2):
                                                    self._event_ch.send_nowait(
                                                        llm.ChatChunk(
                                                            id="gemini_chunk",
                                                            delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                                                        )
                                                    )
                            except Exception:
                                pass
                except Exception as stream_err:
                    logger.warning(f"Tool follow-up stream reading note: {stream_err}")
            else:
                break

        for spoken_part in speech_filter.flush():
            self._event_ch.send_nowait(
                llm.ChatChunk(
                    id="gemini_chunk",
                    delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                )
            )

        # Fallback spoken confirmation if model produced no speech after executing tool
        if not full_reply_text.strip() and last_tool_msg:
            full_reply_text = last_tool_msg
            for spoken_part in speech_filter.push(last_tool_msg):
                self._event_ch.send_nowait(
                    llm.ChatChunk(
                        id="gemini_fallback",
                        delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                    )
                )
            for spoken_part in speech_filter.flush():
                self._event_ch.send_nowait(
                    llm.ChatChunk(
                        id="gemini_fallback",
                        delta=llm.ChoiceDelta(role="assistant", content=spoken_part)
                    )
                )

        # Store complete synthesized response text on LLM instance and emit to UI
        clean_reply = full_reply_text.strip()
        if clean_reply:
            setattr(self._llm, "_pending_reply_text", clean_reply)
            emit_fn = getattr(self._llm, "_emit_assistant_fn", None)
            if emit_fn:
                emit_fn(clean_reply)



class GeminiLLM(llm.LLM):
    def __init__(self, api_key: str = "", model: str = "gemini-3.5-flash-lite", current_user: str = "Kirito", room: Optional[rtc.Room] = None, current_session_id: Optional[str] = None, session_state: Optional[Dict[str, Any]] = None):
        super().__init__()
        self._api_key = api_key
        self._model = model
        self._current_user = current_user
        self._room = room
        self._session_state = session_state if session_state is not None else {"id": current_session_id}
        self._current_session_id = self._session_state["id"]
        self._pending_reply_text = ""
        self._last_broadcast_text = ""
        self._recent_broadcasts = set()
        self._emit_assistant_fn = None
        self._last_turn_speaker = current_user
        self._last_turn_verified = True
        self._last_turn_conf = 100.0
        self._last_pcm = None

    @property
    def model(self) -> str:
        return self._model

    @property
    def provider(self) -> str:
        return "google"

    def chat(self, *, chat_ctx, tools=None, conn_options=DEFAULT_API_CONNECT_OPTIONS, **kwargs):
        return GeminiLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options
        )

def get_llm(current_user: str = "Kirito", room: Optional[rtc.Room] = None, current_session_id: Optional[str] = None, session_state: Optional[Dict[str, Any]] = None):
    # Google Gemini: High-Speed Primary LLM
    gemini_key = get_active_gemini_api_key()
    if gemini_key:
        logger.info(f"Loaded Gemini 3.5 Flash Lite as Ultra-Fast Primary LLM (Key: {gemini_key[:8]}...)")
        return GeminiLLM(
            api_key=gemini_key,
            model="gemini-3.5-flash-lite",
            current_user=current_user,
            room=room,
            current_session_id=current_session_id,
            session_state=session_state
        )

    logger.info("No active Gemini API key found, activating GeminiLLM in LiveKit Cloud fast fallback mode")
    return GeminiLLM(
        api_key="",
        model="gemini-3.5-flash-lite",
        current_user=current_user,
        room=room,
        current_session_id=current_session_id,
        session_state=session_state
    )

class Assistant(Agent):
    def __init__(self, chat_context: ChatContext, room: Optional[rtc.Room] = None, current_user: str = "User"):
        self.current_user = current_user
        self.room = room
        super().__init__(
            instructions=f"""You are aliph1, an ultra-fast Voice and Chat AI Assistant.
The enrolled user is {current_user}.
Be concise, proactive, warm, and articulate.
Language: Speak and communicate exclusively in English.
""",
            chat_ctx=chat_context
        )

server = AgentServer(initialize_process_timeout=60.0)

def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.05,
        min_silence_duration=0.45,
        prefix_padding_duration=0.5,
    )
    # Prewarm heavy lazy imports so they never block the agent event loop on first use
    # (the Google plugin pulls in gRPC/protobuf and blocked the loop for 1.4s on first TTS)
    try:
        from livekit.plugins import google as _google_prewarm  # noqa: F401
    except Exception:
        pass
    try:
        import httpx  # noqa: F401
    except Exception:
        pass

server.setup_fnc = prewarm

@server.rtc_session()
async def my_agent(ctx: JobContext):
    session_state: Dict[str, Any] = {"id": f"sess_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"}
    logger.info(f"Connecting Voice Agent session: {session_state['id']} in room: {ctx.room.name}")

    prewarmed_vad = ctx.proc.userdata.get("vad") if hasattr(ctx, "proc") and hasattr(ctx.proc, "userdata") else None
    if prewarmed_vad is None:
        prewarmed_vad = silero.VAD.load(
            min_speech_duration=0.05,
            min_silence_duration=0.45,
            prefix_padding_duration=0.5,
        )

    current_user_name = get_current_user_name()
    stt_inst = get_stt(prewarmed_vad=prewarmed_vad)
    tts_inst = get_tts()
    llm_inst = get_llm(current_user=current_user_name, room=ctx.room, current_session_id=session_state["id"], session_state=session_state)

    session = AgentSession(
        stt=stt_inst,
        llm=llm_inst,
        tts=tts_inst,
        vad=prewarmed_vad,
        turn_handling={"turn_detection": "manual"},
    )
    chat_ctx = ChatContext()
    assistant = Assistant(chat_context=chat_ctx, room=ctx.room, current_user=current_user_name)
    session_ready = False

    # Universal assistant message broadcaster with duplicate suppression (time-based)
    broadcasted_assistant_texts = {}
    turn_has_assistant_bubble = False

    def emit_assistant_message(text: str):
        nonlocal broadcasted_assistant_texts, turn_has_assistant_bubble
        clean = (text or "").strip()
        if not clean:
            return

        clean_key = re.sub(r'[^a-zA-Z0-9]+', ' ', clean).strip().lower()
        if not clean_key:
            return

        now = time.time()
        # Only suppress duplicate if exact identical text was emitted within the last 2.0s
        if clean_key in broadcasted_assistant_texts and (now - broadcasted_assistant_texts[clean_key]) < 2.0:
            return

        broadcasted_assistant_texts[clean_key] = now
        turn_has_assistant_bubble = True
        if len(broadcasted_assistant_texts) > 100:
            broadcasted_assistant_texts = {k: v for k, v in broadcasted_assistant_texts.items() if now - v < 10.0}

        active_sid = str(session_state.get("id") or "sess_default")
        try:
            history.add_message(
                session_id=active_sid,
                role="assistant",
                content=clean,
                speaker="aliph1"
            )
        except Exception as dbe:
            logger.debug(f"History DB write: {dbe}")

        if ctx.room and ctx.room.local_participant:
            payload = json.dumps({
                "type": "chat_message",
                "role": "assistant",
                "content": clean,
                "session_id": active_sid,
                "timestamp": time.time()
            })
            asyncio.create_task(ctx.room.local_participant.publish_data(payload.encode()))

    llm_inst._emit_assistant_fn = emit_assistant_message
    _is_restoring_history = False

    # ---------------------------------------------------------
    # Pure Acoustic Voice Detection & Speaker Identification
    # (Captures raw 16kHz audio frames into buffer for biometrics)
    # ---------------------------------------------------------
    user_audio_buffer = bytearray()
    attached_tracks = set()

    def attach_audio_stream(track: rtc.Track, identity: str = "User"):
        if not track or track.sid in attached_tracks:
            return
        if identity != "User" and ("agent" in identity.lower()):
            return
        attached_tracks.add(track.sid)

        async def _stream_frames():
            try:
                stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
                async for event in stream:
                    user_audio_buffer.extend(event.frame.data)
            except Exception as e:
                logger.debug(f"Audio stream error: {e}")
        asyncio.create_task(_stream_frames())

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            attach_audio_stream(track, participant.identity)

    for participant in ctx.room.remote_participants.values():
        for track_pub in participant.track_publications.values():
            if track_pub.track and track_pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                attach_audio_stream(track_pub.track, participant.identity)

    async def broadcast_state(state_name: str, text: str = ""):
        if ctx.room and ctx.room.local_participant:
            try:
                payload = json.dumps({
                    "type": "agent_state",
                    "state": state_name,
                    "text": text
                })
                await ctx.room.local_participant.publish_data(payload.encode())
            except Exception as e:
                logger.debug(f"Broadcast state error: {e}")

    async def broadcast_speaker(speaker_name: str, confidence: float, verified: bool, pitch: float = 0.0):
        if ctx.room and ctx.room.local_participant:
            try:
                payload = json.dumps({
                    "type": "speaker_detected",
                    "speaker": speaker_name,
                    "confidence": confidence,
                    "verified": verified,
                    "pitch": pitch
                })
                await ctx.room.local_participant.publish_data(payload.encode())
            except Exception as e:
                logger.debug(f"Broadcast speaker error: {e}")

    # Synchronize agent state changes to frontend for SHDR-31 Orb
    @session.on("agent_state_changed")
    def on_state_changed(event):
        raw_state = getattr(event, "new_state", getattr(event, "state", "idle"))
        if hasattr(raw_state, "value"):
            raw_state = raw_state.value
        state_str = str(raw_state).lower()
        if "think" in state_str:
            state_str = "thinking"
        elif "speak" in state_str:
            state_str = "speaking"
        elif "listen" in state_str:
            state_str = "listening"
        else:
            state_str = "idle"
        logger.info(f"🔄 [Agent State Changed]: {state_str}")
        asyncio.create_task(broadcast_state(state_str))

        # NOTE: Do NOT emit assistant text here. The single source of truth is
        # conversation_item_added -> emit_assistant_message (with 2s idempotent dedup).
        # Emitting _pending_reply_text here caused duplicate chat bubbles.

    @session.on("user_state_changed")
    def on_user_state_changed(event):
        raw_user_state = getattr(event, "new_state", getattr(event, "state", "idle"))
        if hasattr(raw_user_state, "value"):
            raw_user_state = raw_user_state.value
        ustate_str = str(raw_user_state).lower()
        if "speak" in ustate_str:
            logger.info("🎙️ [User Speaking Detected]")
            asyncio.create_task(broadcast_state("listening"))
            if getattr(session.input, "audio_enabled", False):
                try:
                    session.interrupt(force=True)
                except Exception:
                    pass

    turn_has_assistant_bubble = False

    # Real-time transcript broadcast to frontend & SQLite history storage
    @session.on("conversation_item_added")
    def on_conversation_item(event):
        nonlocal turn_has_assistant_bubble
        if _is_restoring_history:
            return
        try:
            item = event.item
            if isinstance(item, AgentConfigUpdate):
                return
            if not hasattr(item, 'content') or not hasattr(item, 'role'):
                return
            content = ''.join(item.content) if isinstance(item.content, list) else str(item.content)
            content = content.strip()
            if not content:
                return

            role = "user" if item.role == "user" else "assistant"
            logger.info(f"[{role.upper()}]: {content[:80]}")

            if role == "user":
                turn_has_assistant_bubble = False

            # If assistant speech item has content, emit it to chat bubble so user always sees the text
            if role == "assistant":
                is_interrupted = getattr(item, 'interrupted', False)
                if is_interrupted and not content:
                    logger.info("🛑 [Interrupted Empty Assistant Item Suppressed]")
                    return
                turn_has_assistant_bubble = True
                emit_assistant_message(content)
                return

            active_sid = str(session_state.get("id") or "sess_default")
            speaker_name = "aliph1" if role != "user" else (session_state.get("last_turn_speaker") or current_user_name)
            # Save to persistent SQLite conversation history for user
            try:
                history.add_message(
                    session_id=active_sid,
                    role=role,
                    content=content,
                    speaker=speaker_name
                )
            except Exception as dbe:
                logger.debug(f"History DB write: {dbe}")

            if ctx.room and ctx.room.local_participant:
                payload = json.dumps({
                    "type": "chat_message",
                    "role": role,
                    "speaker": speaker_name,
                    "content": content,
                    "session_id": session_state.get("id"),
                    "timestamp": time.time()
                })
                asyncio.create_task(ctx.room.local_participant.publish_data(payload.encode()))
        except Exception as e:
            logger.warning(f"Error handling conversation item: {e}")

    # Handle incoming data channel packets from web client
    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        try:
            msg = json.loads(data_packet.data.decode())
            m_type = msg.get("type")

            if m_type == "ptt_start":
                logger.info("PTT start received (Spacebar down)")
                try:
                    session.input.set_audio_enabled(True)
                except Exception:
                    pass
                asyncio.create_task(broadcast_state("listening"))
                user_audio_buffer.clear()
                try:
                    session.interrupt(force=True)
                except Exception:
                    pass

            elif m_type == "ptt_released":
                logger.info("PTT released (Spacebar up)")
                asyncio.create_task(broadcast_state("thinking"))

                # Snapshot the raw user audio buffer. The heavy biometric FFT runs OFF
                # the event loop inside delayed_commit so audio/turn handling is never blocked.
                pcm_data = bytes(user_audio_buffer)
                session_state["last_pcm"] = pcm_data
                if hasattr(llm_inst, "_last_pcm"):
                    llm_inst._last_pcm = pcm_data

                has_voice_attachment = bool(msg.get("has_attachment"))

                async def run_voice_detection():
                    turn_speaker = current_user_name
                    turn_conf = 0.0
                    turn_ver = False
                    turn_pitch = 0.0
                    if pcm_data:
                        try:
                            bio = await asyncio.to_thread(VoiceBiometricManager.get_instance().verify_voice, pcm_data)
                            turn_speaker = bio.get("identified_name", "Unknown")
                            turn_conf = bio.get("confidence", 0.0)
                            turn_ver = bio.get("verified", False)
                            turn_pitch = bio.get("pitch", 0.0)
                            logger.info(f"🎙️ [Voice Detection]: {turn_speaker} ({turn_conf}% confidence, verified={turn_ver})")
                            await broadcast_speaker(turn_speaker, turn_conf, turn_ver, turn_pitch)
                        except Exception as ve:
                            logger.warning(f"Voice detection error: {ve}")
                    session_state["last_turn_speaker"] = turn_speaker
                    session_state["last_turn_verified"] = turn_ver
                    session_state["last_turn_conf"] = turn_conf
                    if hasattr(llm_inst, "_last_turn_speaker"):
                        llm_inst._last_turn_speaker = turn_speaker
                        llm_inst._last_turn_verified = turn_ver
                        llm_inst._last_turn_conf = turn_conf

                async def delayed_commit():
                    try:
                        # Run acoustic voice detection off the event loop first (fills last_turn_speaker)
                        await run_voice_detection()
                        # Flush STT with skip_reply=True so LiveKit does NOT auto-reply on empty/null turns
                        fut = session.commit_user_turn(transcript_timeout=3.0, stt_flush_duration=0.35, skip_reply=True)
                        transcript = await fut
                        clean_tx = (transcript or "").strip()

                        if has_voice_attachment:
                            logger.info(f"Committed user speech for file attachment: '{clean_tx}'")
                            if ctx.room and ctx.room.local_participant:
                                payload = json.dumps({
                                    "type": "voice_transcript_for_attachment",
                                    "transcript": clean_tx,
                                    "session_id": session_state.get("id")
                                })
                                asyncio.create_task(ctx.room.local_participant.publish_data(payload.encode("utf-8"), reliable=True))
                            return

                        # Check if meaningful alphanumeric speech was actually spoken
                        has_words = bool(re.search(r'[a-zA-Z0-9]', clean_tx))
                        if not has_words and pcm_data:
                            # STT produced nothing even though we captured audio — fallback:
                            # transcribe the buffered PCM directly via Gemini before giving up.
                            try:
                                fb_tx = await asyncio.to_thread(tools.transcribe_pcm_with_gemini, pcm_data)
                                if fb_tx:
                                    logger.info(f"🔄 [STT Fallback]: Gemini PCM transcription recovered: '{fb_tx}'")
                                    clean_tx = fb_tx
                                    has_words = True
                            except Exception as fbe:
                                logger.debug(f"STT fallback transcription error: {fbe}")
                        if not has_words:
                            logger.info("PTT released with null speech packet (user tapped space to cut audio). Staying idle.")
                            asyncio.create_task(broadcast_state("idle"))
                            return

                        # Meaningful user speech detected: broadcast thinking state and generate reply
                        logger.info(f"Committed user speech turn: '{clean_tx}'")
                        asyncio.create_task(broadcast_state("thinking"))
                        reply_handle = session.generate_reply()
                        async def _watch_reply_complete(h):
                            try:
                                if hasattr(h, "wait_for_complete"):
                                    await h.wait_for_complete()
                            except Exception:
                                pass
                            finally:
                                await broadcast_state("idle")
                        if reply_handle:
                            asyncio.create_task(_watch_reply_complete(reply_handle))
                    except Exception as ce:
                        logger.warning(f"Error on commit_user_turn: {ce}")
                        asyncio.create_task(broadcast_state("idle"))
                    finally:
                        try:
                            session.input.set_audio_enabled(False)
                        except Exception:
                            pass

                asyncio.create_task(delayed_commit())

            elif m_type == "speak_utterance":
                text_to_speak = msg.get("text", "").strip()
                analysis_full = msg.get("analysis", "")
                user_prompt = msg.get("prompt", "")
                filename = msg.get("filename", "")
                file_type = msg.get("file_type", "")
                client_sid = msg.get("session_id")
                session_state["last_turn_speaker"] = current_user_name
                session_state["last_turn_verified"] = True
                if hasattr(llm_inst, "_last_turn_speaker"):
                    llm_inst._last_turn_speaker = current_user_name
                    llm_inst._last_turn_verified = True
                if client_sid:
                    session_state["id"] = client_sid
                    if hasattr(llm_inst, "_current_session_id"):
                        llm_inst._current_session_id = client_sid
                    if hasattr(llm_inst, "_session_state"):
                        llm_inst._session_state["id"] = client_sid

                # Keep in-memory agent session history 100% updated with the uploaded file & analysis!
                target_contexts = []
                if hasattr(assistant, "_chat_ctx") and assistant._chat_ctx:
                    target_contexts.append(assistant._chat_ctx)
                if hasattr(session, "history") and session.history and session.history not in target_contexts:
                    target_contexts.append(session.history)
                if hasattr(session, "_chat_ctx") and session._chat_ctx and session._chat_ctx not in target_contexts:
                    target_contexts.append(session._chat_ctx)

                for ctx_obj in target_contexts:
                    if hasattr(ctx_obj, "add_message"):
                        try:
                            if user_prompt or filename:
                                ctx_obj.add_message(role="user", content=f"📎 [Uploaded {file_type.upper()}: {filename}]: {user_prompt}")
                            if analysis_full:
                                ctx_obj.add_message(role="assistant", content=analysis_full)
                        except Exception as he:
                            logger.debug(f"ChatContext sync error: {he}")
                logger.info(f"Synced multimodal file analysis into agent memory ({len(analysis_full)} chars)")

                # Persist to SQLite DB if not already recorded
                active_sid = session_state.get("id")
                if active_sid and (user_prompt or filename or analysis_full):
                    try:
                        existing = history.get_session_messages(active_sid)
                        has_entry = any(filename in m.get("content", "") for m in existing) if filename else False
                        if not has_entry:
                            history.add_message(
                                session_id=active_sid,
                                role="user",
                                content=f"📎 [Uploaded {file_type.upper()}: {filename}]: {user_prompt}",
                                speaker=current_user_name
                            )
                            if analysis_full:
                                history.add_message(
                                    session_id=active_sid,
                                    role="assistant",
                                    content=analysis_full,
                                    speaker="aliph1"
                                )
                    except Exception as dbe:
                        logger.debug(f"DB sync error in speak_utterance: {dbe}")

                if text_to_speak:
                    logger.info(f"aliph1 speaking summary over TTS: '{text_to_speak}'")
                    asyncio.create_task(broadcast_state("speaking"))
                    async def _play_and_finish_speech():
                        try:
                            handle = session.say(text_to_speak, allow_interruptions=True, add_to_chat_ctx=False)
                            if hasattr(handle, "wait_for_complete"):
                                await handle.wait_for_complete()
                        except Exception as se:
                            logger.error(f"Error in session.say: {se}")
                        finally:
                            await broadcast_state("idle")
                    asyncio.create_task(_play_and_finish_speech())

            elif m_type == "user_chat":
                text = msg.get("text", "").strip()
                client_sid = msg.get("session_id")
                session_state["last_turn_speaker"] = current_user_name
                session_state["last_turn_verified"] = True
                if hasattr(llm_inst, "_last_turn_speaker"):
                    llm_inst._last_turn_speaker = current_user_name
                    llm_inst._last_turn_verified = True
                    llm_inst._last_turn_conf = 100.0
                asyncio.create_task(broadcast_speaker(current_user_name, 100.0, True, 0.0))
                if client_sid:
                    session_state["id"] = client_sid
                    if hasattr(llm_inst, "_current_session_id"):
                        llm_inst._current_session_id = client_sid
                    if hasattr(llm_inst, "_session_state"):
                        llm_inst._session_state["id"] = client_sid
                if text:
                    logger.info(f"Received user text input in session {session_state['id']}: '{text}'")
                    # Stop/interrupt any active speech immediately!
                    try:
                        session.interrupt(force=True)
                    except Exception as ie:
                        logger.debug(f"Interrupt error on user_chat: {ie}")

                    # Persist typed user message to history SQLite database
                    try:
                        history.add_message(
                            session_id=session_state["id"],
                            role="user",
                            content=text,
                            speaker=current_user_name
                        )
                    except Exception as he:
                        logger.debug(f"Error persisting user_chat: {he}")

                    llm_inst._pending_reply_text = ""
                    asyncio.create_task(broadcast_state("thinking"))
                    async def run_reply():
                        for _ in range(50):
                            if session_ready:
                                break
                            await asyncio.sleep(0.1)
                        try:
                            rep_h = session.generate_reply(user_input=text)
                            async def _watch_user_reply_complete(h):
                                try:
                                    if hasattr(h, "wait_for_complete"):
                                        await h.wait_for_complete()
                                except Exception:
                                    pass
                                finally:
                                    await broadcast_state("idle")
                            if rep_h:
                                asyncio.create_task(_watch_user_reply_complete(rep_h))
                        except Exception as ge:
                            logger.error(f"Error in generate_reply: {ge}")
                            asyncio.create_task(broadcast_state("idle"))
                    asyncio.create_task(run_reply())

            elif m_type in ("switch_session", "init_session"):
                req_sid = msg.get("session_id")
                if req_sid:
                    session_state["id"] = req_sid
                    logger.info(f"Active session set to: {session_state['id']}")
                    if hasattr(llm_inst, "_current_session_id"):
                        llm_inst._current_session_id = req_sid
                    if hasattr(llm_inst, "_session_state"):
                        llm_inst._session_state["id"] = req_sid
                    nonlocal _is_restoring_history
                    try:
                        _is_restoring_history = True
                        past_msgs = history.get_session_messages(req_sid)
                        target_contexts = []
                        if hasattr(assistant, "_chat_ctx") and assistant._chat_ctx:
                            target_contexts.append(assistant._chat_ctx)
                        if hasattr(session, "history") and session.history and session.history not in target_contexts:
                            target_contexts.append(session.history)
                        if hasattr(session, "_chat_ctx") and session._chat_ctx and session._chat_ctx not in target_contexts:
                            target_contexts.append(session._chat_ctx)

                        for ctx_obj in target_contexts:
                            try:
                                msgs_fn = getattr(ctx_obj, "messages", None)
                                msgs_list = msgs_fn() if callable(msgs_fn) else (msgs_fn or [])
                                while len(msgs_list) > 0:
                                    ctx_obj.remove(msgs_list[0].id)
                                    msgs_list = msgs_fn() if callable(msgs_fn) else (msgs_fn or [])
                                for pm in past_msgs:
                                    r = pm.get("role", "user")
                                    c = pm.get("content", "")
                                    if c:
                                        ctx_obj.add_message(role=r, content=c)
                            except Exception as sub_e:
                                logger.debug(f"Error restoring context: {sub_e}")
                        logger.info(f"Loaded {len(past_msgs)} history items into session brain")
                    except Exception as he:
                        logger.warning(f"Error restoring history: {he}")
                    finally:
                        _is_restoring_history = False
                    asyncio.create_task(broadcast_state("idle", f"Session: {session_state['id']}"))

            elif m_type == "switch_engine":
                new_stt = msg.get("stt")
                new_tts = msg.get("tts")
                new_voice = msg.get("voice")
                new_llm = msg.get("llm")
                cfg_up = {}
                if new_stt:
                    cfg_up["selected_stt"] = new_stt
                if new_tts:
                    cfg_up["selected_tts"] = new_tts
                if new_voice:
                    cfg_up["selected_voice"] = new_voice
                if new_llm:
                    cfg_up["selected_llm"] = new_llm

                save_engine_config(cfg_up)
                reset_cached_stt()
                reset_cached_tts()
                try:
                    session.interrupt(force=True)
                except Exception:
                    pass
                try:
                    new_stt_inst = get_stt(prewarmed_vad=prewarmed_vad)
                    new_tts_inst = get_tts()
                    # LiveKit Agents has no public hot-swap API; private assignment is the
                    # documented workaround. Guard so a future SDK rename degrades to restart notice.
                    try:
                        session._stt = new_stt_inst  # type: ignore[attr-defined]
                        session._tts = new_tts_inst  # type: ignore[attr-defined]
                    except Exception as priv_err:
                        logger.warning(f"Hot-swap STT/TTS via private fields failed ({priv_err}); restart worker to apply.")
                    if new_llm and getattr(session, "_llm", None) is not None:
                        try:
                            setattr(session._llm, "_model", new_llm)
                        except Exception:
                            pass
                except Exception as eng_err:
                    logger.warning(f"Engine rebuild failed, keeping previous engines: {eng_err}")
                logger.info(f"Engines switched: STT={new_stt}, TTS={new_tts}, Voice={new_voice}, LLM={new_llm}")
                asyncio.create_task(broadcast_engines())

            elif m_type == "study_context_update":
                new_ctx = msg.get("context") or {}
                if new_ctx:
                    tools.update_active_study_context(new_ctx)
                    logger.info(f"Updated study context: question={new_ctx.get('question', {}).get('id')}")

            elif m_type == "study_judge_request":
                req_code = msg.get("code", "")
                req_q = msg.get("question") or tools.get_active_study_context().get("question")
                async def _run_judge():
                    res = await asyncio.to_thread(tools.judge_code_with_llm, req_code, req_q)
                    if ctx.room and ctx.room.local_participant:
                        p = json.dumps({
                            "type": "study_code_judged",
                            "is_correct": res.get("is_correct"),
                            "score": res.get("score"),
                            "feedback": res.get("feedback")
                        })
                        await ctx.room.local_participant.publish_data(p.encode())
                asyncio.create_task(_run_judge())

        except Exception as err:
            logger.warning(f"Error parsing data packet: {err}")

    async def broadcast_engines():
        if ctx.room and ctx.room.local_participant:
            try:
                payload = json.dumps({
                    "type": "engines_status",
                    "stt": get_active_stt_info(),
                    "tts": get_active_tts_info()
                })
                await ctx.room.local_participant.publish_data(payload.encode())
            except Exception:
                pass

    @ctx.room.on("participant_connected")
    def on_participant_connected(p: rtc.RemoteParticipant):
        logger.info(f"Participant joined: {p.identity}")
        for pub in p.track_publications.values():
            if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                attach_audio_stream(pub.track, identity=p.identity)
        async def send_ready():
            for _ in range(50):
                if session_ready:
                    break
                await asyncio.sleep(0.1)
            await broadcast_state("idle")
            await broadcast_engines()
            await broadcast_speaker(current_user_name, 100.0, True)
        asyncio.create_task(send_ready())

    await session.start(
        room=ctx.room,
        agent=assistant,
        room_options=RoomOptions(close_on_disconnect=False)
    )
    session_ready = True
    logger.info("Agent session active and listening.")
    await broadcast_state("idle")
    await broadcast_engines()
    await broadcast_speaker(current_user_name, 100.0, True)

if __name__ == "__main__":
    cli.run_app(server)
