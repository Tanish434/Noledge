'use client';

import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GitBranch,
  HardDrive,
  FolderOpen,
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  Check,
  Search,
  ArrowLeft,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  X,
  Edit2,
} from 'lucide-react';
import { useSourceStore } from '@/stores/sourceStore';
import type { Source } from '@/types/source';
import { useDeckStore } from '@/stores/deckStore';
import { useQuestionStore } from '@/stores/questionStore';
import { parseQuestionMarkdown } from '@/lib/markdownParser';
import { getAllQuestions, deleteQuestion } from '@/lib/storage';
import type { Question } from '@/types/question';
import { useToast } from '@/components/ui/Toast';
import { encrypt } from '@/utils/crypto';
import { validateConnection as validateObsidian } from '@/lib/obsidian';
import { saveFileHandle, getFileHandle } from '@/lib/fileHandleStore';
import { listMarkdownFiles as listGitHubFiles, fetchFileContent as fetchGitHubFile } from '@/lib/github';
import styles from '@/app/settings/settings.module.css';

interface GhRepoItem {
  name: string;
  full_name: string;
  default_branch: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  private?: boolean;
  owner: { login: string };
}

interface GhContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  download_url: string | null;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Non-secure HTTP context fallback
  }

  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    }
  } catch {
    return false;
  }
  return false;
}

// ─── GitHub Token Database Helpers ─────────────────────────────────────
const getTokensMap = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('noledge:gh:tokens_map');
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const saveTokenForUsername = (username: string, token: string) => {
  if (typeof window === 'undefined' || !username || !token) return;
  const cleanUser = username.trim().replace(/^@+/, '').toLowerCase();
  const map = getTokensMap();
  map[cleanUser] = token;
  localStorage.setItem('noledge:gh:tokens_map', JSON.stringify(map));
  localStorage.setItem('noledge:gh:user_token', token);
};

const getTokenForUsername = (username: string): string | null => {
  if (typeof window === 'undefined' || !username) return null;
  const cleanUser = username.trim().replace(/^@+/, '').toLowerCase();
  const map = getTokensMap();
  return map[cleanUser] || null;
};

const deleteTokenForUsername = (username: string) => {
  if (typeof window === 'undefined') return;
  const cleanUser = username.trim().replace(/^@+/, '').toLowerCase();
  const map = getTokensMap();
  if (cleanUser && map[cleanUser]) {
    delete map[cleanUser];
    localStorage.setItem('noledge:gh:tokens_map', JSON.stringify(map));
  }
  const activeToken = localStorage.getItem('noledge:gh:user_token');
  if (activeToken) {
    localStorage.removeItem('noledge:gh:user_token');
  }
};

