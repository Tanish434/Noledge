import { OrbEngine } from "./orb.js";
import { ORB_VARIANT_LIST, ORB_VARIANTS, ORB_TITLES } from "./orb-variants.js";
import { CustomSelect } from "./custom-select.js";

const LivekitClient = window.LivekitClient;

// Initialize Mermaid.js for flowcharts and architecture diagrams
if (typeof window.mermaid !== "undefined") {
  try {
    window.mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: 'neutral',
      securityLevel: 'loose',
      fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif",
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      }
    });
  } catch (me) {
    console.warn("Mermaid init note:", me);
  }
}

// DOM Elements
const canvas = document.getElementById("orb-canvas");
const statusCapsule = document.getElementById("status-capsule");
const statusText = document.getElementById("status-text");
const userName = document.getElementById("user-name");
const userCert = document.getElementById("user-cert");
const micBtn = document.getElementById("btn-mic");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const transcriptList = document.getElementById("transcript-list");
const chatPlaceholder = document.getElementById("chat-placeholder");
const chatStream = document.getElementById("chat-stream");

// Orb Controls Elements
const orbVariantSelect = document.getElementById("orb-variant-select");
const btnPrevVariant = document.getElementById("btn-prev-variant");
const btnNextVariant = document.getElementById("btn-next-variant");
const modePills = document.querySelectorAll(".mode-pill");

// History Elements
const historyList = document.getElementById("history-list");
const historySearch = document.getElementById("history-search");
const btnNewChat = document.getElementById("btn-new-chat");
const btnClearAllHistory = document.getElementById("btn-clear-all-history");

// Header Navigation
const btnHeaderNewChat = document.getElementById("btn-header-new-chat");
const btnShowHistory = document.getElementById("btn-show-history") || document.getElementById("btn-nav-history");
const btnShowSettings = document.getElementById("btn-show-settings") || document.getElementById("btn-nav-settings");
const btnBackFromHistory = document.getElementById("btn-back-from-history");
const btnBackFromSettings = document.getElementById("btn-back-from-settings");
const themeSwitchBtn = document.getElementById("theme-switch-btn");
const themeIconWrap = document.getElementById("theme-icon-wrap");

// Share Elements
const btnShareChat = document.getElementById("btn-share-chat");
const shareModal = document.getElementById("share-modal");
const btnCloseShare = document.getElementById("btn-close-share");
const shareSessionTitle = document.getElementById("share-session-title");
const shareLinkInput = document.getElementById("share-link-input");
const btnDownloadShareHtml = document.getElementById("btn-download-share-html");
const btnCopyShareLink = document.getElementById("btn-copy-share-link");
const btnCopyTranscriptMd = document.getElementById("btn-copy-transcript-md");

// Settings Elements
const inputGeminiKey = document.getElementById("input-gemini-key");
const engineLlmSelect = document.getElementById("engine-llm-select");
const enableOcrCheckbox = document.getElementById("enable-ocr-checkbox");
const engineSttSelect = document.getElementById("engine-stt-select");
const engineTtsSelect = document.getElementById("engine-tts-select");
const groupVoiceSelect = document.getElementById("group-voice-select");
const engineVoiceSelect = document.getElementById("engine-voice-select");
const capModelBadge = document.getElementById("cap-model-badge");
const btnSaveSettings = document.getElementById("btn-save-settings");
const diagLlm = document.getElementById("diag-llm");
const diagOcr = document.getElementById("diag-ocr");

// File Attachment Elements
const btnAttach = document.getElementById("btn-attach");
const fileInput = document.getElementById("file-input");
const attachmentPreviewBar = document.getElementById("attachment-preview-bar");
const attachmentIcon = document.getElementById("attachment-icon");
const attachmentName = document.getElementById("attachment-name");
const attachmentSize = document.getElementById("attachment-size");
const btnRemoveAttachment = document.getElementById("btn-remove-attachment");
let currentAttachedFile = null;
let pendingVoiceAttachment = null;

// App Panels
const panelChat = document.getElementById("panel-chat");
const panelHistory = document.getElementById("panel-history");
const panelSettings = document.getElementById("panel-settings");

// State
let activeSessionId = null;
let allSessions = [];
let lkRoom = null;
let audioCtx = null;
let micTrack = null;
let micAnalyser = null;
let agentAnalyser = null;
let isHoldingSpace = false;
let isMicActive = false;
let speakingTimeout = null;
let recentUserMessages = new Set();
let recentAssistantMessages = new Set();

// Initialize Single WebGL Orb Engine
const orb = new OrbEngine(canvas, "shdr-01");

// Helper to update active mode pill
function updateModePill(mode) {
  modePills.forEach((p) => {
    p.classList.toggle("active", p.dataset.mode === mode);
  });
}

// Setup Variant Select Dropdown with Custom Glassmorphic Component
let orbCustomSelect = null;

