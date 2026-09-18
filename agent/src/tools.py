import json
import os
import sys
import time
import logging
import uuid
from pathlib import Path
from typing import Optional, Tuple, Any
from datetime import datetime, timezone
from dotenv import load_dotenv

# Load environment variables
AGENT_ROOT = Path(__file__).parent.parent
_src_dir = Path(__file__).parent.resolve()
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

load_dotenv(AGENT_ROOT / ".env", override=True)
load_dotenv(AGENT_ROOT / ".env.local", override=True)

logger = logging.getLogger("agent_tools")

CONFIG_FILE = Path(__file__).parent / "config_engines.json"
CARTESIA_KEYS_FILE = Path(__file__).parent / "cartesia_keys.json"
ELEVENLABS_KEYS_FILE = Path(__file__).parent / "elevenlabs_keys.json"
SPEAKERS_FILE = Path(__file__).parent / "speakers.json"

_cached_stt = None
_cached_tts = None
_last_audio_snapshot = bytearray()

def get_last_audio_snapshot() -> bytes:
    return bytes(_last_audio_snapshot)

def set_last_audio_snapshot(pcm: bytes):
    global _last_audio_snapshot
    _last_audio_snapshot = bytearray(pcm)

def append_to_audio_snapshot(pcm: bytes):
    if len(_last_audio_snapshot) < 16000 * 2 * 12: # up to 12s buffer
        _last_audio_snapshot.extend(pcm)

def clear_audio_snapshot():
    _last_audio_snapshot.clear()

def load_engine_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading {CONFIG_FILE}: {e}")
    return {"selected_stt": "livekit", "selected_tts": "livekit", "selected_language": "en"}

def save_engine_config(new_config: dict) -> dict:
    cfg = load_engine_config()
    cfg.update(new_config)
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        logger.warning(f"Error saving {CONFIG_FILE}: {e}")
    return cfg

def reset_cached_stt():
    global _cached_stt
    _cached_stt = None

def reset_cached_tts():
    global _cached_tts
    _cached_tts = None

