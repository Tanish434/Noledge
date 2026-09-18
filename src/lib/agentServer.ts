import fs from 'fs';
import path from 'path';

let cachedAgentEnv: Record<string, string> | null = null;

export function getAgentEnv(): Record<string, string> {
  if (cachedAgentEnv) return cachedAgentEnv;

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
  return envVars;
}

export const AGENT_BACKEND_PORT = 5050;
export const AGENT_BACKEND_URL = `http://127.0.0.1:${AGENT_BACKEND_PORT}`;