if (orbVariantSelect) {
  orbVariantSelect.innerHTML = "";
  ORB_VARIANT_LIST.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.key;
    opt.textContent = v.label;
    orbVariantSelect.appendChild(opt);
  });

  const activeKey = orb.currentVariant ? orb.currentVariant.key : "shdr-01";
  orbVariantSelect.value = activeKey;

  orbCustomSelect = new CustomSelect(orbVariantSelect, {
    searchable: true,
    searchPlaceholder: "Search 33 orb styles...",
    align: "right",
    formatTriggerText: (fullText, key) => {
      return ORB_TITLES[key] || fullText || "Select Style";
    },
    customRender: (opt) => {
      const title = ORB_TITLES[opt.value] || opt.textContent;
      const v = ORB_VARIANTS[opt.value];
      const code = v ? v.label : "";
      return `
        <div class="shader-opt-card">
          <div class="shader-opt-head">
            <span class="shader-opt-title">${title}</span>
            <span class="shader-opt-badge">${code}</span>
          </div>
        </div>
        <svg class="custom-option-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
    }
  });

  orbVariantSelect.addEventListener("change", (e) => {
    switchVariantUI(e.target.value);
  });
}

function switchVariantUI(key) {
  if (orb.switchVariant(key)) {
    if (orbVariantSelect) {
      orbVariantSelect.value = key;
      if (orbCustomSelect) orbCustomSelect.syncFromSelect();
    }
  }
}

if (btnPrevVariant) {
  btnPrevVariant.addEventListener("click", () => {
    const keys = ORB_VARIANT_LIST.map((v) => v.key);
    const currKey = orb.currentVariant ? orb.currentVariant.key : keys[0];
    const idx = keys.indexOf(currKey);
    const nextIdx = (idx - 1 + keys.length) % keys.length;
    switchVariantUI(keys[nextIdx]);
  });
}

if (btnNextVariant) {
  btnNextVariant.addEventListener("click", () => {
    const keys = ORB_VARIANT_LIST.map((v) => v.key);
    const currKey = orb.currentVariant ? orb.currentVariant.key : keys[0];
    const idx = keys.indexOf(currKey);
    const nextIdx = (idx + 1) % keys.length;
    switchVariantUI(keys[nextIdx]);
  });
}

// Mode preview buttons [Idle] [Thinking] [Speaking]
modePills.forEach((pill) => {
  pill.addEventListener("click", () => {
    const mode = pill.dataset.mode;
    updateModePill(mode);
    orb.setState(mode);
    if (mode === "thinking") {
      showThinkingIndicator();
      if (statusCapsule) statusCapsule.setAttribute("data-status", "thinking");
      if (statusText) statusText.textContent = "Thinking...";
    } else if (mode === "speaking") {
      hideThinkingIndicator();
      if (statusCapsule) statusCapsule.setAttribute("data-status", "speaking");
      if (statusText) statusText.textContent = "Speaking";
    } else {
      hideThinkingIndicator();
      if (statusCapsule) statusCapsule.setAttribute("data-status", "idle");
      if (statusText) statusText.textContent = "Ready";
    }
  });
});

// =========================================================
// In-Card Panel Navigation (Transforms ONLY the card panel)
// =========================================================
function switchPanel(panelName) {
  panelChat.classList.remove("active");
  panelHistory.classList.remove("active");
  panelSettings.classList.remove("active");

  if (panelName === "history") {
    panelHistory.classList.add("active");
    loadSessions();
  } else if (panelName === "settings") {
    panelSettings.classList.add("active");
    loadSettingsData();
  } else {
    panelChat.classList.add("active");
  }
}

if (btnShowHistory) btnShowHistory.addEventListener("click", () => switchPanel("history"));
if (btnShowSettings) btnShowSettings.addEventListener("click", () => switchPanel("settings"));
if (btnBackFromHistory) btnBackFromHistory.addEventListener("click", () => switchPanel("chat"));
if (btnBackFromSettings) btnBackFromSettings.addEventListener("click", () => switchPanel("chat"));

// =========================================================
// Theme Switcher (Pure Monochromatic Black & Clean Slate)
// =========================================================
const SUN_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;

const MOON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function renderThemeIcon(theme, animate = false) {
  if (themeIconWrap) {
    themeIconWrap.innerHTML = theme === "dark" ? MOON_SVG : SUN_SVG;
    if (animate) {
      themeIconWrap.classList.remove("to-dark", "to-light");
      void themeIconWrap.offsetWidth;
      themeIconWrap.classList.add(theme === "dark" ? "to-dark" : "to-light");
    }
  }
  const themeSwitchLabel = document.getElementById("theme-switch-label");
  if (themeSwitchLabel) {
    themeSwitchLabel.textContent = theme === "dark" ? "Dark Theme" : "Light Mode";
  }
}

function applyThemeWithTransition(origin, nextTheme) {
  const apply = () => {
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
      localStorage.setItem("aliph1_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("aliph1_theme", "light");
    }
    renderThemeIcon(nextTheme, true);
  };

  if (!document.startViewTransition || window.innerWidth > 1800) {
    apply();
    return;
  }

  const { x, y } = origin;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  document.documentElement.style.setProperty("--vt-x", `${x}px`);
  document.documentElement.style.setProperty("--vt-y", `${y}px`);
  document.documentElement.style.setProperty("--vt-r", `${endRadius}px`);
  document.startViewTransition(apply).ready.catch(() => {});
}

if (themeSwitchBtn) {
  themeSwitchBtn.addEventListener("click", (e) => {
    const origin = { x: e.clientX, y: e.clientY };
    const isDark = document.documentElement.classList.contains("dark");
    const nextTheme = isDark ? "light" : "dark";
    applyThemeWithTransition(origin, nextTheme);
  });
}

// Initial theme load (default to dark if not set)
const initialTheme = localStorage.getItem("aliph1_theme") || "dark";
if (initialTheme === "dark") {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}
renderThemeIcon(initialTheme, false);

// =========================================================
// Status & Thinking State Updates
// =========================================================
let thinkingIndicatorEl = null;

function showThinkingIndicator() {
  if (chatPlaceholder && chatPlaceholder.parentElement === transcriptList) {
    chatPlaceholder.remove();
  }
  // Thinking state is indicated exclusively by the top pills (Idle / Thinking / Speaking) and glowing 3D orb
}

function hideThinkingIndicator() {
  if (thinkingIndicatorEl) {
    thinkingIndicatorEl.remove();
    thinkingIndicatorEl = null;
  }
}

function setStatus(state, message) {
  const norm = (state || "").toLowerCase();
  if (statusCapsule) statusCapsule.setAttribute("data-status", norm);
  if (statusText) statusText.textContent = message;

  const orbStage = document.querySelector(".orb-stage");

  if (norm.includes("listen")) {
    if (orbStage) orbStage.classList.remove("thinking");
    hideThinkingIndicator();
    updateModePill("idle");
    orb.setState("idle");
    orb.setAudioInput(0.35);
    orb.setAudioOutput(0.0);
  } else if (norm.includes("think") || norm.includes("process") || norm.includes("reason")) {
    if (orbStage) orbStage.classList.add("thinking");
    showThinkingIndicator();
    updateModePill("thinking");
    orb.setState("thinking");
    orb.setAudioInput(0.0);
    orb.setAudioOutput(0.0);
  } else if (norm.includes("speak")) {
    if (orbStage) orbStage.classList.remove("thinking");
    hideThinkingIndicator();
    updateModePill("speaking");
    orb.setState("speaking");
  } else {
    if (orbStage) orbStage.classList.remove("thinking");
    hideThinkingIndicator();
    updateModePill("idle");
    orb.setState("idle");
    orb.setAudioInput(0.0);
    orb.setAudioOutput(0.0);
  }
}

// =========================================================
// Web Audio Analysers
// =========================================================
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function createTrackAnalyser(mediaStreamTrack, onVolume) {
  try {
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    function poll() {
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      onVolume(sum / buffer.length);
      requestAnimationFrame(poll);
    }
    requestAnimationFrame(poll);
    return analyser;
  } catch (err) {
    console.warn("Audio analyser setup note:", err);
    return null;
  }
}

function setupAgentAudioAnalyser(mediaStreamTrack) {
  agentAnalyser = createTrackAnalyser(mediaStreamTrack, (avg) => {
    const normalized = Math.min(1.0, (avg / 128.0) * 1.6);
    orb.setAudioOutput(normalized);
    if (normalized > 0.04) {
      setStatus("speaking", "Speaking");
      if (speakingTimeout) clearTimeout(speakingTimeout);
      speakingTimeout = setTimeout(() => {
        setStatus("ready", "Ready");
        orb.setAudioOutput(0);
      }, 500);
    }
  });
}

function setupMicAudioAnalyser(mediaStreamTrack) {
  micAnalyser = createTrackAnalyser(mediaStreamTrack, (avg) => {
    if (isMicActive) {
      const normalized = Math.min(1.0, (avg / 128.0) * 2.0);
      orb.setAudioInput(normalized);
    } else {
      orb.setAudioInput(0.0);
    }
  });
}

// =========================================================
// Conversation History Management
// =========================================================
async function loadSessions(autoSelect = false) {
  try {
    const res = await fetch("/api/history/sessions");
    const data = await res.json();
    if (data.success && Array.isArray(data.sessions)) {
      allSessions = data.sessions;
      renderHistoryList(allSessions);

      if (autoSelect) {
        const savedSid = localStorage.getItem("aura_session_id");
        if (savedSid && allSessions.some(s => s.id === savedSid)) {
          selectSession(savedSid, false);
        } else if (allSessions.length > 0) {
          selectSession(allSessions[0].id, false);
        } else {
          createNewSession(false);
        }
      }
    }
  } catch (err) {
    console.warn("Error loading sessions:", err);
    if (historyList) {
      historyList.innerHTML = `<div class="history-empty">No conversation history yet.</div>`;
    }
  }
}

function renderHistoryList(sessions) {
  if (!historyList) return;
  if (!sessions || sessions.length === 0) {
    historyList.innerHTML = `<div class="history-empty">No conversations found.</div>`;
    return;
  }

  historyList.innerHTML = "";
  sessions.forEach(sess => {
    const row = document.createElement("div");
    row.className = `history-row ${sess.id === activeSessionId ? 'active' : ''}`;
    row.dataset.id = sess.id;

    const dateStr = formatRelativeTime(sess.updated_at || sess.created_at);

    row.innerHTML = `
      <div class="history-row-content">
        <span class="history-row-title">${escapeHtml(sess.title)}</span>
        <span class="history-row-meta">${dateStr} • ${sess.message_count || 0} msgs</span>
      </div>
      <div class="history-row-actions">
        <button class="btn-share-row" title="Share this conversation" data-id="${sess.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
            <polyline points="16 6 12 2 8 6"></polyline>
            <line x1="12" y1="2" x2="12" y2="15"></line>
          </svg>
        </button>
        <button class="btn-delete-row" title="Delete conversation" data-id="${sess.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    row.addEventListener("click", (e) => {
      if (e.target.closest(".history-row-actions")) return;
      selectSession(sess.id, true);
    });

    const shareBtn = row.querySelector(".btn-share-row");
    if (shareBtn) {
      shareBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openShareModal(sess.id, sess.title);
      });
    }

    const delBtn = row.querySelector(".btn-delete-row");
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteSession(sess.id);
    });

    historyList.appendChild(row);
  });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "Just now";
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function selectSession(sessionId, returnToChat = false) {
  activeSessionId = sessionId;
  localStorage.setItem("aura_session_id", sessionId);

  document.querySelectorAll(".history-row").forEach(el => {
    el.classList.toggle("active", el.dataset.id === sessionId);
  });

  sendDataPacket({ type: "switch_session", session_id: sessionId });

  try {
    const res = await fetch(`/api/history/sessions/${sessionId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.messages) && data.messages.length > 0) {
      renderMessages(data.messages);
    } else {
      renderMessages([]);
    }
  } catch (err) {
    console.warn("Error fetching session messages:", err);
    renderMessages([]);
  }

  if (returnToChat) {
    switchPanel("chat");
  }
}

async function createNewSession(returnToChat = true) {
  // Generate session ID locally without saving an empty row until first message!
  activeSessionId = "sess_" + Math.floor(Date.now() / 1000) + "_" + Math.random().toString(36).substring(2, 8);
  localStorage.setItem("aura_session_id", activeSessionId);
  sendDataPacket({ type: "switch_session", session_id: activeSessionId });
  renderMessages([]);
  setStatus("ready", "Ready");
  if (returnToChat) {
    switchPanel("chat");
  }
}

async function deleteSession(sessionId) {
  try {
    const res = await fetch(`/api/history/sessions/${sessionId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      allSessions = allSessions.filter(s => s.id !== sessionId);
      renderHistoryList(allSessions);
      if (activeSessionId === sessionId) {
        if (allSessions.length > 0) {
          selectSession(allSessions[0].id, false);
        } else {
          createNewSession(false);
        }
      }
    }
  } catch (err) {
    console.warn("Error deleting session:", err);
  }
}

if (btnNewChat) {
  btnNewChat.addEventListener("click", () => createNewSession(true));
}

if (btnHeaderNewChat) {
  btnHeaderNewChat.addEventListener("click", () => {
    switchPanel("chat");
    createNewSession(true);
    if (chatInput) chatInput.focus();
  });
}

if (historySearch) {
  historySearch.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderHistoryList(allSessions);
      return;
    }
    const filtered = allSessions.filter(s => (s.title || "").toLowerCase().includes(q));
    renderHistoryList(filtered);
  });
}

