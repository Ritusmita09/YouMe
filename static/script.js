/* ─── State ──────────────────────────────────────────────── */
let currentType = null;          // 'video' | 'playlist'
let currentUrl = null;
let currentResolutions = [];
let selectedResolution = "best";
let isAudioOnly = false;
let activePolls = {};            // task_id → interval

/* ─── Focus Mode State ──────────────────────────────────── */
const POMODORO_FOCUS_SECONDS = 25 * 60;
const POMODORO_BREAK_SECONDS = 5 * 60;

let focusState = {
  phase: "focus", // focus | break
  running: false,
  remaining: POMODORO_FOCUS_SECONDS,
  sessionsToday: 0,
  intervalId: null,
  audioEnabled: false,
};

let audioCtx = null;
let focusMasterGain = null;
let currentSoundNodes = [];
let lofiBeatTimer = null;
let whiteNoiseBuffer = null;

/* ─── Stream Player State ───────────────────────────────── */
let streamState = {
  playing: false,
};

/* ─── Toast ──────────────────────────────────────────────── */
let toastEl = null;
function showToast(msg, type = "") {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = `toast ${type} show`;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3500);
}

/* ─── Helpers ────────────────────────────────────────────── */
function formatDuration(secs) {
  if (!secs) return "--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function formatViews(n) {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n/1_000).toFixed(0)}K views`;
  return `${n} views`;
}

/* ─── Fetch Info ─────────────────────────────────────────── */
async function fetchInfo() {
  const urlInput = document.getElementById("urlInput");
  const url = urlInput.value.trim();
  if (!url) { showToast("Paste a YouTube URL first", "error"); return; }

  setBtnLoading("fetchBtn", true);
  hideElements("infoCard", "optionsCard");

  try {
    const res = await fetch("/fetch_info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, "error"); return; }

    currentUrl = url;
    currentType = data.type;
    renderInfo(data);
    renderOptions(data);
    showElements("infoCard", "optionsCard");
  } catch (e) {
    showToast("Network error – is the server running?", "error");
  } finally {
    setBtnLoading("fetchBtn", false);
  }
}

/* ─── Render Info Card ───────────────────────────────────── */
function renderInfo(data) {
  const box = document.getElementById("videoInfo");

  if (data.type === "video") {
    box.innerHTML = `
      <div class="thumb-wrap">
        ${data.thumbnail ? `<img src="${escHtml(data.thumbnail)}" alt="thumbnail" loading="lazy"/>` : ""}
      </div>
      <div class="video-meta">
        <div class="type-badge">VIDEO</div>
        <div class="video-title">${escHtml(data.title)}</div>
        <div class="video-sub">
          ${data.channel ? `<span class="meta-pill">📺 ${escHtml(data.channel)}</span>` : ""}
          ${data.duration ? `<span class="meta-pill">⏱ ${formatDuration(data.duration)}</span>` : ""}
          ${data.view_count ? `<span class="meta-pill">👁 ${formatViews(data.view_count)}</span>` : ""}
        </div>
      </div>`;
  } else {
    const entries = (data.entries || []).slice(0, 50);
    const listHtml = entries.map((e, i) => `
      <div class="playlist-entry">
        <span class="entry-index">${i + 1}</span>
        <span class="entry-title">${escHtml(e.title)}</span>
        ${e.duration ? `<span class="meta-pill">⏱ ${formatDuration(e.duration)}</span>` : ""}
      </div>`).join("");

    box.innerHTML = `
      <div class="video-meta" style="width:100%">
        <div class="type-badge">PLAYLIST</div>
        <div class="video-title">${escHtml(data.title)}</div>
        <div class="video-sub" style="margin-bottom:12px">
          <span class="meta-pill">📋 ${data.count} videos</span>
        </div>
        <div class="playlist-entries">${listHtml}</div>
      </div>`;
  }
}

/* ─── Render Options Card ────────────────────────────────── */
function renderOptions(data) {
  isAudioOnly = false;
  setFormat("video");

  currentResolutions = data.resolutions || [];
  const grid = document.getElementById("resGrid");
  grid.innerHTML = "";

  // Always include "Best" option
  const allRes = ["best", ...currentResolutions];
  allRes.forEach((r, i) => {
    const btn = document.createElement("button");
    btn.className = "res-btn" + (i === 0 ? " active" : "");
    btn.textContent = r === "best" ? "⭐ Best" : r;
    btn.onclick = () => selectResolution(r, btn);
    grid.appendChild(btn);
  });
  selectedResolution = "best";
}

function selectResolution(res, el) {
  document.querySelectorAll(".res-btn").forEach(b => b.classList.remove("active"));
  el.classList.add("active");
  selectedResolution = res;
}

function setFormat(type) {
  isAudioOnly = type === "audio";
  document.getElementById("videoBtn").classList.toggle("active", !isAudioOnly);
  document.getElementById("audioBtn").classList.toggle("active", isAudioOnly);
  document.getElementById("resGroup").style.display = isAudioOnly ? "none" : "";
}

/* ─── Start Download ─────────────────────────────────────── */
async function startDownload() {
  if (!currentUrl) return;

  const btn = document.getElementById("downloadBtn");
  btn.disabled = true;
  btn.textContent = "Starting…";

  try {
    const res = await fetch("/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: currentUrl,
        resolution: selectedResolution,
        audio_only: isAudioOnly,
        is_playlist: currentType === "playlist",
      }),
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, "error"); return; }

    const taskId = data.task_id;
    showElements("activeCard");
    addDownloadItem(taskId, isAudioOnly ? "🎵 Audio Download" : "🎬 Video Download");
    pollProgress(taskId);
    showToast("Download started!", "success");
  } catch (e) {
    showToast("Failed to start download", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "⬇ Download Now";
  }
}