# =========================================================
# Speaker Management & Acoustic Voice Recognition
# =========================================================
def get_current_user_name() -> str:
    """Retrieve primary enrolled user name from speakers.json (S1)."""
    if SPEAKERS_FILE.exists():
        try:
            with open(SPEAKERS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                for entry in data:
                    if entry.get("label_id") == "S1":
                        return entry.get("label", "User")
                if data:
                    return data[0].get("label", "User")
        except Exception:
            pass
    return "User"

def set_primary_user_name(new_name: str) -> bool:
    """Update primary enrolled user name in speakers.json (S1)."""
    clean = new_name.strip().title()
    if not clean:
        return False
    if SPEAKERS_FILE.exists():
        try:
            with open(SPEAKERS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            found = False
            for entry in data:
                if entry.get("label_id") == "S1":
                    entry["label"] = clean
                    found = True
                    break
            if not found and data:
                data[0]["label"] = clean
                found = True
            with open(SPEAKERS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            logger.warning(f"Error updating user name in {SPEAKERS_FILE}: {e}")
    return False

class VoiceBiometricManager:
    """
    Pure acoustic voice biometric identification & speaker recognition engine.
    Extracts 128-dimensional vocal tract resonance fingerprints and pitch frequencies.
    Zero camera or vision required — 100% audio spectral analysis using NumPy.
    """
    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._speakers_file = SPEAKERS_FILE

    def extract_fingerprint(self, audio_pcm: bytes, sample_rate: int = 16000) -> Optional[dict]:
        """Extract 32-dim vocal tract spectral resonance profile & pitch from raw 16-bit PCM."""
        if not audio_pcm or len(audio_pcm) < sample_rate * 2 * 0.2:
            return None

        try:
            import numpy as np

            audio = np.frombuffer(audio_pcm, dtype=np.int16).astype(np.float32) / 32768.0
            if len(audio) < 400:
                return None

            n_fft = 512
            hop = 160
            pad = n_fft // 2

            if len(audio) > pad:
                audio_padded = np.pad(audio, (pad, pad), mode='reflect')
            else:
                audio_padded = np.pad(audio, (pad, pad), mode='constant')

            num_frames = 1 + (len(audio_padded) - n_fft) // hop
            if num_frames < 1:
                return None

            hann = 0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(n_fft) / n_fft))
            frames = np.lib.stride_tricks.sliding_window_view(audio_padded[:n_fft + (num_frames - 1) * hop], window_shape=n_fft)[::hop]
            windowed = frames * hann
            spec = np.abs(np.fft.rfft(windowed, n=n_fft, axis=1)).T
            power_spec = (spec ** 2) / n_fft
            avg_power = np.mean(power_spec, axis=1) # 257 bins

            # 32 Mel filterbanks from 80Hz to 7600Hz for true acoustic vocal tract formants
            n_filters = 32
            low_mel = 2595.0 * np.log10(1.0 + 80.0 / 700.0)
            high_mel = 2595.0 * np.log10(1.0 + 7600.0 / 700.0)
            mel_points = np.linspace(low_mel, high_mel, n_filters + 2)
            hz_points = 700.0 * (10.0 ** (mel_points / 2595.0) - 1.0)
            bin_points = np.clip(np.floor((n_fft + 1) * hz_points / sample_rate).astype(int), 0, 256)

            fbank = np.zeros(n_filters, dtype=np.float32)
            for m in range(1, n_filters + 1):
                f_m_minus = bin_points[m - 1]
                f_m = bin_points[m]
                f_m_plus = bin_points[m + 1]
                if f_m > f_m_minus:
                    fbank[m - 1] += np.sum((np.arange(f_m_minus, f_m) - f_m_minus) / (f_m - f_m_minus) * avg_power[f_m_minus:f_m])
                if f_m_plus > f_m:
                    fbank[m - 1] += np.sum((f_m_plus - np.arange(f_m, f_m_plus)) / (f_m_plus - f_m) * avg_power[f_m:f_m_plus])

            log_fbank = np.log(np.maximum(fbank, 1e-6))

            # DCT-II (32 cepstral coefficients, drop c0 for gain/loudness invariance)
            n_ceps = 32
            m_idx = np.arange(n_filters)
            dct_basis = np.cos(np.pi * np.outer(np.arange(1, n_ceps + 1), m_idx + 0.5) / n_filters)
            ceps = np.dot(dct_basis, log_fbank)

            # Cepstral mean normalization (eliminates common channel/room acoustic tilt)
            ceps_centered = ceps - np.mean(ceps)
            norm = np.linalg.norm(ceps_centered)
            embedding = (ceps_centered / (norm if norm > 1e-6 else 1.0)).tolist()

            # Fundamental pitch frequency estimate (human vocal range 70-350Hz)
            n = len(audio)
            f_audio = np.fft.rfft(audio, n=2*n)
            corr = np.fft.irfft(f_audio * np.conj(f_audio))[:n]
            min_lag = max(1, int(sample_rate / 350))
            max_lag = min(n - 1, int(sample_rate / 70))
            if max_lag > min_lag and len(corr) > max_lag:
                peak = min_lag + int(np.argmax(corr[min_lag:max_lag]))
                pitch = float(sample_rate / peak) if peak > 0 else 135.0
            else:
                pitch = 135.0

            return {
                "embedding": embedding,
                "pitch": round(pitch, 1)
            }
        except Exception as e:
            logger.debug(f"Fingerprint extraction error: {e}")
            return None

    def cosine_similarity(self, v1: list[float], v2: list[float]) -> float:
        import numpy as np
        a = np.array(v1, dtype=np.float32)
        b = np.array(v2, dtype=np.float32)
        dot = np.dot(a, b)
        norm = np.linalg.norm(a) * np.linalg.norm(b)
        return float(dot / norm) if norm > 0 else 0.0

    def verify_voice(self, audio_pcm: bytes) -> dict:
        """
        Verify incoming speaker voice against enrolled profiles in speakers.json.
        Returns:
            identified_name: str
            confidence: float (0.0 to 100.0)
            status: "verified" | "guest"
            verified: bool
            pitch: float
        """
        fp = self.extract_fingerprint(audio_pcm)
        if not fp:
            return {
                "identified_name": "Unknown",
                "confidence": 0.0,
                "status": "guest",
                "verified": False,
                "pitch": 0.0
            }

        speakers: list[dict[str, Any]] = []
        if self._speakers_file.exists():
            try:
                with open(self._speakers_file, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    if isinstance(loaded, list):
                        speakers = [s for s in loaded if isinstance(s, dict)]
            except Exception:
                speakers = []

        # Separate primary owner (S1) and secondary enrolled profiles
        s1_profile: Optional[dict[str, Any]] = next((s for s in speakers if s.get("label_id") == "S1" or str(s.get("label", "")).lower() == "kirito"), None)
        other_profiles: list[dict[str, Any]] = [s for s in speakers if s != s1_profile]

        if not s1_profile and not other_profiles:
            owner_name = get_current_user_name() or "Kirito"
            s1_profile = {
                "user_id": f"usr_{owner_name.lower()}",
                "label": owner_name,
                "label_id": "S1",
                "verified": False,
                "voiceprint": {"embedding": [], "pitch_baseline": 0.0, "samples": 0}
            }

        curr_pitch = float(fp.get("pitch", 0.0) or 0.0)

        def eval_profile(sp: Optional[dict[str, Any]]):
            if not isinstance(sp, dict):
                return 0.0, False
            vp = sp.get("voiceprint")
            emb = vp.get("embedding") if isinstance(vp, dict) else None
            if not emb or len(emb) != len(fp["embedding"]):
                return 0.0, False
            sim = self.cosine_similarity(fp["embedding"], emb)
            base_pitch = float((vp.get("pitch_baseline", 0.0) if isinstance(vp, dict) else 0.0) or sp.get("pitch", 0.0) or 0.0)
            compat = True
            if base_pitch >= 50.0 and curr_pitch >= 50.0:
                pitch_diff = abs(curr_pitch - base_pitch)
                is_octave = (abs(curr_pitch - 2.0 * base_pitch) <= 35.0) or (abs(curr_pitch - 0.5 * base_pitch) <= 20.0)
                if pitch_diff > 110.0 and not is_octave and sim < 0.88:
                    compat = False
            return sim, compat

        # 1. Check Primary Owner S1
        s1_sim, s1_compat = eval_profile(s1_profile) if s1_profile else (0.0, False)

        # 2. Check Secondary Enrolled Speakers
        best_sec_sp: Optional[dict[str, Any]] = None
        best_sec_sim = 0.0
        for sp in other_profiles:
            sim, compat = eval_profile(sp)
            if compat and sim > best_sec_sim:
                best_sec_sim = sim
                best_sec_sp = sp

        # Primary Owner Rule: Vault-grade threshold (>= 80% acoustic resonance correlation)
        if isinstance(s1_profile, dict) and s1_compat and s1_sim >= 0.80:
            # Online adaptation: reinforce vault security with moving average
            try:
                import numpy as np
                vp = s1_profile.get("voiceprint")
                if isinstance(vp, dict):
                    vp_emb = vp.get("embedding")
                    if isinstance(vp_emb, list):
                        emb_arr = np.array(vp_emb, dtype=np.float32)
                        new_emb = np.array(fp["embedding"], dtype=np.float32)
                        samples = int(vp.get("samples", 1))
                        weight = min(samples, 8)
                        updated = (emb_arr * weight + new_emb) / (weight + 1)
                        norm = np.linalg.norm(updated)
                        if norm > 1e-6:
                            vp["embedding"] = (updated / norm).tolist()
                            vp["samples"] = samples + 1
                            s1_profile["label_id"] = "S1"
                            self._save_speakers(speakers)
            except Exception:
                pass

            return {
                "identified_name": s1_profile.get("label", "Kirito"),
                "confidence": round(s1_sim * 100.0, 1),
                "status": "verified",
                "verified": True,
                "label_id": "S1",
                "pitch": fp["pitch"]
            }

        # If primary owner does NOT match, evaluate secondary guest profiles (threshold >= 82%)
        if best_sec_sp and best_sec_sim >= 0.82 and best_sec_sim > (s1_sim + 0.06):
            return {
                "identified_name": best_sec_sp.get("label", "Guest"),
                "confidence": round(best_sec_sim * 100.0, 1),
                "status": "verified",
                "verified": True,
                "label_id": best_sec_sp.get("label_id", "S2"),
                "pitch": fp["pitch"]
            }

        return {
            "identified_name": "Unknown",
            "confidence": round(max(s1_sim, best_sec_sim) * 100.0, 1),
            "status": "unknown",
            "verified": False,
            "label_id": "UNKNOWN",
            "pitch": fp["pitch"]
        }

    def _load_speakers(self) -> list[dict]:
        if self._speakers_file.exists():
            try:
                with open(self._speakers_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _save_speakers(self, speakers: list[dict]):
        try:
            with open(self._speakers_file, "w", encoding="utf-8") as f:
                json.dump(speakers, f, indent=2)
        except Exception as e:
            logger.warning(f"Error saving {self._speakers_file}: {e}")

    def list_speakers(self) -> list[dict]:
        """List all enrolled speakers with their IDs, names, and roles."""
        speakers = self._load_speakers()
        res = []
        for sp in speakers:
            lid = sp.get("label_id", "S1")
            vp = sp.get("voiceprint") or {}
            emb = vp.get("embedding")
            res.append({
                "label_id": lid,
                "name": sp.get("label", "User"),
                "is_primary": (lid == "S1"),
                "has_voiceprint": bool(emb and len(emb) == 128),
                "samples": vp.get("samples", 0),
                "updated_at": sp.get("updated_at", "")
            })
        return res

    def enroll_new_speaker(self, name: str, audio_pcm: Optional[bytes] = None, label_id: Optional[str] = None) -> dict:
        """
        Enroll a new speaker (e.g. S2, S3) with acoustic voiceprint without overwriting S1 (Kirito).
        """
        clean_name = name.strip().title()
        if not clean_name:
            return {"status": "error", "message": "Please provide a valid speaker name."}

        speakers = self._load_speakers()
        now_iso = datetime.now(timezone.utc).isoformat()
        fp = self.extract_fingerprint(audio_pcm) if audio_pcm else None

        # If name is Kirito or explicitly requested S1, update S1
        is_for_s1 = (label_id and label_id.strip().upper() == "S1") or (clean_name.lower() == "kirito")

        if is_for_s1:
            s1 = next((s for s in speakers if s.get("label_id") == "S1"), None)
            if s1:
                s1["label"] = clean_name
                s1["updated_at"] = now_iso
                if fp:
                    prev_pitch = float(s1.get("voiceprint", {}).get("pitch_baseline", 0.0) or 0.0)
                    new_pitch = round(0.75 * prev_pitch + 0.25 * fp["pitch"], 1) if prev_pitch >= 50.0 else fp["pitch"]
                    s1["voiceprint"] = {
                        "embedding": fp["embedding"],
                        "pitch_baseline": new_pitch,
                        "samples": s1.get("voiceprint", {}).get("samples", 0) + 1
                    }
                    s1["verified"] = True
            else:
                s1 = {
                    "user_id": f"usr_{clean_name.lower()}",
                    "label": clean_name,
                    "label_id": "S1",
                    "auth_key": uuid.uuid4().hex,
                    "verified": bool(fp),
                    "speaker_identifiers": ["S1"],
                    "updated_at": now_iso,
                    "voiceprint": {
                        "embedding": fp["embedding"] if fp else [],
                        "pitch_baseline": fp["pitch"] if fp else 0.0,
                        "samples": 1 if fp else 0
                    }
                }
                speakers.insert(0, s1)
            self._save_speakers(speakers)
            return {
                "status": "success",
                "action": "enroll_speaker",
                "label_id": "S1",
                "speaker_name": clean_name,
                "is_primary": True,
                "voice_captured": bool(fp),
                "message": f"Updated primary owner {clean_name} (S1)."
            }

        # Non-primary speaker: check if an existing S2/S3 profile matches this name or ID
        target_sp = None
        if label_id and label_id.strip().upper() != "S1":
            target_sp = next((s for s in speakers if s.get("label_id") == label_id.strip().upper()), None)
        if not target_sp:
            target_sp = next((s for s in speakers if s.get("label_id") != "S1" and s.get("label", "").lower() == clean_name.lower()), None)

        if target_sp:
            target_sp["label"] = clean_name
            target_sp["updated_at"] = now_iso
            if fp:
                prev_pitch = float(target_sp.get("voiceprint", {}).get("pitch_baseline", 0.0) or 0.0)
                new_pitch = round(0.75 * prev_pitch + 0.25 * fp["pitch"], 1) if prev_pitch >= 50.0 else fp["pitch"]
                target_sp["voiceprint"] = {
                    "embedding": fp["embedding"],
                    "pitch_baseline": new_pitch,
                    "samples": target_sp.get("voiceprint", {}).get("samples", 0) + 1
                }
                target_sp["verified"] = True
            lid = target_sp.get("label_id")
        else:
            # Assign next available ID: S2, S3, S4...
            existing_ids = {s.get("label_id", "") for s in speakers}
            n = 2
            while f"S{n}" in existing_ids:
                n += 1
            lid = f"S{n}"

            new_profile = {
                "user_id": f"usr_{clean_name.lower()}_{uuid.uuid4().hex[:6]}",
                "label": clean_name,
                "label_id": lid,
                "verified": bool(fp),
                "voiceprint": {
                    "embedding": fp["embedding"] if fp else [],
                    "pitch_baseline": fp["pitch"] if fp else 0.0,
                    "samples": 1 if fp else 0
                },
                "updated_at": now_iso
            }
            speakers.append(new_profile)

        self._save_speakers(speakers)
        has_voice = bool(fp)
        logger.info(f"Enrolled speaker {clean_name} as {lid} (Voice sample captured: {has_voice}). S1 (Kirito) preserved.")
        return {
            "status": "success",
            "action": "enroll_speaker",
            "label_id": lid,
            "speaker_name": clean_name,
            "is_primary": False,
            "voice_captured": has_voice,
            "message": f"Successfully enrolled {clean_name} as speaker {lid}{' with acoustic voiceprint' if has_voice else ''}. Kirito (S1) remains primary owner."
        }

    def rename_speaker(self, label_id: str, new_name: str) -> dict:
        """Rename an enrolled speaker by label_id (e.g. S1 or S2)."""
        clean_name = new_name.strip().title()
        if not clean_name:
            return {"status": "error", "message": "Please provide a valid new name."}
        lid = label_id.strip().upper() if label_id else "S1"
        speakers = self._load_speakers()
        found = False
        for sp in speakers:
            if sp.get("label_id") == lid:
                sp["label"] = clean_name
                sp["updated_at"] = datetime.now(timezone.utc).isoformat()
                found = True
                break
        if not found:
            return {"status": "error", "message": f"Speaker with ID {lid} not found."}

        self._save_speakers(speakers)
        return {
            "status": "success",
            "action": "rename_speaker",
            "label_id": lid,
            "speaker_name": clean_name,
            "is_primary": (lid == "S1"),
            "message": f"Successfully renamed speaker {lid} to {clean_name}."
        }

    def delete_speaker(self, label_id: str) -> dict:
        """Delete an enrolled speaker by label_id (S2, S3, etc.). S1 cannot be deleted."""
        lid = label_id.strip().upper() if label_id else ""
        if not lid or lid == "S1":
            return {
                "status": "error",
                "message": "Cannot delete primary owner (S1: Kirito). You may rename S1, but S1 cannot be deleted."
            }
        speakers = self._load_speakers()
        orig_len = len(speakers)
        removed_name = None
        remaining = []
        for sp in speakers:
            if sp.get("label_id") == lid:
                removed_name = sp.get("label")
            else:
                remaining.append(sp)

        if len(remaining) == orig_len:
            return {"status": "error", "message": f"Speaker {lid} not found."}

        self._save_speakers(remaining)
        logger.info(f"Deleted speaker {lid} ({removed_name})")
        return {
            "status": "success",
            "action": "delete_speaker",
            "label_id": lid,
            "deleted_name": removed_name,
            "message": f"Successfully removed speaker {lid} ({removed_name})."
        }

    def reset_all_vectors(self) -> dict:
        """Reset/refresh all acoustic voice vectors in speakers.json so fresh vectors can be calibrated."""
        now_iso = datetime.now(timezone.utc).isoformat()
        clean_profile = [{
            "user_id": "usr_kirito",
            "label": "Kirito",
            "label_id": "S1",
            "auth_key": uuid.uuid4().hex,
            "verified": False,
            "speaker_identifiers": ["S1"],
            "updated_at": now_iso,
            "voiceprint": {
                "embedding": [],
                "pitch_baseline": 0.0,
                "samples": 0
            }
        }]
        self._save_speakers(clean_profile)
        logger.info("Purged all voice vectors. S1 (Kirito) reset to uncalibrated.")
        return {
            "status": "success",
            "action": "reset_vectors",
            "message": "All voice vectors have been refreshed and cleared. Kirito (S1) is ready for clean calibration."
        }

    def enroll_speaker(self, name: str, label_id: str, audio_pcm: bytes) -> bool:
        """Enroll or update speaker profile with acoustic voiceprint in speakers.json."""
        res = self.enroll_new_speaker(name=name, audio_pcm=audio_pcm, label_id=label_id)
        return res.get("status") == "success"

def manage_speakers(action: str, name: Optional[str] = None, label_id: Optional[str] = None, audio_pcm: Optional[bytes] = None) -> dict:
    mgr = VoiceBiometricManager.get_instance()
    act = (action or "list").strip().lower()
    if act in ("reset", "reset_vectors", "refresh", "refresh_vectors", "clear"):
        return mgr.reset_all_vectors()
    elif act == "list":
        sp_list = mgr.list_speakers()
        return {"status": "success", "action": "list_speakers", "total": len(sp_list), "speakers": sp_list}
    elif act in ("enroll", "add"):
        return mgr.enroll_new_speaker(name=name or "Guest", audio_pcm=audio_pcm, label_id=label_id)
    elif act == "rename":
        target_lid = (label_id or "").strip().upper()
        if not target_lid and name:
            for sp in mgr.list_speakers():
                if sp.get("name", "").lower() == name.strip().lower():
                    target_lid = sp.get("label_id")
                    break
        return mgr.rename_speaker(label_id=target_lid or "S1", new_name=name or "")
    elif act in ("delete", "remove"):
        target_lid = (label_id or "").strip().upper()
        if not target_lid and name:
            for sp in mgr.list_speakers():
                if sp.get("name", "").lower() == name.strip().lower():
                    target_lid = sp.get("label_id")
                    break
        return mgr.delete_speaker(label_id=target_lid or "")
    return {"status": "error", "message": f"Unknown action '{action}'. Supported: list, enroll, rename, delete."}

# =========================================================
# LiveKit Credentials Pool
# =========================================================
def get_all_active_livekit_credentials() -> list[dict]:
    creds = []
    k1 = os.getenv("LIVEKIT_API_KEY")
    s1 = os.getenv("LIVEKIT_API_SECRET")
    u1 = os.getenv("LIVEKIT_URL")
    if k1 and s1:
        creds.append({"label": "Primary Account", "api_key": k1.strip(), "api_secret": s1.strip(), "url": u1})

    k2 = os.getenv("LIVEKIT_API_KEY_2")
    s2 = os.getenv("LIVEKIT_API_SECRET_2")
    u2 = os.getenv("LIVEKIT_URL_2") or u1
    if k2 and s2:
        creds.append({"label": "Account 2", "api_key": k2.strip(), "api_secret": s2.strip(), "url": u2})

    k3 = os.getenv("LIVEKIT_API_KEY_3")
    s3 = os.getenv("LIVEKIT_API_SECRET_3")
    u3 = os.getenv("LIVEKIT_URL_3") or u1
    if k3 and s3:
        creds.append({"label": "Account 3", "api_key": k3.strip(), "api_secret": s3.strip(), "url": u3})

    return creds

def is_valid_token(k: Optional[str]) -> bool:
    if not k or not isinstance(k, str):
        return False
    clean = k.strip()
    if len(clean) < 12:
        return False
    lower = clean.lower()
    if any(bad in lower for bad in ["test", "redacted", "xxxx", "dummy", "placeholder", "fake"]):
        return False
    return True

# =========================================================
# Base Quota & Multi-Account Key Pool Manager
# =========================================================
class BaseQuotaKeyManager:
    """Reusable base manager for multi-key quota rotation, health checks, and persistence."""
    def __init__(self, keys_file: Path, env_vars: list[str], csv_env_var: str, default_limit: int = 10000):
        self._keys_file = keys_file
        self._env_vars = env_vars
        self._csv_env_var = csv_env_var
        self._default_limit = default_limit
        self._cached_records = None
        self._last_refresh_time: float = 0.0

    def get_all_configured_keys(self) -> list[str]:
        discovered = []
        for var in self._env_vars:
            val = os.getenv(var, "").strip()
            if val and not val.startswith("sk-xxxx") and val not in discovered:
                discovered.append(val)
        csv_keys = os.getenv(self._csv_env_var, "")
        if csv_keys:
            for piece in csv_keys.split(","):
                k = piece.strip()
                if k and not k.startswith("sk-xxxx") and k not in discovered:
                    discovered.append(k)
        return discovered

    def _load_records(self) -> dict:
        if self._keys_file.exists():
            try:
                with open(self._keys_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"keys": {}, "last_synced": 0}

    def _save_records(self, data: dict):
        try:
            with open(self._keys_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    def mark_exhausted(self, api_key: str):
        data = self._load_records()
        records_map = data.get("keys", {})
        if api_key in records_map:
            records_map[api_key]["status"] = "exhausted"
            data["keys"] = records_map
            self._save_records(data)
            self._cached_records = None
            self._last_refresh_time = 0.0

    def sync_and_get_records(self, force_remote_check: bool = False) -> list[dict]:
        now = time.time()
        if not force_remote_check and self._cached_records is not None and (now - self._last_refresh_time) < 60:
            return self._cached_records

        all_keys = self.get_all_configured_keys()
        if not all_keys:
            self._cached_records = []
            return []

        data = self._load_records()
        records_map = data.get("keys", {})
        key_pool = []

        for idx, key in enumerate(all_keys, 1):
            key_id = f"Account_{idx}_{key[:8]}...{key[-6:]}"
            rec = records_map.get(key, {})
            reset_unix = rec.get("reset_unix", 0)
            if reset_unix > 0 and now >= reset_unix:
                rec["character_count"] = 0
                rec["status"] = "active"
                rec["reset_unix"] = int(now + 30 * 86400)

            if not is_valid_token(key):
                continue

            if not rec:
                rec = {
                    "key_id": key_id,
                    "api_key": key,
                    "tier": "starter",
                    "character_count": 0,
                    "character_limit": self._default_limit,
                    "status": "active",
                    "reset_unix": int(now + 30 * 86400),
                    "last_checked": int(now),
                }
            if rec.get("reset_unix"):
                rec["days_until_reset"] = max(0, int((rec["reset_unix"] - now) / 86400))
            records_map[key] = rec
            key_pool.append(rec)

        data["keys"] = records_map
        data["last_synced"] = int(now)
        self._save_records(data)
        self._cached_records = key_pool
        self._last_refresh_time = now
        return key_pool

    def get_active_key(self) -> Optional[str]:
        pool = self.sync_and_get_records(force_remote_check=False)
        for rec in pool:
            if rec.get("status") == "active" and is_valid_token(rec.get("api_key")):
                return rec.get("api_key")
        return None

    def get_all_active_keys(self) -> list[str]:
        pool = self.sync_and_get_records(force_remote_check=False)
        active: list[str] = [str(rec["api_key"]) for rec in pool if rec.get("status") == "active" and is_valid_token(rec.get("api_key"))]
        if not active:
            for v in self._env_vars:
                env_k = os.getenv(v)
                if env_k and is_valid_token(env_k):
                    clean_env = env_k.strip()
                    is_exhausted = any(rec.get("api_key") == clean_env and rec.get("status") == "exhausted" for rec in pool)
                    if not is_exhausted and clean_env not in active:
                        active.append(clean_env)
        return active

    def mark_exhausted(self, api_key: str, reset_in_days: int = 30):
        data = self._load_records()
        records_map = data.get("keys", {})
        now = time.time()
        for k, rec in records_map.items():
            if k == api_key or rec.get("api_key") == api_key:
                rec["status"] = "exhausted"
                rec["reset_unix"] = int(now + reset_in_days * 86400)
                rec["days_until_reset"] = reset_in_days
                rec["last_checked"] = int(now)
                break
        self._save_records(data)
        self._cached_records = None
        reset_cached_tts()

# =========================================================
# ElevenLabs Key Manager
# =========================================================
class ElevenLabsKeyManager(BaseQuotaKeyManager):
    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        super().__init__(
            keys_file=ELEVENLABS_KEYS_FILE,
            env_vars=["ELEVEN_API_KEY", "ELEVENLABS_API_KEY", "ELEVEN_API_KEY_2", "ELEVEN_API_KEY_3"],
            csv_env_var="ELEVEN_API_KEYS",
            default_limit=10000
        )

def is_elevenlabs_quota_available() -> bool:
    return ElevenLabsKeyManager.get_instance().get_active_key() is not None

def get_active_elevenlabs_api_key() -> Optional[str]:
    return ElevenLabsKeyManager.get_instance().get_active_key()

def get_all_active_elevenlabs_api_keys() -> list[str]:
    return ElevenLabsKeyManager.get_instance().get_all_active_keys()

# =========================================================
# Cartesia Key Manager
# =========================================================
class CartesiaKeyManager(BaseQuotaKeyManager):
    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        super().__init__(
            keys_file=CARTESIA_KEYS_FILE,
            env_vars=["CARTESIA_API_KEY", "CARTESIA_API_KEY_2", "CARTESIA_API_KEY_3", "CARTESIA_API_KEY_4"],
            csv_env_var="CARTESIA_API_KEYS",
            default_limit=30000
        )

def is_cartesia_quota_available() -> bool:
    return CartesiaKeyManager.get_instance().get_active_key() is not None

def get_active_cartesia_api_key() -> Optional[str]:
    return CartesiaKeyManager.get_instance().get_active_key()

def get_all_active_cartesia_api_keys() -> list[str]:
    return CartesiaKeyManager.get_instance().get_all_active_keys()

def mark_cartesia_key_exhausted(api_key: str):
    CartesiaKeyManager.get_instance().mark_exhausted(api_key)

def mark_elevenlabs_key_exhausted(api_key: str):
    ElevenLabsKeyManager.get_instance().mark_exhausted(api_key)

# =========================================================
# Gemini Multi-Account Key Pool & Automatic Cooldown
# =========================================================
class GeminiKeyManager:
    _instance = None

    def __init__(self):
        self._cooldowns: dict[str, float] = {}  # api_key -> cooldown_until_unix

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = GeminiKeyManager()
        return cls._instance

    def _load_records(self) -> dict:
        gemini_file = Path(__file__).parent / "gemini_keys.json"
        if gemini_file.exists():
            try:
                with open(gemini_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"keys": {}}

    def get_all_active_keys(self) -> list[str]:
        now = time.time()
        candidates = []

        # 1. First check local agent/.env and agent/.env.local directly so project keys take precedence
        for ef_name in [".env.local", ".env"]:
            try:
                env_file = Path(__file__).parent.parent / ef_name
                if env_file.exists():
                    with open(env_file, "r", encoding="utf-8") as ef:
                        for line in ef:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k_name, _, k_val = line.partition("=")
                                k_name = k_name.strip()
                                k_val = k_val.strip().strip("'\"")
                                if ("GEMINI" in k_name or "GOOGLE" in k_name) and "PROJECT" not in k_name:
                                    if k_val and k_val not in candidates:
                                        candidates.append(k_val)
            except Exception:
                pass

        # 2. Check gemini_keys.json records
        data = self._load_records()
        for k, rec in data.get("keys", {}).items():
            key_str = rec.get("api_key") or k
            if key_str and key_str not in candidates:
                candidates.append(key_str)

        # 3. Check environment variables
        for var in ["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GOOGLE_API_KEY", "GOOGLE_API_KEY_2"]:
            v = os.getenv(var)
            if v and v.strip() and v.strip() not in candidates:
                candidates.append(v.strip())

        # 4. Keep genuine Google Gemini keys (starts with AQ., or genuine AIzaSy, excluding known broken test keys)
        all_keys = [
            k for k in candidates
            if len(k) >= 20 and is_valid_token(k) and not k.startswith("sk-") and not k.startswith("AIzaSyBZw7O8kE9")
        ]

        # 5. Filter out currently cooled-down keys
        active = []
        for k in all_keys:
            cd = self._cooldowns.get(k, 0)
            if cd > now:
                continue
            active.append(k)

        return active

    def get_active_key(self) -> Optional[str]:
        keys = self.get_all_active_keys()
        return keys[0] if keys else None

    def mark_rate_limited(self, api_key: str, cooldown_seconds: int = 60):
        logger.warning(f"Gemini key {mask_key(api_key)} rate-limited (429/quota). Setting {cooldown_seconds}s cooldown.")
        self._cooldowns[api_key] = time.time() + cooldown_seconds

    def mark_invalid(self, api_key: str):
        logger.warning(f"Gemini key {mask_key(api_key)} invalid/forbidden (400/403). Temporarily disabling.")
        self._cooldowns[api_key] = time.time() + 3600

def get_active_gemini_api_key() -> Optional[str]:
    return GeminiKeyManager.get_instance().get_active_key()

def get_all_active_gemini_api_keys() -> list[str]:
    return GeminiKeyManager.get_instance().get_all_active_keys()

def mark_gemini_key_rate_limited(api_key: str, cooldown_seconds: int = 60):
    GeminiKeyManager.get_instance().mark_rate_limited(api_key, cooldown_seconds)

def mark_gemini_key_invalid(api_key: str):
    GeminiKeyManager.get_instance().mark_invalid(api_key)


# =========================================================
# STT Engine Construction & Fallbacks
# =========================================================
def get_stt(prewarmed_vad=None, language: Optional[str] = None):
    global _cached_stt
    if _cached_stt is not None:
        return _cached_stt

    providers = []

    # 1. Speechmatics STT (Primary Verified STT - High-Speed & Accurate)
    sm_key = os.getenv("SPEECHMATICS_API_KEY", "").strip()
    if sm_key:
        try:
            from livekit.plugins import speechmatics
            sm_lang = os.getenv("SPEECHMATICS_LANGUAGE", "en").strip().lower()
            if sm_lang in ("auto", "multi", "multilingual", ""):
                sm_lang = "en"
            providers.append(speechmatics.STT(
                api_key=sm_key,
                language=sm_lang,
                enable_diarization=False
            ))
            logger.info("✅ Prioritized Speechmatics STT as primary speech recognizer")
        except Exception as e:
            logger.warning(f"Could not load Speechmatics STT: {e}")

    # 2. LiveKit Cloud Inference STT (Deepgram Nova-3 / Nova-2 English Only)
    lk_creds = get_all_active_livekit_credentials()
    if lk_creds:
        try:
            from livekit.agents import inference
            for c in lk_creds:
                try:
                    providers.append(inference.STT(
                        model="deepgram/nova-3",
                        language="en",
                        api_key=c["api_key"],
                        api_secret=c["api_secret"],
                        extra_kwargs={"smart_format": True, "punctuate": True}
                    ))
                except Exception as ex:
                    logger.warning(f"Could not init LiveKit Nova-3 STT: {ex}")
                try:
                    providers.append(inference.STT(
                        model="deepgram/nova-2",
                        language="en",
                        api_key=c["api_key"],
                        api_secret=c["api_secret"],
                        extra_kwargs={"smart_format": True, "punctuate": True}
                    ))
                except Exception as ex:
                    logger.warning(f"Could not init LiveKit Nova-2 STT: {ex}")
        except Exception as e:
            logger.warning(f"Could not load inference STT: {e}")

    # 3. ElevenLabs Scribe STT (Only if explicitly selected)
    cfg = load_engine_config()
    if cfg.get("selected_stt") == "elevenlabs":
        el_keys = get_all_active_elevenlabs_api_keys()
        if el_keys:
            try:
                from livekit.plugins import elevenlabs
                for ek in el_keys:
                    providers.append(elevenlabs.STT(
                        api_key=ek.strip(),
                        model="scribe_v2_realtime",
                        tag_audio_events=False,
                        no_verbatim=True
                    ))
            except Exception as ex:
                logger.warning(f"Could not load ElevenLabs STT: {ex}")

    # 4. Google Cloud / Gemini STT
    if cfg.get("selected_stt") in ["google", "gemini"]:
        try:
            from livekit.plugins import google
            providers.append(google.STT(languages="en-US"))
        except Exception as ex:
            logger.warning(f"Could not load Google STT: {ex}")

    cfg = load_engine_config()
    selected = cfg.get("selected_stt", "livekit")

    if selected == "speechmatics":
        providers.sort(key=lambda p: 0 if "speechmatics" in type(p).__module__.lower() else 1)
    elif selected == "livekit":
        providers.sort(key=lambda p: 0 if "inference" in type(p).__module__.lower() else 1)
    elif selected == "elevenlabs":
        providers.sort(key=lambda p: 0 if "elevenlabs" in type(p).__module__.lower() else 1)
    elif selected in ["google", "gemini"]:
        providers.sort(key=lambda p: 0 if "google" in type(p).__module__.lower() else 1)

    if not providers:
        from livekit.agents import inference
        return inference.STT(model="deepgram/nova-3", language="en")

    if len(providers) == 1:
        _cached_stt = providers[0]
        return _cached_stt

    # Wrap in LiveKit FallbackAdapter
    try:
        from livekit.agents.stt import FallbackAdapter
        _cached_stt = FallbackAdapter(providers)
        return _cached_stt
    except Exception:
        _cached_stt = providers[0]
        return _cached_stt

# =========================================================
# TTS Voice Registries & Persona Presets
# =========================================================
CARTESIA_VOICES = [
    {"id": "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc", "name": "Jacqueline (Reassuring & Professional Female)", "gender": "female"},
    {"id": "694f9389-aac1-45b6-b726-9d9369183238", "name": "Sarah (Mindful & Soothing Female)", "gender": "female"},
    {"id": "2747b6cf-fa34-460c-97db-267566918881", "name": "Allie (Natural & Friendly Female)", "gender": "female"},
    {"id": "79a125e8-cd45-4c13-8a67-188112f4dd22", "name": "British Reading Lady (Sophisticated Female)", "gender": "female"},
    {"id": "156fb8d2-335b-4950-9cb3-a2d33befec77", "name": "Sunny (Upbeat & Clear Female)", "gender": "female"},
    {"id": "c45bc5ec-5968-4f95-a226-b81b2a472c21", "name": "Commercial Man (Confident & Clear Male)", "gender": "male"},
    {"id": "4f7f1324-1853-48a6-b294-4e78e8036a83", "name": "Casper (Gentle Narrator Male)", "gender": "male"},
    {"id": "69267136-1bdc-4103-a11a-70e5586bd382", "name": "British Reading Man (Polite & Articulate Male)", "gender": "male"},
    {"id": "a0e99841-438c-4a64-b679-ae501e7d6091", "name": "Greg (Deep & Warm Support Male)", "gender": "male"},
    {"id": "ee7ea9f8-c0c1-498e-9279-764d6b56d189", "name": "Madam (Refined & Elegant Female)", "gender": "female"},
    {"id": "b34e8f77-9fcb-48d6-9635-433967885b5d", "name": "Newsman (Authoritative Anchor Male)", "gender": "male"},
    {"id": "367f1b7d-66e2-4113-9112-9c719cb6ff0d", "name": "Storyteller (Expressive Audiobook Male)", "gender": "male"},
]

ELEVENLABS_VOICES = [
    {"id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel (Calm & Natural Female)", "gender": "female"},
    {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Bella (Soft & Expressive Female)", "gender": "female"},
    {"id": "pNInz6obpgDQGcFmaJgB", "name": "Adam (Deep & Narrator Male)", "gender": "male"},
    {"id": "ErXwobaYiN019PkySvjV", "name": "Antoni (Smooth & Crisp Male)", "gender": "male"},
    {"id": "piTKgcLEGmTX4duSTGNx", "name": "Nicole (Whispering & Gentle Female)", "gender": "female"},
    {"id": "JBFqnCBsd6RMkjVDRZzb", "name": "George (Warm British Male)", "gender": "male"},
    {"id": "AZnzlk1XvdvUeBnXmlld", "name": "Domi (Confident & Clear Female)", "gender": "female"},
    {"id": "MF3mGyEYCl7XYWbV9V6O", "name": "Elli (Youthful & Bright Female)", "gender": "female"},
    {"id": "yoZ06aMxZJJ28mfd3POQ", "name": "Sam (Dynamic American Male)", "gender": "male"},
    {"id": "IKne3meq5aSn9XLyUdCD", "name": "Charlie (Conversational & Warm Male)", "gender": "male"},
    {"id": "TX3LPaxmHKxFdv7VOQHJ", "name": "Liam (Crisp & Engaging Male)", "gender": "male"},
]

GOOGLE_VOICES = [
    {"id": "Puck", "name": "Puck (Upbeat & Energetic Male)", "gender": "male"},
    {"id": "Charon", "name": "Charon (Calm & Deep Male)", "gender": "male"},
    {"id": "Kore", "name": "Kore (Friendly & Soothing Female)", "gender": "female"},
    {"id": "Fenrir", "name": "Fenrir (Confident & Bold Male)", "gender": "male"},
    {"id": "Aoede", "name": "Aoede (Warm & Articulate Female)", "gender": "female"},
    {"id": "en-US-Journey-F", "name": "Journey Female (Natural & Expressive)", "gender": "female"},
    {"id": "en-US-Journey-D", "name": "Journey Male (Natural & Engaging)", "gender": "male"},
    {"id": "en-US-Neural2-F", "name": "Neural2 Female (Crisp & Studio)", "gender": "female"},
    {"id": "en-US-Neural2-D", "name": "Neural2 Male (Authoritative & Clear)", "gender": "male"},
]

LIVEKIT_VOICES = [
    {"id": "alloy", "name": "Alloy (Neutral & Balanced)", "gender": "neutral"},
    {"id": "echo", "name": "Echo (Warm & Grounded Male)", "gender": "male"},
    {"id": "fable", "name": "Fable (Expressive British Neutral)", "gender": "neutral"},
    {"id": "onyx", "name": "Onyx (Deep & Authoritative Male)", "gender": "male"},
    {"id": "nova", "name": "Nova (Energetic & Friendly Female)", "gender": "female"},
    {"id": "shimmer", "name": "Shimmer (Clear & Gentle Female)", "gender": "female"},
]

VOICE_REGISTRIES = {
    "cartesia": CARTESIA_VOICES,
    "elevenlabs": ELEVENLABS_VOICES,
    "google": GOOGLE_VOICES,
    "gemini": GOOGLE_VOICES,
    "livekit": LIVEKIT_VOICES,
}

def get_voice_options_for_engine(engine_id: str):
    return VOICE_REGISTRIES.get(engine_id.lower().strip(), [])

# =========================================================
# TTS Engine Construction & Fallbacks
# =========================================================
def get_tts():
    global _cached_tts
    if _cached_tts is not None:
        return _cached_tts

    cfg = load_engine_config()
    selected = cfg.get("selected_tts", "cartesia")
    chosen_voice = cfg.get("selected_voice")

    tts_providers = []

    # 1. Cartesia Sonic-3
    cart_voice = chosen_voice if chosen_voice and any(v["id"] == chosen_voice for v in CARTESIA_VOICES) else "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
    cart_keys = get_all_active_cartesia_api_keys()
    if cart_keys:
        try:
            from livekit.plugins import cartesia
            for ck in cart_keys:
                try:
                    t = cartesia.TTS(
                        api_key=ck.strip(),
                        model="sonic-3",
                        voice=cart_voice,
                        speed=1.05
                    )
                    tts_providers.append(t)
                except Exception as ex:
                    logger.warning(f"Cartesia TTS init error: {ex}")
        except Exception as e:
            logger.warning(f"Could not load Cartesia plugin: {e}")

    # 2. ElevenLabs Studio TTS
    el_voice = chosen_voice if chosen_voice and any(v["id"] == chosen_voice for v in ELEVENLABS_VOICES) else os.getenv("ELEVEN_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    el_keys = get_all_active_elevenlabs_api_keys()
    if el_keys:
        try:
            from livekit.plugins import elevenlabs
            for ek in el_keys:
                try:
                    t = elevenlabs.TTS(
                        api_key=ek.strip(),
                        model="eleven_turbo_v2_5",
                        voice_id=el_voice,
                        encoding="pcm_48000"
                    )
                    tts_providers.append(t)
                except Exception as ex:
                    logger.warning(f"ElevenLabs TTS init error: {ex}")
        except Exception as e:
            logger.warning(f"Could not load ElevenLabs plugin: {e}")

    # 3. Google Cloud / Gemini TTS (Included in fallback pool)
    try:
        from livekit.plugins import google
        g_voice = chosen_voice if chosen_voice and any(v["id"] == chosen_voice for v in GOOGLE_VOICES) else "en-US-Journey-F"
        tts_providers.append(google.TTS(voice_name=g_voice, language="en-US"))
    except Exception as ge:
        logger.debug(f"Google TTS init: {ge}")

    # 4. LiveKit Cloud Inference TTS (Cartesia sonic-3 or OpenAI tts-1)
    lk_creds = get_all_active_livekit_credentials()
    if lk_creds:
        try:
            from livekit.agents import inference
            lk_voice = chosen_voice if chosen_voice and any(v["id"] == chosen_voice for v in LIVEKIT_VOICES) else cart_voice
            for c in lk_creds:
                try:
                    tts_providers.append(inference.TTS(
                        model="cartesia/sonic-3",
                        voice=lk_voice,
                        api_key=c["api_key"],
                        api_secret=c["api_secret"]
                    ))
                except Exception as ex:
                    logger.warning(f"LiveKit Cloud TTS init error: {ex}")
        except Exception as e:
            logger.warning(f"Could not load inference TTS: {e}")

    # Reorder according to user selection
    if selected == "elevenlabs":
        tts_providers.sort(key=lambda p: 0 if "elevenlabs" in type(p).__module__.lower() else 1)
    elif selected == "cartesia":
        tts_providers.sort(key=lambda p: 0 if "cartesia" in type(p).__module__.lower() else 1)
    elif selected in ["google", "gemini"]:
        tts_providers.sort(key=lambda p: 0 if "google" in type(p).__module__.lower() else 1)
    elif selected == "livekit":
        tts_providers.sort(key=lambda p: 0 if "inference" in type(p).__module__.lower() else 1)

    if not tts_providers:
        from livekit.agents import inference
        return inference.TTS(model="cartesia/sonic-3", voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc")

    if len(tts_providers) == 1:
        _cached_tts = tts_providers[0]
        return _cached_tts

    try:
        from livekit.agents.tts import FallbackAdapter
        _cached_tts = FallbackAdapter(tts_providers)
        return _cached_tts
    except Exception:
        _cached_tts = tts_providers[0]
        return _cached_tts

# =========================================================
# Status Inspection Helpers
# =========================================================
def get_active_stt_info() -> dict:
    cfg = load_engine_config()
    selected = cfg.get("selected_stt", "livekit")
    return {
        "id": selected,
        "name": f"LiveKit Cloud STT ({selected.capitalize()})",
        "badge": "⭐ LiveKit STT (Deepgram Nova-3 English)",
        "is_fallback": False
    }

def get_active_tts_info() -> dict:
    cfg = load_engine_config()
    selected = cfg.get("selected_tts", "cartesia")
    return {
        "id": selected,
        "name": f"Text-to-Speech ({selected.capitalize()})",
        "badge": "🎙️ High-Fidelity English Voice",
        "is_fallback": False
    }

# =========================================================
# Multi-Account API Key Pool & Dynamic Engine Switching
# =========================================================
LIVEKIT_KEYS_FILE = Path(__file__).parent / "livekit_keys.json"
GEMINI_KEYS_FILE = Path(__file__).parent / "gemini_keys.json"
SPEECHMATICS_KEYS_FILE = Path(__file__).parent / "speechmatics_keys.json"

def mask_key(key: str) -> str:
    if not key or len(key) < 8:
        return "***"
    return f"{key[:6]}...{key[-4:]}"

def _get_service_file(service: str) -> Tuple[Path, str]:
    srv = service.lower().strip()
    if "cartesia" in srv:
        return CARTESIA_KEYS_FILE, "CARTESIA_API_KEY"
    elif "eleven" in srv:
        return ELEVENLABS_KEYS_FILE, "ELEVEN_API_KEY"
    elif "speech" in srv:
        return SPEECHMATICS_KEYS_FILE, "SPEECHMATICS_API_KEY"
    elif "gemini" in srv or "google" in srv:
        return GEMINI_KEYS_FILE, "GEMINI_API_KEY"
    elif "livekit" in srv:
        return LIVEKIT_KEYS_FILE, "LIVEKIT_API_KEY"
    raise ValueError(f"Unsupported service: {service}. Supported: cartesia, elevenlabs, gemini, speechmatics, livekit")

def _load_pool(file_path: Path) -> dict:
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"keys": {}, "last_synced": int(time.time())}

def _save_pool(file_path: Path, data: dict):
    data["last_synced"] = int(time.time())
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.warning(f"Error saving {file_path}: {e}")

def _write_env_var(target_file: Path, var_name: str, var_value: str):
    lines = []
    found = False
    if target_file.exists():
        try:
            with open(target_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except Exception:
            lines = []
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{var_name}="):
            new_lines.append(f"{var_name}={var_value}\n")
            found = True
        else:
            new_lines.append(line)
    if not found:
        insert_idx = -1
        # Try finding plural counterpart (e.g. CARTESIA_API_KEYS= for CARTESIA_API_KEY_5)
        prefix_base = var_name.rsplit('_', 1)[0] if '_' in var_name else var_name
        plural_target = f"{prefix_base}S="

        for idx, line in enumerate(new_lines):
            if line.strip().startswith(plural_target):
                insert_idx = idx
                break

        # If no plural target found, try placing after the last occurrence of the service prefix
        if insert_idx == -1 and "_" in var_name:
            svc_prefix = var_name.split("_")[0] + "_"
            last_prefix_idx = -1
            for idx, line in enumerate(new_lines):
                if line.strip().startswith(svc_prefix):
                    last_prefix_idx = idx
            if last_prefix_idx != -1:
                insert_idx = last_prefix_idx + 1

        if insert_idx != -1:
            new_lines.insert(insert_idx, f"{var_name}={var_value}\n")
        else:
            new_lines.append(f"{var_name}={var_value}\n")
    try:
        with open(target_file, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except Exception as e:
        logger.warning(f"Error writing to {target_file.name}: {e}")

def _find_next_numbered_var(base_var: str) -> str:
    target_file = AGENT_ROOT / ".env"
    existing = set()
    if target_file.exists():
        try:
            with open(target_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        existing.add(line.split("=")[0].strip())
        except Exception:
            pass
    if base_var not in existing:
        return base_var
    n = 2
    while f"{base_var}_{n}" in existing:
        n += 1
    return f"{base_var}_{n}"

def update_env_local(var_name: str, var_value: str):
    _write_env_var(AGENT_ROOT / ".env.local", var_name, var_value)
    _write_env_var(AGENT_ROOT / ".env", var_name, var_value)
    _write_env_var(AGENT_ROOT.parent / ".env.local", var_name, var_value)
    _write_env_var(AGENT_ROOT.parent / ".env", var_name, var_value)
    os.environ[var_name] = var_value

def manage_api_keys_pool(
    action: str,
    service: str = "cartesia",
    api_key: Optional[str] = None,
    api_secret: Optional[str] = None,
    url: Optional[str] = None,
    account_label: Optional[str] = None
) -> dict:
    act = action.lower().strip()
    srv = service.lower().strip()
    try:
        pool_file, env_var = _get_service_file(service)
    except ValueError as e:
        return {"status": "error", "message": str(e)}

    pool = _load_pool(pool_file)
    keys_map = pool.setdefault("keys", {})

    # Special handling for LiveKit: 3 parameters (URL, API Key, API Secret)
    if "livekit" in srv:
        if act == "list":
            res = []
            for k, v in keys_map.items():
                res.append({
                    "account": v.get("key_id", "LiveKit Account"),
                    "url": v.get("url", "wss://..."),
                    "masked_key": mask_key(v.get("api_key", k)),
                    "masked_secret": mask_key(v.get("api_secret", "")),
                    "status": v.get("status", "active")
                })
            return {
                "status": "success",
                "service": "livekit",
                "total_accounts": len(res),
                "accounts": res
            }

        elif act == "add":
            if not api_key:
                return {"status": "error", "message": "api_key is required for LiveKit."}
            clean_key = api_key.strip()
            clean_sec = (api_secret or "").strip()
            clean_url = (url or os.getenv("LIVEKIT_URL") or "").strip()
            idx = len(keys_map) + 1
            label = account_label.strip() if account_label else f"Account_{idx}_{mask_key(clean_key)}"
            keys_map[clean_key] = {
                "key_id": label,
                "api_key": clean_key,
                "api_secret": clean_sec,
                "url": clean_url,
                "status": "active",
                "last_checked": int(time.time())
            }
            _save_pool(pool_file, pool)
            next_num_var = _find_next_numbered_var("LIVEKIT_API_KEY")
            suffix = next_num_var.replace("LIVEKIT_API_KEY", "")
            if clean_url:
                update_env_local(f"LIVEKIT_URL{suffix}", clean_url)
                update_env_local("LIVEKIT_URL", clean_url)
            update_env_local(f"LIVEKIT_API_KEY{suffix}", clean_key)
            update_env_local("LIVEKIT_API_KEY", clean_key)
            if clean_sec:
                update_env_local(f"LIVEKIT_API_SECRET{suffix}", clean_sec)
                update_env_local("LIVEKIT_API_SECRET", clean_sec)
            return {
                "status": "success",
                "message": f"Added LiveKit account ({label}) as LIVEKIT_API_KEY{suffix}: key={mask_key(clean_key)}, secret={mask_key(clean_sec)}, url={clean_url}.",
                "service": "livekit",
                "account": label
            }

        elif act == "set_active":
            target = (api_key or account_label or "").strip()
            found_rec = None
            for k, v in keys_map.items():
                if k == target or v.get("key_id") == target or target in v.get("key_id", "") or target in k:
                    found_rec = v
                    break
            if found_rec:
                if found_rec.get("url"):
                    update_env_local("LIVEKIT_URL", found_rec["url"])
                if found_rec.get("api_key"):
                    update_env_local("LIVEKIT_API_KEY", found_rec["api_key"])
                if found_rec.get("api_secret"):
                    update_env_local("LIVEKIT_API_SECRET", found_rec["api_secret"])
                return {
                    "status": "success",
                    "message": f"Activated LiveKit account '{found_rec.get('key_id')}'.",
                    "service": "livekit"
                }
            return {"status": "error", "message": f"LiveKit account '{target}' not found."}

    if act == "list":
        res = []
        now = time.time()
        for k, v in keys_map.items():
            reset_unix = v.get("reset_unix", 0)
            days_left = max(0, int((reset_unix - now) / 86400)) if reset_unix else None
            res.append({
                "account": v.get("key_id", "Account"),
                "masked_key": mask_key(k),
                "status": v.get("status", "active"),
                "tier": v.get("tier", "unknown"),
                "days_until_reset": days_left
            })
        return {
            "status": "success",
            "service": service,
            "total_accounts": len(res),
            "accounts": res
        }

    elif act in ["mark_exhausted", "exhaust"]:
        target = (api_key or account_label or "").strip()
        now = time.time()
        found_label = None
        for k, v in keys_map.items():
            if k == target or v.get("key_id") == target or target in v.get("key_id", "") or target in k:
                v["status"] = "exhausted"
                v["reset_unix"] = int(now + 30 * 86400)
                v["days_until_reset"] = 30
                v["last_checked"] = int(now)
                found_label = v.get("key_id", mask_key(k))
                break
        if found_label:
            _save_pool(pool_file, pool)
            reset_cached_tts()
            return {
                "status": "success",
                "message": f"Marked {found_label} as exhausted for {service}. It will be skipped for 30 days until monthly recharge.",
                "service": service,
                "days_until_reset": 30
            }
        return {"status": "error", "message": f"Account '{target}' not found in {service}."}

    elif act == "add":
        if not api_key:
            return {"status": "error", "message": "api_key is required to add."}
        clean_key = api_key.strip()
        idx = len(keys_map) + 1
        label = account_label.strip() if account_label else f"Account_{idx}_{mask_key(clean_key)}"
        keys_map[clean_key] = {
            "key_id": label,
            "api_key": clean_key,
            "status": "active",
            "tier": "standard",
            "last_checked": int(time.time())
        }
        _save_pool(pool_file, pool)
        # 1. Write separate numbered variable (e.g. CARTESIA_API_KEY_4, ELEVEN_API_KEY_4)
        next_numbered_var = _find_next_numbered_var(env_var)
        update_env_local(next_numbered_var, clean_key)

        # 2. Set as active key in env
        update_env_local(env_var, clean_key)
        if "gemini" in srv or "google" in srv:
            update_env_local("GOOGLE_API_KEY", clean_key)

        # 3. Update the combined plural list (e.g. CARTESIA_API_KEYS, ELEVEN_API_KEYS)
        plural_var = f"{env_var}S"
        all_keys = list(keys_map.keys())
        if all_keys:
            update_env_local(plural_var, ",".join(all_keys))
        return {
            "status": "success",
            "message": f"Added key for {service} ({label}) as {next_numbered_var}: {mask_key(clean_key)} and updated {plural_var}.",
            "service": service,
            "account": label,
            "env_var": next_numbered_var
        }

    elif act == "remove":
        target = (api_key or account_label or "").strip()
        if not target:
            return {"status": "error", "message": "Target api_key or account_label required to remove."}
        removed = None
        for k, v in list(keys_map.items()):
            if k == target or v.get("key_id") == target or target in v.get("key_id", "") or target in k:
                removed = v.get("key_id", mask_key(k))
                del keys_map[k]
                break
        if removed:
            _save_pool(pool_file, pool)
            return {"status": "success", "message": f"Successfully removed account '{removed}' from {service}."}
        return {"status": "error", "message": f"No matching key or account found for '{target}' in {service}."}

    elif act == "set_active":
        target = (api_key or account_label or "").strip()
        found_key = None
        found_label = None
        for k, v in keys_map.items():
            if k == target or v.get("key_id") == target or target in v.get("key_id", "") or target in k:
                found_key = k
                found_label = v.get("key_id", mask_key(k))
                break
        if found_key:
            update_env_local(env_var, found_key)
            return {
                "status": "success",
                "message": f"Set {found_label} ({mask_key(found_key)}) as active key for {service}.",
                "service": service
            }
        return {"status": "error", "message": f"Account '{target}' not found in {service}."}

    return {"status": "error", "message": f"Unknown action '{action}'. Supported: list, add, remove, set_active, mark_exhausted."}

def get_settings_overview() -> dict:
    """Inspect and return current system engine settings, active voice, and available choices."""
    cfg = load_engine_config()
    current_tts = cfg.get("selected_tts", "cartesia")
    active_voice_id = cfg.get("selected_voice")

    active_voice_name = "Default"
    for v in VOICE_REGISTRIES.get(current_tts, []):
        if v["id"] == active_voice_id:
            active_voice_name = v["name"]
            break

    available_voices = {k: [v["name"] for v in v_list] for k, v_list in VOICE_REGISTRIES.items() if v_list}

    return {
        "status": "success",
        "current_stt": cfg.get("selected_stt", "livekit"),
        "current_tts": current_tts,
        "active_voice": active_voice_name,
        "active_voice_id": active_voice_id,
        "current_llm": cfg.get("selected_llm", "gemini-3.5-flash-lite"),
        "ocr_enabled": cfg.get("enable_ocr", True),
        "available_stt": ["livekit", "speechmatics", "cartesia", "elevenlabs"],
        "available_tts": ["cartesia", "elevenlabs", "livekit"],
        "available_voices": available_voices,
        "available_llms": ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash"],
        "message": f"Active Settings: STT={cfg.get('selected_stt')}, TTS={current_tts}, Voice={active_voice_name}, LLM={cfg.get('selected_llm')}, OCR={'Active' if cfg.get('enable_ocr', True) else 'Disabled'}."
    }

def switch_engines(
    stt: Optional[str] = None,
    tts: Optional[str] = None,
    voice: Optional[str] = None,
    llm: Optional[str] = None,
    enable_ocr: Optional[bool] = None
) -> dict:
    """Dynamically switch STT, TTS, voice, LLM model, or OCR configuration."""
    cfg = load_engine_config()
    changed = []

    if stt:
        s = stt.lower().strip()
        if s in ["livekit", "speechmatics", "cartesia", "elevenlabs"]:
            cfg["selected_stt"] = s
            changed.append(f"STT -> {s}")
            reset_cached_stt()
        else:
            return {"status": "error", "message": f"Invalid STT '{stt}'. Supported: livekit, speechmatics, cartesia, elevenlabs."}

    if tts:
        t = tts.lower().strip()
        if t in ["cartesia", "elevenlabs", "livekit"]:
            cfg["selected_tts"] = t
            changed.append(f"TTS -> {t}")
            reset_cached_tts()
        else:
            return {"status": "error", "message": f"Invalid TTS '{tts}'. Supported: cartesia, elevenlabs, livekit."}

    if voice:
        v_clean = voice.strip().lower()
        target_engine = cfg.get("selected_tts", "cartesia")
        matched_voice = None
        # Check current engine's voices first
        for v in VOICE_REGISTRIES.get(target_engine, []):
            if v_clean in v["name"].lower() or v_clean == v["id"].lower():
                matched_voice = v
                break
        # If not found in current engine, search across all engines and align TTS engine
        if not matched_voice:
            for eng, v_list in VOICE_REGISTRIES.items():
                for v in v_list:
                    if v_clean in v["name"].lower() or v_clean == v["id"].lower():
                        matched_voice = v
                        cfg["selected_tts"] = eng
                        reset_cached_tts()
                        changed.append(f"TTS -> {eng}")
                        break
                if matched_voice:
                    break
        if matched_voice:
            cfg["selected_voice"] = matched_voice["id"]
            changed.append(f"Voice -> {matched_voice['name']}")
            reset_cached_tts()
        else:
            return {"status": "error", "message": f"Could not find voice matching '{voice}'. Check available voices via get_system_settings."}

    if llm:
        llm_clean = llm.strip().lower()
        valid_llms = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash"]
        matched_llm = next((m for m in valid_llms if llm_clean in m), None)
        if matched_llm:
            cfg["selected_llm"] = matched_llm
            changed.append(f"LLM -> {matched_llm}")
        else:
            return {"status": "error", "message": f"Unsupported LLM '{llm}'. Supported: {', '.join(valid_llms)}"}

    if enable_ocr is not None:
        cfg["enable_ocr"] = enable_ocr
        changed.append(f"OCR -> {'Enabled' if enable_ocr else 'Disabled'}")

    save_engine_config(cfg)
    msg = "Settings updated: " + ", ".join(changed) if changed else "No settings modified."
    return {
        "status": "success",
        "action": "switch_engine",
        "stt": cfg.get("selected_stt"),
        "tts": cfg.get("selected_tts"),
        "voice": cfg.get("selected_voice"),
        "llm": cfg.get("selected_llm"),
        "enable_ocr": cfg.get("enable_ocr"),
        "message": msg
    }


# =============================================================================
# Noledge Study Context & AI Answer Evaluation
# Built using Python Standard Library (urllib, json)
# =============================================================================

ACTIVE_CONTEXT_FILE = Path(__file__).parent / "active_context.json"

def get_active_study_context() -> dict:
    """Retrieve the current study card and code buffer context."""
    if ACTIVE_CONTEXT_FILE.exists():
        try:
            with open(ACTIVE_CONTEXT_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error reading {ACTIVE_CONTEXT_FILE}: {e}")
    return {"question": None, "code_buffer": "", "deck_name": "", "card_index": 0}

def update_active_study_context(data: dict) -> dict:
    """Update active study card, code buffer, and deck context."""
    ctx = get_active_study_context()
    if isinstance(data, dict):
        ctx.update(data)
    try:
        with open(ACTIVE_CONTEXT_FILE, "w", encoding="utf-8") as f:
            json.dump(ctx, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving {ACTIVE_CONTEXT_FILE}: {e}")
    return ctx

def evaluate_with_gemini(system_prompt: str, user_prompt: str) -> Optional[dict]:
    """Query Gemini using Python standard library urllib without third-party dependencies."""
    keys = get_all_active_gemini_api_keys()
    if not keys:
        env_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if env_key:
            keys = [env_key.strip()]
    if not keys:
        return None

    models = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-2.5-flash"]
    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": user_prompt}]}
        ],
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }
    data_bytes = json.dumps(payload).encode("utf-8")

    import urllib.request
    import urllib.error

    for key in keys:
        for m in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json", "User-Agent": "Noledge-Agent/1.0"}
            )
            try:
                with urllib.request.urlopen(req, timeout=12) as resp:
                    res_json = json.loads(resp.read().decode("utf-8"))
                    text = res_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    if text:
                        return json.loads(text.strip())
            except Exception as ex:
                logger.debug(f"Gemini evaluate attempt failed on {m}: {ex}")
                continue
    return None

def transcribe_pcm_with_gemini(audio_pcm: bytes, sample_rate: int = 16000) -> str:
    """Fallback STT: wrap raw 16-bit mono PCM into a WAV container and transcribe via Gemini.
    Returns '' when there is no intelligible speech or only hallucinated junk (e.g. '0:00')."""
    if not audio_pcm or len(audio_pcm) < 3200:  # < 0.1s of 16-bit 16kHz audio
        return ""

    keys = get_all_active_gemini_api_keys()
    if not keys:
        env_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if env_key:
            keys = [env_key.strip()]
    if not keys:
        return ""

    import io
    import wave
    import base64

    buf = io.BytesIO()
    try:
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(audio_pcm)
    except Exception as we:
        logger.debug(f"WAV wrap failed: {we}")
        return ""

    wav_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    models = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inlineData": {"mimeType": "audio/wav", "data": wav_b64}},
                    {
                        "text": (
                            "Transcribe the spoken audio verbatim. Return ONLY the transcription text. "
                            "If there is no intelligible speech, return an empty string. "
                            "Never return timestamps, durations, or placeholder text."
                        )
                    },
                ],
            }
        ],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 256},
    }

    import urllib.request
    data_bytes = json.dumps(payload).encode("utf-8")

    for key in keys[:3]:
        for m in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json", "User-Agent": "Noledge-Agent/1.0"},
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    res_json = json.loads(resp.read().decode("utf-8"))
                    text = res_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    text = (text or "").strip().strip('"').strip()
                    # Reject junk: empty, timestamp-like ("0:00"), or no real characters
                    if not text or re.fullmatch(r"\d{1,2}:\d{2}([.:]\d+)?", text) or not re.search(r"[a-zA-Z0-9]", text):
                        continue
                    return text
            except Exception as ex:
                logger.debug(f"Gemini PCM transcription attempt failed on {m}: {ex}")
                continue
    return ""


def judge_code_with_llm(code: str, question: Optional[dict]) -> dict:
    """Judge user code directly and objectively. Does NOT preach or give unsolicited lectures."""
    q_content = (question or {}).get("content", "")
    q_answer = (question or {}).get("answer", "")
    q_explanation = (question or {}).get("explanation", "")
    q_lang = (question or {}).get("code_language", "python") or "python"

    system_prompt = (
        "You are an objective, authoritative automated code evaluator in the Noledge flashcard platform. "
        "Your role is to strictly evaluate whether the user's code solves the question and produces the required behavior or output.\n"
        "STRICT CONSTRAINTS:\n"
        "1. Direct & Concise: State if the code is correct or incorrect.\n"
        "2. No lecturing: Do NOT preach, do NOT explain basic concepts unless there is a bug, do NOT give unsolicited tutorials or tell the user how to learn.\n"
        "3. Focus on bugs/logic: If incorrect, state precisely what is broken, missing, or buggy.\n"
        "4. You must output valid JSON with keys: is_correct (boolean), score (float 0.0 to 1.0), and feedback (string)."
    )

    user_prompt = (
        f"Language: {q_lang}\n"
        f"Problem Statement:\n{q_content}\n\n"
        f"Expected Reference / Solution:\n{q_answer}\n\n"
        f"Explanation / Context:\n{q_explanation}\n\n"
        f"User Submitted Code:\n```\n{code}\n```\n\n"
        "Evaluate the code. Return JSON only:"
    )

    result = evaluate_with_gemini(system_prompt, user_prompt)
    if result and isinstance(result, dict) and "is_correct" in result:
        return {
            "is_correct": bool(result.get("is_correct")),
            "score": float(result.get("score", 1.0 if result.get("is_correct") else 0.0)),
            "feedback": str(result.get("feedback", "Code evaluated."))
        }

    # Fallback to normalized comparison if LLM unreachable
    code_norm = "\n".join(line.rstrip() for line in (code or "").strip().splitlines())
    ans_norm = "\n".join(line.rstrip() for line in str(q_answer or "").strip().splitlines())
    is_exact = bool(code_norm and (code_norm == ans_norm or (ans_norm and ans_norm in code_norm)))
    return {
        "is_correct": is_exact,
        "score": 1.0 if is_exact else 0.0,
        "feedback": "Code is correct!" if is_exact else "Code does not match expected output or solution logic."
    }

def judge_voice_with_llm(spoken_answer: str, question: Optional[dict]) -> dict:
    """Judge user spoken speech answer conceptually. Does NOT lecture."""
    q_content = (question or {}).get("content", "")
    q_answer = (question or {}).get("answer", "")
    q_explanation = (question or {}).get("explanation", "")

    system_prompt = (
        "You are an objective spoken answer evaluator in the Noledge flashcard platform. "
        "Evaluate whether the user's spoken answer correctly answers the question conceptually.\n"
        "STRICT CONSTRAINTS:\n"
        "1. Be objective, concise, and direct.\n"
        "2. Minor speech-to-text slips or slight phrasing variations should still be marked correct if the core concept is right.\n"
        "3. Do NOT lecture or give unsolicited tutorials. State whether it is correct or incorrect and why in 1-2 sentences.\n"
        "4. Return JSON only with keys: is_correct (boolean), score (float 0.0 to 1.0), and feedback (string)."
    )

    user_prompt = (
        f"Question:\n{q_content}\n\n"
        f"Target Answer:\n{q_answer}\n\n"
        f"Explanation / Key Points:\n{q_explanation}\n\n"
        f"User Spoken Answer:\n\"{spoken_answer}\"\n\n"
        "Evaluate the spoken answer. Return JSON only:"
    )

    result = evaluate_with_gemini(system_prompt, user_prompt)
    if result and isinstance(result, dict) and "is_correct" in result:
        return {
            "is_correct": bool(result.get("is_correct")),
            "score": float(result.get("score", 1.0 if result.get("is_correct") else 0.0)),
            "feedback": str(result.get("feedback", "Answer evaluated."))
        }

    # Fallback substring check
    s_norm = (spoken_answer or "").lower().strip()
    a_norm = str(q_answer or "").lower().strip()
    is_match = bool(s_norm and a_norm and (a_norm in s_norm or s_norm in a_norm))
    return {
        "is_correct": is_match,
        "score": 1.0 if is_match else 0.0,
        "feedback": "Spoken answer is correct." if is_match else "Spoken answer does not match the key concepts."
    }

def manage_site_deck(action: str, name: Optional[str] = None, deck_id: Optional[str] = None, description: Optional[str] = None, tags: Optional[list] = None, sort_by: Optional[str] = None) -> dict:
    """Agent tool to create, list, delete, or sort decks on the Noledge platform."""
    return {
        "status": "success",
        "action": action,
        "deck_id": deck_id,
        "name": name,
        "description": description,
        "tags": tags or [],
        "sort_by": sort_by,
        "message": f"Site action '{action}' queued for execution on platform."
    }

def manage_site_question(action: str, deck_id: Optional[str] = None, question_id: Optional[str] = None, type: Optional[str] = None, content: Optional[str] = None, answer: Optional[Any] = None, explanation: Optional[str] = None, options: Optional[list] = None, code_language: Optional[str] = None, new_type: Optional[str] = None, target_deck_id: Optional[str] = None) -> dict:
    """Agent tool to add, edit, delete, move, or convert flashcard questions across all 10 question types."""
    return {
        "status": "success",
        "action": action,
        "question_id": question_id,
        "deck_id": deck_id,
        "type": type or new_type,
        "content": content,
        "answer": answer,
        "explanation": explanation,
        "options": options,
        "code_language": code_language,
        "target_deck_id": target_deck_id,
        "message": f"Question action '{action}' queued for execution on platform."
    }

def control_site_app(action: str, path: Optional[str] = None, theme: Optional[str] = None) -> dict:
    """Agent tool to navigate pages/tests or toggle Light/Dark theme."""
    return {
        "status": "success",
        "action": action,
        "path": path,
        "theme": theme,
        "message": f"App control '{action}' queued for execution."
    }