if (btnClearAllHistory) {
  btnClearAllHistory.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to clear all conversation history?")) return;
    try {
      const res = await fetch("/api/history/clear", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        allSessions = [];
        renderHistoryList([]);
        createNewSession(true);
      }
    } catch (err) {
      console.warn("Error clearing history:", err);
    }
  });
}

// =========================================================
// Chat Messages UI & DEDUPLICATION (Fixes Redundancy!)
// =========================================================
function renderMessages(messages) {
  transcriptList.innerHTML = "";
  if (!messages || messages.length === 0) {
    if (chatPlaceholder) transcriptList.appendChild(chatPlaceholder);
    return;
  }

  messages.forEach(msg => {
    appendMessageCard(msg.role, msg.content, msg.speaker, false);
  });
  scrollToBottom();
}

function autoFenceMermaid(text) {
  if (!text) return "";
  const mermaidStartRegex = /^(?:graph\s+(?:TD|TB|BT|RL|LR)|flowchart\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline)/i;
  const lines = text.split("\n");
  const result = [];
  let inCodeBlock = false;
  let inMermaidBlock = false;
  let currentMermaidLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inMermaidBlock) {
        while (currentMermaidLines.length && !currentMermaidLines[currentMermaidLines.length - 1].trim()) {
          currentMermaidLines.pop();
        }
        result.push("```mermaid");
        result.push(...currentMermaidLines);
        result.push("```");
        inMermaidBlock = false;
        currentMermaidLines = [];
      }
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (!inMermaidBlock && mermaidStartRegex.test(trimmed)) {
      inMermaidBlock = true;
      currentMermaidLines = [line];
      continue;
    }

    if (inMermaidBlock) {
      const isDiagramLine = 
        !trimmed ||
        trimmed.startsWith("%%") ||
        trimmed.toLowerCase() === "end" ||
        /^(subgraph\b|classDef\b|class\b|style\b|linkStyle\b|click\b)/i.test(trimmed) ||
        /(-->|---|==>|\.\.>|->|-\.-)/.test(trimmed) ||
        /^[A-Za-z0-9_]+\s*(\[|\(|\{|\>)/.test(trimmed) ||
        /^[A-Za-z0-9_]+$/.test(trimmed);

      if (isDiagramLine) {
        currentMermaidLines.push(line);
      } else {
        while (currentMermaidLines.length && !currentMermaidLines[currentMermaidLines.length - 1].trim()) {
          currentMermaidLines.pop();
        }
        result.push("```mermaid");
        result.push(...currentMermaidLines);
        result.push("```");
        result.push("");
        inMermaidBlock = false;
        currentMermaidLines = [];
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  if (inMermaidBlock && currentMermaidLines.length > 0) {
    while (currentMermaidLines.length && !currentMermaidLines[currentMermaidLines.length - 1].trim()) {
      currentMermaidLines.pop();
    }
    result.push("```mermaid");
    result.push(...currentMermaidLines);
    result.push("```");
  }

  return result.join("\n");
}

function renderMarkdownAndCharts(content) {
  if (typeof window.marked !== "undefined") {
    try {
      // Clean and format chemical formulas & LaTeX notation cleanly into HTML subscripts
      let formatted = (content || "")
        // $ \text{CO}_2$ or $\text{CO}_2$ -> CO<sub>2</sub>
        .replace(/\$\s*\\text\{([A-Za-z0-9]+)\}_?\{?([0-9a-zA-Z+-]+)\}?\s*\$/g, '$1<sub>$2</sub>')
        .replace(/\\text\{([A-Za-z0-9]+)\}_?\{?([0-9a-zA-Z+-]+)\}?/g, '$1<sub>$2</sub>')
        // $CO_2$ or $H_2O$ -> CO<sub>2</sub> / H<sub>2</sub>O
        .replace(/\$\s*([A-Z][a-z]?)_?\{?(\d+)\}?\s*\$/g, '$1<sub>$2</sub>')
        // CO_2 or H_2O in standard text -> CO<sub>2</sub> / H<sub>2</sub>O
        .replace(/\b([A-Z][a-z]?[0-9]?[A-Z]?[a-z]?)_(\d+)\b/g, '$1<sub>$2</sub>')
        // Strip general \text{...} wrappers
        .replace(/\\text\{([^}]+)\}/g, '$1')
        // Strip generic math dollar delimiters $$...$$ and $...$
        .replace(/\$\$?([^$]+)\$\$?/g, '$1');

      // Auto-detect and fence any raw unfenced mermaid graph/flowchart blocks before markdown parsing
      formatted = autoFenceMermaid(formatted);

      let rawHtml = window.marked.parse(formatted, { breaks: true, gfm: true });
      const temp = document.createElement("div");
      temp.innerHTML = rawHtml;

      // 1. Wrap all markdown tables in .table-responsive for smooth horizontal scrolling
      temp.querySelectorAll("table").forEach(tbl => {
        if (tbl.parentElement && tbl.parentElement.classList.contains("table-responsive")) return;
        const wrapper = document.createElement("div");
        wrapper.className = "table-responsive";
        tbl.parentNode.insertBefore(wrapper, tbl);
        wrapper.appendChild(tbl);
      });

      // 2. Scan for Chart.js code blocks (language 'chart', or language 'graph' with JSON)
      const chartCodes = temp.querySelectorAll("code.language-chart, code.language-graph");
      const chartConfigs = [];
      chartCodes.forEach((codeEl, idx) => {
        const jsonText = codeEl.textContent.trim();
        if (jsonText.startsWith("{") || jsonText.startsWith("[")) {
          try {
            const cfg = JSON.parse(jsonText);
            const chartId = `aura-chart-${Date.now()}-${idx}`;
            const wrapper = document.createElement("div");
            wrapper.className = "chart-card-wrapper";
            wrapper.innerHTML = `<div class="chart-canvas-box"><canvas id="${chartId}"></canvas></div>`;
            const pre = codeEl.closest("pre");
            if (pre) pre.replaceWith(wrapper);
            else codeEl.replaceWith(wrapper);
            chartConfigs.push({ id: chartId, config: cfg });
          } catch (je) {
            console.warn("Chart JSON parse note:", je);
          }
        }
      });

      // 3. Scan for Mermaid diagrams and flowcharts
      const mermaidBlocks = [];
      const codeCandidates = temp.querySelectorAll("pre code, code");
      codeCandidates.forEach((codeEl, idx) => {
        const rawCode = (codeEl.textContent || "").trim();
        if (!rawCode) return;

        const isMermaidClass = codeEl.classList.contains("language-mermaid") || codeEl.classList.contains("language-mermaidjs");
        const startsWithMermaid = /^(graph\s+(TD|TB|BT|RL|LR)|flowchart\s+(TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline)/i.test(rawCode) ||
          (rawCode.includes("subgraph ") && (rawCode.includes("-->") || rawCode.includes("--->")));

        if (isMermaidClass || startsWithMermaid) {
          // Normalize long arrows (---> to -->) for robust Mermaid parser compatibility
          let cleanCode = rawCode.replace(/--->/g, "-->");
          const mId = `aliph-mermaid-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`;
          const diagramTitle = getDiagramTitle(cleanCode);
          const wrapper = document.createElement("div");
          wrapper.className = "mermaid-diagram-card";
          wrapper.innerHTML = `
            <div class="diagram-header">
              <span class="diagram-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                  <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                  <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                  <rect x="3" y="14" width="7" height="7" rx="1"></rect>
                  <path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4"></path>
                </svg>
                ${escapeHtml(diagramTitle)}
              </span>
            </div>
            <div class="mermaid-diagram-viewport">
              <div class="mermaid-diagram-content" id="${mId}">
                <div class="mermaid-loading">Rendering Diagram...</div>
              </div>
            </div>
          `;
          const pre = codeEl.closest("pre");
          if (pre) pre.replaceWith(wrapper);
          else codeEl.replaceWith(wrapper);
          mermaidBlocks.push({ id: mId, code: cleanCode });
        }
      });

      // Fallback: Scan any paragraph elements that may still contain unfenced graph declarations
      temp.querySelectorAll("p").forEach((pEl, pIdx) => {
        const rawP = (pEl.textContent || "").trim();
        if (/^(graph\s+(TD|TB|BT|RL|LR)|flowchart\s+(TD|TB|BT|RL|LR)|sequenceDiagram)/i.test(rawP)) {
          let cleanCode = rawP.replace(/--->/g, "-->");
          const mId = `aliph-mermaid-p-${Date.now()}-${pIdx}-${Math.floor(Math.random() * 1000)}`;
          const diagramTitle = getDiagramTitle(cleanCode);
          const wrapper = document.createElement("div");
          wrapper.className = "mermaid-diagram-card";
          wrapper.innerHTML = `
            <div class="diagram-header">
              <span class="diagram-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                  <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                  <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                  <rect x="3" y="14" width="7" height="7" rx="1"></rect>
                  <path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4"></path>
                </svg>
                ${escapeHtml(diagramTitle)}
              </span>
            </div>
            <div class="mermaid-diagram-viewport">
              <div class="mermaid-diagram-content" id="${mId}">
                <div class="mermaid-loading">Rendering Diagram...</div>
              </div>
            </div>
          `;
          pEl.replaceWith(wrapper);
          mermaidBlocks.push({ id: mId, code: cleanCode });
        }
      });

      return { html: temp.innerHTML, charts: chartConfigs, mermaids: mermaidBlocks };
    } catch (me) {
      console.warn("Markdown parse note:", me);
    }
  }
  return { html: escapeHtml(content), charts: [], mermaids: [] };
}

function getDiagramTitle(code) {
  const c = (code || "").trim();
  if (/tree/i.test(c)) return "Tree Hierarchy Diagram";
  if (/^sequenceDiagram/i.test(c)) return "Sequence Architecture";
  if (/^classDiagram/i.test(c)) return "Class Architecture";
  if (/^stateDiagram/i.test(c)) return "State Machine";
  if (/^erDiagram/i.test(c)) return "Entity Relationship Model";
  if (/^journey/i.test(c)) return "User Journey Flow";
  if (/^gantt/i.test(c)) return "Gantt Timeline";
  if (/^pie/i.test(c)) return "Distribution Chart";
  if (/^gitGraph/i.test(c)) return "Git Version Graph";
  if (/^mindmap/i.test(c)) return "Mind Map";
  return "Flowchart Architecture";
}

function sanitizeMermaidCode(code) {
  if (!code) return "";
  const lines = code.split("\n");
  const cleaned = [];
  let subgraphIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // Preserve comments, empty lines, and end keyword
    if (!trimmed || trimmed.startsWith("%%") || trimmed.toLowerCase() === "end") {
      cleaned.push(line);
      continue;
    }

    // Preserve class / classDef / style statements
    if (/^\s*(classDef|class|style|linkStyle|click)\b/i.test(trimmed)) {
      cleaned.push(line);
      continue;
    }

    // Preserve graph/flowchart declaration
    if (/^(graph|flowchart)\s+[A-Za-z0-9]+/i.test(trimmed)) {
      cleaned.push(line);
      continue;
    }

    // 1. Subgraph normalization: subgraph sg_1 ["Title"]
    const sgMatch = line.match(/^(\s*subgraph\s+)(.+)$/i);
    if (sgMatch) {
      const indent = sgMatch[1];
      const rawTitle = sgMatch[2].trim();
      if (/^[A-Za-z0-9_]+\s*\["[^"]+"\]$/.test(rawTitle)) {
        cleaned.push(line);
      } else {
        subgraphIdx++;
        const safeTitle = rawTitle.replace(/["\[\]]/g, "'");
        cleaned.push(`${indent}sg_${subgraphIdx} ["${safeTitle}"]`);
      }
      continue;
    }

    let cur = line;

    // 2. Normalize arrows: ---> or ----> to -->
    cur = cur.replace(/--+>/g, "-->");

    // 3. Fix unquoted pipe labels on arrows: -->|some text (with parens) & symbols| -> -->|"some text (with parens) & symbols"|
    cur = cur.replace(/(-->|---|==>|\.\.>)\s*\|([^|]+)\|/g, (match, arrow, label) => {
      const trimLabel = label.trim();
      if (trimLabel.startsWith('"') && trimLabel.endsWith('"')) {
        return `${arrow}|${trimLabel}|`;
      }
      const safeLabel = trimLabel.replace(/"/g, "'");
      return `${arrow}|"${safeLabel}"|`;
    });

    // 4. Quote cylindrical nodes: [("...")]
    cur = cur.replace(/([A-Za-z0-9_]+)\s*\[\(\s*(.*?)\s*\)\]/g, (match, id, text) => {
      const t = text.trim();
      if (t.startsWith('"') && t.endsWith('"')) return `${id}[(${t})]`;
      return `${id}[("${t.replace(/"/g, "'")}")]`;
    });

    // 5. Quote stadium/pill nodes: (["..."])
    cur = cur.replace(/([A-Za-z0-9_]+)\s*\(\[\s*(.*?)\s*\]\)/g, (match, id, text) => {
      const t = text.trim();
      if (t.startsWith('"') && t.endsWith('"')) return `${id}([${t}])`;
      return `${id}(["${t.replace(/"/g, "'") }"])`;
    });

    // 6. Quote standard bracket nodes: [...]
    cur = cur.replace(/([A-Za-z0-9_]+)\s*\[\s*([^(\][^\]]*?)\s*\]/g, (match, id, text) => {
      const t = text.trim();
      if (t.startsWith('"') && t.endsWith('"')) return `${id}[${t}]`;
      return `${id}["${t.replace(/"/g, "'") }"]`;
    });

    cleaned.push(cur);
  }

  return cleaned.join("\n");
}

function triggerPostRenderEnhancements(charts, mermaids) {
  // Initialize interactive charts if any
  if (charts && charts.length > 0 && typeof window.Chart !== "undefined") {
    setTimeout(() => {
      charts.forEach(({ id, config }) => {
        const cvs = document.getElementById(id);
        if (cvs) {
          try {
            new window.Chart(cvs, config);
          } catch (ce) {
            console.warn("Chart rendering note:", ce);
          }
        }
      });
    }, 50);
  }

  // Initialize interactive Mermaid flowcharts & architectural diagrams
  if (mermaids && mermaids.length > 0 && typeof window.mermaid !== "undefined") {
    setTimeout(async () => {
      for (const { id, code } of mermaids) {
        const container = document.getElementById(id);
        if (!container) continue;

        const sanitized = sanitizeMermaidCode(code);
        const renderSvgId = "aliphsvg-" + Math.random().toString(36).substring(2, 9);

        try {
          // Attempt 1: Render with sanitized code (handles unquoted labels, parentheses, ampersands)
          const { svg } = await window.mermaid.render(renderSvgId, sanitized);
          if (svg && !svg.includes("Syntax error in text") && !svg.includes("mermaid version")) {
            container.innerHTML = svg;
            const svgEl = container.querySelector("svg");
            if (svgEl) {
              svgEl.style.display = "block";
              svgEl.style.maxWidth = "100%";
              svgEl.style.height = "auto";
              svgEl.style.visibility = "visible";
              svgEl.style.opacity = "1";
            }
            continue;
          }
          throw new Error("Sanitized render returned error SVG");
        } catch (firstErr) {
          console.warn("Sanitized Mermaid render note, attempting raw fallback:", firstErr);
          // Purge any stray error elements Mermaid may have injected into document
          document.querySelectorAll(`[id^="d${renderSvgId}"], .error-icon`).forEach(el => el.remove());

          try {
            // Attempt 2: Render with raw code
            const rawSvgId = "aliphrawsvg-" + Math.random().toString(36).substring(2, 9);
            const { svg } = await window.mermaid.render(rawSvgId, code);
            if (svg && !svg.includes("Syntax error in text") && !svg.includes("mermaid version")) {
              container.innerHTML = svg;
              const svgEl = container.querySelector("svg");
              if (svgEl) {
                svgEl.style.display = "block";
                svgEl.style.maxWidth = "100%";
                svgEl.style.height = "auto";
                svgEl.style.visibility = "visible";
                svgEl.style.opacity = "1";
              }
              continue;
            }
          } catch (secondErr) {
            console.warn("Raw Mermaid render fallback note:", secondErr);
            document.querySelectorAll(`[id^="daliph"], .error-icon`).forEach(el => el.remove());
          }

          // Fallback: Clean styled code block (never show the bomb icon)
          container.innerHTML = `<pre class="mermaid-fallback"><code>${escapeHtml(code)}</code></pre>`;
        }
      }
    }, 60);
  }
}

function appendMessageCard(role, content, speaker = null, scroll = true) {
  const trimmed = (content || "").trim();
  if (!trimmed) return;

  // Never append exact identical duplicate text
  const lastBubble = transcriptList.querySelector(`.msg-row.${role}:last-child .msg-bubble`);
  if (lastBubble && lastBubble.innerText.trim() === trimmed) {
    return;
  }

  if (role === "assistant") {
    hideThinkingIndicator();
  }

  if (chatPlaceholder && chatPlaceholder.parentElement === transcriptList) {
    chatPlaceholder.remove();
  }

  const row = document.createElement("div");
  row.className = `msg-row ${role}`;
  const displayName = speaker || (role === "user" ? userName.textContent : "aliph1");

  if (role === "assistant") {
    const { html, charts, mermaids } = renderMarkdownAndCharts(trimmed);
    row.innerHTML = `
      <div class="msg-info">${escapeHtml(displayName)}</div>
      <div class="msg-bubble">${html}</div>
    `;
    transcriptList.appendChild(row);
    triggerPostRenderEnhancements(charts, mermaids);
  } else {
    row.innerHTML = `
      <div class="msg-info">${escapeHtml(displayName)}</div>
      <div class="msg-bubble">${escapeHtml(trimmed)}</div>
    `;
    transcriptList.appendChild(row);
  }

  if (scroll) scrollToBottom();
}

function scrollToBottom() {
  if (chatStream) {
    chatStream.scrollTop = chatStream.scrollHeight;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// =========================================================
// Data Channel & WebRTC Connection
// =========================================================
function resumeAllAudioElements() {
  document.querySelectorAll("audio").forEach((el) => {
    try {
      el.muted = false;
      el.volume = 1.0;
      if (el.paused) {
        el.play().catch(() => {});
      }
    } catch (e) {}
  });
}
window.addEventListener("click", resumeAllAudioElements, { once: true });
window.addEventListener("keydown", resumeAllAudioElements, { once: true });

function sendDataPacket(obj) {
  if (!lkRoom || !lkRoom.localParticipant) return;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    lkRoom.localParticipant.publishData(bytes, { reliable: true });
  } catch (err) {
    console.warn("Data packet send notice:", err);
  }
}

async function connectLiveKit() {
  if (lkRoom && (lkRoom.state === "connected" || lkRoom.state === "connecting")) {
    return;
  }
  setStatus("ready", "Connecting");
  try {
    const tabId = sessionStorage.getItem("aura_tab_id") || ("tab_" + Math.random().toString(36).substring(2, 8));
    sessionStorage.setItem("aura_tab_id", tabId);

    const res = await fetch(`/getToken?name=Kirito&identity=Kirito_${tabId}&room=agent-room`);
    const data = await res.json();
    if (!data.token) {
      setStatus("ready", "Offline");
      return;
    }

    lkRoom = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000
      }
    });

    lkRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === LivekitClient.Track.Kind.Audio) {
        let audioEl = document.getElementById(`audio-${participant.identity}`);
        if (!audioEl) {
          audioEl = track.attach();
          audioEl.id = `audio-${participant.identity}`;
          document.body.appendChild(audioEl);
        } else {
          track.attach(audioEl);
        }
        audioEl.autoplay = true;
        audioEl.volume = 1.0;
        audioEl.muted = false;
        audioEl.play().catch(e => console.warn("Initial audio play note:", e));
        setupAgentAudioAnalyser(track.mediaStreamTrack);
      }
    });

    lkRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === LivekitClient.Track.Kind.Audio) {
        track.detach().forEach(el => el.remove());
      }
    });

    lkRoom.on(LivekitClient.RoomEvent.DataReceived, (payload) => {
      try {
        const str = new TextDecoder().decode(payload);
        const msg = JSON.parse(str);

        if (msg.type === "agent_state") {
          const raw = (msg.state || "").toLowerCase();
          if (raw.includes("think") || raw.includes("process") || raw.includes("reason")) {
            setStatus("thinking", "Thinking");
          } else if (raw.includes("speak")) {
            setStatus("speaking", "Speaking");
            resumeAllAudioElements();
          } else if (raw.includes("listen")) {
            setStatus("listening", "Listening");
          } else {
            setStatus("ready", "Ready");
          }
        } else if (msg.type === "switch_session_ui") {
          if (msg.session_id) {
            selectSession(msg.session_id, true);
          }
        } else if (msg.type === "switch_shader_ui") {
          if (msg.variant) {
            switchVariantUI(msg.variant);
          }
        } else if (msg.type === "switch_engine_ui") {
          if (msg.stt && engineSttSelect) {
            engineSttSelect.value = msg.stt;
            if (sttCustomSelect) sttCustomSelect.syncFromSelect();
          }
          if (msg.tts && engineTtsSelect) {
            engineTtsSelect.value = msg.tts;
            if (ttsCustomSelect) ttsCustomSelect.syncFromSelect();
          }
          loadSettingsData();
        } else if (msg.type === "speaker_update" || msg.type === "speaker_detected") {
          const isVerified = Boolean(msg.verified);
          const speakerName = isVerified ? (msg.speaker || "Kirito") : "Unknown";
          if (userName) userName.textContent = speakerName;
          if (userCert) {
            userCert.remove();
          }
        } else if (msg.type === "speaker_deleted") {
          if (userName && msg.deleted_name && userName.textContent === msg.deleted_name) {
            userName.textContent = "Kirito";
          }
        } else if (msg.type === "session_deleted") {
          allSessions = allSessions.filter(s => s.id !== msg.session_id);
          renderHistoryList(allSessions);
          if (msg.is_current && msg.new_session_id) {
            activeSessionId = msg.new_session_id;
            localStorage.setItem("aura_session_id", activeSessionId);
            renderMessages([]);
          }
        } else if (msg.type === "session_renamed") {
          const sess = allSessions.find(s => s.id === msg.session_id);
          if (sess) {
            sess.title = msg.new_title;
          }
          renderHistoryList(allSessions);
        } else if (msg.type === "history_cleared") {
          allSessions = [];
          renderHistoryList([]);
          if (msg.new_session_id) {
            activeSessionId = msg.new_session_id;
            localStorage.setItem("aura_session_id", activeSessionId);
          }
          // Do not erase active conversation turn so the user prompt and response remain visible
        } else if (msg.type === "voice_transcript_for_attachment") {
          hideThinkingIndicator();
          if (pendingVoiceAttachment) {
            const fileToProc = pendingVoiceAttachment;
            pendingVoiceAttachment = null;
            const voicePrompt = (msg.transcript || "").trim();
            processFileAnalysis(fileToProc, voicePrompt);
          }
        } else if (msg.type === "chat_message") {
          hideThinkingIndicator();
          if (msg.session_id && msg.session_id !== activeSessionId) {
            activeSessionId = msg.session_id;
            localStorage.setItem("aura_session_id", activeSessionId);
            document.querySelectorAll(".history-row").forEach(el => {
              el.classList.toggle("active", el.dataset.id === activeSessionId);
            });
          }
          // Deduplicate if user already appended locally!
          if (msg.role === "user") {
            const clean = (msg.content || "").trim();
            if (!clean) return;
            if (recentUserMessages.has(clean)) {
              return; // Skip duplicate echo!
            }
            const lastUserBubble = transcriptList.querySelector(".msg-row.user:last-child .msg-bubble");
            if (lastUserBubble && lastUserBubble.innerText.trim() === clean) {
              return; // Skip duplicate echo!
            }
            recentUserMessages.add(clean);
            setTimeout(() => recentUserMessages.delete(clean), 30000);
          }

          // Deduplicate assistant messages
          if (msg.role === "assistant") {
            const clean = (msg.content || "").trim();
            if (!clean) return;
            if (recentAssistantMessages.has(clean)) {
              return; // Skip duplicate assistant message!
            }
            const lastAssistantBubble = transcriptList.querySelector(".msg-row.assistant:last-child .msg-bubble");
            if (lastAssistantBubble) {
              const lastText = (lastAssistantBubble.innerText || "").trim().replace(/\s+/g, " ");
              const cleanNorm = clean.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim();
              if (lastText && (lastText === cleanNorm || lastText.includes(cleanNorm) || cleanNorm.includes(lastText))) {
                return; // Skip duplicate!
              }
            }
            recentAssistantMessages.add(clean);
            setTimeout(() => recentAssistantMessages.delete(clean), 30000);
          }

          appendMessageCard(msg.role, msg.content, msg.role === "user" ? (msg.speaker || userName.textContent) : "aliph1");
        }
      } catch (err) {
        console.warn("Data parse error:", err);
      }
    });

    lkRoom.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
      console.warn("LiveKit Room disconnected:", reason);
      const rStr = String(reason || "").toLowerCase();
      if (rStr.includes("duplicate")) {
        setStatus("ready", "Duplicate Tab Active");
        return;
      }
      setStatus("ready", "Reconnecting");
      setTimeout(() => {
        if (!lkRoom || lkRoom.state === "disconnected") {
          connectLiveKit();
        }
      }, 4000);
    });

    await lkRoom.connect(data.url, data.token);

    if (activeSessionId) {
      sendDataPacket({ type: "init_session", session_id: activeSessionId });
    }

    try {
      micTrack = await LivekitClient.createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      });
      await lkRoom.localParticipant.publishTrack(micTrack);
      await micTrack.mute();
      setupMicAudioAnalyser(micTrack.mediaStreamTrack);
    } catch (mErr) {
      console.warn("Microphone initial track creation note (will init on first talk):", mErr);
    }

    setStatus("ready", "Ready");
  } catch (err) {
    console.error("LiveKit connection error:", err);
    setStatus("ready", "Offline");
  }
}