/* ─── Download Item UI ───────────────────────────────────── */
function addDownloadItem(taskId, label) {
  const container = document.getElementById("activeDownloads");
  const div = document.createElement("div");
  div.className = "dl-item";
  div.id = `task-${taskId}`;
  div.innerHTML = `
    <div class="dl-header">
      <span class="dl-title" id="title-${taskId}">${escHtml(label)}</span>
      <span class="dl-status downloading" id="status-${taskId}">Starting…</span>
    </div>
    <div class="progress-bar-wrap">
      <div class="progress-bar" id="bar-${taskId}" style="width:0%"></div>
    </div>
    <div class="dl-meta">
      <span id="speed-${taskId}"></span>
      <span id="pct-${taskId}">0%</span>
    </div>`;
  container.prepend(div);
}

function updateDownloadItem(taskId, task) {
  const titleEl = document.getElementById(`title-${taskId}`);
  const statusEl = document.getElementById(`status-${taskId}`);
  const barEl = document.getElementById(`bar-${taskId}`);
  const speedEl = document.getElementById(`speed-${taskId}`);
  const pctEl = document.getElementById(`pct-${taskId}`);
  if (!statusEl) return;

  const idx = Number(task.playlist_index || 0);
  const count = Number(task.playlist_count || 0);
  const serialPrefix = idx > 0 ? `${idx}. ` : "";

  if (titleEl && task.current_title) {
    const numberedTitle = `${serialPrefix}${task.current_title}`;
    titleEl.textContent = numberedTitle;
    titleEl.title = numberedTitle;
  }

  const pct = task.percent || 0;
  barEl.style.width = pct + "%";
  pctEl.textContent = pct.toFixed(1) + "%";
  speedEl.textContent = task.speed || "";

  statusEl.className = `dl-status ${task.status}`;
  const serial = idx > 0 && count > 0 ? ` ${idx}. (${idx}/${count})` : "";

  if (task.status === "downloading") statusEl.textContent = `Downloading${serial}`;
  else if (task.status === "processing") statusEl.textContent = `Processing…${serial}`;
  else if (task.status === "done") {
    statusEl.textContent = "✓ Done";
    barEl.classList.add("done");
    loadFiles();
  }
  else if (task.status === "error") {
    statusEl.textContent = "✗ Error";
    showToast(`Download error: ${task.error || "unknown"}`, "error");
  }
}

