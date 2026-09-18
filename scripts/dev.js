const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const rootDir = path.resolve(__dirname, '..');
const agentDir = path.join(rootDir, 'agent');

// Determine Python executable
function getPythonCommand() {
  const localCandidates = [
    path.join(agentDir, '.venv', 'Scripts', 'python.exe'),
    path.join(agentDir, 'venv', 'Scripts', 'python.exe'),
    path.join(agentDir, 'avatar_env', 'Scripts', 'python.exe'),
  ];
  for (const cand of localCandidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return process.env.PYTHON || 'python';
}

const pythonCmd = getPythonCommand();
const isWin = process.platform === 'win32';

console.log('\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');
console.log('\x1b[36m%s\x1b[0m', '  🚀 Starting Noledge (Next.js + LiveKit Voice Agent)         ');
console.log('\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');

const children = [];
let isShuttingDown = false;

function killProcessTree(pid) {
  try {
    if (isWin) {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch (e) {
    // Process might already be dead
  }
}

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\x1b[33m%s\x1b[0m', 'Shutting down all development servers...');
  for (const child of children) {
    if (child && child.pid) {
      killProcessTree(child.pid);
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

function loadAgentEnv() {
  const envObj = {};
  try {
    const envFile = path.join(agentDir, '.env');
    if (fs.existsSync(envFile)) {
      const txt = fs.readFileSync(envFile, 'utf-8');
      for (const line of txt.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (k && v) envObj[k] = v;
        }
      }
    }
  } catch {}
  return envObj;
}

const fileEnv = loadAgentEnv();

// 1. Start Python Voice Agent Worker
console.log('\x1b[32m%s\x1b[0m', '📡 [1/2] Launching Python Voice Agent Worker...');
const agentProc = spawn(pythonCmd, ['run_agent.py', '--no-browser'], {
  cwd: agentDir,
  shell: isWin,
  stdio: 'inherit',
  env: { ...process.env, ...fileEnv, PYTHONIOENCODING: 'utf-8' },
});
children.push(agentProc);

agentProc.on('error', (err) => {
  console.error('\x1b[31m%s\x1b[0m', `Failed to start Python Agent: ${err.message}`);
});

agentProc.on('exit', (code) => {
  if (code && code !== 0 && !isShuttingDown) {
    console.warn(`\x1b[33m[Agent]\x1b[0m exited with code ${code}`);
  }
});

// 2. Start Next.js Development Server
console.log('\x1b[34m%s\x1b[0m', '⚡ [2/2] Launching Next.js Webpack Server (port 3000)...');
const nextBin = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const nextProc = spawn(process.execPath, [nextBin, 'dev', '--webpack'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});
children.push(nextProc);

nextProc.on('error', (err) => {
  console.error('\x1b[31m%s\x1b[0m', `Failed to start Next.js: ${err.message}`);
});

nextProc.on('exit', (code) => {
  if (!isShuttingDown) {
    cleanup();
  }
});

// 3. Automatically open http://localhost:3000 in Firefox once Next.js is responding
let openedBrowser = false;
function pollNextServer() {
  if (openedBrowser || isShuttingDown) return;
  const req = http.get('http://localhost:3000', (res) => {
    if (res.statusCode === 200 && !openedBrowser) {
      openedBrowser = true;
      console.log('\x1b[35m%s\x1b[0m', '🌐 Next.js is live on http://localhost:3000! Opening in Firefox...');
      try {
        execSync('start firefox http://localhost:3000', { stdio: 'ignore' });
      } catch {
        try {
          execSync('start http://localhost:3000', { stdio: 'ignore' });
        } catch {}
      }
    }
  });
  req.on('error', () => {
    if (!openedBrowser && !isShuttingDown) {
      setTimeout(pollNextServer, 1000);
    }
  });
}
setTimeout(pollNextServer, 2000);