// =========================================================
// Push-To-Talk (PTT) Spacebar & Circular Mic Button
// =========================================================
async function startPTT() {
  if (isMicActive) return;

  // Temporarily mute playing audio during PTT to prevent microphone feedback
  document.querySelectorAll("audio").forEach((el) => {
    try {
      el.muted = true;
    } catch (e) {}
  });

  if (currentAttachedFile) {
    pendingVoiceAttachment = currentAttachedFile;
    clearAttachment();
  }
  isMicActive = true;
  micBtn.classList.add("active");
  setStatus("listening", "Listening");

  if (!micTrack && lkRoom && lkRoom.localParticipant) {
    try {
      micTrack = await LivekitClient.createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      });
      await lkRoom.localParticipant.publishTrack(micTrack);
      await micTrack.mute();
      setupMicAudioAnalyser(micTrack.mediaStreamTrack);
    } catch (e) {
      console.warn("Could not acquire microphone:", e);
      setStatus("ready", "Ready");
      isMicActive = false;
      micBtn.classList.remove("active");
      return;
    }
  }

  if (micTrack) {
    try { await micTrack.unmute(); } catch (e) {}
  }
  sendDataPacket({ type: "ptt_start" });
}

async function stopPTT() {
  if (!isMicActive) return;
  isMicActive = false;
  micBtn.classList.remove("active");

  // Restore audio playback unmuting
  resumeAllAudioElements();
  
  if (pendingVoiceAttachment) {
    setStatus("thinking", "Analyzing & Reasoning");
  }

  // Send ptt_released with has_attachment flag
  sendDataPacket({ type: "ptt_released", has_attachment: !!pendingVoiceAttachment });
  setTimeout(async () => {
    if (!isMicActive && micTrack) {
      try { await micTrack.mute(); } catch (e) {}
    }
  }, 250);
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !isHoldingSpace) {
    const isInputFocused = document.activeElement === chatInput || document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA";
    if (!isInputFocused) {
      e.preventDefault();
      isHoldingSpace = true;
      startPTT();
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && isHoldingSpace) {
    e.preventDefault();
    isHoldingSpace = false;
    stopPTT();
  }
});

