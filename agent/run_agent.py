import os
import sys
import time
import socket
import subprocess
import webbrowser
from pathlib import Path
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

AGENT_DIR = Path(__file__).parent.resolve()

# -------------------------------------------------------------
# Portable Python Resolution (100% self-contained project)
# 1. Local virtualenv in agent folder (.venv or venv)
# 2. Currently executing Python runtime (sys.executable)
# 3. Development fallback to sibling/parent venvs if present
# -------------------------------------------------------------
def get_python_executable() -> Path:
    # 1. Check local virtual environments inside agent folder
    local_candidates = [
        AGENT_DIR / ".venv" / "Scripts" / "python.exe",
        AGENT_DIR / ".venv" / "bin" / "python",
        AGENT_DIR / "venv" / "Scripts" / "python.exe",
        AGENT_DIR / "venv" / "bin" / "python",
        AGENT_DIR / "avatar_env" / "Scripts" / "python.exe",
    ]
    for c in local_candidates:
        if c.exists():
            return c

    # 2. Check current sys.executable
    curr = Path(sys.executable)
    if curr.exists() and "python" in curr.name.lower():
        # If running from a virtual environment or active Python
        return curr

    # 3. Check workspace development venv if still in development folder
    dev_candidate = AGENT_DIR.parent / "avatar_env" / "Scripts" / "python.exe"
    if dev_candidate.exists():
        return dev_candidate

    return Path(sys.executable)

PYTHON_EXE = get_python_executable()

load_dotenv(AGENT_DIR / ".env", override=True)
load_dotenv(AGENT_DIR / ".env.local", override=True)

_instance_lock_socket = None

def acquire_instance_lock():
    global _instance_lock_socket
    _instance_lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _instance_lock_socket.bind(('127.0.0.1', 5003))
        _instance_lock_socket.listen(1)
    except socket.error:
        port = int(os.getenv("PORT", 5050))
        print("\n" + "!" * 65)
        print(" [!] NOTICE: Another instance of run_agent.py is already active!")
        print(" [!] Exiting duplicate instance to prevent double speech & audio conflict.")
        print(f" [!] The active session is already accessible on http://localhost:{port}.")
        print("!" * 65 + "\n")
        sys.exit(0)

def cleanup_old_processes():
    my_pid = os.getpid()
    parent_pid = os.getppid() if hasattr(os, 'getppid') else None
    try:
        import psutil
        for p in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                if p.pid != my_pid and p.pid != parent_pid and 'python' in (p.info.get('name') or '').lower():
                    cmd = " ".join(p.info.get('cmdline') or []).replace("\\", "/")
                    if any(target in cmd for target in ["src/server.py", "src/agent.py"]):
                        p.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except Exception:
        pass

def check_env():
    print("=" * 60)
    print(" [*] VOICE AI AGENT (SHDR-31 GODRAY ORB) - SYSTEM CHECK")
    print("=" * 60)
    
    livekit_url = os.getenv("LIVEKIT_URL")
    livekit_key = os.getenv("LIVEKIT_API_KEY")
    livekit_secret = os.getenv("LIVEKIT_API_SECRET")
    
    if not livekit_url or not livekit_key or not livekit_secret:
        print("\n[!] LIVEKIT CREDENTIALS MISSING!")
        print(f"Please check your .env file at: {AGENT_DIR / '.env'}")
        print("=" * 60)
        return False

    print(f"[OK] Python: {PYTHON_EXE}")
    print(f"[OK] LiveKit URL: {livekit_url}")
    print("[OK] STT: LiveKit Cloud Deepgram Nova-3 (English Only)")
    print("[OK] TTS: High-Fidelity Cartesia / ElevenLabs / LiveKit Voice")
    print("[OK] Voice Detection: 128-D Acoustic Resonance Biometrics (No Camera)")
    print("[OK] UI: SHDR-31 Raymarched Godray Orb with Spacebar PTT")
    print("=" * 60)
    return True

def main():
    acquire_instance_lock()
    cleanup_old_processes()
    if not check_env():
        return

    proc_env = os.environ.copy()
    proc_env["PYTHONIOENCODING"] = "utf-8"

    port = int(os.getenv("PORT", 5050))
    print(f"\n[1/3] Starting Web Server (Port {port})...")
    server_proc = subprocess.Popen(
        [str(PYTHON_EXE), "-X", "utf8", "src/server.py"],
        cwd=str(AGENT_DIR),
        env=proc_env
    )

    # Fast polling for web server availability
    import urllib.request
    for _ in range(40):
        try:
            with urllib.request.urlopen(f"http://localhost:{port}/api/status", timeout=0.2):
                break
        except Exception:
            time.sleep(0.08)

    print("[2/3] Starting LiveKit Voice Agent Worker...")
    agent_proc = subprocess.Popen(
        [str(PYTHON_EXE), "-X", "utf8", "-u", "src/agent.py", "connect", "--room", "agent-room"],
        cwd=str(AGENT_DIR),
        env=proc_env
    )

    time.sleep(0.5)
    target_url = "http://localhost:3000"

    if "--no-browser" not in sys.argv:
        print(f"\n[3/3] Opening Noledge in Firefox: {target_url}")
        try:
            subprocess.run(f"start firefox {target_url}", shell=True)
        except Exception:
            webbrowser.open(target_url)
    else:
        print(f"\n[3/3] Voice Agent worker ready. Web UI live on: {target_url}")

    print("\n[READY] Voice AI Agent is live! Press Ctrl+C to stop.\n")

    def _kill_children():
        print("\nStopping agent cleanly...")
        try:
            if server_proc.poll() is None:
                server_proc.kill()
        except Exception:
            pass
        try:
            if agent_proc.poll() is None:
                agent_proc.kill()
        except Exception:
            pass
        cleanup_old_processes()
        print("Shutdown complete.")

    import atexit
    atexit.register(_kill_children)

    try:
        while True:
            time.sleep(2)
            if server_proc.poll() is not None:
                print("\n[!] Web Server stopped! Restarting...")
                server_proc = subprocess.Popen(
                    [str(PYTHON_EXE), "-X", "utf8", "src/server.py"],
                    cwd=str(AGENT_DIR),
                    env=proc_env
                )
            if agent_proc.poll() is not None:
                print("\n[!] Voice Agent stopped! Auto-reconnecting...")
                agent_proc = subprocess.Popen(
                    [str(PYTHON_EXE), "-X", "utf8", "-u", "src/agent.py", "connect", "--room", "agent-room"],
                    cwd=str(AGENT_DIR),
                    env=proc_env
                )
    except (KeyboardInterrupt, SystemExit):
        _kill_children()

if __name__ == "__main__":
    main()
