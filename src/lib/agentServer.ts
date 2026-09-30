import fs from 'fs';
import path from 'path';

let cachedAgentEnv: Record<string, string> | null = null;
let cachedAtMs = 0;
let cachedFileMtimeMs = 0;

function getEnvFilesMtime(): number {
  try {
    let m = 0;
    for (const rel of ['agent/.env', 'agent/.env.local']) {
      const p = path.join(process.cwd(), rel);
      if (fs.existsSync(p)) {
        const st = fs.statSync(p).mtimeMs;
        if (st > m) m = st;
      }
    }
    return m;
  } catch {
    return 0;
  }
}

export function getAgentEnv(): Record<string, string> {
  const mtime = getEnvFilesMtime();
  // Invalidate when .env files change (API key added at runtime) or after 30s staleness.
  if (cachedAgentEnv && mtime <= cachedFileMtimeMs && Date.now() - cachedAtMs < 30000) return cachedAgentEnv;

  const envVars: Record<string, string> = {};

  // 1. Process environment first
  Object.assign(envVars, process.env);

  // 2. Read agent/.env if available (overwrites process.env with actual configured keys)
  try {
    const agentEnvPath = path.join(process.cwd(), 'agent', '.env');
    if (fs.existsSync(agentEnvPath)) {
      const content = fs.readFileSync(agentEnvPath, 'utf-8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && val) {
            envVars[key] = val;
          }
        }
      });
    }
  } catch (err) {
    console.warn('[agentServer] Could not read agent/.env:', err);
  }

  // 3. Read agent/.env.local if available
  try {
    const localEnvPath = path.join(process.cwd(), 'agent', '.env.local');
    if (fs.existsSync(localEnvPath)) {
      const content = fs.readFileSync(localEnvPath, 'utf-8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && val) {
            envVars[key] = val;
          }
        }
      });
    }
  } catch {
    // Ignore optional local env errors
  }

  cachedAgentEnv = envVars;
  cachedAtMs = Date.now();
  cachedFileMtimeMs = mtime;
  return envVars;
}

export const AGENT_BACKEND_PORT = 5050;
export const AGENT_BACKEND_URL = `http://127.0.0.1:${AGENT_BACKEND_PORT}`;