if (micBtn) {
  micBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startPTT();
  });
  micBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    startPTT();
  });
  micBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    stopPTT();
  });
}

window.addEventListener("mouseup", () => {
  if (isMicActive && !isHoldingSpace) {
    stopPTT();
  }
});

// =========================================================
// File Attachment & Multimodal Ingestion (OCR / PDF / Video / Audio)
// =========================================================
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function clearAttachment() {
  currentAttachedFile = null;
  if (fileInput) fileInput.value = "";
  if (attachmentPreviewBar) attachmentPreviewBar.style.display = "none";
}

if (btnAttach && fileInput) {
  btnAttach.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      alert("File size exceeds 25MB limit.");
      fileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const base64 = evt.target.result;
      currentAttachedFile = {
        name: file.name,
        size: formatBytes(file.size),
        type: file.type || "application/octet-stream",
        base64: base64
      };

      let icon = "≡ƒôä";
      if (file.type.startsWith("image/")) icon = "≡ƒû╝∩╕Å";
      else if (file.type.startsWith("audio/")) icon = "≡ƒÄ╡";
      else if (file.type.startsWith("video/")) icon = "≡ƒÄ¼";
      else if (file.type.includes("pdf")) icon = "≡ƒôò";

      if (attachmentIcon) attachmentIcon.textContent = icon;
      if (attachmentName) attachmentName.textContent = file.name;
      if (attachmentSize) attachmentSize.textContent = `(${formatBytes(file.size)})`;
      if (attachmentPreviewBar) attachmentPreviewBar.style.display = "flex";
    };
    reader.readAsDataURL(file);
  });
}

