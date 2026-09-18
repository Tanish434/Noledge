import os
import sys
import re
import json
import urllib.request
import urllib.error
import logging
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from livekit import api

SRC_DIR = Path(__file__).parent.resolve()
AGENT_DIR = SRC_DIR.parent.resolve()
WEB_DIR = AGENT_DIR / "web"

load_dotenv(AGENT_DIR / ".env", override=True)
load_dotenv(AGENT_DIR / ".env.local", override=True)

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from tools import (
    load_engine_config,
    save_engine_config,
    get_active_stt_info,
    get_active_tts_info,
    is_cartesia_quota_available,
    is_elevenlabs_quota_available,
    reset_cached_stt,
    reset_cached_tts,
    update_env_local,
    VOICE_REGISTRIES,
    get_all_active_gemini_api_keys,
    mark_gemini_key_rate_limited,
    mark_gemini_key_invalid
)
import history

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("agent_server")

app = Flask(__name__, static_folder=str(WEB_DIR))
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route("/")
def index():
    from flask import redirect
    return redirect("http://localhost:3000/", code=302)

@app.route("/<path:path>")
def static_proxy(path):
    resp = send_from_directory(WEB_DIR, path)
    if path.endswith((".js", ".mjs")):
        resp.headers["Content-Type"] = "application/javascript"
    elif path.endswith(".css"):
        resp.headers["Content-Type"] = "text/css"
    elif path.endswith(".svg"):
        resp.headers["Content-Type"] = "image/svg+xml"
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/getToken")
def get_token():
    livekit_url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")

    if not api_key or not api_secret or not livekit_url:
        return jsonify({"error": "LIVEKIT credentials not properly set in .env"}), 500

    name = request.args.get("name", "User")
    identity = request.args.get("identity") or name
    room_name = request.args.get("room", "agent-room")

    token = (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True
        ))
    )

    return jsonify({
        "token": token.to_jwt(),
        "url": livekit_url,
        "room": room_name,
        "identity": identity
    })

@app.route("/api/status")
def get_status():
    livekit_url = os.getenv("LIVEKIT_URL")
    return jsonify({
        "status": "ok",
        "livekit_url": livekit_url,
        "stt": get_active_stt_info(),
        "tts": get_active_tts_info(),
    })