/* ─── Poll Progress ──────────────────────────────────────── */
function pollProgress(taskId) {
  if (activePolls[taskId]) clearInterval(activePolls[taskId]);
  activePolls[taskId] = setInterval(async () => {
    try {
      const res = await fetch(`/progress/${encodeURIComponent(taskId)}`);
      const task = await res.json();
      updateDownloadItem(taskId, task);
      if (task.status === "done" || task.status === "error") {
        clearInterval(activePolls[taskId]);
        delete activePolls[taskId];
      }
    } catch (_) { /* ignore transient errors */ }
  }, 600);
}

/* ─── File Library ───────────────────────────────────────── */
async function loadFiles() {
  try {
    const res = await fetch("/files");
    const files = await res.json();
    renderFiles(files);
  } catch (e) {
    // silently ignore
  }
}

function renderFiles(files) {
  const box = document.getElementById("fileList");
  if (!files.length) {
    box.innerHTML = `<p class="empty-msg">No files yet.</p>`;
    return;
  }
  const html = files.map(f => {
    const isAudio = /\.(mp3|m4a|aac|ogg|flac|wav)$/i.test(f.name);
    const icon = isAudio ? "🎵" : "🎬";
    const safeEnc = encodeURIComponent(f.name);
    return `
      <div class="file-item">
        <span class="file-icon">${icon}</span>
        <span class="file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
        <span class="file-size">${escHtml(f.size_str)}</span>
        <div class="file-actions">
          <a href="/download_file/${safeEnc}" download>
            <button class="icon-btn" title="Download">⬇</button>
          </a>
          <button class="icon-btn delete" title="Delete" onclick="deleteFile(${JSON.stringify(f.name)})">🗑</button>
        </div>
      </div>`;
  }).join("");
  box.innerHTML = `<div class="file-list">${html}</div>`;
}