if (btnRemoveAttachment) {
  btnRemoveAttachment.addEventListener("click", clearAttachment);
}

// =========================================================
// Multimodal File Analysis & Spoken Synthesis
// =========================================================
async function processFileAnalysis(fileObj, promptText) {
  if (!fileObj) return;
  const senderName = userName ? userName.textContent : "User";
  const displayText = `≡ƒôÄ [${fileObj.name}]: ${promptText || "Please analyze this file and extract all key findings."}`;

  appendMessageCard("user", displayText, senderName);
  recentUserMessages.add(displayText);
  setTimeout(() => recentUserMessages.delete(displayText), 30000);

  setStatus("thinking", "Analyzing & Reasoning");

  try {
    const res = await fetch("/api/analyze_file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: fileObj.base64,
        mime_type: fileObj.type,
        filename: fileObj.name,
        prompt: promptText,
        session_id: activeSessionId
      })
    });
    const data = await res.json();
    if (data.success && data.text) {
      appendMessageCard("assistant", data.text, "aliph1");
      setStatus("idle", "Ready");

      // Tell LiveKit Agent to speak the conversational spoken summary over TTS!
      if (data.spoken_summary) {
        sendDataPacket({
          type: "speak_utterance",
          text: data.spoken_summary,
          analysis: data.text,
          prompt: promptText,
          filename: fileObj.name,
          file_type: fileObj.type,
          session_id: activeSessionId
        });
      }
    } else {
      appendMessageCard("assistant", "Sorry, I encountered an issue analyzing that file: " + (data.error || "Unknown error"), "aliph1");
      setStatus("idle", "Ready");
    }
  } catch (err) {
    appendMessageCard("assistant", "Error analyzing document: " + err.message, "aliph1");
    setStatus("idle", "Ready");
  }
}