@app.route("/api/engines")
def get_engines():
    cfg = load_engine_config()
    stt_options = [
        {
            "id": "livekit",
            "name": "LiveKit Cloud STT",
            "badge": "⭐ Deepgram Nova-3 (English)",
            "desc": "Real-time English speech recognition (<150ms latency)",
            "available": True
        },
        {
            "id": "speechmatics",
            "name": "Speechmatics STT",
            "badge": "👂 Speechmatics (English)",
            "desc": "Broadcast-grade English precision with acoustic diarization",
            "available": bool(os.getenv("SPEECHMATICS_API_KEY"))
        },
        {
            "id": "google",
            "name": "Google Cloud STT",
            "badge": "⚡ Google Speech (English)",
            "desc": "Google Cloud real-time English speech recognition",
            "available": True
        },
        {
            "id": "cartesia",
            "name": "Cartesia Listen STT",
            "badge": "⚡ Cartesia Listen (English)",
            "desc": "Ultra-low latency English speech transcription",
            "available": is_cartesia_quota_available()
        },
        {
            "id": "elevenlabs",
            "name": "ElevenLabs Scribe",
            "badge": "🎙️ Scribe (English)",
            "desc": "High-accuracy English speech-to-text",
            "available": is_elevenlabs_quota_available()
        }
    ]
    tts_options = [
        {
            "id": "cartesia",
            "name": "Cartesia Sonic-3",
            "badge": "⚡ Cartesia Sarah (English)",
            "desc": "Ultra-low latency (<90ms) conversational natural English tone",
            "available": is_cartesia_quota_available()
        },
        {
            "id": "elevenlabs",
            "name": "ElevenLabs Turbo v2.5",
            "badge": "🎙️ ElevenLabs Rachel (English)",
            "desc": "Studio-quality expressive English voice",
            "available": is_elevenlabs_quota_available()
        },
        {
            "id": "google",
            "name": "Google / Gemini Voice",
            "badge": "⚡ Gemini Voices (Puck, Kore, Aoede)",
            "desc": "Official Google Gemini and Cloud Journey neural voices",
            "available": True
        },
        {
            "id": "livekit",
            "name": "LiveKit Cloud TTS",
            "badge": "⭐ LiveKit Voice (English)",
            "desc": "Real-time cloud voice synthesis with zero-lag streaming",
            "available": True
        }
    ]
    llm_options = [
        {
            "id": "gemini-3.5-flash-lite",
            "name": "Gemini 3.5 Flash Lite",
            "badge": "⭐ Active Primary (High Speed)",
            "desc": "Google's fastest multimodal reasoning brain with verified active quota",
            "available": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
        },
        {
            "id": "gemini-3.5-flash",
            "name": "Gemini 3.5 Flash",
            "badge": "⚡ Deep Multimodal",
            "desc": "Full complex multimodal analysis with OCR, chart generation, and document reasoning",
            "available": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
        },
        {
            "id": "gemini-flash-latest",
            "name": "Gemini Flash Latest",
            "badge": "💡 Auto-Updating",
            "desc": "Google AI flagship Flash model always pinned to the latest release",
            "available": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
        },
        {
            "id": "gemini-pro-latest",
            "name": "Gemini Pro Latest",
            "badge": "🚀 Deep Reasoning",
            "desc": "Maximum reasoning depth and coding analysis",
            "available": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
        }
    ]
    selected_tts = cfg.get("selected_tts", "cartesia")
    return jsonify({
        "success": True,
        "selected_stt": cfg.get("selected_stt", "livekit"),
        "selected_tts": selected_tts,
        "selected_voice": cfg.get("selected_voice") or (VOICE_REGISTRIES.get(selected_tts, [{}])[0].get("id", "") if VOICE_REGISTRIES.get(selected_tts) else ""),
        "selected_llm": cfg.get("selected_llm", "gemini-3.5-flash-lite"),
        "enable_ocr": cfg.get("enable_ocr", True),
        "selected_language": "en",
        "stt": get_active_stt_info(),
        "tts": get_active_tts_info(),
        "stt_options": stt_options,
        "tts_options": tts_options,
        "voice_options": VOICE_REGISTRIES,
        "llm_options": llm_options,
        "model_details": {
            "active_model": cfg.get("selected_llm", "gemini-2.0-flash"),
            "capabilities": [
                "Native PDF OCR & Comprehension (up to 1,000 pages)",
                "High-Resolution Visual Image & Diagram OCR",
                "Direct Speech & Audio Analysis (MP3, WAV, AAC)",
                "Full Video Frame Reasoning (MP4, MOV)",
                "Interactive Chart.js Generation",
                "Chemistry & Mathematical Formula Parsing"
            ],
            "context_window": "1,048,576 tokens",
            "free_tier_limits": "15 RPM • 1,000,000 TPM • 1,500 Requests/Day",
            "pricing": "$0.00 / month (Google AI Studio Free Tier)"
        }
    })