async function deleteFile(filename) {
  if (!confirm(`Delete "${filename}"?`)) return;
  try {
    const res = await fetch("/delete_file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.success) { showToast("File deleted", "success"); loadFiles(); }
    else showToast(data.error || "Delete failed", "error");
  } catch (e) {
    showToast("Network error", "error");
  }
}

/* ─── Utility ────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showElements(...ids) { ids.forEach(id => document.getElementById(id)?.classList.remove("hidden")); }
function hideElements(...ids) { ids.forEach(id => document.getElementById(id)?.classList.add("hidden")); }

function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  btn.disabled = loading;
  btn.querySelector(".btn-text").textContent = loading ? "Fetching…" : "Fetch";
  btn.querySelector(".btn-loader").classList.toggle("hidden", !loading);
}

/* ─── Focus Mode Helpers ────────────────────────────────── */
function formatClock(totalSeconds) {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function focusEls() {
  return {
    timer: document.getElementById("focusTimer"),
    phase: document.getElementById("focusPhase"),
    status: document.getElementById("focusStatus"),
    sessions: document.getElementById("focusSessions"),
    cycle: document.getElementById("focusCycle"),
    startBtn: document.getElementById("focusStartBtn"),
    resetBtn: document.getElementById("focusResetBtn"),
    soundMode: document.getElementById("soundMode"),
    soundToggle: document.getElementById("soundToggleBtn"),
    autoSound: document.getElementById("autoSound"),
    volume: document.getElementById("soundVolume"),
  };
}

function updateFocusUI() {
  const els = focusEls();
  if (!els.timer) return;

  els.timer.textContent = formatClock(focusState.remaining);
  els.sessions.textContent = String(focusState.sessionsToday);
  els.cycle.textContent = focusState.phase === "focus" ? "Work" : "Break";
  els.phase.textContent = focusState.phase === "focus" ? "Focus" : "Break";
  els.phase.classList.toggle("break", focusState.phase === "break");
  els.startBtn.textContent = focusState.running ? "Pause" : "Start";
  els.soundToggle.textContent = focusState.audioEnabled ? "Pause Sound" : "Play Sound";

  if (focusState.phase === "focus") {
    els.status.textContent = focusState.running
      ? "Focus session in progress. Stay on one task."
      : "Ready for a 25-minute Pomodoro.";
  } else {
    els.status.textContent = focusState.running
      ? "Short break running. Breathe and reset."
      : "Break is paused.";
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadFocusSessions() {
  try {
    const key = "youme_focus_sessions";
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    focusState.sessionsToday = Number(parsed[todayKey()] || 0);
  } catch (_) {
    focusState.sessionsToday = 0;
  }
}

function saveFocusSessions() {
  try {
    const key = "youme_focus_sessions";
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[todayKey()] = focusState.sessionsToday;
    localStorage.setItem(key, JSON.stringify(parsed));
  } catch (_) {
    // ignore storage errors
  }
}

function clearTimerLoop() {
  if (focusState.intervalId) {
    clearInterval(focusState.intervalId);
    focusState.intervalId = null;
  }
}

function startTimerLoop() {
  clearTimerLoop();
  focusState.intervalId = setInterval(() => {
    if (!focusState.running) return;
    focusState.remaining -= 1;
    if (focusState.remaining <= 0) {
      onFocusPhaseComplete();
    }
    updateFocusUI();
  }, 1000);
}

function onFocusPhaseComplete() {
  if (focusState.phase === "focus") {
    focusState.sessionsToday += 1;
    saveFocusSessions();
    focusState.phase = "break";
    focusState.remaining = POMODORO_BREAK_SECONDS;
    fadeOutSound(1.2);
    showToast("Focus session complete. Break started.", "success");
  } else {
    focusState.phase = "focus";
    focusState.remaining = POMODORO_FOCUS_SECONDS;
    const els = focusEls();
    if (els.autoSound.checked) {
      playAmbient(els.soundMode.value);
    }
    showToast("Break complete. Next focus session started.", "success");
  }
}

function toggleFocusTimer() {
  focusState.running = !focusState.running;
  const els = focusEls();

  if (focusState.running) {
    if (focusState.phase === "focus" && els.autoSound.checked) {
      playAmbient(els.soundMode.value);
    }
    if (focusState.phase === "break") {
      fadeOutSound(1.1);
    }
  }
  updateFocusUI();
}

function resetFocusTimer() {
  focusState.phase = "focus";
  focusState.running = false;
  focusState.remaining = POMODORO_FOCUS_SECONDS;
  fadeOutSound(0.9);
  updateFocusUI();
}

/* ─── Ambient Audio Engine ──────────────────────────────── */
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      showToast("Web Audio API is not supported in this browser", "error");
      return false;
    }
    audioCtx = new AC();
    focusMasterGain = audioCtx.createGain();
    focusMasterGain.gain.value = 0;
    focusMasterGain.connect(audioCtx.destination);
  }

  const vol = Number((focusEls().volume?.value || 35) / 100);
  const now = audioCtx.currentTime;
  focusMasterGain.gain.cancelScheduledValues(now);
  focusMasterGain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), now + 0.2);

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return true;
}