// =========================================================
// Manually Type & Send Logic (With Thinking Depiction & Deduplication)
// =========================================================
async function handleSendMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  const fileToUpload = currentAttachedFile;

  if (!text && !fileToUpload) return;

  chatInput.value = "";
  chatInput.style.height = "auto";
  clearAttachment();

  if (fileToUpload) {
    await processFileAnalysis(fileToUpload, text);
  } else {
    const senderName = userName ? userName.textContent : "User";
    appendMessageCard("user", text, senderName);
    recentUserMessages.add(text);
    setTimeout(() => recentUserMessages.delete(text), 30000);

    setStatus("thinking", "Thinking");
    sendDataPacket({ type: "user_chat", text: text, session_id: activeSessionId });
  }
}

if (btnSend) {
  btnSend.addEventListener("click", handleSendMessage);
}

if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift + Enter: natural line break without sending
        return;
      }
      e.preventDefault();
      handleSendMessage();
    }
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });
}

// =========================================================
// Settings Load & Save (With Dynamic Voice Changer & Custom Selects)
// =========================================================
let llmCustomSelect = null;
let sttCustomSelect = null;
let ttsCustomSelect = null;
let voiceCustomSelect = null;
let currentVoiceOptions = {};

if (engineLlmSelect) {
  llmCustomSelect = new CustomSelect(engineLlmSelect, { align: "left" });
  engineLlmSelect.addEventListener("change", () => {
    if (capModelBadge && engineLlmSelect.selectedIndex >= 0) {
      const opt = engineLlmSelect.options[engineLlmSelect.selectedIndex];
      if (opt) capModelBadge.textContent = opt.text.split("(")[0].trim();
    }
  });
}
if (engineSttSelect) {
  sttCustomSelect = new CustomSelect(engineSttSelect, { align: "left" });
}
if (engineTtsSelect) {
  ttsCustomSelect = new CustomSelect(engineTtsSelect, { align: "left" });
  const handleTtsChange = () => {
    renderVoiceOptions(engineTtsSelect.value);
  };
  engineTtsSelect.addEventListener("change", handleTtsChange);
  engineTtsSelect.addEventListener("input", handleTtsChange);
}

function renderVoiceOptions(ttsEngine, selectedVoiceId = null) {
  if (voiceCustomSelect && typeof voiceCustomSelect.destroy === "function") {
    voiceCustomSelect.destroy();
    voiceCustomSelect = null;
  }
  if (groupVoiceSelect) {
    groupVoiceSelect.querySelectorAll(".custom-select-container").forEach(el => el.remove());
  }

  const voices = currentVoiceOptions[ttsEngine] || [];
  if (!groupVoiceSelect || !engineVoiceSelect) return;

  if (voices.length === 0) {
    groupVoiceSelect.style.display = "none";
    return;
  }

  groupVoiceSelect.style.display = "block";
  engineVoiceSelect.innerHTML = "";
  voices.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    if (selectedVoiceId && v.id === selectedVoiceId) {
      opt.selected = true;
    }
    engineVoiceSelect.appendChild(opt);
  });

  if (!selectedVoiceId && voices.length > 0) {
    engineVoiceSelect.value = voices[0].id;
  }

  voiceCustomSelect = new CustomSelect(engineVoiceSelect, { align: "left" });
}

async function loadSettingsData() {
  try {
    const res = await fetch("/api/engines");
    const data = await res.json();
    if (data.success) {
      currentVoiceOptions = data.voice_options || {};

      if (engineLlmSelect && data.selected_llm) {
        engineLlmSelect.value = data.selected_llm;
        // If option was not present in the DOM, dynamically add it
        if (engineLlmSelect.selectedIndex === -1) {
          const opt = document.createElement("option");
          opt.value = data.selected_llm;
          opt.textContent = data.selected_llm;
          engineLlmSelect.appendChild(opt);
          engineLlmSelect.value = data.selected_llm;
        }
        if (llmCustomSelect) llmCustomSelect.syncFromSelect();
        if (capModelBadge) {
          const opt = engineLlmSelect.options[engineLlmSelect.selectedIndex];
          capModelBadge.textContent = opt ? opt.text.split("(")[0].trim() : data.selected_llm;
        }
      }
      if (enableOcrCheckbox && typeof data.enable_ocr !== "undefined") {
        enableOcrCheckbox.checked = data.enable_ocr;
      }
      if (engineSttSelect) {
        engineSttSelect.value = data.selected_stt || "livekit";
        if (sttCustomSelect) sttCustomSelect.syncFromSelect();
      }
      if (engineTtsSelect) {
        engineTtsSelect.value = data.selected_tts || "cartesia";
        if (ttsCustomSelect) ttsCustomSelect.syncFromSelect();
      }

      // Populate dynamic voice selector according to active TTS engine
      renderVoiceOptions(data.selected_tts || "cartesia", data.selected_voice);

      if (diagLlm && data.selected_llm) {
        diagLlm.textContent = data.selected_llm.replace(/-/g, " ").replace("gemini", "Gemini");
      }
      if (diagOcr) {
        diagOcr.textContent = (data.enable_ocr !== false) ? "Active (Google Gemini)" : "Disabled";
      }
    }
  } catch (e) {
    console.warn("Failed loading settings data:", e);
  }
}

if (btnSaveSettings) {
  btnSaveSettings.addEventListener("click", async () => {
    const geminiKey = inputGeminiKey ? inputGeminiKey.value.trim() : "";
    const llm = engineLlmSelect ? engineLlmSelect.value : "gemini-3.5-flash-lite";
    const enable_ocr = enableOcrCheckbox ? enableOcrCheckbox.checked : true;
    const stt = engineSttSelect ? engineSttSelect.value : "livekit";
    const tts = engineTtsSelect ? engineTtsSelect.value : "cartesia";
    const voice = (engineVoiceSelect && groupVoiceSelect && groupVoiceSelect.style.display !== "none") ? engineVoiceSelect.value : "";

    try {
      const res = await fetch("/api/engines/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stt, tts, voice, llm, enable_ocr, gemini_key: geminiKey })
      });
      const data = await res.json();
      if (data.success) {
        sendDataPacket({ type: "switch_engine", stt, tts, voice, llm });
        if (diagLlm) diagLlm.textContent = llm.replace(/-/g, " ").replace("gemini", "Gemini");
        if (diagOcr) diagOcr.textContent = enable_ocr ? "Active (Google Gemini)" : "Disabled";
        alert("Settings applied successfully!");
        switchPanel("chat");
      }
    } catch (err) {
      alert("Error saving settings: " + err.message);
    }
  });
}

// =========================================================
// Share Chat Session (Full Standalone HTML, Web Link, Markdown)
// =========================================================
let shareTargetSessionId = null;
let shareTargetSessionTitle = null;

function openShareModal(targetSessionId = null, targetTitle = null) {
  if (!shareModal) return;
  shareTargetSessionId = targetSessionId || activeSessionId;
  const curSession = allSessions.find(s => s.id === shareTargetSessionId) || { title: targetTitle || "Current Conversation" };
  shareTargetSessionTitle = targetTitle || curSession.title || "Current Conversation";

  if (shareSessionTitle) {
    shareSessionTitle.textContent = shareTargetSessionTitle;
  }
  if (shareLinkInput) {
    const origin = window.location.origin || "http://localhost:5050";
    shareLinkInput.value = `${origin}/share/${shareTargetSessionId || "session"}`;
  }
  shareModal.style.display = "flex";
}

function closeShareModal() {
  if (shareModal) shareModal.style.display = "none";
}

if (btnShareChat) {
  btnShareChat.addEventListener("click", () => openShareModal());
}

if (btnCloseShare) {
  btnCloseShare.addEventListener("click", closeShareModal);
}

if (shareModal) {
  shareModal.addEventListener("click", (e) => {
    if (e.target === shareModal) closeShareModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && shareModal.style.display === "flex") {
      closeShareModal();
    }
  });
}