@app.route("/api/engines/switch", methods=["POST"])
def switch_engines():
    try:
        data = request.get_json() or {}
        cfg = {}
        if "stt" in data and data["stt"]:
            cfg["selected_stt"] = data["stt"]
        if "tts" in data and data["tts"]:
            cfg["selected_tts"] = data["tts"]
        if "voice" in data and data["voice"]:
            cfg["selected_voice"] = data["voice"]
        if "llm" in data and data["llm"]:
            cfg["selected_llm"] = data["llm"]
        if "enable_ocr" in data:
            cfg["enable_ocr"] = bool(data["enable_ocr"])
        if "gemini_key" in data and data["gemini_key"].strip():
            update_env_local("GEMINI_API_KEY", data["gemini_key"].strip())
            update_env_local("GOOGLE_API_KEY", data["gemini_key"].strip())
        save_engine_config(cfg)
        reset_cached_stt()
        reset_cached_tts()
        return jsonify({
            "success": True,
            "stt": get_active_stt_info(),
            "tts": get_active_tts_info(),
            "config": load_engine_config()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ocr", methods=["POST"])
@app.route("/api/analyze_file", methods=["POST"])
def perform_ocr_and_analyze():
    """Universal Multimodal Document, Image, Video, and Audio Analyzer via Google Gemini."""
    try:
        data = request.get_json() or {}
        file_base64 = data.get("file") or data.get("image") or ""
        mime_type = data.get("mime_type", "image/png")
        filename = data.get("filename", "file")
        file_type = data.get("file_type") or ("document" if "pdf" in mime_type else "audio" if "audio" in mime_type else "video" if "video" in mime_type else "image")
        prompt = data.get("prompt", "")
        session_id = data.get("session_id")

        if not prompt.strip():
            if "pdf" in mime_type:
                prompt = f"Please read and analyze this PDF document '{filename}'. Provide a comprehensive executive summary, extract all key tables and findings, and format cleanly in Markdown."
            elif "image" in mime_type:
                prompt = f"Please perform OCR and deep visual analysis on this image '{filename}'. Extract all readable text, describe key visual elements, and explain charts or diagrams."
            elif "audio" in mime_type:
                prompt = f"Please listen to and transcribe this audio file '{filename}'. Provide a verbatim transcription and summarize the main conversation topics."
            elif "video" in mime_type:
                prompt = f"Please analyze this video file '{filename}'. Detail the visual scenes, timeline actions, and summarize what occurs throughout the clip."
            else:
                prompt = f"Please thoroughly analyze this file '{filename}' and extract all pertinent details, data, and insights."

        if not file_base64:
            return jsonify({"success": False, "error": "No file data provided"}), 400

        # Remove data URL header if present
        if "," in file_base64:
            file_base64 = file_base64.split(",", 1)[1]

        keys_to_try = get_all_active_gemini_api_keys()
        if not keys_to_try:
            k = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if k:
                keys_to_try = [k.strip()]

        if not keys_to_try:
            return jsonify({"success": False, "error": "Gemini API key not configured"}), 500

        cfg = load_engine_config()
        model = cfg.get("selected_llm", "gemini-3.5-flash-lite")
        priority_fallbacks = [
            "gemini-3.5-flash-lite",
            "gemini-flash-lite-latest",
            "gemini-3.1-flash-lite",
            "gemini-3.5-flash",
            "gemini-flash-latest"
        ]
        models_to_try = [model] + [m for m in priority_fallbacks if m != model]

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": file_base64
                            }
                        }
                    ]
                }
            ],
            "systemInstruction": {
                "parts": [{
                    "text": (
                        "You are aliph1, an articulate, brilliant Executive Voice and Chat AI Assistant.\n\n"
                        "STRICT RULE FOR USER SCOPE & CONSTRAINTS (HIGHEST PRIORITY):\n"
                        "- Always strictly obey the user's specific prompt, requested length, and format.\n"
                        "- If the user asks for a brief answer, a specific word count (e.g. 'in 50 words', 'in 100 words'), a summary, a single paragraph, or answers a specific question: "
                        "provide ONLY what was requested within that exact length. DO NOT append unsolicited executive summaries, deep technical architectures, flowcharts, or tables.\n"
                        "- Only provide comprehensive multi-section breakdowns (such as flowcharts, tables, and in-depth analyses) when the user explicitly requests an exhaustive review, asks for a flowchart/architecture/table, or when no concise length constraint was requested.\n\n"
                        "FORMATTING RULES WHEN FULL ANALYSIS OR DIAGRAMS ARE REQUESTED:\n"
                        "- Present findings with crisp Markdown formatting, bullet points, headers, and clean tables.\n"
                        "- When creating flowcharts, workflows, or system architectures, you MUST ALWAYS enclose the diagram inside a fenced code block tagged ```mermaid (e.g. ```mermaid\ngraph TD\n...\n```). "
                        "Always enclose node labels and arrow pipe labels in double quotes (e.g. A[\"Data Source\"] -->|\"Telemetry\"| B) and name subgraphs like subgraph sg1 [\"Layer 1: Title\"].\n"
                        "- When comparing numerical metrics or data distributions, output interactive Chart.js code blocks tagged ```chart.\n"
                        "- Never output raw LaTeX math formulas for chemical formulas (write CO2, H2O, carbon dioxide naturally).\n\n"
                        "MANDATORY SPOKEN VOICE FEEDBACK BLOCK:\n"
                        "At the very end of your response, ALWAYS provide a dedicated block formatted exactly as:\n"
                        "<<<SPOKEN_SUMMARY>>>\n"
                        "[A natural, engaging 1-2 sentence spoken summary suitable for Text-to-Speech audio output. Address the user directly, highlight the core conclusion, and if appropriate ask a relevant follow-up question.]\n"
                        "<<<END_SPOKEN_SUMMARY>>>"
                    )
                }]
            }
        }

        last_err = None
        for cur_key in keys_to_try:
            for m in models_to_try:
                target_url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={cur_key}"
                try:
                    req = urllib.request.Request(
                        target_url,
                        data=json.dumps(payload).encode("utf-8"),
                        headers={"Content-Type": "application/json", "User-Agent": "aliph1-Multimodal/1.0"}
                    )
                    with urllib.request.urlopen(req, timeout=35) as resp:
                        raw = json.loads(resp.read().decode("utf-8"))
                        text = ""
                        candidates = raw.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            text = "".join(p.get("text", "") for p in parts)

                        # Extract spoken_summary if present with robust regex to catch all delimiter variations
                        spoken_summary = ""
                        spoken_match = re.search(r"<{2,3}\s*(?:SPOKEN_SUMMARY|SUMMARY)?\s*>{2,3}([\s\S]*?)<{2,3}\s*(?:END_SPOKEN_SUMMARY|END_SUMMARY)?\s*>{2,3}", text, re.IGNORECASE)
                        if spoken_match:
                            spoken_summary = spoken_match.group(1).strip()
                            text = text[:spoken_match.start()].rstrip()
                        elif "<<<SPOKEN_SUMMARY>>>" in text:
                            start_idx = text.find("<<<SPOKEN_SUMMARY>>>")
                            spoken_summary = text[start_idx + len("<<<SPOKEN_SUMMARY>>>"):].replace("<<<END_SPOKEN_SUMMARY>>>", "").strip()
                            text = text[:start_idx].rstrip()
                        elif text:
                            # Fallback friendly spoken summary
                            first_line = text.split("\n")[0].replace("#", "").strip()
                            spoken_summary = f"I've completed analyzing your {file_type}. {first_line[:120]}. What would you like to explore or adjust?"

                        # Store in conversation history if session_id provided
                        if session_id and text:
                            try:
                                history.add_message(
                                    session_id=session_id,
                                    role="user",
                                    content=f"📎 [Uploaded {filename}]: {prompt}",
                                    speaker="User"
                                )
                                history.add_message(
                                    session_id=session_id,
                                    role="assistant",
                                    content=text,
                                    speaker="aliph1"
                                )
                            except Exception as db_err:
                                logger.debug(f"History save error: {db_err}")

                        return jsonify({
                            "success": True,
                            "text": text,
                            "spoken_summary": spoken_summary,
                            "filename": filename,
                            "file_type": file_type,
                            "model_used": m
                        })
                except urllib.error.HTTPError as he:
                    last_err = he
                    if he.code == 429:
                        mark_gemini_key_rate_limited(cur_key, 60)
                        logger.warning(f"Gemini key rate-limited (429) on model {m}, switching key/model...")
                        break
                    elif he.code in (400, 403):
                        mark_gemini_key_invalid(cur_key)
                        logger.warning(f"Gemini key invalid/forbidden ({he.code}) on key {cur_key[:10]}..., switching key...")
                        break
                    logger.warning(f"Gemini model {m} HTTP {he.code}: {he.reason}, trying fallback...")
                    continue
                except Exception as ex:
                    last_err = ex
                    logger.warning(f"Model {m} failed for file analysis: {ex}, trying next fallback...")
                    continue

        raise last_err or RuntimeError("All multimodal Gemini keys and models failed.")
    except Exception as e:
        logger.error(f"Multimodal analysis error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/history/search", methods=["GET"])