function createWhiteNoiseBuffer(ctx) {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function stopCurrentAmbient() {
  if (lofiBeatTimer) {
    clearInterval(lofiBeatTimer);
    lofiBeatTimer = null;
  }

  currentSoundNodes.forEach(node => {
    try {
      if (node.stop) node.stop();
      if (node.disconnect) node.disconnect();
    } catch (_) {
      // no-op
    }
  });
  currentSoundNodes = [];
  focusState.audioEnabled = false;
}

function fadeOutSound(seconds = 1) {
  if (!audioCtx || !focusMasterGain) return;
  const now = audioCtx.currentTime;
  focusMasterGain.gain.cancelScheduledValues(now);
  focusMasterGain.gain.setValueAtTime(focusMasterGain.gain.value, now);
  focusMasterGain.gain.linearRampToValueAtTime(0.0001, now + seconds);
  setTimeout(() => {
    stopCurrentAmbient();
    updateFocusUI();
  }, Math.ceil(seconds * 1000));
}

function createNoiseSource() {
  if (!whiteNoiseBuffer) {
    whiteNoiseBuffer = createWhiteNoiseBuffer(audioCtx);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = whiteNoiseBuffer;
  src.loop = true;
  return src;
}

function addNode(node) {
  currentSoundNodes.push(node);
  return node;
}

function playLofi() {
  const pad = addNode(audioCtx.createOscillator());
  const padFilter = addNode(audioCtx.createBiquadFilter());
  const padGain = addNode(audioCtx.createGain());

  pad.type = "triangle";
  pad.frequency.value = 110;
  padFilter.type = "lowpass";
  padFilter.frequency.value = 900;
  padGain.gain.value = 0.18;

  pad.connect(padFilter);
  padFilter.connect(padGain);
  padGain.connect(focusMasterGain);
  pad.start();

  const hatNoise = addNode(createNoiseSource());
  const hatFilter = addNode(audioCtx.createBiquadFilter());
  const hatGain = addNode(audioCtx.createGain());
  hatFilter.type = "highpass";
  hatFilter.frequency.value = 3500;
  hatGain.gain.value = 0;
  hatNoise.connect(hatFilter);
  hatFilter.connect(hatGain);
  hatGain.connect(focusMasterGain);
  hatNoise.start();

  const bpm = 74;
  const beatMs = Math.round((60 / bpm) * 1000);
  lofiBeatTimer = setInterval(() => {
    if (!audioCtx || !hatGain) return;
    const t = audioCtx.currentTime;
    hatGain.gain.cancelScheduledValues(t);
    hatGain.gain.setValueAtTime(0.02, t);
    hatGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  }, beatMs);
}

function playRain() {
  const rain = addNode(createNoiseSource());
  const rainFilter = addNode(audioCtx.createBiquadFilter());
  const rainGain = addNode(audioCtx.createGain());
  rainFilter.type = "lowpass";
  rainFilter.frequency.value = 1600;
  rainGain.gain.value = 0.28;

  rain.connect(rainFilter);
  rainFilter.connect(rainGain);
  rainGain.connect(focusMasterGain);
  rain.start();
}

function playCafe() {
  const cafeNoise = addNode(createNoiseSource());
  const band = addNode(audioCtx.createBiquadFilter());
  const cafeGain = addNode(audioCtx.createGain());

  band.type = "bandpass";
  band.frequency.value = 950;
  band.Q.value = 0.7;
  cafeGain.gain.value = 0.2;

  cafeNoise.connect(band);
  band.connect(cafeGain);
  cafeGain.connect(focusMasterGain);
  cafeNoise.start();

  const cupTone = addNode(audioCtx.createOscillator());
  const cupGain = addNode(audioCtx.createGain());
  cupTone.type = "sine";
  cupTone.frequency.value = 510;
  cupGain.gain.value = 0.04;
  cupTone.connect(cupGain);
  cupGain.connect(focusMasterGain);
  cupTone.start();
}

function playPink() {
  const pinkNoise = addNode(createNoiseSource());
  const low = addNode(audioCtx.createBiquadFilter());
  const gain = addNode(audioCtx.createGain());
  low.type = "lowpass";
  low.frequency.value = 550;
  gain.gain.value = 0.35;

  pinkNoise.connect(low);
  low.connect(gain);
  gain.connect(focusMasterGain);
  pinkNoise.start();
}

function playWhite() {
  const white = addNode(createNoiseSource());
  const gain = addNode(audioCtx.createGain());
  gain.gain.value = 0.24;
  white.connect(gain);
  gain.connect(focusMasterGain);
  white.start();
}

function playBinaural() {
  const left = addNode(audioCtx.createOscillator());
  const right = addNode(audioCtx.createOscillator());
  const split = addNode(audioCtx.createChannelMerger(2));
  const gain = addNode(audioCtx.createGain());

  left.type = "sine";
  right.type = "sine";
  left.frequency.value = 200;
  right.frequency.value = 210;
  gain.gain.value = 0.22;

  left.connect(split, 0, 0);
  right.connect(split, 0, 1);
  split.connect(gain);
  gain.connect(focusMasterGain);

  left.start();
  right.start();
}

function playAmbient(mode) {
  if (!ensureAudio()) return;

  stopCurrentAmbient();
  const now = audioCtx.currentTime;
  focusMasterGain.gain.cancelScheduledValues(now);
  focusMasterGain.gain.setValueAtTime(0.0001, now);

  switch (mode) {
    case "rain":
      playRain();
      break;
    case "cafe":
      playCafe();
      break;
    case "pink":
      playPink();
      break;
    case "white":
      playWhite();
      break;
    case "binaural":
      playBinaural();
      break;
    case "lofi":
    default:
      playLofi();
      break;
  }

  const volume = Number((focusEls().volume?.value || 35) / 100);
  focusMasterGain.gain.linearRampToValueAtTime(Math.max(0.0001, volume), now + 0.7);
  focusState.audioEnabled = true;
  updateFocusUI();
}

function toggleAmbientManual() {
  if (focusState.audioEnabled) {
    fadeOutSound(0.8);
    return;
  }
  const els = focusEls();
  playAmbient(els.soundMode.value);
}

function bindFocusEvents() {
  const els = focusEls();
  if (!els.startBtn) return;

  els.startBtn.addEventListener("click", toggleFocusTimer);
  els.resetBtn.addEventListener("click", resetFocusTimer);
  els.soundToggle.addEventListener("click", toggleAmbientManual);

  els.soundMode.addEventListener("change", () => {
    if (focusState.audioEnabled) {
      playAmbient(els.soundMode.value);
    }
  });

  els.volume.addEventListener("input", () => {
    if (!audioCtx || !focusMasterGain) return;
    const vol = Math.max(0.0001, Number(els.volume.value) / 100);
    const now = audioCtx.currentTime;
    focusMasterGain.gain.cancelScheduledValues(now);
    focusMasterGain.gain.linearRampToValueAtTime(vol, now + 0.1);
  });
}

function initFocusMode() {
  loadFocusSessions();
  startTimerLoop();
  bindFocusEvents();
  updateFocusUI();
}

/* ─── Music Stream Player ───────────────────────────────── */
function streamEls() {
  return {
    mode: document.getElementById("streamMode"),
    toggleBtn: document.getElementById("streamToggleBtn"),
    volume: document.getElementById("streamVolume"),
    status: document.getElementById("streamStatus"),
    audio: document.getElementById("streamAudio"),
  };
}

function updateStreamUI() {
  const els = streamEls();
  if (!els.toggleBtn) return;

  els.toggleBtn.textContent = streamState.playing ? "Pause Stream" : "Play Stream";
  els.status.textContent = streamState.playing ? "Stream is live." : "Stream is stopped.";
  els.status.classList.toggle("live", streamState.playing);
}

function syncStreamSource() {
  const els = streamEls();
  if (!els.audio || !els.mode) return;
  if (els.audio.src !== els.mode.value) {
    els.audio.src = els.mode.value;
  }
}

async function toggleStreamPlayback() {
  const els = streamEls();
  if (!els.audio) return;

  if (streamState.playing) {
    els.audio.pause();
    streamState.playing = false;
    updateStreamUI();
    return;
  }

  try {
    syncStreamSource();
    await els.audio.play();
    streamState.playing = true;
    updateStreamUI();
  } catch (_) {
    streamState.playing = false;
    updateStreamUI();
    showToast("Could not start stream. Try another source.", "error");
  }
}

function initStreamPlayer() {
  const els = streamEls();
  if (!els.audio) return;

  els.audio.volume = Number(els.volume?.value || 40) / 100;
  els.toggleBtn?.addEventListener("click", toggleStreamPlayback);

  els.mode?.addEventListener("change", async () => {
    const wasPlaying = streamState.playing;
    streamState.playing = false;
    els.audio.pause();
    syncStreamSource();
    if (wasPlaying) {
      try {
        await els.audio.play();
        streamState.playing = true;
      } catch (_) {
        streamState.playing = false;
        showToast("Stream switch failed. Try Play again.", "error");
      }
    }
    updateStreamUI();
  });

  els.volume?.addEventListener("input", () => {
    els.audio.volume = Number(els.volume.value) / 100;
  });

  els.audio.addEventListener("pause", () => {
    streamState.playing = false;
    updateStreamUI();
  });

  els.audio.addEventListener("playing", () => {
    streamState.playing = true;
    updateStreamUI();
  });

  els.audio.addEventListener("error", () => {
    streamState.playing = false;
    updateStreamUI();
    showToast("Stream error. Try another stream.", "error");
  });

  syncStreamSource();
  updateStreamUI();
}

function bindUrlEnter() {
  const input = document.getElementById("urlInput");
  if (!input) return;
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") fetchInfo();
  });
}

function initApp() {
  bindUrlEnter();
  loadFiles();
  initFocusMode();
  initStreamPlayer();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