if (btnCopyShareLink && shareLinkInput) {
  btnCopyShareLink.addEventListener("click", () => {
    shareLinkInput.select();
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      const prev = btnCopyShareLink.textContent;
      btnCopyShareLink.textContent = "Copied! Γ£ô";
      btnCopyShareLink.classList.add("primary");
      setTimeout(() => {
        btnCopyShareLink.textContent = prev;
        btnCopyShareLink.classList.remove("primary");
      }, 2200);
    });
  });
}

if (btnCopyTranscriptMd) {
  btnCopyTranscriptMd.addEventListener("click", async () => {
    let md = `# ${shareTargetSessionTitle || "aliph1 Conversation Session"}\n`;
    md += `*Exported from aliph1 Assistant ΓÇö ${new Date().toLocaleString()}*\n\n---\n\n`;

    if (shareTargetSessionId === activeSessionId && transcriptList.querySelectorAll(".msg-row").length > 0) {
      const rows = transcriptList.querySelectorAll(".msg-row");
      rows.forEach(r => {
        const spk = r.querySelector(".msg-info") ? r.querySelector(".msg-info").textContent.trim() : "Speaker";
        const bubble = r.querySelector(".msg-bubble");
        const text = bubble ? (bubble.innerText || bubble.textContent).trim() : "";
        md += `### ${spk}:\n${text}\n\n`;
      });
    } else {
      try {
        const res = await fetch(`/api/share/${shareTargetSessionId}`);
        const data = await res.json();
        const msgs = data.messages || [];
        if (!msgs.length) {
          alert("This conversation has no messages recorded yet.");
          return;
        }
        msgs.forEach(m => {
          const spk = m.speaker || (m.role === "user" ? "User" : "aliph1");
          md += `### ${spk}:\n${m.content}\n\n`;
        });
      } catch (e) {
        alert("Failed fetching session messages: " + e.message);
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(md);
      const prev = btnCopyTranscriptMd.textContent;
      btnCopyTranscriptMd.textContent = "Copied! Γ£ô";
      btnCopyTranscriptMd.classList.add("primary");
      setTimeout(() => {
        btnCopyTranscriptMd.textContent = prev;
        btnCopyTranscriptMd.classList.remove("primary");
      }, 2200);
    } catch (err) {
      alert("Could not copy transcript: " + err.message);
    }
  });
}

if (btnDownloadShareHtml) {
  btnDownloadShareHtml.addEventListener("click", async () => {
    const sessionTitle = shareTargetSessionTitle || "aliph1 Conversation";
    const dateStr = new Date().toLocaleString();

    let transcriptInnerHtml = "";
    if (shareTargetSessionId === activeSessionId && transcriptList.querySelectorAll(".msg-row").length > 0) {
      const transcriptClone = transcriptList.cloneNode(true);
      const ph = transcriptClone.querySelector(".chat-placeholder");
      if (ph) ph.remove();
      transcriptInnerHtml = transcriptClone.innerHTML;
    } else {
      try {
        const res = await fetch(`/api/share/${shareTargetSessionId}`);
        const data = await res.json();
        const msgs = data.messages || [];
        if (!msgs.length) {
          alert("This conversation has no messages to export.");
          return;
        }
        const tempDiv = document.createElement("div");
        msgs.forEach(m => {
          const row = document.createElement("div");
          row.className = `msg-row ${m.role}`;
          const spk = m.speaker || (m.role === "user" ? "User" : "aliph1");
          if (m.role === "assistant") {
            const { html } = renderMarkdownAndCharts(m.content);
            row.innerHTML = `<div class="msg-info">${escapeHtml(spk)}</div><div class="msg-bubble">${html}</div>`;
          } else {
            row.innerHTML = `<div class="msg-info">${escapeHtml(spk)}</div><div class="msg-bubble">${escapeHtml(m.content)}</div>`;
          }
          tempDiv.appendChild(row);
        });
        transcriptInnerHtml = tempDiv.innerHTML;
      } catch (e) {
        alert("Failed fetching session messages: " + e.message);
        return;
      }
    }

    const standaloneHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(sessionTitle)} ΓÇö aliph1</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 50% 0%, #FFFFFF 0%, #F8FAFC 50%, #EEF2F6 100%);
      color: #0F172A;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 32px 16px 64px;
      -webkit-font-smoothing: antialiased;
    }
    .standalone-container {
      width: 100%;
      max-width: 880px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .header-card {
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 18px;
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 20px -4px rgba(15, 23, 42, 0.06);
    }
    .header-meta {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .agent-avatar {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 20px;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.28);
    }
    .header-titles h1 {
      font-size: 17px;
      font-weight: 800;
      color: #0F172A;
      letter-spacing: -0.01em;
    }
    .header-titles p {
      font-size: 12px;
      color: #64748B;
      margin-top: 3px;
    }
    .badge-standalone {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 4px 10px;
      border-radius: 9999px;
      background: #EEF2FF;
      color: #4F46E5;
      border: 1px solid #C7D2FE;
    }
    .chat-card {
      background: #FFFFFF;
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 20px;
      box-shadow: 0 10px 30px -5px rgba(15, 23, 42, 0.05);
      padding: 28px 24px;
    }
    .transcript-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .msg-row {
      display: flex;
      flex-direction: column;
      max-width: 82%;
      animation: fadeIn 0.2s ease-out;
    }
    .msg-row.user {
      align-self: flex-end;
      align-items: flex-end;
    }
    .msg-row.assistant {
      align-self: flex-start;
      align-items: flex-start;
      max-width: 96%;
    }
    .msg-info {
      font-size: 11.5px;
      font-weight: 600;
      color: #94A3B8;
      margin-bottom: 5px;
      padding: 0 4px;
    }
    .msg-row.user .msg-bubble {
      background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
      color: #FFFFFF;
      border-radius: 16px 16px 4px 16px;
      padding: 12px 18px;
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.18);
    }
    .msg-row.assistant .msg-bubble {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      color: #1E293B;
      border-radius: 16px 16px 16px 4px;
      padding: 16px 20px;
      font-size: 14px;
      line-height: 1.6;
      width: 100%;
    }
    .mermaid-diagram-card {
      margin: 14px 0;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
    }
    .diagram-header {
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
      padding: 8px 14px;
      display: flex;
      align-items: center;
    }
    .diagram-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      color: #4F46E5;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .mermaid-diagram-viewport {
      padding: 16px;
      overflow-x: auto;
      display: flex;
      justify-content: center;
      background: #FAFAFA;
    }
    .mermaid-diagram-content svg {
      max-width: 100% !important;
      height: auto !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    pre {
      background: #0F172A;
      color: #F8FAFC;
      padding: 14px;
      border-radius: 10px;
      overflow-x: auto;
      font-family: 'Fira Code', monospace;
      font-size: 12.5px;
      margin: 10px 0;
    }
    code {
      font-family: 'Fira Code', monospace;
      background: rgba(15, 23, 42, 0.06);
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 12.5px;
    }
    pre code { background: none; padding: 0; color: inherit; }
    p { margin-bottom: 8px; }
    p:last-child { margin-bottom: 0; }
    ul, ol { margin-left: 20px; margin-bottom: 10px; }
    h1, h2, h3, h4 { margin-top: 14px; margin-bottom: 8px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="standalone-container">
    <div class="header-card">
      <div class="header-meta">
        <div class="agent-avatar">╬▒</div>
        <div class="header-titles">
          <h1>${escapeHtml(sessionTitle)}</h1>
          <p>Exported on ${escapeHtml(dateStr)} • aliph1 Full Session Transcript</p>
        </div>
      </div>
      <span class="badge-standalone">Saved Session</span>
    </div>

    <div class="chat-card">
      <div class="transcript-list">
        ${transcriptInnerHtml}
      </div>
    </div>
  </div>
  <script>
    if (typeof window.mermaid !== "undefined") {
      try {
        window.mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
      } catch(e) {}
    }
  </script>
</body>
</html>`;

    const blob = new Blob([standaloneHtml], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aliph1_${sessionTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
    a.click();
  });
}

// =========================================================
// App Startup
// =========================================================
window.addEventListener("DOMContentLoaded", () => {
  loadSessions(false);
  createNewSession(false);
  loadSettingsData();
  connectLiveKit();
});