def search_history():
    try:
        q = request.args.get("q", "").strip()
        results = history.search_sessions(q) if q else history.get_sessions()
        return jsonify({"success": True, "sessions": results})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/history/sessions", methods=["GET"])
def get_history_sessions():
    try:
        sessions = history.get_sessions()
        return jsonify({"success": True, "sessions": sessions})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/history/sessions/new", methods=["POST"])
def create_history_session():
    try:
        data = request.get_json() or {}
        title = data.get("title")
        session = history.create_session(title=title)
        return jsonify({"success": True, "session": session})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/share/<session_id>")
def share_session_page(session_id):
    resp = send_from_directory(WEB_DIR, "share.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/api/share/<session_id>", methods=["GET"])
def api_get_shared_session(session_id):
    try:
        sessions = history.get_sessions()
        sess_meta = next((s for s in sessions if s.get("id") == session_id), None)
        messages = history.get_session_messages(session_id)
        return jsonify({
            "success": True,
            "session": sess_meta or {"id": session_id, "title": "Shared Conversation"},
            "messages": messages
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/history/sessions/<session_id>", methods=["GET"])
def get_session_messages(session_id):
    try:
        messages = history.get_session_messages(session_id)
        return jsonify({"success": True, "session_id": session_id, "messages": messages})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/history/sessions/<session_id>", methods=["PATCH"])
def rename_session_route(session_id):
    try:
        data = request.get_json() or {}
        title = data.get("title", "").strip()
        if not title:
            return jsonify({"success": False, "error": "Title required"}), 400
        ok = history.rename_session(session_id, title)
        return jsonify({"success": ok})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/history/sessions/<session_id>", methods=["DELETE"])
def delete_session_route(session_id):
    try:
        ok = history.delete_session(session_id)
        return jsonify({"success": ok})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/history/clear", methods=["DELETE"])
def clear_all_history_route():
    try:
        ok = history.clear_all_history()
        return jsonify({"success": ok})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/config/keys", methods=["POST"])
def update_api_keys():
    try:
        data = request.get_json() or {}
        gemini_key = data.get("gemini_key")
        if gemini_key:
            os.environ["GEMINI_API_KEY"] = gemini_key.strip()
            os.environ["GOOGLE_API_KEY"] = gemini_key.strip()
        openai_key = data.get("openai_key")
        if openai_key:
            os.environ["OPENAI_API_KEY"] = openai_key.strip()
        groq_key = data.get("groq_key")
        if groq_key:
            os.environ["GROQ_API_KEY"] = groq_key.strip()
        return jsonify({"success": True, "message": "API keys updated"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/speakers", methods=["GET"])
def get_speakers_route():
    try:
        from tools import manage_speakers
        res = manage_speakers(action="list")
        return jsonify(res)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/speakers", methods=["POST"])
def manage_speakers_route():
    try:
        from tools import manage_speakers
        data = request.get_json() or {}
        action = data.get("action", "list")
        name = data.get("name")
        label_id = data.get("label_id")
        res = manage_speakers(action=action, name=name, label_id=label_id)
        return jsonify(res)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# =============================================================================
# Noledge Study & Question Evaluation Endpoints
# =============================================================================

@app.route("/api/study/context", methods=["GET", "POST"])
def study_context_route():
    try:
        from tools import get_active_study_context, update_active_study_context
        if request.method == "POST":
            data = request.get_json() or {}
            ctx = update_active_study_context(data)
            return jsonify({"success": True, "context": ctx})
        else:
            ctx = get_active_study_context()
            return jsonify({"success": True, "context": ctx})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/study/judge-code", methods=["POST"])
def judge_code_route():
    try:
        from tools import judge_code_with_llm, get_active_study_context
        data = request.get_json() or {}
        code = data.get("code", "")
        question = data.get("question") or get_active_study_context().get("question")
        res = judge_code_with_llm(code, question)
        return jsonify({"success": True, **res})
    except Exception as e:
        return jsonify({"success": False, "is_correct": False, "feedback": f"Evaluation error: {str(e)}", "score": 0.0}), 500

@app.route("/api/study/judge-voice", methods=["POST"])
def judge_voice_route():
    try:
        from tools import judge_voice_with_llm, get_active_study_context
        data = request.get_json() or {}
        spoken_answer = data.get("spoken_answer", "")
        question = data.get("question") or get_active_study_context().get("question")
        res = judge_voice_with_llm(spoken_answer, question)
        return jsonify({"success": True, **res})
    except Exception as e:
        return jsonify({"success": False, "is_correct": False, "feedback": f"Evaluation error: {str(e)}", "score": 0.0}), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5050))
    logger.info(f"Starting Agent Web Server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