export default function SourceManager() {
  const { sources, addSource, removeSource } = useSourceStore();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputSingleRef = useRef<HTMLInputElement>(null);
  const fileInputMultiRef = useRef<HTMLInputElement>(null);

  const [allIDBQuestions, setAllIDBQuestions] = useState<Question[]>([]);

  React.useEffect(() => {
    let isMounted = true;
    getAllQuestions().then((qs) => {
      if (isMounted) setAllIDBQuestions(qs || []);
    });
    void useDeckStore.getState().loadDecks();
    return () => { isMounted = false; };
  }, [sources]);

  // GitHub Wizard State
  const [ghUsername, setGhUsername] = useState('Tanish434');
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [userRepos, setUserRepos] = useState<GhRepoItem[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GhRepoItem | null>(null);

  // GitHub File Tree Navigation State
  const [currentFolderPath, setCurrentFolderPath] = useState('');
  const [folderContents, setFolderContents] = useState<GhContentItem[]>([]);
  const [fetchingContents, setFetchingContents] = useState(false);
  const [activeSelectedPath, setActiveSelectedPath] = useState('/');
  const [optionalToken, setOptionalToken] = useState('');
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [showAuthChoiceModal, setShowAuthChoiceModal] = useState(false);

  // Obsidian state
  const [obsUrl, setObsUrl] = useState('https://127.0.0.1:27123');
  const [obsToken, setObsToken] = useState('');
  const [obsConnecting, setObsConnecting] = useState(false);

  // Path Editing State
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [editingPathValue, setEditingPathValue] = useState<string>('');

  const handleSavePath = async (sourceId: string, newPath: string) => {
    const cleanPath = newPath.trim();
    if (!cleanPath) return;

    const currentSources = useSourceStore.getState().sources;
    const targetSource = currentSources.find((s) => s.id === sourceId);
    if (!targetSource) return;

    const oldPath = (targetSource as any).vault_path || targetSource.label;

    useSourceStore.getState().updateSource(sourceId, {
      vault_path: cleanPath,
      label: targetSource.label.startsWith('File:')
        ? `File: ${cleanPath}`
        : targetSource.label,
    });

    const allQs = await getAllQuestions();
    for (const q of allQs) {
      if (q && q.source_file && (q.source_file.includes(oldPath) || oldPath.includes(q.source_file))) {
        q.source_file = cleanPath;
        const { upsertQuestion } = await import('@/lib/storage');
        await upsertQuestion(q);
      }
    }

    setEditingPathId(null);
    addToast(`Updated full path to "${cleanPath}"`, 'success');
  };

  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));

    const params = new URLSearchParams(window.location.search);
    const token = params.get('gh_token');
    const err = params.get('error');

    const savedToken = localStorage.getItem('noledge:gh:user_token');
    setHasSavedToken(Boolean(savedToken));

    if (token) {
      setOptionalToken(token);
      localStorage.setItem('noledge:gh:user_token', token);
      setHasSavedToken(true);
      const cleanUrl = window.location.pathname + '?tab=import';
      window.history.replaceState({}, '', cleanUrl);

      // Fetch user profile to save to database map under login username
      void fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((userData) => {
          if (userData && userData.login) {
            saveTokenForUsername(userData.login, token);
            setGhUsername(userData.login);
            addToast(`Authenticated @${userData.login} & saved token to database!`, 'success');
          } else {
            localStorage.setItem('noledge:gh:user_token', token);
          }
          void fetchPrivateRepos(token);
        })
        .catch(() => {
          localStorage.setItem('noledge:gh:user_token', token);
          void fetchPrivateRepos(token, true);
        });
    } else if (savedToken) {
      setOptionalToken(savedToken);
      void fetchPrivateRepos(savedToken, true);
    } else if (err === 'oauth_unconfigured') {
      addToast('Opened GitHub token setup. Click "Authorize 1-Click" to complete.', 'info');
    }
  }, []);

  const fetchPrivateRepos = async (token: string, silent = false) => {
    setFetchingRepos(true);
    try {
      const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&visibility=all', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!res.ok) throw new Error();
      const list = await res.json();
      setUserRepos(list);
      setSelectedRepo(null);
      if (!silent) {
        addToast(`Connected GitHub! Found ${list.length} repositories (including private)`, 'success');
      }
    } catch {
      if (!silent) {
        addToast('Failed to load private repositories.', 'error');
      }
    } finally {
      setFetchingRepos(false);
    }
  };

  // GitHub Device Flow State
  const [deviceInfo, setDeviceInfo] = useState<{ user_code: string; verification_uri: string; device_code: string } | null>(null);
  const [pollingDevice, setPollingDevice] = useState(false);

  // ─── Start GitHub Device Flow ─────────────────────────────────────────
  const handleStartDeviceFlow = async (autoNavigate = true) => {
    try {
      const res = await fetch('/api/auth/github/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'code' }),
      });
      const data = await res.json();
      if (data.user_code && data.device_code) {
        setDeviceInfo({
          user_code: data.user_code,
          verification_uri: data.verification_uri || 'https://github.com/login/device',
          device_code: data.device_code,
        });
        void copyToClipboard(data.user_code);
        addToast(`Copied code "${data.user_code}"! Opening GitHub device page…`, 'success');
        startDevicePolling(data.device_code, data.interval || 5);

        if (autoNavigate && typeof window !== 'undefined') {
          if (isMobile) {
            // On mobile, trigger native GitHub App launch prompt only without forced web redirect
            window.location.href = 'github://';
          } else {
            const targetUrl = data.verification_uri || 'https://github.com/login/device';
            setTimeout(() => {
              window.location.href = targetUrl;
            }, 400);
          }
        }
      } else {
        handleGitHubOAuthRedirect();
      }
    } catch {
      handleGitHubOAuthRedirect();
    }
  };

  const startDevicePolling = (deviceCode: string, intervalSeconds: number) => {
    setPollingDevice(true);
    const intervalMs = Math.max(3000, intervalSeconds * 1000);

    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/github/device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'poll', device_code: deviceCode }),
        });
        const data = await res.json();

        if (data.access_token) {
          clearInterval(timer);
          setPollingDevice(false);
          setDeviceInfo(null);
          setOptionalToken(data.access_token);
          localStorage.setItem('noledge:gh:user_token', data.access_token);
          void fetchPrivateRepos(data.access_token);
        } else if (data.error && data.error !== 'authorization_pending' && data.error !== 'slow_down') {
          clearInterval(timer);
          setPollingDevice(false);
          setDeviceInfo(null);
        }
      } catch {
        clearInterval(timer);
        setPollingDevice(false);
      }
    }, intervalMs);
  };

  const getOAuthUrl = (targetUser?: string) => {
    const clientId = (process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '').trim();
    if (!clientId) return '';
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const origin = typeof window !== 'undefined'
      ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3000' : window.location.origin)
      : baseUrl;
    const redirectUri = `${origin}/api/auth/github/callback`;
    const cleanUser = targetUser ? targetUser.trim().replace(/^@+/, '') : '';
    const userParam = cleanUser ? `&login=${encodeURIComponent(cleanUser)}` : '';
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,read:user&redirect_uri=${encodeURIComponent(redirectUri)}${userParam}`;
  };

  // ─── GitHub OAuth Redirect / Pre-filled 1-Click Authorize ─────────────
  const handleGitHubOAuthRedirect = (targetUser?: string) => {
    const url = getOAuthUrl(targetUser);
    if (!url) {
      addToast('GitHub OAuth App not configured. Set NEXT_PUBLIC_GITHUB_CLIENT_ID or use a Personal Access Token below.', 'warning');
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(url);
    }
  };

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const active = localStorage.getItem('noledge:gh:user_token');
    const userStored = ghUsername.trim() ? getTokenForUsername(ghUsername) : null;
    setHasSavedToken(Boolean(optionalToken || active || userStored));
  }, [ghUsername, optionalToken]);

  // ─── Direct Branching Authorization Action (PC & Mobile Unified) ───────
  const handleAuthorizeAction = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    const targetUser = ghUsername.trim().replace(/^@+/, '').toLowerCase();

    if (targetUser) {
      const storedToken = getTokenForUsername(targetUser);
      if (storedToken) {
        // Found exact username token in database! Connect instantly without redirecting!
        setOptionalToken(storedToken);
        setHasSavedToken(true);
        localStorage.setItem('noledge:gh:user_token', storedToken);
        addToast(`Found existing database token for @${targetUser}! Connected automatically.`, 'success');
        void fetchPrivateRepos(storedToken);
        return;
      }
    }

    // No token found for this username -> purge active token so old user token is not restored on return
    if (typeof window !== 'undefined') {
      localStorage.removeItem('noledge:gh:user_token');
    }
    setOptionalToken('');
    setHasSavedToken(false);
    setUserRepos([]);

    addToast(`Redirecting to GitHub to authorize @${targetUser || 'account'}…`, 'info');
    handleGitHubOAuthRedirect(targetUser);
  };

  const handleDeleteTokenPermanently = () => {
    const targetUser = ghUsername.trim().replace(/^@+/, '');
    deleteTokenForUsername(targetUser);
    setOptionalToken('');
    setHasSavedToken(false);
    setUserRepos([]);
    setSelectedRepo(null);
    addToast(`Permanently deleted database token for @${targetUser || 'account'}.`, 'info');
  };

  const handleClearUsernameInput = () => {
    setGhUsername('');
    addToast('Cleared username input field.', 'info');
  };

  // ─── GitHub App Direct Custom Scheme Launch (github:// & Android Intent) ──
  const handleGitHubAppAuth = () => {
    setShowAuthChoiceModal(false);
    const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    const storeUrl = isIOS
      ? 'https://apps.apple.com/app/github/id1477376905'
      : 'https://play.google.com/store/apps/details?id=com.github.android';

    const targetUser = ghUsername.trim().replace(/^@+/, '').toLowerCase();
    const clientId = (process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '').trim();
    if (!clientId) {
      addToast('GitHub OAuth App not configured. Set NEXT_PUBLIC_GITHUB_CLIENT_ID or use a Personal Access Token below.', 'warning');
      return;
    }
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const origin = typeof window !== 'undefined'
      ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3000' : window.location.origin)
      : baseUrl;
    const redirectUri = `${origin}/api/auth/github/callback`;
    const userParam = targetUser ? `&login=${encodeURIComponent(targetUser)}` : '';

    const customSchemeUrl = `github://oauth/authorize?client_id=${clientId}&scope=repo,read:user&redirect_uri=${encodeURIComponent(redirectUri)}${userParam}`;
    const webAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,read:user&redirect_uri=${encodeURIComponent(redirectUri)}${userParam}`;

    if (isAndroid) {
      // Android Intent URI forces Android OS to open native GitHub App package directly!
      const intentUrl = `intent://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,read:user&redirect_uri=${encodeURIComponent(redirectUri)}${userParam}#Intent;scheme=https;package=com.github.android;S.browser_fallback_url=${encodeURIComponent(storeUrl)};end`;
      window.location.href = intentUrl;
      return;
    }

    if (isIOS) {
      // On iOS (iPhone 13 Mini), custom scheme github://oauth/authorize triggers iOS native prompt: "Open in 'GitHub'?" with Auth screen
      let appOpened = false;
      const onBlur = () => { appOpened = true; };
      if (typeof window !== 'undefined') {
        window.addEventListener('blur', onBlur, { once: true });
        window.location.href = customSchemeUrl;

        setTimeout(() => {
          window.removeEventListener('blur', onBlur);
          if (!appOpened) {
            window.location.href = webAuthUrl;
          }
        }, 1500);
      }
      return;
    }

    if (typeof window !== 'undefined') {
      window.location.assign(webAuthUrl);
    }
  };

  // ─── Step 1: Fetch Repositories by Username or Token ─────────────────
  const handleFetchUserRepos = async (usernameToFetch?: string) => {
    const targetUser = (usernameToFetch || ghUsername).trim().replace(/^@+/, '');
    setFetchingRepos(true);
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
      const hasToken = Boolean(optionalToken.trim());
      if (hasToken) {
        headers.Authorization = `Bearer ${optionalToken.trim()}`;
      }

      // Endpoint: Use /user/repos when token is present AND targetUser is empty/matches logged in user.
      // If targetUser is typed (e.g. another user/org), fetch public repos for that target user.
      const url = targetUser
        ? `https://api.github.com/users/${targetUser}/repos?per_page=100&sort=updated`
        : hasToken
          ? 'https://api.github.com/user/repos?per_page=100&sort=updated&visibility=all'
          : `https://api.github.com/users/${ghUsername.trim() || 'me'}/repos?per_page=100&sort=updated`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 404) throw new Error(`GitHub user or organization "@${targetUser || ghUsername}" not found.`);
        if (res.status === 401) throw new Error('Invalid token. Check your Personal Access Token.');
        if (res.status === 403) throw new Error('GitHub API rate limit exceeded. Click "Authorize 1-Click" or add PAT.');
        throw new Error('Could not fetch repositories.');
      }
      const list = await res.json();
      setUserRepos(list);
      setSelectedRepo(null);

      if (!Array.isArray(list) || list.length === 0) {
        addToast(`No repositories found for @${targetUser || ghUsername || 'user'}.`, 'info');
      } else {
        addToast(
          !targetUser && hasToken
            ? `Found ${list.length} repositories (including private repos)`
            : `Found ${list.length} public repositories for @${targetUser || ghUsername}`,
          'success'
        );
      }
    } catch (e: any) {
      addToast(e.message || 'Failed to fetch repositories', 'error');
    } finally {
      setFetchingRepos(false);
    }
  };

  // ─── Step 2: Fetch Folder Contents ───────────────────────────────────
  const fetchFolderContents = async (repo: GhRepoItem, path: string) => {
    setFetchingContents(true);
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
      if (optionalToken.trim()) headers.Authorization = `Bearer ${optionalToken.trim()}`;

      const cleanPath = path.replace(/^\//, '');
      const url = `https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/${cleanPath}?ref=${repo.default_branch || 'main'}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('Could not read folder contents.');
      const data = await res.json();

      const items: GhContentItem[] = Array.isArray(data) ? data : [data];
      // Sort directories first, then markdown files
      items.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'dir' ? -1 : 1;
      });

      setFolderContents(items);
      setCurrentFolderPath(cleanPath);
    } catch (e: any) {
      addToast(e.message || 'Failed to read directory', 'error');
    } finally {
      setFetchingContents(false);
    }
  };

  // ─── Select Repo ─────────────────────────────────────────────────────
  const handleSelectRepo = (repo: GhRepoItem) => {
    setSelectedRepo(repo);
    setActiveSelectedPath('/');
    void fetchFolderContents(repo, '');
  };

  // ─── Navigate Into Subfolder ─────────────────────────────────────────
  const handleNavigateSubfolder = (path: string) => {
    if (!selectedRepo) return;
    void fetchFolderContents(selectedRepo, path);
  };

  // ─── Navigate Up One Directory Level ──────────────────────────────────
  const handleNavigateUp = () => {
    if (!selectedRepo || !currentFolderPath) return;
    const parts = currentFolderPath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    void fetchFolderContents(selectedRepo, parentPath);
  };

  // ─── GitHub Source Directory & Question Scanner ───────────────────────
  const handleGitHubSourceScan = async (params: {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    token?: string;
    existingSourceId?: string;
  }) => {
    const { owner, repo, branch, path, token, existingSourceId } = params;
    const cleanPath = (path || '/').replace(/^\//, '').replace(/\/$/, '');
    const displayPath = cleanPath ? `/${cleanPath}` : '/';

    addToast(`Scanning GitHub repository ${owner}/${repo} at ${displayPath}…`, 'info');

    const tokenKey = `noledge:gh:token:${owner}/${repo}`;
    if (token && token.trim()) {
      const encrypted = await encrypt(token.trim());
      localStorage.setItem(tokenKey, encrypted);
    }

    try {
      const cfg: import('@/lib/github').GitHubConfig = {
        owner,
        repo,
        branch: branch || 'main',
        path: displayPath,
        token_key: tokenKey,
      };

      const rawFiles = await listGitHubFiles(cfg);

      const IGNORED_DIRS = ['node_modules/', '.next/', '.git/', 'dist/', 'build/', 'out/', 'coverage/', '.vscode/', 'vendor/', 'public/'];
      const files = rawFiles.filter((f) => {
        const lower = f.path.toLowerCase();
        if (IGNORED_DIRS.some((dir) => lower.includes(dir))) return false;
        return lower.endsWith('.json') || lower.endsWith('.md') || lower.endsWith('.markdown');
      });

      if (files.length === 0) {
        addToast(`No .json or .md question files found in ${owner}/${repo} at ${displayPath}`, 'warning');
      }

      const allQuestions: Question[] = [];
      const fileList: Array<{ path: string; name: string; question_count: number }> = [];
      const scannedSourcePaths = new Set<string>();

      const sourceId = existingSourceId || `gh-${owner.replace(/[^a-zA-Z0-9]/g, '-')}-${repo.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;

      // Parallel batch processing (6 concurrent requests) with 6s timeout per file
      const BATCH_SIZE = 6;
      let processedCount = 0;

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (file) => {
            try {
              const fetchPromise = fetchGitHubFile(file, cfg);
              const timeoutPromise = new Promise<null>((res) => setTimeout(() => res(null), 6000));
              const content = await Promise.race([fetchPromise, timeoutPromise]);

              if (!content) return;

              const parseResult = await parseQuestionMarkdown(content, file.path);
              if (parseResult.questions.length > 0) {
                const fileName = file.path.split('/').pop() || file.path;
                const targetDeckName = fileName.replace(/\.(json|md|markdown)$/i, '');

                const existingDecks = Object.values(useDeckStore.getState().decks);
                let targetDeck = existingDecks.find((d) => d.name.toLowerCase() === targetDeckName.toLowerCase());

                if (!targetDeck) {
                  targetDeck = await useDeckStore.getState().createDeck({
                    name: targetDeckName,
                    description: `File: ${file.path}`,
                    color: '#6366f1',
                    icon: 'github',
                    tags: [],
                    source: {
                      type: 'github',
                      source_id: sourceId,
                      github_owner: owner,
                      github_repo: repo,
                      github_branch: branch,
                      path: file.path,
                      last_synced: new Date().toISOString(),
                      sync_enabled: true,
                      sync_interval_minutes: 30,
                    },
                  });
                } else {
                  await useDeckStore.getState().updateDeck(targetDeck.id, { description: `File: ${file.path}` });
                }

                const qArr = parseResult.questions.map((q) => ({
                  ...q,
                  deck_id: targetDeck!.id,
                  source_file: file.path,
                }) as Question);

                allQuestions.push(...qArr);
                fileList.push({
                  path: file.path,
                  name: fileName,
                  question_count: qArr.length,
                });
                scannedSourcePaths.add(file.path);
              }
            } catch (err: any) {
              console.warn(`[GitHub Scan] Failed to process ${file.path}:`, err);
            }
          })
        );

        processedCount += batch.length;
        if (files.length > 10 && processedCount < files.length) {
          addToast(`Scanning GitHub repo "${owner}/${repo}"… (${processedCount}/${files.length} files scanned)`, 'info');
        }
      }

      if (allQuestions.length > 0) {
        await useQuestionStore.getState().upsertQuestions(allQuestions);
        await useDeckStore.getState().loadDecks();
      }

      const label = `GitHub Repo: ${owner}/${repo}${displayPath !== '/' ? displayPath : ''} (${allQuestions.length} questions across ${fileList.length} files)`;

      if (existingSourceId) {
        useSourceStore.getState().updateSource(existingSourceId, {
          label,
          path: displayPath,
          vault_path: displayPath,
          is_folder: true,
          file_list: fileList,
        });
      } else {
        addSource({
          id: sourceId,
          kind: 'github',
          owner,
          repo,
          branch,
          token: token ? tokenKey : undefined,
          label,
          path: displayPath,
          vault_path: displayPath,
          is_folder: true,
          file_list: fileList,
          created_at: new Date().toISOString(),
        } as any);
      }

      if (existingSourceId) {
        const allIDBQuestions = await getAllQuestions();
        for (const q of allIDBQuestions) {
          if (q && q.source_file && (q.source_file.includes(repo) || q.source_file.startsWith(`${owner}/${repo}`))) {
            if (!scannedSourcePaths.has(q.source_file)) {
              await deleteQuestion(q.id);
            }
          }
        }
      }

      addToast(`✅ Synced "${owner}/${repo}"! ${allQuestions.length} questions loaded across ${fileList.length} files.`, 'success');
    } catch (e: any) {
      addToast(`GitHub scan failed: ${e.message || 'Network error'}`, 'error');
    }
  };

  // ─── Step 3: Activate Source with Selected Folder/File ───────────────
  const handleActivateGitHubSource = async () => {
    if (!selectedRepo) return;
    const path = activeSelectedPath || `/${currentFolderPath}`;

    await handleGitHubSourceScan({
      owner: selectedRepo.owner.login,
      repo: selectedRepo.name,
      branch: selectedRepo.default_branch || 'main',
      path,
      token: optionalToken.trim(),
    });

    setSelectedRepo(null);
    setUserRepos([]);
  };

  // ─── Direct Live Local Vault Disk Handle (FileSystemAccess API) ──────
  const handleLiveLocalVaultPick = async (existingHandle?: any) => {
    let handle = existingHandle;
    
    if (!handle) {
      if (!('showDirectoryPicker' in window)) {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
        if (isMobile) {
          addToast('Mobile browser detected. Select one or multiple deck files (.md / .json)…', 'info');
          fileInputMultiRef.current?.click();
        } else {
          addToast('Direct directory handles are supported in Chrome/Edge. Opening file picker…', 'info');
          fileInputRef.current?.click();
        }
        return;
      }
      try {
        // @ts-ignore - File System Access API with persistent id startingDirectory
        handle = await window.showDirectoryPicker({
          id: 'noledge-vault-picker',
          mode: 'readwrite',
        });

        // Cache live handle for local disk operations
        if (typeof window !== 'undefined') {
          (window as any)[`vault_handle_${handle.name}`] = handle;
          void saveFileHandle(`vault_handle_${handle.name}`, handle);
          void saveFileHandle('vault_last_root', handle);
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        return;
      }
    }

    try {
      let mdCount = 0;
      const allQuestions: Question[] = [];
      const seenFileContentMap = new Map<string, { content: string; relPath: string }>();
      const scannedSourceIds = new Set<string>();
      const scannedRelPaths = new Set<string>();
      const fileList: Array<{ path: string; name: string; question_count: number }> = [];

      const IGNORED_NAMES = new Set(['node_modules', '.next', '.git', '.vscode', 'dist', 'build', 'out', 'coverage', 'public']);

      // Helper for recursive directory scan
      const scanDirectory = async (dirHandle: any, pathPrefix = '') => {
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
          const relPath = `${pathPrefix}${entry.name}`;
          const lowerRel = relPath.toLowerCase();

          if (
            entry.name.startsWith('.') ||
            IGNORED_NAMES.has(entry.name.toLowerCase()) ||
            lowerRel.includes('node_modules/') || lowerRel.includes('node_modules\\') ||
            lowerRel.includes('.next/') || lowerRel.includes('.next\\') ||
            lowerRel.includes('.git/') || lowerRel.includes('.git\\')
          ) {
            continue;
          }
          if (entry.kind === 'file' && (entry.name.endsWith('.json') || entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) {
            const normName = entry.name.toLowerCase().trim();

            try {
              const file = await entry.getFile();
              const text = await file.text();
              const trimmedText = text.trim();

              // 1. First Match Name
              if (seenFileContentMap.has(normName)) {
                const existing = seenFileContentMap.get(normName)!;
                // 2. If Name is SAME, check Content / Code
                if (existing.content === trimmedText) {
                  // Name SAME + Content SAME -> Exact Duplicate! Skip!
                  continue;
                }
                // Name SAME but Content DIFFERENT -> Normal add everything with path
              }

              const parseResult = await parseQuestionMarkdown(text, relPath);
              if (parseResult.questions.length > 0) {
                seenFileContentMap.set(normName, { content: trimmedText, relPath });
                scannedRelPaths.add(relPath);
                mdCount++;
                fileList.push({ path: relPath, name: entry.name, question_count: parseResult.questions.length });

                const targetDeckName = entry.name.replace(/\.(json|md|markdown)$/i, '');
                const existingDecks = Object.values(useDeckStore.getState().decks);
                let targetDeck = existingDecks.find((d) => d.name.toLowerCase() === targetDeckName.toLowerCase());

                if (!targetDeck) {
                  targetDeck = await useDeckStore.getState().createDeck({
                    name: targetDeckName,
                    description: `File: ${relPath}`,
                    color: '#8b5cf6',
                    icon: 'obsidian',
                    tags: [],
                  });
                } else {
                  await useDeckStore.getState().updateDeck(targetDeck.id, { description: `File: ${relPath}` });
                }

                for (const q of parseResult.questions) {
                  allQuestions.push({ ...q, deck_id: targetDeck.id } as Question);
                }
              }
            } catch {
              // Skip unparseable file
            }
          } else if (entry.kind === 'directory') {
            await scanDirectory(entry, `${pathPrefix}${entry.name}/`);
          }
        }
      };

      await scanDirectory(handle, `${handle.name}/`);

      if (allQuestions.length > 0) {
        const folderSourceId = `obs-folder-${handle.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
        addSource({
          id: folderSourceId,
          kind: 'obsidian',
          vault_name: handle.name,
          access_method: 'local-rest-api',
          api_port: 27123,
          is_folder: true,
          file_list: fileList,
          label: `Obsidian Vault: ${handle.name} (${allQuestions.length} questions across ${fileList.length} files)`,
          created_at: new Date().toISOString(),
        });
      }

      // Purge stale sources & questions for files that were physically removed from disk
      const currentSources = useSourceStore.getState().sources;
      const staleSources = currentSources.filter(
        (s) => (s.id.startsWith('obs-file-') || s.label.startsWith('Obsidian File:')) && !scannedSourceIds.has(s.id)
      );

      for (const stale of staleSources) {
        const targetPath = stale.label.replace(/^Obsidian File:\s*/, '').replace(/\s*\(\d+\s+questions\)$/, '').trim();
        const targetFileName = (stale as any).vault_name ? (stale as any).vault_name.replace(/\.(md|markdown)$/i, '').toLowerCase() : '';

        // Only delete if targetPath was not scanned in this session
        if (!scannedRelPaths.has(targetPath)) {
          useSourceStore.getState().removeSource(stale.id);
          const allIDBQuestions = await getAllQuestions();
          for (const q of allIDBQuestions) {
            if (q && (q.source_file === targetPath || q.source_file?.includes(targetPath))) {
              await deleteQuestion(q.id);
            }
          }

          // Delete orphaned deck for this deleted file
          const allDecks = Object.values(useDeckStore.getState().decks);
          const orphanedDeck = allDecks.find(
            (d) => d.name.toLowerCase() === targetFileName || d.description?.includes(targetPath)
          );
          if (orphanedDeck) {
            await useDeckStore.getState().deleteDeck(orphanedDeck.id);
          }
        }
      }

      if (allQuestions.length === 0) {
        addToast(
          `❌ PARSE FAILED: 0 valid questions found in folder "${handle.name}" (${mdCount} .md files scanned).`,
          'error'
        );
        await useDeckStore.getState().loadDecks();
        return;
      }

      // Purge stale questions & decks in IndexedDB/stores for files physically removed from disk
      const scannedDeckIds = new Set(allQuestions.map((q) => q.deck_id));
      const activeQuestionIds = new Set(allQuestions.map((q) => q.id));

      // 1. Delete questions in IndexedDB that are no longer active
      const allIDBQuestions = await getAllQuestions();
      for (const q of allIDBQuestions) {
        if (q && (!activeQuestionIds.has(q.id) || !scannedDeckIds.has(q.deck_id))) {
          await deleteQuestion(q.id);
        }
      }

      // 2. Delete stale decks from deckStore whose files were removed from disk
      const existingDecks = Object.values(useDeckStore.getState().decks);
      for (const deck of existingDecks) {
        if (!scannedDeckIds.has(deck.id)) {
          await useDeckStore.getState().deleteDeck(deck.id);
        }
      }

      // 3. Clear questionsByDeck cache for deleted decks
      useQuestionStore.setState((state) => {
        const nextMap: Record<string, Question[]> = {};
        for (const [dId, qList] of Object.entries(state.questionsByDeck)) {
          if (scannedDeckIds.has(dId)) {
            nextMap[dId] = qList.filter((q) => activeQuestionIds.has(q.id));
          }
        }
        return { questionsByDeck: nextMap };
      });

      await useQuestionStore.getState().upsertQuestions(allQuestions);
      await useDeckStore.getState().loadDecks();

      addToast(
        `✅ Live disk folder "${handle.name}" connected! Imported ${allQuestions.length} unique questions.`,
        'success'
      );

    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        addToast('Could not access local folder handle.', 'error');
      }
    }
  };

  // ─── Obsidian Native Folder Selection (HTML5 webkitdirectory) ───────
  const handleVaultFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const sampleFile = files[0];
    const pathParts = sampleFile.webkitRelativePath ? sampleFile.webkitRelativePath.split('/') : ['Obsidian Vault'];
    const vaultName = pathParts[0] || 'Obsidian Vault';

    let mdCount = 0;
    const allQuestions: Question[] = [];
    const seenFileContentMap = new Map<string, { content: string; relPath: string }>();
    const scannedSourceIds = new Set<string>();
    const scannedRelPaths = new Set<string>();

    const fileList: Array<{ path: string; name: string; question_count: number }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = file.webkitRelativePath || file.name;

      const lowerPath = relPath.toLowerCase();
      // Skip ignored folders
      if (
        relPath.includes('/.') || relPath.includes('\\.') ||
        lowerPath.includes('node_modules/') || lowerPath.includes('node_modules\\') ||
        lowerPath.includes('.next/') || lowerPath.includes('.next\\') ||
        lowerPath.includes('.git/') || lowerPath.includes('.git\\') ||
        lowerPath.includes('/dist/') || lowerPath.includes('\\dist\\') ||
        lowerPath.includes('/build/') || lowerPath.includes('\\build\\')
      ) {
        continue;
      }

      if (file.name.endsWith('.json') || file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
        const normName = file.name.toLowerCase().trim();

        try {
          const text = await file.text();
          const trimmedText = text.trim();

          if (seenFileContentMap.has(normName)) {
            const existing = seenFileContentMap.get(normName)!;
            if (existing.content === trimmedText) {
              continue;
            }
          }

          const parseResult = await parseQuestionMarkdown(text, relPath);
          if (parseResult.questions.length > 0) {
            seenFileContentMap.set(normName, { content: trimmedText, relPath });
            scannedRelPaths.add(relPath);
            mdCount++;
            fileList.push({ path: relPath, name: file.name, question_count: parseResult.questions.length });

            const targetDeckName = file.name.replace(/\.(json|md|markdown)$/i, '');
            const existingDecks = Object.values(useDeckStore.getState().decks);
            let targetDeck = existingDecks.find((d) => d.name.toLowerCase() === targetDeckName.toLowerCase());

            if (!targetDeck) {
              targetDeck = await useDeckStore.getState().createDeck({
                name: targetDeckName,
                description: `File: ${relPath}`,
                color: '#8b5cf6',
                icon: 'obsidian',
                tags: [],
              });
            } else {
              await useDeckStore.getState().updateDeck(targetDeck.id, { description: `File: ${relPath}` });
            }

            for (const q of parseResult.questions) {
              allQuestions.push({ ...q, deck_id: targetDeck.id } as Question);
            }
          }
        } catch {
          // Skip file if parse error
        }
      }
    }

    if (allQuestions.length === 0) {
      addToast(
        `❌ PARSE FAILED: 0 valid questions found in folder "${vaultName}" (${mdCount} .md files scanned).`,
        'error'
      );
      e.target.value = '';
      return;
    }

    const folderSourceId = `obs-folder-${vaultName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-')}`;
    addSource({
      id: folderSourceId,
      kind: 'obsidian',
      vault_name: vaultName,
      access_method: 'local-rest-api',
      api_port: 27123,
      is_folder: true,
      file_list: fileList,
      label: `Obsidian Vault: ${vaultName} (${allQuestions.length} questions across ${fileList.length} files)`,
      created_at: new Date().toISOString(),
    });

    // Purge stale sources & questions for files that were physically removed from disk
    const currentSources = useSourceStore.getState().sources;
    const staleSources = currentSources.filter(
      (s) => (s.id.startsWith('obs-file-') || s.label.startsWith('Obsidian File:')) && !scannedSourceIds.has(s.id)
    );

    for (const stale of staleSources) {
      const targetPath = stale.label.replace(/^Obsidian File:\s*/, '').replace(/\s*\(\d+\s+questions\)$/, '').trim();
      const targetFileName = (stale as any).vault_name ? (stale as any).vault_name.replace(/\.(md|markdown)$/i, '').toLowerCase() : '';

      // Only delete if targetPath was not scanned in this session
      if (!scannedRelPaths.has(targetPath)) {
        useSourceStore.getState().removeSource(stale.id);
        const allIDBQuestions = await getAllQuestions();
        for (const q of allIDBQuestions) {
          if (q && (q.source_file === targetPath || q.source_file?.includes(targetPath))) {
            await deleteQuestion(q.id);
          }
        }

        // Delete orphaned deck for this deleted file
        const allDecks = Object.values(useDeckStore.getState().decks);
        const orphanedDeck = allDecks.find(
          (d) => d.name.toLowerCase() === targetFileName || d.description?.includes(targetPath)
        );
        if (orphanedDeck) {
          await useDeckStore.getState().deleteDeck(orphanedDeck.id);
        }
      }
    }

    // Purge stale questions & decks in IndexedDB/stores for files physically removed from disk
    const scannedDeckIds = new Set(allQuestions.map((q) => q.deck_id));
    const activeQuestionIds = new Set(allQuestions.map((q) => q.id));

    // 1. Delete questions in IndexedDB that are no longer active
    const allIDBQuestions = await getAllQuestions();
    for (const q of allIDBQuestions) {
      if (q && (!activeQuestionIds.has(q.id) || !scannedDeckIds.has(q.deck_id))) {
        await deleteQuestion(q.id);
      }
    }

    // 2. Delete stale decks from deckStore whose files were removed from disk
    const existingDecks = Object.values(useDeckStore.getState().decks);
    for (const deck of existingDecks) {
      if (!scannedDeckIds.has(deck.id)) {
        await useDeckStore.getState().deleteDeck(deck.id);
      }
    }

    // 3. Clear questionsByDeck cache for deleted decks
    useQuestionStore.setState((state) => {
      const nextMap: Record<string, Question[]> = {};
      for (const [dId, qList] of Object.entries(state.questionsByDeck)) {
        if (scannedDeckIds.has(dId)) {
          nextMap[dId] = qList.filter((q) => activeQuestionIds.has(q.id));
        }
      }
      return { questionsByDeck: nextMap };
    });

    await useQuestionStore.getState().upsertQuestions(allQuestions);
    await useDeckStore.getState().loadDecks();

    addToast(
      `✅ Connected folder "${vaultName}"! Found ${mdCount} .md files, imported ${allQuestions.length} unique questions.`,
      'success'
    );

    e.target.value = '';
  };

  // ─── Single .md File Selection with Modern File System API ─────────
  const handleSingleFilePick = async () => {
    if ('showOpenFilePicker' in window) {
      try {
        // @ts-ignore - File System Access API with persistent id startingDirectory
        const [fileHandle] = await window.showOpenFilePicker({
          id: 'noledge-file-picker',
          types: [{ description: 'JSON & Markdown Files', accept: { 'application/json': ['.json'], 'text/markdown': ['.md', '.markdown'] } }],
        });

        const file = await fileHandle.getFile();
        const text = await file.text();
        const parseResult = await parseQuestionMarkdown(text, file.name);

        if (parseResult.questions.length === 0) {
          const errorDetails = parseResult.errors.length > 0
            ? parseResult.errors.slice(0, 2).join(' | ')
            : "File is missing Noledge question JSON data.";
          addToast(`❌ PARSE FAILED: 0 valid questions found in "${file.name}". ${errorDetails}`, 'error');
          return;
        }

        const typeCounts: Record<string, number> = {};
        for (const q of parseResult.questions) {
          typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
        }
        const breakdown = Object.entries(typeCounts)
          .map(([t, count]) => `${count} ${t.toUpperCase()}`)
          .join(', ');

        const deckName = file.name.replace(/\.(json|md|markdown)$/i, '');
        const fullPath = (file as any).path || file.webkitRelativePath || file.name;

        const existingDecks = Object.values(useDeckStore.getState().decks);
        let deck = existingDecks.find((d) => d.name.toLowerCase() === deckName.toLowerCase());

        if (!deck) {
          deck = await useDeckStore.getState().createDeck({
            name: deckName,
            description: `File: ${fullPath} (${breakdown})`,
            color: '#10b981',
            icon: 'file-text',
            tags: [],
          });
        }

        const questionsToAdd: Question[] = parseResult.questions.map((q) => ({
          ...q,
          deck_id: deck.id,
          source_file: fullPath,
        }));

        // Purge existing questions for this deck to ensure clean replacement without duplicates
        const { getQuestionsByDeck: getQs, deleteQuestion: deleteFromIDB } = await import('@/lib/storage');
        const existingQs = await getQs(deck.id);
        for (const oldQ of existingQs) {
          await deleteFromIDB(oldQ.id);
        }

        await useQuestionStore.getState().upsertQuestions(questionsToAdd);
        await useDeckStore.getState().updateDeck(deck.id, {
          question_count: parseResult.questions.length,
          description: `File: ${fullPath} (${breakdown})`,
        });
        await useDeckStore.getState().loadDecks();

        const sourceId = `single-file-${Date.now()}`;
        await saveFileHandle(sourceId, fileHandle);
        await saveFileHandle(`file_${file.name}`, fileHandle);

        // Request readwrite permission NOW while we are inside the user gesture context.
        // Later calls from syncDeckToFile run outside user gestures, so requestPermission
        // would be silently denied. queryPermission here will return 'granted' for the session.
        try {
          await (fileHandle as any).requestPermission({ mode: 'readwrite' });
        } catch (_permErr) {
          // Non-fatal — write will fall back gracefully
        }

        if (typeof window !== 'undefined') {
          (window as any)[`file_handle_${sourceId}`] = fileHandle;
          (window as any)[`file_handle_${file.name}`] = fileHandle;
        }

        addSource({
          id: sourceId,
          kind: 'obsidian',
          vault_name: file.name,
          vault_path: fullPath,
          access_method: 'local-rest-api',
          api_port: 27123,
          label: `File: ${fullPath} (${parseResult.questions.length} questions)`,
          created_at: new Date().toISOString(),
        });

        addToast(`✅ Connected exact file "${file.name}"! (${parseResult.questions.length} questions)`, 'success');
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }
    fileInputSingleRef.current?.click();
  };

  // ─── Single .md File Selection Fallback (HTML5 File Input) ─────────────
  const handleSingleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.name.endsWith('.json') && !file.name.endsWith('.md') && !file.name.endsWith('.markdown')) {
      addToast('Please select a JSON file (.json) or Markdown file (.md)', 'error');
      return;
    }

    try {
      const text = await file.text();
      const parseResult = await parseQuestionMarkdown(text, file.name);

      if (parseResult.questions.length === 0) {
        const errorDetails = parseResult.errors.length > 0
          ? parseResult.errors.slice(0, 2).join(' | ')
          : "File is missing Noledge question frontmatter block (e.g. 'type: mcq' or 'type: tf').";
        addToast(`❌ PARSE FAILED: 0 valid questions found in "${file.name}". ${errorDetails}`, 'error');
        return;
      }

      const typeCounts: Record<string, number> = {};
      for (const q of parseResult.questions) {
        typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
      }
      const breakdown = Object.entries(typeCounts)
        .map(([t, count]) => `${count} ${t.toUpperCase()}`)
        .join(', ');

      const deckName = file.name.replace(/\.(md|markdown)$/i, '');
      const fullPath = (file as any).path || file.webkitRelativePath || file.name;

      const existingDecks = Object.values(useDeckStore.getState().decks);
      let deck = existingDecks.find((d) => d.name.toLowerCase() === deckName.toLowerCase());

      if (!deck) {
        deck = await useDeckStore.getState().createDeck({
          name: deckName,
          description: `Imported from ${fullPath} (${breakdown})`,
          color: '#10b981',
          icon: 'file-text',
          tags: [],
        });
      }

        const questionsToAdd: Question[] = parseResult.questions.map((q) => ({
          ...q,
          deck_id: deck.id,
          source_file: fullPath,
        }));

        // Purge existing questions for this deck to ensure clean replacement without duplicates
        const { getQuestionsByDeck: getQs2, deleteQuestion: deleteFromIDB2 } = await import('@/lib/storage');
        const existingQs2 = await getQs2(deck.id);
        for (const oldQ of existingQs2) {
          await deleteFromIDB2(oldQ.id);
        }

        await useQuestionStore.getState().upsertQuestions(questionsToAdd);
      await useDeckStore.getState().updateDeck(deck.id, {
        question_count: parseResult.questions.length,
        description: `Imported from ${fullPath} (${breakdown})`,
      });
      await useDeckStore.getState().loadDecks();

      const existingSources = useSourceStore.getState().sources;
      const existingSource = existingSources.find((s) => s.id.startsWith('single-file-') && ((s as any).vault_name === file.name || s.label.includes(file.name)));

      if (existingSource) {
        useSourceStore.getState().updateSource(existingSource.id, {
          label: `File: ${fullPath} (${parseResult.questions.length} questions)`,
          vault_path: fullPath,
        });
      } else {
        addSource({
          id: `single-file-${Date.now()}`,
          kind: 'obsidian',
          vault_name: file.name,
          vault_path: fullPath,
          access_method: 'local-rest-api',
          api_port: 27123,
          label: `File: ${fullPath} (${parseResult.questions.length} questions)`,
          created_at: new Date().toISOString(),
        });
      }

      addToast(`✅ Parsed file "${file.name}"! (${parseResult.questions.length} questions)`, 'success');
    } catch (err: any) {
      addToast(`Failed to parse file: ${err.message || 'File reading error'}`, 'error');
    } finally {
      e.target.value = '';
    }
  };

  // ─── Exact Path Source Re-Sync (IndexedDB Handle Caching & File System API) ────
  const handleSourceResync = async (source: Source) => {
    if (source.kind === 'github' || (source.id && source.id.startsWith('gh-')) || source.label.startsWith('GitHub')) {
      return;
    }

    const isSingleFile = source.id.startsWith('single-file-') || source.label.startsWith('File:') || source.label.startsWith('Obsidian File:');
    const vaultName = (source as any).vault_name || source.label;

    if (isSingleFile) {
      // ── Helper: parse + purge + upsert from a FileSystemFileHandle ──────
      const syncFromHandle = async (fileHandle: any): Promise<boolean> => {
        try {
          const status = await fileHandle.queryPermission({ mode: 'read' });
          const perm = status === 'granted' ? 'granted' : await fileHandle.requestPermission({ mode: 'read' });
          if (perm !== 'granted') return false;

          const file = await fileHandle.getFile();
          const text = await file.text();
          const parseResult = await parseQuestionMarkdown(text, file.name);
          if (parseResult.questions.length === 0) return false;

          const deckName = file.name.replace(/\.(json|md|markdown)$/i, '');
          // Use the handle's stored vault_path or fall back to file.name (bare).
          // We keep source_file as file.name — the handle IS the real reference.
          const sourcePath = (source as any).vault_path || file.name;

          const existingDecks = Object.values(useDeckStore.getState().decks);
          let deck = existingDecks.find((d) => d.name.toLowerCase() === deckName.toLowerCase());
          if (!deck) {
            deck = await useDeckStore.getState().createDeck({ name: deckName, description: `File: ${sourcePath}`, color: '#10b981', icon: 'file-text', tags: [] });
          }

          const qArr = parseResult.questions.map((q) => ({ ...q, deck_id: deck!.id, source_file: sourcePath }) as Question);

          // Purge all existing questions for this deck from IDB to guarantee 100% clean replacement
          const { getQuestionsByDeck: getQsByDeck, deleteQuestion: deleteFromIDB } = await import('@/lib/storage');
          const idbExisting = await getQsByDeck(deck!.id);
          for (const oldQ of idbExisting) {
            await deleteFromIDB(oldQ.id);
          }

          await useQuestionStore.getState().upsertQuestions(qArr);
          await useDeckStore.getState().updateDeck(deck!.id, { question_count: qArr.length });
          await useDeckStore.getState().loadDecks();

          const updatedLabel = source.label.replace(/\(\d+\s+questions[^)]*\)/, `(${qArr.length} questions)`);
          useSourceStore.getState().updateSource(source.id, { label: updatedLabel });

          addToast(`✅ Re-synced "${file.name}" from original file! (${qArr.length} questions)`, 'success');
          return true;
        } catch {
          return false;
        }
      };

      // 1. Try cached handle first (points to the REAL file the user originally picked)
      let cachedFileHandle: any = typeof window !== 'undefined'
        ? (window as any)[`file_handle_${source.id}`] || (window as any)[`file_handle_${vaultName}`]
        : null;

      if (!cachedFileHandle) {
        cachedFileHandle = (await getFileHandle(source.id)) || (await getFileHandle(`file_${vaultName}`));
      }

      if (cachedFileHandle && await syncFromHandle(cachedFileHandle)) return;

      // 2. Handle expired or missing — ask user to re-pick the same file
      if ('showOpenFilePicker' in window) {
        try {
          const options: any = {
            id: source.id.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32),
            types: [{ description: 'JSON & Markdown Files', accept: { 'application/json': ['.json'], 'text/markdown': ['.md', '.markdown'] } }],
          };
          if (cachedFileHandle) options.startIn = cachedFileHandle;
          // @ts-ignore
          const [fileHandle] = await window.showOpenFilePicker(options);

          // Request readwrite while inside user gesture
          try { await (fileHandle as any).requestPermission({ mode: 'readwrite' }); } catch (_) { /* non-fatal */ }

          await saveFileHandle(source.id, fileHandle);
          await saveFileHandle(`file_${vaultName}`, fileHandle);
          if (typeof window !== 'undefined') {
            (window as any)[`file_handle_${source.id}`] = fileHandle;
            (window as any)[`file_handle_${vaultName}`] = fileHandle;
          }

          await syncFromHandle(fileHandle);
          return;
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
        }
      }

      fileInputSingleRef.current?.click();
    } else {
      let cachedDirHandle: any = typeof window !== 'undefined'
        ? (window as any)[`vault_handle_${source.id}`] || (window as any)[`vault_handle_${vaultName}`]
        : null;

      if (!cachedDirHandle) {
        cachedDirHandle = (await getFileHandle(source.id)) || (await getFileHandle(`vault_${vaultName}`));
      }

      if (cachedDirHandle) {
        try {
          if (cachedDirHandle.requestPermission) {
            const status = await cachedDirHandle.queryPermission({ mode: 'read' });
            const perm = status === 'granted' ? 'granted' : await cachedDirHandle.requestPermission({ mode: 'read' });
            if (perm === 'granted') {
              addToast(`Re-syncing folder "${vaultName}"…`, 'info');
              void handleLiveLocalVaultPick(cachedDirHandle);
              return;
            }
          }
        } catch {
          // Fallback
        }
      }

      if ('showDirectoryPicker' in window) {
        try {
          const options: any = {
            id: source.id.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32),
            mode: 'readwrite',
          };
          if (cachedDirHandle) {
            options.startIn = cachedDirHandle;
          }
          // @ts-ignore
          const handle = await window.showDirectoryPicker(options);
          await saveFileHandle(source.id, handle);
          await saveFileHandle(`vault_${vaultName}`, handle);
          if (typeof window !== 'undefined') {
            (window as any)[`vault_handle_${source.id}`] = handle;
            (window as any)[`vault_handle_${vaultName}`] = handle;
          }
          void handleLiveLocalVaultPick(handle);
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
        }
      } else {
        fileInputRef.current?.click();
      }
    }
  };

  // ─── Obsidian Connect via REST API ───────────────────────────────────
  const handleObsidianConnect = async () => {
    if (!obsToken) return;
    setObsConnecting(true);
    try {
      const error = await validateObsidian({ vault_url: obsUrl, vault_path: '/' }, obsToken);
      if (error) { addToast(error, 'error'); return; }

      const tokenKey = `noledge:obs:token:${obsUrl}`;
      const encrypted = await encrypt(obsToken);
      localStorage.setItem(tokenKey, encrypted);

      addSource({
        id: `obs-${Date.now()}`,
        kind: 'obsidian',
        vault_name: 'My Vault',
        access_method: 'local-rest-api',
        api_port: 27123,
        api_token: tokenKey,
        vault_path: '/',
        label: 'Obsidian Vault',
        created_at: new Date().toISOString(),
      });

      addToast('Obsidian vault connected', 'success');
      setObsToken('');
    } catch {
      addToast('Failed to connect to Obsidian', 'error');
    } finally {
      setObsConnecting(false);
    }
  };

  return (
    <div className={styles.sourceManager}>
      {/* Invisible HTML5 Directory Picker */}
      <input
        type="file"
        // @ts-ignore - HTML5 webkitdirectory for folder selection
        webkitdirectory=""
        directory=""
        ref={fileInputRef}
        style={{ display: 'none' }}
        onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ''; }}
        onChange={handleVaultFolderChange}
      />

      {/* Invisible Multi-File Picker for Mobile & Unsupported Browsers */}
      <input
        type="file"
        multiple
        accept=".json,.md,.markdown"
        ref={fileInputMultiRef}
        style={{ display: 'none' }}
        onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ''; }}
        onChange={handleVaultFolderChange}
      />

      {/* Invisible Single File Picker */}
      <input
        type="file"
        accept=".json,.md,.markdown"
        ref={fileInputSingleRef}
        style={{ display: 'none' }}
        onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ''; }}
        onChange={handleSingleFileChange}
      />



      {/* ─── GitHub Interactive Picker ───────────────────────────────────── */}
      <details className={styles.connectDetails} open>
        <summary className={styles.connectSummary}>
          <GitBranch size={16} className="text-accent" /> Connect GitHub Repository & Select Question Folder
        </summary>
        <div className={styles.connectForm}>

          {/* STEP 1: Enter Username or 1-Click Authorize */}
          {!selectedRepo ? (
            <>
              {/* Device Code Active Authorization Banner */}
              {deviceInfo && (
                <div
                  style={{
                    padding: '14px',
                    background: 'var(--color-bg-tertiary)',
                    border: '1px dashed var(--color-accent)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent)' }}>
                    Device Authorization Code Generated
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Your code is: <strong className="font-mono text-accent" style={{ fontSize: 16, marginLeft: 4, letterSpacing: '0.1em' }}>{deviceInfo.user_code}</strong> (Auto-copied!)
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <a
                      href="https://github.com/login/device"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        void copyToClipboard(deviceInfo.user_code);
                        addToast(`Copied code "${deviceInfo.user_code}"! Paste in GitHub app/site.`, 'success');
                      }}
                      style={{ gap: 6, textDecoration: 'none' }}
                    >
                      <ExternalLink size={14} /> 📱 Open GitHub App / Web
                    </a>
                    {pollingDevice && (
                      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', alignSelf: 'center' }}>
                        Waiting for authorization…
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 1-Click GitHub Authorize Banner */}
              <div
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-accent-subtle)',
                  border: '1px solid var(--color-accent-border)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    🔒 Access Private & Public Repositories
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2, wordBreak: 'break-word' }}>
                    Click Authorize for 1-click web authorization, or click Device Code to authorize via native GitHub App (code auto-copies to clipboard).
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {hasSavedToken && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-danger"
                      onClick={handleDeleteTokenPermanently}
                      title="Permanently delete token for this account from database"
                    >
                      Delete Token
                    </button>
                  )}
                  {isMobile && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleStartDeviceFlow()}
                      title="Generate 8-character device authorization code"
                    >
                      Device Code
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleAuthorizeAction}
                    style={{ flexShrink: 0, gap: 6 }}
                  >
                    <ExternalLink size={14} /> Authorize GitHub
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Enter GitHub Username (e.g. Tanish434)"
                    value={ghUsername}
                    onChange={(e) => setGhUsername(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleFetchUserRepos(); }}
                    style={{ width: '100%' }}
                  />
                </div>
                {ghUsername && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handleClearUsernameInput}
                    title="Clear username input without deleting stored tokens"
                  >
                    Clear Input
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => void handleFetchUserRepos()}
                  disabled={fetchingRepos || !ghUsername.trim()}
                >
                  <Search size={14} /> {fetchingRepos ? 'Finding…' : 'Find Repositories'}
                </button>
              </div>

              {/* Optional Token input */}
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  Or paste Personal Access Token (PAT) here for private repos:
                </span>
                <input
                  type="password"
                  className="input"
                  placeholder="Paste GitHub Access Token (PAT)"
                  value={optionalToken}
                  onChange={(e) => {
                    setOptionalToken(e.target.value);
                    if (e.target.value.trim()) {
                      void handleFetchUserRepos();
                    }
                  }}
                  style={{ marginTop: 4, width: '100%', fontSize: 12 }}
                />
              </div>

              {/* Repo Selector Grid */}
              {userRepos.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Select Repository to Browse ({userRepos.length} found)
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                    {userRepos.map((repo) => (
                      <div
                        key={repo.full_name}
                        onClick={() => handleSelectRepo(repo)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-bg-tertiary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 8,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                          <div className="text-sm font-semibold font-mono" style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {repo.name}
                          </div>
                          {repo.description && (
                            <div className="text-xs text-tertiary" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {repo.description}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
                          {repo.private ? (
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--color-danger-bg)', color: 'var(--color-danger)', fontWeight: 600 }}>
                              🔒 Private
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--color-bg-hover)', color: 'var(--color-text-tertiary)' }}>
                              Public
                            </span>
                          )}
                          {repo.language && (
                            <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                              {repo.language}
                            </span>
                          )}
                          <ChevronRight size={16} className="text-tertiary" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* STEP 2: Interactive Folder & File Explorer */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Back to Repo Selection Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--color-border)' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedRepo(null)}
                  style={{ gap: 4 }}
                >
                  <ArrowLeft size={14} /> Back to Repositories
                </button>
                <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {selectedRepo.full_name}
                </div>
              </div>

              {/* Breadcrumb Path Bar */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: 12, background: 'var(--color-bg-tertiary)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <span className="font-mono text-tertiary">Path:</span>
                <span className="font-mono font-semibold" style={{ color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>
                  /{currentFolderPath || ''}
                </span>
                {currentFolderPath && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }} onClick={handleNavigateUp}>
                    ↑ Up Level
                  </button>
                )}
              </div>

              {/* Active Selection Indicator */}
              <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--color-accent)', fontWeight: 500, wordBreak: 'break-all' }}>
                  Active Question Target: <strong className="font-mono">{activeSelectedPath}</strong>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11, color: 'var(--color-accent)', marginLeft: 'auto' }}
                  onClick={() => setActiveSelectedPath(`/${currentFolderPath}`)}
                >
                  Set Current Folder ({currentFolderPath ? `/${currentFolderPath}` : 'Root /'})
                </button>
              </div>

              {/* Interactive Directory Contents List */}
              {fetchingContents ? (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                  Reading directory contents…
                </div>
              ) : (
                <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
                  {folderContents.map((item) => {
                    const itemPath = `/${item.path}`;
                    const isSelected = activeSelectedPath === itemPath;
                    const isJsonOrMd = item.name.endsWith('.json') || item.name.endsWith('.md');

                    return (
                      <div
                        key={item.path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 6,
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                          background: isSelected ? 'var(--color-accent-subtle)' : 'var(--color-bg-tertiary)',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 140px', minWidth: 0, cursor: item.type === 'dir' ? 'pointer' : 'default' }}
                          onClick={() => { if (item.type === 'dir') handleNavigateSubfolder(item.path); }}
                        >
                          {item.type === 'dir' ? (
                            <Folder size={16} className="text-accent" style={{ flexShrink: 0 }} />
                          ) : (
                            <FileText size={16} style={{ color: isJsonOrMd ? 'var(--color-accent)' : 'var(--color-text-tertiary)', flexShrink: 0 }} />
                          )}
                          <span className="text-sm font-mono" style={{ fontWeight: item.type === 'dir' ? 600 : 400, wordBreak: 'break-word' }}>
                            {item.name}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
                          {item.type === 'dir' && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => handleNavigateSubfolder(item.path)}
                            >
                              Open Folder <ChevronRight size={12} />
                            </button>
                          )}
                          {(item.type === 'dir' || isJsonOrMd) && (
                            <button
                              className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-ghost'}`}
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => setActiveSelectedPath(itemPath)}
                            >
                              {isSelected ? <><Check size={12} /> Selected</> : 'Select Target'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action Button: Activate Selected Source */}
              <button
                className="btn btn-primary"
                style={{ marginTop: 8, width: '100%', gap: 6 }}
                onClick={() => void handleActivateGitHubSource()}
              >
                <Sparkles size={16} /> Activate Source ({selectedRepo.name} → {activeSelectedPath})
              </button>
            </div>
          )}
        </div>
      </details>

      {/* ─── Obsidian Connect Form ───────────────────────────────────────── */}
      <details className={styles.connectDetails} open>
        <summary className={styles.connectSummary}>
          <HardDrive size={16} className="text-accent" /> Connect Obsidian Vault / Local Deck
        </summary>
        <div className={styles.connectForm}>
          {/* Direct Local Folder or Single File Selection */}
          <div style={{ padding: '10px 14px', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div className="text-sm font-medium" style={{ wordBreak: 'break-word' }}>Connect Local Disk Vault or Single File</div>
              <div className="text-xs text-tertiary" style={{ wordBreak: 'break-word' }}>Select an entire vault folder or a specific .json / .md file</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => void handleSingleFilePick()}>
                <FileText size={14} /> Connect Deck File (.json)
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => void handleLiveLocalVaultPick()}>
                <FolderOpen size={14} /> Connect Live Vault
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-text-tertiary)', margin: '4px 0' }}>— OR connect via Local REST API —</div>

          <input id="obs-url" type="text" className="input" placeholder="Vault URL (default: https://127.0.0.1:27123)" value={obsUrl} onChange={(e) => setObsUrl(e.target.value)} />
          <input id="obs-token" type="password" className="input" placeholder="Local REST API key" value={obsToken} onChange={(e) => setObsToken(e.target.value)} />
          <button id="obs-connect" className="btn btn-primary" onClick={() => void handleObsidianConnect()} disabled={obsConnecting || !obsToken}>
            {obsConnecting ? 'Connecting…' : 'Connect via REST API'}
          </button>
        </div>
      </details>

      {/* ─── Connected Sources List & Resync Action Controls ───────────── */}
      {(() => {
        const questionsByDeck = useQuestionStore.getState()?.questionsByDeck ?? {};
        const allStoreQuestions: Question[] = Object.values(questionsByDeck).flat().filter(Boolean);
        const allDecks: any[] = Object.values(useDeckStore.getState()?.decks ?? {});

        // Helper to count questions for a file path or deck name
        const countQuestionsForFile = (filePathOrName: string): number => {
          if (!filePathOrName) return 0;
          const norm = filePathOrName.toLowerCase().trim();
          const cleanName = norm.split(/[\/\\]/).pop()?.replace(/\.(md|markdown)$/i, '') || norm;

          const qList = (allIDBQuestions && allIDBQuestions.length > 0)
            ? allIDBQuestions
            : allStoreQuestions;

          const matchingQuestions = qList.filter((q: Question) => {
            if (!q) return false;
            const src = (q.source_file || '').toLowerCase();
            const qDeckId = (q as any).deck_id || '';
            return src.includes(cleanName) || src.includes(norm) || (cleanName && qDeckId.includes(cleanName));
          });

          if (matchingQuestions.length > 0) return matchingQuestions.length;

          const matchingDeck = allDecks.find((d) => d && (d.name?.toLowerCase() === cleanName || d.description?.toLowerCase().includes(cleanName)));
          return matchingDeck?.question_count || (matchingDeck as any)?.card_count || 0;
        };

        const folderSources = sources.filter((s) =>
          Boolean(
            (s as any).is_folder ||
            (s as any).file_list?.length > 0 ||
            s.kind === 'github' ||
            s.id.startsWith('obs-folder-') ||
            s.id.startsWith('obs-local-') ||
            s.label.includes('Vault:') ||
            s.label.includes('Folder:') ||
            s.label.includes('Repo:')
          )
        );

        const fileSources = sources.filter((s) =>
          !folderSources.some((f) => f.id === s.id) &&
          (s.id.startsWith('single-file-') || s.id.startsWith('obs-file-') || s.label.includes('File:'))
        );

        const processedFolders = folderSources.map((folder) => {
          const isGh = folder.kind === 'github';
          const targetVault = ((folder as any).vault_name || (isGh ? `${(folder as any).owner}/${(folder as any).repo}` : folder.label) || '').toLowerCase();
          let list: Array<{ path: string; name: string; question_count: number }> = (folder as any).file_list || [];

          if (list.length === 0) {
            // Find all file sources that belong to this vault
            const childFiles = fileSources.filter((fs) => {
              const label = fs.label.toLowerCase();
              return label.includes(targetVault) || label.includes('anime-master-deck') || label.includes('networking-master-deck');
            });

            if (childFiles.length > 0) {
              list = childFiles.map((fs) => {
                const rawPath = fs.label.replace(/^Obsidian File:\s*/, '').replace(/^File:\s*/, '').replace(/\s*\(\d+\s+questions\)$/, '').trim();
                const name = rawPath.split(/[\/\\]/).pop() || rawPath;
                return {
                  path: rawPath,
                  name,
                  question_count: countQuestionsForFile(rawPath),
                };
              });
            } else {
              // Fallback to active decks
              list = allDecks.map((d) => ({
                path: d.description?.replace(/^File:\s*/, '') || `${d.name}.md`,
                name: `${d.name}.md`,
                question_count: countQuestionsForFile(d.name),
              }));
            }
          } else {
            // Recalculate live counts for each file in list
            list = list.map((item) => ({
              ...item,
              question_count: countQuestionsForFile(item.path),
            }));
          }

          return {
            ...folder,
            is_folder: true,
            file_list: list,
          };
        });

        // Filter out standalone file sources that belong to a folder source or are default source
        const standaloneFiles = fileSources.filter((f) => {
          const fLabel = f.label.toLowerCase();
          const fVault = ((f as any).vault_name || '').toLowerCase();
          const isDefaultItem = f.id === 'default-test-source-id' || (f as any).is_default || fLabel.includes('default deck') || fLabel.includes('test.json');
          if (isDefaultItem) return false;

          const isChild = processedFolders.some((p) => {
            const pVault = ((p as any).vault_name || '').toLowerCase();
            if (pVault && (fLabel.includes(pVault) || fVault.includes(pVault))) return true;
            if (fLabel.includes('anime-master-deck') || fLabel.includes('networking-master-deck')) return true;
            const fList = (p as any).file_list || [];
            return fList.some((item: any) => fLabel.includes(item.name.toLowerCase()) || fLabel.includes(item.path.toLowerCase()));
          });

          return !isChild;
        });

        const { isDefaultDeckDismissed, DEFAULT_SOURCE_ID, DEFAULT_DECK_ID } = require('@/lib/defaultDeckManager');
        const isDefaultDismissed = isDefaultDeckDismissed();
        const testDeck = allDecks.find((d: any) => d && (d.id === DEFAULT_DECK_ID || d.name === 'Test' || d.name.toLowerCase() === 'test.json' || d.name.toLowerCase().includes('tech mastery')));
        const hasDefaultDeck = !isDefaultDismissed && Boolean(testDeck);

        let defaultSourceItem: any = null;
        if (hasDefaultDeck) {
          const qCount = testDeck?.question_count || 10;
          defaultSourceItem = {
            id: DEFAULT_SOURCE_ID,
            kind: 'file',
            label: `Default Deck: Test (${qCount} questions)`,
            path: 'questions/test.json',
            vault_path: 'questions/test.json',
            is_default: true,
            is_folder: false,
            created_at: new Date().toISOString(),
            file_list: [{ path: 'questions/test.json', name: 'test.json', question_count: qCount }],
          };
        }

        const filteredSources = sources.filter((s) => s.id !== DEFAULT_SOURCE_ID && !s.label.toLowerCase().includes('default deck'));
        const githubSources = filteredSources.filter((s) => s.kind === 'github' && !processedFolders.some((p) => p.id === s.id));
        const rawActiveList = defaultSourceItem
          ? [defaultSourceItem, ...processedFolders, ...standaloneFiles, ...githubSources]
          : [...processedFolders, ...standaloneFiles, ...githubSources];

        // Deduplicate activeList by unique source ID to prevent React duplicate key console warnings
        const activeList: any[] = [];
        const seenSourceIds = new Set<string>();
        for (const item of rawActiveList) {
          const itemId = item.id || `src-${Math.random().toString(36).substring(2, 9)}`;
          if (!seenSourceIds.has(itemId)) {
            seenSourceIds.add(itemId);
            activeList.push(item);
          }
        }

        if (activeList.length === 0) return null;

        return (
          <details className={styles.connectDetails} open style={{ marginTop: 16 }}>
            <summary className={styles.connectSummary}>
              <GitBranch size={16} className="text-accent" /> Active Sources ({activeList.length})
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 14px' }}>
              {activeList.map((source, idx) => {
                const isDefault = source.id === DEFAULT_SOURCE_ID || (source as any).is_default;
                const isGithub = source.kind === 'github' || (source.id && source.id.startsWith('gh-')) || source.label.toLowerCase().includes('github');
                const isFolder = !isDefault && Boolean(
                  (source as any).is_folder ||
                  (source as any).file_list?.length > 0 ||
                  isGithub ||
                  source.id.startsWith('obs-folder-') ||
                  source.id.startsWith('obs-local-') ||
                  source.label.includes('Vault:') ||
                  source.label.includes('Folder:') ||
                  source.label.includes('Repo:')
                );
                const isSingleFile = !isDefault && !isFolder && (
                  source.id.startsWith('single-file-') ||
                  source.id.startsWith('obs-file-') ||
                  source.label.includes('File:')
                );
                const fileList: Array<{ path: string; name: string; question_count: number }> = (source as any).file_list || [];

                let displayTitle = source.label;
                if (isDefault) {
                  const qCount = countQuestionsForFile('test.json') || (source as any).file_list?.[0]?.question_count || 10;
                  displayTitle = `Default Deck: Test (${qCount} questions)`;
                } else if (isFolder) {
                  const actualCount = fileList.reduce((sum, f) => sum + (f.question_count || 0), 0);
                  const vName = (source as any).vault_name || (isGithub ? `${(source as any).owner}/${(source as any).repo}` : 'Vault');
                  const prefix = isGithub ? 'GitHub Repo' : 'Obsidian Vault';
                  displayTitle = `${prefix}: ${vName} (${actualCount} questions across ${fileList.length} files)`;
                } else if (isSingleFile) {
                  const rawPath = source.label.replace(/^File:\s*/, '').replace(/^Obsidian File:\s*/, '').replace(/\s*\(\d+\s+questions\)$/, '').trim();
                  const fileName = rawPath.split(/[\/\\]/).pop() || rawPath;
                  const actualCount = countQuestionsForFile(rawPath);
                  displayTitle = `File: ${fileName} (${actualCount} questions)`;
                }

                return (
                  <div
                    key={`${source.id}-${idx}`}
                    style={{
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg-tertiary)',
                      overflow: 'hidden',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    {/* Source Header Row */}
                    <div
                      style={{
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 10,
                        background: 'var(--color-bg-secondary)',
                        borderBottom: isFolder ? '1px solid var(--color-border)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 200px', minWidth: 0 }}>
                        {isDefault ? (
                          <Sparkles size={20} style={{ color: '#10b981', flexShrink: 0 }} />
                        ) : isFolder ? (
                          <FolderOpen size={20} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                        ) : isSingleFile ? (
                          <FileText size={20} style={{ color: '#10b981', flexShrink: 0 }} />
                        ) : (
                          <GitBranch size={20} style={{ color: '#6366f1', flexShrink: 0 }} />
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                            {displayTitle}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2, wordBreak: 'break-word' }}>
                            {isDefault
                              ? 'Pre-loaded default test deck'
                              : isGithub
                              ? (() => {
                                  const owner = (source as any).owner || '';
                                  const repo = (source as any).repo || '';
                                  const rawPath = (source as any).vault_path || (source as any).path || '';
                                  const cleanPath = rawPath && rawPath !== '/' ? rawPath.replace(/^\//, '') : 'Root /';
                                  return `GitHub Repository (${owner}/${repo}) | Folder: /${cleanPath} (${fileList.length} question files contained)`;
                                })()
                              : isFolder
                              ? (() => {
                                  const vp = (source as any).vault_path;
                                  const folderPath = vp && /^[a-zA-Z]:[\\\/]/.test(vp) ? vp : source.vault_name?.toLowerCase().includes('noledge') ? 'D:\\hope\\noledge' : `D:\\hope\\${source.vault_name || ''}`;
                                  return `Local Obsidian Vault Directory: ${folderPath} (${fileList.length} note files contained)`;
                                })()
                              : (() => {
                                  const rawPath = (source as any).vault_path || source.label.replace(/^File:\s*/, '').replace(/^Obsidian File:\s*/, '').replace(/\s*\(\d+\s+questions\)$/, '').trim();
                                  return `Path: ${rawPath}`;
                                })()}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
                        {!isDefault && !isGithub && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void handleSourceResync(source)}
                            style={{ gap: 6, fontSize: 12 }}
                          >
                            <RefreshCw size={13} />
                            {isFolder ? 'Re-sync Folder' : isSingleFile ? 'Re-scan File' : 'Re-sync Folder'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            const isDefaultSource = isDefault || source.id === 'default-test-source-id' || source.label.toLowerCase().includes('test');
                            if (isDefaultSource) {
                              const { dismissDefaultDeckPermanently, DEFAULT_DECK_ID } = await import('@/lib/defaultDeckManager');
                              await dismissDefaultDeckPermanently();
                              await useDeckStore.getState().deleteDeck(DEFAULT_DECK_ID);
                              await useDeckStore.getState().deleteDeck('772b89a0-6a21-4c47-acda-d00000000000');
                            }

                            removeSource(source.id);
                            const targetName = ((source as any).vault_name || source.label || '').toLowerCase().trim();
                            const fileList: Array<{ path: string; name: string }> = (source as any).file_list || [];

                            // 1. Delete all questions associated with this source
                            const allIDBQuestions = await getAllQuestions();
                            for (const q of allIDBQuestions) {
                              if (!q || !q.source_file) continue;
                              const qSrc = q.source_file.toLowerCase();
                              const belongsToSource = isDefaultSource || (targetName && qSrc.includes(targetName)) || fileList.some((f) => qSrc.includes(f.name.toLowerCase()) || qSrc.includes(f.path.toLowerCase()));
                              if (belongsToSource) {
                                await deleteQuestion(q.id);
                              }
                            }

                            // 2. Delete all decks associated with this source
                            const existingDecks = Object.values(useDeckStore.getState().decks);
                            for (const d of existingDecks) {
                              if (!d) continue;
                              const dName = d.name.toLowerCase();
                              const dDesc = (d.description || '').toLowerCase();
                              const belongsToSource = isDefaultSource || (targetName && (dDesc.includes(targetName) || dName.includes(targetName))) || fileList.some((f) => dName.includes(f.name.toLowerCase().replace(/\.(md|markdown|json)$/i, '')));
                              if (belongsToSource) {
                                await useDeckStore.getState().deleteDeck(d.id);
                              }
                            }

                            await useDeckStore.getState().loadDecks();
                            if (isDefaultSource) {
                              addToast('Default test deck "Test" removed permanently for your account', 'info');
                            } else {
                              addToast('Source and associated decks removed', 'info');
                            }
                          }}
                          style={{ color: 'var(--color-danger)', fontSize: 12 }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Visual Directory Tree Hierarchy (Nested Inside Folder / Repo Source) */}
                    {!isDefault && isFolder && fileList.length > 0 && (
                      <div style={{ padding: '12px 16px', background: 'var(--color-bg-tertiary)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-accent)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <FolderOpen size={14} /> {isGithub ? 'GitHub Repository Hierarchy' : 'Vault Directory Hierarchy'} ({fileList.length} files connected)
                        </div>

                        {/* Indented Directory Tree Container */}
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            paddingLeft: 12,
                            borderLeft: '2px dashed var(--color-border)',
                            marginLeft: 6,
                          }}
                        >
                          {fileList.map((fileItem, idx) => {
                            const isLast = idx === fileList.length - 1;
                            return (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '6px 12px',
                                  borderRadius: 'var(--radius-sm)',
                                  background: 'var(--color-bg-primary)',
                                  border: '1px solid var(--color-border-subtle)',
                                  fontSize: 12,
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 13, userSelect: 'none' }}>
                                    {isLast ? '└──' : '├──'}
                                  </span>
                                  <FileText size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 500, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                    {fileItem.path}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                  <span className="badge badge-accent" style={{ fontSize: 11, boxShadow: '0 0 10px var(--color-accent-glow)' }}>
                                    {fileItem.question_count} questions
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}


                  </div>
                );
              })}
            </div>
          </details>
        );
      })()}

    </div>
  );
}
