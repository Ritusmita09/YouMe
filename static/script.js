/* ─── State ──────────────────────────────────────────────── */
let currentType = null;          // 'video' | 'playlist'
let currentUrl = null;
let currentResolutions = [];
let selectedResolution = "best";
let isAudioOnly = false;
let activePolls = {};            // task_id → interval
let browserExtractorClient = null;
let browserExtractorPromise = null;
let trackSeekDragging = false;
let currentTrackMeta = { title: "", sourceUrl: "" };
let libraryLoadedOnce = false;
let currentVisibleSection = null;

const SECTION_ORDER = ["focus", "downloader", "library", "watchlist", "planner", "admin", "settings"];
let adminLoadedOnce = false;

function setActiveNav(name) {
  document.querySelectorAll(".nav-item").forEach(b => {
    b.classList.toggle("active", b.dataset.section === name);
  });
  document.querySelectorAll(".mob-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.section === name);
  });
}

function maybeLoadSectionData(name) {
  if (name === "library" && !libraryLoadedOnce) {
    libraryLoadedOnce = true;
    loadFiles();
  }
  if (name === "admin" && !adminLoadedOnce) {
    adminLoadedOnce = true;
    loadAdminPanel();
  }
}

function initSectionScrollTracking() {
  const main = document.querySelector(".main-content");
  if (!main || typeof IntersectionObserver === "undefined") return;

  const sectionElements = SECTION_ORDER
    .map(name => document.getElementById(`sec-${name}`))
    .filter(Boolean);

  const observer = new IntersectionObserver(entries => {
    // Pick the most visible currently intersecting section.
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (!visible.length) return;

    const id = visible[0].target.id || "";
    const name = id.replace(/^sec-/, "");
    if (!name) return;

    // Avoid re-running updates while staying on the same visible section.
    if (name === currentVisibleSection) return;
    currentVisibleSection = name;

    setActiveNav(name);
    maybeLoadSectionData(name);
  }, {
    root: null,
    threshold: [0.2, 0.45, 0.7],
  });

  sectionElements.forEach(sec => observer.observe(sec));
}

function getSectionScrollOffset() {
  const topbar = document.querySelector(".mobile-topbar");
  const topbarVisible = !!topbar && window.getComputedStyle(topbar).display !== "none";
  const topbarHeight = topbarVisible ? topbar.getBoundingClientRect().height : 0;
  const extraGap = topbarVisible ? 56 : 20;
  return Math.ceil(topbarHeight + extraGap);
}

/* ─── Navigation ────────────────────────────────────────── */
function showSection(name) {
  const sec = document.getElementById(`sec-${name}`);
  if (!sec) return;

  setActiveNav(name);
  maybeLoadSectionData(name);

  const anchor = sec.querySelector(".sec-header") || sec;
  const targetY = window.pageYOffset + anchor.getBoundingClientRect().top - getSectionScrollOffset();
  window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });

  // Animate the active section when GSAP is available.
  animateSectionEntrance(name);
}

function hasGsap() {
  return typeof window !== "undefined" && !!window.gsap && typeof window.gsap.fromTo === "function";
}

function animateSectionEntrance(name) {
  if (!hasGsap()) return;
  const sec = document.getElementById(`sec-${name}`);
  if (!sec) return;

  const gsap = window.gsap;
  const headerEls = sec.querySelectorAll(".sec-header");
  const blockEls = Array.from(sec.querySelectorAll(".card, .lib-card, .wl-pl-card")).filter(el => !el.classList.contains("hidden"));

  if (headerEls.length) {
    gsap.fromTo(headerEls, { autoAlpha: 0, y: 10 }, {
      autoAlpha: 1,
      y: 0,
      duration: 0.28,
      ease: "power2.out",
      overwrite: "auto",
    });
  }

  if (blockEls.length) {
    gsap.fromTo(blockEls, { autoAlpha: 0, y: 14, scale: 0.99 }, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.35,
      ease: "power2.out",
      stagger: 0.035,
      overwrite: "auto",
    });
  }

  if (name === "watchlist") {
    animateWatchlistUI();
  }
}

function animateWatchlistUI() {
  if (!hasGsap()) return;
  const grid = document.getElementById("watchlistGrid");
  if (!grid) return;

  const gsap = window.gsap;
  const cards = grid.querySelectorAll(":scope > .lib-card, :scope > .wl-pl-card");
  if (cards.length) {
    gsap.fromTo(cards, { autoAlpha: 0, y: 10 }, {
      autoAlpha: 1,
      y: 0,
      duration: 0.28,
      ease: "power2.out",
      stagger: 0.03,
      overwrite: "auto",
    });
  }

  const rows = grid.querySelectorAll(".wl-entries:not(.hidden) .wl-entry-row");
  if (rows.length) {
    gsap.fromTo(rows, { autoAlpha: 0, x: -8 }, {
      autoAlpha: 1,
      x: 0,
      duration: 0.22,
      ease: "power2.out",
      stagger: 0.015,
      overwrite: "auto",
    });
  }

  const fills = grid.querySelectorAll(".wl-progress-fill[data-target]");
  fills.forEach(fill => {
    const target = Math.max(0, Math.min(100, Number(fill.dataset.target || 0)));
    gsap.fromTo(fill, { width: "0%" }, {
      width: `${target}%`,
      duration: 0.45,
      ease: "power2.out",
      overwrite: "auto",
    });
  });
}

/* ─── Theme ──────────────────────────────────────────────── */
function setTheme(name) {
  const validThemes = ["batman", "hello-kitty", "spiderman", "ironman"];
  if (!validThemes.includes(name)) return;

  document.documentElement.setAttribute("data-theme", name);

  // Highlight correct option in Settings
  document.querySelectorAll(".theme-opt").forEach(el => {
    el.classList.toggle("active", el.dataset.t === name);
  });

  try { localStorage.setItem("youme_theme", name); } catch (_) {}

  // Re-apply wallpaper for the selected theme so each theme can keep its own default/custom image.
  loadCustomBackground();
  syncKittyCursorWithTheme();
}

function loadSavedTheme() {
  try {
    const saved = localStorage.getItem("youme_theme");
    if (saved) setTheme(saved);
  } catch (_) {}
}

const kittyCursorState = {
  initialized: false,
  enabled: false,
  tickerBound: false,
  observer: null,
  gsap: null,
  cursorEl: null,
  dotEl: null,
  particlesEl: null,
  mouse: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  pos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  rotation: 0,
  lastHeartAt: 0,
  interactiveEls: [],
};

function canUseKittyCursor() {
  if (!hasGsap()) return false;
  if (!window.matchMedia) return false;
  if (!window.matchMedia("(pointer:fine)").matches) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return true;
}

function isHelloKittyTheme() {
  return document.documentElement.getAttribute("data-theme") === "hello-kitty";
}

function kittyCursorTick() {
  const state = kittyCursorState;
  if (!state.enabled || !state.gsap) return;

  const dx = state.mouse.x - state.pos.x;
  const dy = state.mouse.y - state.pos.y;
  state.pos.x += dx * 0.14;
  state.pos.y += dy * 0.14;
  state.rotation = Math.max(-16, Math.min(16, dx * 0.12));

  state.gsap.set(state.cursorEl, { x: state.pos.x, y: state.pos.y, rotation: state.rotation });
  state.gsap.set(state.dotEl, { x: state.mouse.x, y: state.mouse.y });
}

function createKittyHeart(x, y, burst = false) {
  const state = kittyCursorState;
  if (!state.enabled || !state.gsap || !state.particlesEl) return;

  const heart = document.createElement("div");
  heart.className = "heart";
  const palette = ["#ff79bf", "#ff8fcb", "#ffa7d8", "#ff62b2"];
  heart.style.setProperty("--heart-color", palette[Math.floor(Math.random() * palette.length)]);
  state.particlesEl.appendChild(heart);

  const spread = burst ? 80 : 30;
  const rise = burst ? 130 : 75;
  const drift = (Math.random() * spread) - spread / 2;
  const duration = burst ? 0.95 : 0.72;
  const rot = 45 + (Math.random() * 48 - 24);

  state.gsap.set(heart, {
    x,
    y,
    scale: burst ? 0.9 : 0.7,
    rotation: rot,
    opacity: 0.95,
  });

  state.gsap.to(heart, {
    y: y - rise,
    x: x + drift,
    opacity: 0,
    scale: burst ? 1.7 : 1.25,
    duration,
    ease: "power2.out",
    onComplete: () => heart.remove(),
  });
}

function setKittyCursorEnabled(enabled) {
  const state = kittyCursorState;
  if (!state.initialized || !state.gsap) return;
  if (state.enabled === enabled) return;

  state.enabled = enabled;

  if (enabled) {
    document.documentElement.classList.add("kitty-cursor-enabled");
    state.pos.x = state.mouse.x;
    state.pos.y = state.mouse.y;
    state.gsap.set(state.cursorEl, { x: state.pos.x, y: state.pos.y, scale: 1 });
    state.gsap.set(state.dotEl, { x: state.mouse.x, y: state.mouse.y, scale: 1 });
    if (!state.tickerBound) {
      state.gsap.ticker.add(kittyCursorTick);
      state.tickerBound = true;
    }
    return;
  }

  document.documentElement.classList.remove("kitty-cursor-enabled");
  if (state.tickerBound) {
    state.gsap.ticker.remove(kittyCursorTick);
    state.tickerBound = false;
  }
  state.gsap.set(state.cursorEl, { clearProps: "x,y,scale" });
  state.gsap.set(state.dotEl, { clearProps: "x,y,scale" });
  state.interactiveEls.forEach((el) => state.gsap.to(el, { x: 0, y: 0, duration: 0.22, overwrite: "auto" }));
  if (state.particlesEl) state.particlesEl.innerHTML = "";
}

function syncKittyCursorWithTheme() {
  setKittyCursorEnabled(isHelloKittyTheme() && canUseKittyCursor());
}

function bindKittyCursorTargets() {
  const state = kittyCursorState;
  const selector = "a, button, .btn, .nav-item, .mob-tab, .theme-opt, [role='button'], .lib-card, .wl-pl-card";
  state.interactiveEls = Array.from(new Set(Array.from(document.querySelectorAll(selector))));

  state.interactiveEls.forEach((el) => {
    el.addEventListener("mouseenter", () => {
      if (!state.enabled || !state.gsap) return;
      state.gsap.to(state.cursorEl, {
        scale: 1.45,
        duration: 0.22,
        ease: "power2.out",
        overwrite: "auto",
      });
    });

    el.addEventListener("mouseleave", () => {
      if (!state.gsap) return;
      state.gsap.to(state.cursorEl, {
        scale: 1,
        duration: 0.2,
        ease: "power2.out",
        overwrite: "auto",
      });
      state.gsap.to(el, { x: 0, y: 0, duration: 0.22, ease: "power2.out", overwrite: "auto" });
    });

    el.addEventListener("mousemove", (e) => {
      if (!state.enabled || !state.gsap) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      state.gsap.to(el, {
        x: x * 0.11,
        y: y * 0.11,
        duration: 0.2,
        ease: "power2.out",
        overwrite: "auto",
      });
    });
  });
}

function initHelloKittyCursor() {
  const state = kittyCursorState;
  if (state.initialized) {
    syncKittyCursorWithTheme();
    return;
  }

  state.cursorEl = document.querySelector(".cursor");
  state.dotEl = document.querySelector(".cursor-dot");
  state.particlesEl = document.querySelector(".particles");
  if (!state.cursorEl || !state.dotEl || !state.particlesEl) return;

  if (!hasGsap()) return;
  state.gsap = window.gsap;

  window.addEventListener("mousemove", (e) => {
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;

    if (!state.enabled) return;

    const now = performance.now();
    const enoughTimePassed = now - state.lastHeartAt > 52;
    if (enoughTimePassed && Math.random() > 0.84) {
      state.lastHeartAt = now;
      createKittyHeart(e.clientX, e.clientY, false);
    }
  }, { passive: true });

  window.addEventListener("click", (e) => {
    if (!state.enabled || !state.gsap) return;
    for (let i = 0; i < 6; i += 1) createKittyHeart(e.clientX, e.clientY, true);

    state.gsap.fromTo(state.cursorEl,
      { scale: 1 },
      {
        scale: 0.82,
        yoyo: true,
        repeat: 1,
        duration: 0.12,
        ease: "power2.out",
      },
    );
  }, { passive: true });

  bindKittyCursorTargets();

  if (window.MutationObserver) {
    state.observer = new MutationObserver(() => syncKittyCursorWithTheme());
    state.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  state.initialized = true;
  syncKittyCursorWithTheme();
}

/* ─── Focus Mode State ──────────────────────────────────── */
const POMODORO_MODES = {
  "25-5": { focus: 25 * 60, brk: 5 * 60, label: "25 / 5" },
  "50-10": { focus: 50 * 60, brk: 10 * 60, label: "50 / 10" },
};

let focusState = {
  phase: "focus", // focus | break
  running: false,
  mode: "25-5",
  focusSeconds: POMODORO_MODES["25-5"].focus,
  breakSeconds: POMODORO_MODES["25-5"].brk,
  remaining: POMODORO_MODES["25-5"].focus,
  sessionsToday: 0,
  intervalId: null,
  audioEnabled: false,
  audioSource: null, // ambient | track
};

let audioCtx = null;
let focusMasterGain = null;
let currentSoundNodes = [];
let lofiBeatTimer = null;
let whiteNoiseBuffer = null;
let focusTrackCache = {};

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

function extractYouTubeVideoId(input) {
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "").trim() || null;
    }
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("music.youtube.com")) {
      const vid = parsed.searchParams.get("v");
      if (vid) return vid;
      const parts = parsed.pathname.split("/").filter(Boolean);
      const shortType = parts[0];
      if ((shortType === "shorts" || shortType === "embed") && parts[1]) {
        return parts[1];
      }
    }
  } catch (_) {
    // ignore parser errors and try regex fallback
  }

  const m = String(input).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function formatPlayerTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const whole = Math.floor(value);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

async function getBrowserExtractorClient() {
  if (browserExtractorClient) return browserExtractorClient;
  if (!browserExtractorPromise) {
    browserExtractorPromise = (async () => {
      const mod = await import("https://esm.sh/youtubei.js@10.5.0?bundle");
      const Innertube = mod.Innertube || mod.default?.Innertube || mod.default;
      if (!Innertube || typeof Innertube.create !== "function") {
        throw new Error("Could not initialize browser extractor");
      }
      browserExtractorClient = await Innertube.create({
        generate_session_locally: true,
        fetch: window.fetch.bind(window),
      });
      return browserExtractorClient;
    })();
  }
  return browserExtractorPromise;
}

function getAudioCandidates(streamingData) {
  const adaptive = streamingData?.adaptive_formats || streamingData?.adaptiveFormats || [];
  const formats = streamingData?.formats || [];
  const merged = [...adaptive, ...formats];

  return merged
    .filter(f => {
      const mime = String(f.mime_type || f.mimeType || "");
      return mime.includes("audio/");
    })
    .map(f => {
      const bitrate = Number(f.bitrate || f.audio_bitrate || f.audioBitrate || 0);
      const url = f.url || f.deciphered_url || f.decipheredUrl || "";
      return { bitrate, url };
    })
    .filter(f => !!f.url);
}

// Resolve track: pre-warm server cache + return proxy URL, fallback to browser extractor
async function resolveTrackStream(trackUrl) {
  if (focusTrackCache[trackUrl]) {
    return { streamUrl: focusTrackCache[trackUrl], title: currentTrackMeta.title || "Track" };
  }
  try {
    // Call music_stream_url to pre-warm the server-side stream cache and get title.
    // The audio src will point to /music_proxy so the browser never hits YouTube CDN directly.
    const resp = await fetch("/music_stream_url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trackUrl }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (!data.error) {
        const proxyUrl = `/music_proxy?url=${encodeURIComponent(trackUrl)}`;
        focusTrackCache[trackUrl] = proxyUrl;
        return { streamUrl: proxyUrl, title: data.title || currentTrackMeta.title || "Track" };
      }
    }
  } catch (_) {
    // server unavailable, fall through to browser extractor
  }
  return resolveTrackStreamInBrowser(trackUrl);
}

async function resolveTrackStreamInBrowser(trackUrl) {
  if (focusTrackCache[trackUrl]) {
    return {
      streamUrl: focusTrackCache[trackUrl],
      title: currentTrackMeta.title || "Track",
    };
  }

  const videoId = extractYouTubeVideoId(trackUrl);
  if (!videoId) {
    throw new Error("Invalid YouTube URL");
  }

  const client = await getBrowserExtractorClient();
  const info = await client.getBasicInfo(videoId);
  const streamingData =
    info?.streaming_data ||
    info?.streamingData ||
    info?.basic_info?.streaming_data ||
    info?.basic_info?.streamingData;

  const candidates = getAudioCandidates(streamingData).sort((a, b) => b.bitrate - a.bitrate);
  if (!candidates.length) {
    throw new Error("No playable audio stream found for this track");
  }

  const best = candidates[0];
  focusTrackCache[trackUrl] = best.url;
  const resolvedTitle = info?.basic_info?.title || info?.video_details?.title || "Track";
  return { streamUrl: best.url, title: resolvedTitle };
}

function updateTrackPlayerUI() {
  const els = focusEls();
  if (!els.trackAudio || !els.trackPlayer) return;

  const hasTrack = !!els.trackAudio.src;
  els.trackPlayer.hidden = !hasTrack;
  if (!hasTrack) {
    if (els.trackCurrent) els.trackCurrent.textContent = "0:00";
    if (els.trackDuration) els.trackDuration.textContent = "0:00";
    if (els.trackSeek) els.trackSeek.value = "0";
    if (els.trackToggle) els.trackToggle.textContent = "▶";
    return;
  }

  const duration = Number.isFinite(els.trackAudio.duration) ? els.trackAudio.duration : 0;
  const current = Number.isFinite(els.trackAudio.currentTime) ? els.trackAudio.currentTime : 0;
  const ratio = duration > 0 ? (current / duration) * 100 : 0;

  if (els.trackCurrent) els.trackCurrent.textContent = formatPlayerTime(current);
  if (els.trackDuration) els.trackDuration.textContent = formatPlayerTime(duration);
  if (els.trackSeek && !trackSeekDragging) els.trackSeek.value = String(ratio);
  if (els.trackToggle) els.trackToggle.textContent = els.trackAudio.paused ? "▶" : "⏸";
}

function setTrackTitleLabel(label) {
  const titleEl = document.getElementById("focusTrackTitle");
  if (!titleEl) return;
  const clean = (label || "Track").replace(/^⭐\s*/, "").replace(/^🎵\s*/, "").trim();
  titleEl.textContent = clean || "Track";
}

async function toggleTrackPlayback() {
  const els = focusEls();
  if (!els.trackAudio || !els.trackAudio.src) return;
  if (els.trackAudio.paused) {
    await els.trackAudio.play();
  } else {
    els.trackAudio.pause();
  }
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
    box.innerHTML = `<p class="empty-msg">No files yet. Download something!</p>`;
    return;
  }
  const html = files.map(f => {
    const isAudio = /\.(mp3|m4a|aac|ogg|flac|wav)$/i.test(f.name);
    const icon = isAudio ? "🎵" : "🎬";
    const safeEnc = encodeURIComponent(f.name);
    const cardClass = `lib-card${isAudio ? " audio" : ""}`;
    return `
      <div class="${cardClass}">
        <div class="lib-thumb" title="${escHtml(f.name)}">${icon}</div>
        <div class="lib-info">
          <div class="lib-name" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
          <div class="lib-size">${escHtml(f.size_str)}</div>
          <div class="lib-actions">
            <a class="lib-btn" href="/download_file/${safeEnc}" download title="Download">⬇ Save</a>
            <button class="lib-btn del" title="Delete" onclick="deleteFile(${JSON.stringify(f.name)})">🗑 Del</button>
          </div>
        </div>
      </div>`;
  }).join("");
  box.innerHTML = html;
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
    audioSelect: document.getElementById("focusAudioSelect"),
    soundToggle: document.getElementById("soundToggleBtn"),
    autoSound: document.getElementById("autoSound"),
    volume: document.getElementById("soundVolume"),
    modeSelect: document.getElementById("pomodoroMode"),
    musicQuery: document.getElementById("focusMusicQuery"),
    musicSearchBtn: document.getElementById("focusMusicSearchBtn"),
    musicDownloadBtn: document.getElementById("focusMusicDownloadBtn"),
    trackAudio: document.getElementById("focusTrackAudio"),
    trackPlayer: document.getElementById("focusTrackPlayer"),
    trackToggle: document.getElementById("focusTrackToggleBtn"),
    trackSeek: document.getElementById("focusTrackSeek"),
    trackCurrent: document.getElementById("focusTrackCurrent"),
    trackDuration: document.getElementById("focusTrackDuration"),
  };
}

const RING_CIRCUMFERENCE = 527.8; // 2π × r=84

function updateTimerRing() {
  const ring = document.getElementById("timerRing");
  if (!ring) return;
  const total = focusState.phase === "focus" ? focusState.focusSeconds : focusState.breakSeconds;
  const progress = total > 0 ? focusState.remaining / total : 1;
  ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
}

function updateFocusUI() {
  const els = focusEls();
  if (!els.timer) return;

  els.timer.textContent = formatClock(focusState.remaining);
  els.sessions.textContent = String(focusState.sessionsToday);
  els.cycle.textContent = focusState.phase === "focus" ? "Work" : "Break";
  // Update the second cycle label in session-row
  const cycleLabel = document.getElementById("focusCycleLabel");
  if (cycleLabel) cycleLabel.textContent = focusState.phase === "focus" ? "Work" : "Break";

  els.phase.textContent = focusState.phase === "focus" ? "Focus" : "Break";
  els.phase.classList.toggle("break", focusState.phase === "break");
  els.startBtn.textContent = focusState.running ? "Pause" : "Start";

  // Update sound toggle button label
  if (els.soundToggle) {
    els.soundToggle.textContent = focusState.audioEnabled ? "⏸" : "▶";
  }

  if (els.modeSelect) {
    els.modeSelect.value = focusState.mode;
  }

  if (focusState.phase === "focus") {
    els.status.textContent = focusState.running
      ? "Focus session in progress. Stay on one task."
      : `Ready for a ${POMODORO_MODES[focusState.mode].label} Pomodoro.`;
  } else {
    els.status.textContent = focusState.running
      ? "Short break running. Breathe and reset."
      : "Break is paused.";
  }

  updateTimerRing();
}

function setPomodoroMode(mode) {
  if (!POMODORO_MODES[mode]) return;
  focusState.mode = mode;
  focusState.focusSeconds = POMODORO_MODES[mode].focus;
  focusState.breakSeconds = POMODORO_MODES[mode].brk;

  if (!focusState.running) {
    focusState.phase = "focus";
    focusState.remaining = focusState.focusSeconds;
  }
  updateFocusUI();
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
    focusState.remaining = focusState.breakSeconds;
    stopFocusAudio(1.2);
    showToast("Focus session complete. Break started.", "success");
  } else {
    focusState.phase = "focus";
    focusState.remaining = focusState.focusSeconds;
    const els = focusEls();
    if (els.autoSound.checked) {
      playSelectedFocusAudio();
    }
    showToast("Break complete. Next focus session started.", "success");
  }
}

function toggleFocusTimer() {
  focusState.running = !focusState.running;
  const els = focusEls();

  if (focusState.running) {
    if (focusState.phase === "focus" && els.autoSound?.checked) {
      playSelectedFocusAudio();
    }
    if (focusState.phase === "break") {
      stopFocusAudio(1.1);
    }
  }
  updateFocusUI();
}

function resetFocusTimer() {
  focusState.phase = "focus";
  focusState.running = false;
  focusState.remaining = focusState.focusSeconds;
  stopFocusAudio(0.9);
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
  if (focusState.audioSource === "ambient") {
    focusState.audioEnabled = false;
    focusState.audioSource = null;
  }
}

function fadeOutAmbient(seconds = 1) {
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
  focusState.audioSource = "ambient";
  updateFocusUI();
}

function getSelectedFocusAudio() {
  const value = focusEls().audioSelect?.value || "ambient:lofi";
  if (value.startsWith("ambient:")) {
    return { type: "ambient", mode: value.split(":")[1] || "lofi" };
  }
  if (value.startsWith("track:")) {
    return { type: "track", url: value.slice("track:".length) };
  }
  return { type: "ambient", mode: "lofi" };
}

function stopFocusTrack() {
  const els = focusEls();
  if (!els.trackAudio) return;
  try {
    els.trackAudio.pause();
  } catch (_) {
    // ignore
  }
}

function stopFocusAudio(seconds = 0.8) {
  if (focusState.audioSource === "track") {
    stopFocusTrack();
    focusState.audioEnabled = false;
    focusState.audioSource = null;
    updateFocusUI();
    return;
  }
  if (focusState.audioSource === "ambient") {
    fadeOutAmbient(seconds);
  }
}

async function playFocusTrack(trackUrl) {
  const els = focusEls();
  if (!els.trackAudio || !trackUrl) return;

  stopCurrentAmbient();
  focusState.audioEnabled = false;
  focusState.audioSource = null;

  const selected = Array.from(els.audioSelect?.options || []).find(opt => opt.value === `track:${trackUrl}`);
  currentTrackMeta = {
    title: selected?.textContent || "Track",
    sourceUrl: trackUrl,
  };
  setTrackTitleLabel(currentTrackMeta.title);

  const resolved = await resolveTrackStream(trackUrl);
  if (!els.trackAudio.src || els.trackAudio.src !== resolved.streamUrl) {
    els.trackAudio.src = resolved.streamUrl;
  }
  if (resolved.title) {
    setTrackTitleLabel(resolved.title);
  }

  els.trackAudio.volume = Number(els.volume?.value || 35) / 100;
  els.trackAudio.load();
  await els.trackAudio.play();
  focusState.audioEnabled = true;
  focusState.audioSource = "track";
  if (els.trackPlayer) {
    els.trackPlayer.hidden = false;
  }
  updateTrackPlayerUI();
  updateFocusUI();
}

async function playSelectedFocusAudio() {
  const selected = getSelectedFocusAudio();
  if (selected.type === "ambient") {
    stopFocusTrack();
    const els = focusEls();
    if (els.trackAudio) {
      els.trackAudio.removeAttribute("src");
      els.trackAudio.load();
    }
    if (els.trackPlayer) {
      els.trackPlayer.hidden = true;
    }
    setTrackTitleLabel("No track selected");
    playAmbient(selected.mode);
    return;
  }
  try {
    await playFocusTrack(selected.url);
  } catch (e) {
    showToast(`Track play failed: ${e.message || "unknown"}`, "error");
  }
}

async function toggleFocusAudioManual() {
  if (focusState.audioEnabled) {
    stopFocusAudio(0.8);
    return;
  }
  await playSelectedFocusAudio();
}

async function searchFocusMusic() {
  const els = focusEls();
  const query = (els.musicQuery?.value || "").trim();
  if (!query) {
    showToast("Type a song or lofi query first", "error");
    return;
  }

  els.musicSearchBtn.disabled = true;
  els.musicSearchBtn.textContent = "Searching...";
  try {
    const res = await fetch("/music_search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 12 }),
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, "error");
      return;
    }

    const sel = els.audioSelect;
    const ambientOptions = Array.from(sel.options).filter(o => o.value.startsWith("ambient:"));
    sel.innerHTML = "";
    ambientOptions.forEach(o => sel.appendChild(o));

    (data.tracks || []).forEach(track => {
      if (!track.url) return;
      const opt = document.createElement("option");
      const dur = track.duration ? ` (${formatDuration(track.duration)})` : "";
      opt.value = `track:${track.url}`;
      opt.textContent = `🎵 ${track.title}${dur}`;
      sel.appendChild(opt);
    });

    if (sel.options.length > ambientOptions.length) {
      sel.selectedIndex = ambientOptions.length;
    }
    showToast(`Found ${data.count || 0} tracks`, "success");
    updateLofiButtons();
  } catch (_) {
    showToast("Music search failed", "error");
  } finally {
    els.musicSearchBtn.disabled = false;
    els.musicSearchBtn.textContent = "Search";
  }
}

/* ─── Custom Lofi Logic ─────────────────────────────────── */
let customLofiList = [];

function loadCustomLofi() {
  try {
    const raw = localStorage.getItem("youme_custom_lofi");
    customLofiList = raw ? JSON.parse(raw) : [];
  } catch (_) {
    customLofiList = [];
  }
  renderCustomLofiOptions();
}

function renderCustomLofiOptions() {
  const group = document.getElementById("myCustomLofiGroup");
  if (!group) return;
  group.innerHTML = "";
  customLofiList.forEach(t => {
    const opt = document.createElement("option");
    opt.value = `track:${t.url}`;
    opt.textContent = `⭐ ${t.title}`;
    group.appendChild(opt);
  });
}

function updateLofiButtons() {
  const btnSave = document.getElementById("btnSaveLofi");
  const btnRemove = document.getElementById("btnRemoveLofi");
  if (!btnSave || !btnRemove) return;

  const sel = getSelectedFocusAudio();
  if (sel.type !== "track") {
    btnSave.style.display = "none";
    btnRemove.style.display = "none";
    return;
  }

  const isSaved = customLofiList.some(t => t.url === sel.url);
  if (isSaved) {
    btnSave.style.display = "none";
    btnRemove.style.display = "inline-flex";
  } else {
    btnSave.style.display = "inline-flex";
    btnRemove.style.display = "none";
  }
}

function saveFocusTrack() {
  const selectEl = document.getElementById("focusAudioSelect");
  if (!selectEl) return;
  const opt = selectEl.options[selectEl.selectedIndex];
  const url = opt.value.replace("track:", "");
  let title = opt.textContent.replace("🎵 ", "").trim();
  // Strip duration if present
  title = title.replace(/\s\([\d:]+\)$/, "");

  if (customLofiList.some(t => t.url === url)) return;

  customLofiList.push({ title, url });
  localStorage.setItem("youme_custom_lofi", JSON.stringify(customLofiList));
  renderCustomLofiOptions();
  updateLofiButtons();
  showToast("Track saved to Custom Lofi", "success");
}

function removeFocusTrack() {
  const sel = getSelectedFocusAudio();
  if (sel.type !== "track") return;

  customLofiList = customLofiList.filter(t => t.url !== sel.url);
  localStorage.setItem("youme_custom_lofi", JSON.stringify(customLofiList));
  
  // fallback selection
  const selectEl = document.getElementById("focusAudioSelect");
  selectEl.value = "ambient:lofi";
  
  renderCustomLofiOptions();
  updateLofiButtons();
  showToast("Track removed from saved list", "success");
  if (focusState.audioEnabled) playSelectedFocusAudio();
}

async function downloadSelectedFocusTrack() {
  const selected = getSelectedFocusAudio();
  if (selected.type !== "track") {
    showToast("Select a searched track to download", "error");
    return;
  }

  const res = await fetch("/music_download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: selected.url }),
  });
  const data = await res.json();
  if (data.error) {
    showToast(data.error, "error");
    return;
  }

  showElements("activeCard");
  addDownloadItem(data.task_id, "🎵 Focus Music Download");
  pollProgress(data.task_id);
  showToast("Music download started", "success");
}

function bindFocusEvents() {
  const els = focusEls();
  if (!els.startBtn) return;

  // startBtn, resetBtn, soundToggle, musicSearchBtn, musicDownloadBtn
  // are handled via inline onclick in HTML — only bind non-inline events here.

  els.audioSelect.addEventListener("change", () => {
    updateTrackPlayerUI();
    updateLofiButtons();
    if (focusState.audioEnabled) playSelectedFocusAudio();
  });

  els.musicQuery?.addEventListener("keydown", e => {
    if (e.key === "Enter") searchFocusMusic();
  });

  els.volume?.addEventListener("input", () => {
    const vol = Math.max(0.0001, Number(els.volume.value) / 100);
    if (focusState.audioSource === "track" && els.trackAudio) {
      els.trackAudio.volume = vol;
      return;
    }
    if (!audioCtx || !focusMasterGain) return;
    const now = audioCtx.currentTime;
    focusMasterGain.gain.cancelScheduledValues(now);
    focusMasterGain.gain.linearRampToValueAtTime(vol, now + 0.1);
  });

  els.trackAudio?.addEventListener("pause", () => {
    if (focusState.audioSource === "track") {
      focusState.audioEnabled = false;
      focusState.audioSource = null;
      updateFocusUI();
    }
    updateTrackPlayerUI();
  });

  els.trackAudio?.addEventListener("playing", () => {
    focusState.audioEnabled = true;
    focusState.audioSource = "track";
    updateFocusUI();
    updateTrackPlayerUI();
  });

  els.trackAudio?.addEventListener("timeupdate", () => {
    updateTrackPlayerUI();
  });

  els.trackAudio?.addEventListener("loadedmetadata", () => {
    updateTrackPlayerUI();
  });

  els.trackAudio?.addEventListener("ended", () => {
    updateTrackPlayerUI();
  });

  els.trackSeek?.addEventListener("input", () => {
    trackSeekDragging = true;
    if (!els.trackAudio || !Number.isFinite(els.trackAudio.duration)) return;
    const ratio = Number(els.trackSeek.value) / 100;
    const previewTime = ratio * els.trackAudio.duration;
    if (els.trackCurrent) {
      els.trackCurrent.textContent = formatPlayerTime(previewTime);
    }
  });

  els.trackSeek?.addEventListener("change", () => {
    if (!els.trackAudio || !Number.isFinite(els.trackAudio.duration)) {
      trackSeekDragging = false;
      return;
    }
    const ratio = Number(els.trackSeek.value) / 100;
    els.trackAudio.currentTime = ratio * els.trackAudio.duration;
    trackSeekDragging = false;
    updateTrackPlayerUI();
  });
}

function initFocusMode() {
  setPomodoroMode("25-5");
  loadFocusSessions();
  startTimerLoop();
  bindFocusEvents();
  updateFocusUI();
}

/* ─── Mini Notepad ──────────────────────────────────────── */
function notepadEls() {
  return {
    area: document.getElementById("focusNotepad"),
    clearBtn: document.getElementById("focusNotepadClearBtn"),
  };
}

function initNotepad() {
  const els = notepadEls();
  if (!els.area) return;

  const key = "youme_focus_notepad";
  els.area.value = localStorage.getItem(key) || "";

  els.area.addEventListener("input", () => {
    localStorage.setItem(key, els.area.value);
  });

  els.clearBtn?.addEventListener("click", () => {
    els.area.value = "";
    localStorage.removeItem(key);
    showToast("Notepad cleared", "success");
  });
}

/* Expose clearNotepad for inline onclick */
function clearNotepad() {
  const el = document.getElementById("focusNotepad");
  if (!el) return;
  el.value = "";
  try { localStorage.removeItem("youme_focus_notepad"); } catch (_) {}
  showToast("Notepad cleared", "success");
}

function bindUrlEnter() {
  const input = document.getElementById("urlInput");
  if (!input) return;
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") fetchInfo();
  });
}

function initApp() {
  loadSavedTheme();
  bindUrlEnter();
  initFocusMode();
  initNotepad();
  if (typeof loadCustomLofi === "function") loadCustomLofi();
  loadWatchlist();
  loadPlanner();
  initCustomBackground();
  loadCustomBackground();
  initSectionScrollTracking();
  setActiveNav("focus");
  maybeLoadSectionData("focus");
  initHelloKittyCursor();
  animateSectionEntrance("focus");
}

function formatMemberSince(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function initialsFromName(name, email) {
  const text = (name || "").trim() || (email || "").trim();
  if (!text) return "YM";
  const parts = text.split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "YM";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function renderAdminBadges(badges) {
  const grid = document.getElementById("adminBadgeGrid");
  if (!grid) return;
  if (!Array.isArray(badges) || !badges.length) {
    grid.innerHTML = '<div class="admin-badge">No badges yet.</div>';
    return;
  }

  grid.innerHTML = badges.map(b => `
    <div class="admin-badge ${b.status === "coming-soon" ? "locked" : ""}">
      <div class="admin-badge-top">
        <span class="admin-badge-title">${escHtml(b.title || "Badge")}</span>
        <span class="admin-badge-state">${b.status === "coming-soon" ? "Coming Soon" : "Unlocked"}</span>
      </div>
      <p class="admin-badge-desc">${escHtml(b.description || "")}</p>
    </div>
  `).join("");
}

async function loadAdminPanel() {
  try {
    const res = await fetch("/admin_profile");
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Failed to load admin profile");

    const profile = data.profile || {};
    const stats = data.stats || {};

    const name = profile.name || "User";
    const email = profile.email || "-";
    const avatar = document.getElementById("adminAvatar");
    const nameEl = document.getElementById("adminName");
    const emailEl = document.getElementById("adminEmail");
    const tierEl = document.getElementById("adminTier");
    const memberEl = document.getElementById("adminMemberSince");
    const idEl = document.getElementById("adminUserId");

    if (avatar) avatar.textContent = initialsFromName(name, email);
    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = email;
    if (tierEl) tierEl.textContent = profile.tier || "Free";
    if (memberEl) memberEl.textContent = formatMemberSince(profile.member_since);
    if (idEl) idEl.textContent = profile.id != null ? String(profile.id) : "-";

    const downloadsEl = document.getElementById("adminDownloads");
    const habitsEl = document.getElementById("adminHabits");
    const currentStreakEl = document.getElementById("adminCurrentStreak");
    const bestStreakEl = document.getElementById("adminBestStreak");
    if (downloadsEl) downloadsEl.textContent = String(stats.downloads || 0);
    if (habitsEl) habitsEl.textContent = String(stats.habits_total || 0);
    if (currentStreakEl) currentStreakEl.textContent = String(stats.current_streak || 0);
    if (bestStreakEl) bestStreakEl.textContent = String(stats.best_streak || 0);

    renderAdminBadges(data.badges || []);
  } catch (e) {
    const grid = document.getElementById("adminBadgeGrid");
    if (grid) {
      grid.innerHTML = '<div class="admin-badge">Could not load admin data.</div>';
    }
    showToast(`Admin panel load failed: ${e.message || "unknown"}`, "error");
  }
}

/* ─── Watchlist Logic ──────────────────────────────────── */
let watchlistItems = [];
const wlExpandState = {};  // in-memory expand/collapse per item id

function wlFmt(secs) {
  const s = Number(secs) || 0;
  if (!s) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  if (h > 0) return `${h}h${m > 0 ? " " + m + "m" : ""}`;
  if (m > 0) return `${m}m${sc > 0 ? " " + sc + "s" : ""}`;
  return `${sc}s`;
}

function loadWatchlist() {
  try {
    const raw = localStorage.getItem("youme_watchlist");
    watchlistItems = raw ? JSON.parse(raw) : [];
  } catch (_) {
    watchlistItems = [];
  }
  renderWatchlist();
}

function saveWatchlist() {
  localStorage.setItem("youme_watchlist", JSON.stringify(watchlistItems));
  renderWatchlist();
}

async function addWatchlistItem() {
  const input = document.getElementById("watchlistInput");
  const url = input.value.trim();
  if (!url) { showToast("Please enter a YouTube URL", "error"); return; }

  const tempId = Date.now().toString();
  watchlistItems.push({ id: tempId, url, type: "video", title: "Loading…", thumb: "", done: false, category: "Productive", learned: "" });
  input.value = "";
  renderWatchlist();

  try {
    const res = await fetch("/video_info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const idx = watchlistItems.findIndex(i => i.id === tempId);
    if (idx === -1) return;

    if (data.type === "playlist") {
      watchlistItems[idx] = {
        id: tempId, url, type: "playlist",
        title: data.title,
        thumb: data.thumb || "",
        totalDuration: data.total_duration || 0,
        count: data.count || 0,
        entries: (data.entries || []).map(e => ({ ...e, done: false })),
        category: "Productive",
        learned: "",
      };
    } else {
      watchlistItems[idx] = {
        id: tempId, url, type: "video",
        title: data.title,
        thumb: data.thumb || data.thumbnail || "",
        duration: data.duration || 0,
        done: false,
        category: "Productive",
        learned: "",
      };
    }
    saveWatchlist();
    showToast(`Added: ${watchlistItems[idx].title}`, "success");
  } catch (err) {
    watchlistItems = watchlistItems.filter(i => i.id !== tempId);
    renderWatchlist();
    showToast("Failed: " + err.message, "error");
  }
}

function toggleWatchlistDone(id) {
  const item = watchlistItems.find(i => i.id === id);
  if (item) { item.done = !item.done; saveWatchlist(); }
}

function togglePlaylistEntry(playlistId, entryIdx) {
  const pl = watchlistItems.find(i => i.id === playlistId);
  if (!pl || !pl.entries) return;
  const e = pl.entries[Number(entryIdx)];
  if (e) { e.done = !e.done; saveWatchlist(); }
}

function deleteWatchlistItem(id) {
  watchlistItems = watchlistItems.filter(i => i.id !== id);
  delete wlExpandState[id];
  saveWatchlist();
}

function deletePlaylistEntry(playlistId, entryIdx) {
  const pl = watchlistItems.find(i => i.id === playlistId);
  if (!pl || !pl.entries) return;
  pl.entries.splice(Number(entryIdx), 1);
  pl.count = pl.entries.length;
  pl.totalDuration = pl.entries.reduce((s, e) => s + (Number(e.duration) || 0), 0);
  saveWatchlist();
}

function updateWatchlistCategory(id, val) {
  const item = watchlistItems.find(i => i.id === id);
  if (item) { item.category = val; saveWatchlist(); }
}

function updateWatchlistLearned(id, val) {
  const item = watchlistItems.find(i => i.id === id);
  if (item) { item.learned = val; saveWatchlist(); }
}

function toggleWatchlistExpand(id) {
  wlExpandState[id] = !wlExpandState[id];
  renderWatchlist();
}

function renderWatchlist() {
  const grid = document.getElementById("watchlistGrid");
  if (!grid) return;
  if (!watchlistItems.length) {
    grid.innerHTML = '<p class="empty-msg">No watchlist items yet.</p>';
    return;
  }
  grid.innerHTML = "";
  watchlistItems.forEach(item => {
    grid.appendChild(item.type === "playlist" ? renderWlPlaylistCard(item) : renderWlVideoCard(item));
  });
  animateWatchlistUI();
}

function renderWlVideoCard(item) {
  const div = document.createElement("div");
  div.className = "lib-card wl-video-card";
  const thumbHtml = item.thumb
    ? `<img src="${escHtml(item.thumb)}" class="lib-thumb" alt="" loading="lazy">`
    : `<div class="lib-thumb" style="display:flex;align-items:center;justify-content:center;background:#2a2a2a;color:#888;font-size:2rem;">🎬</div>`;
  const durHtml = item.duration ? `<span class="wl-dur">⏱ ${wlFmt(item.duration)}</span>` : "";
  const cats = ["Productive","Good Habit","Bad Habit","Time Pass","Entertainment"];
  div.innerHTML = `
    ${thumbHtml}
    <div class="lib-info" style="display:flex;flex-direction:column;gap:8px;">
      <h4 class="wl-vtitle${item.done ? " wl-done-title" : ""}">${escHtml(item.title)}</h4>
      ${durHtml}
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="checkbox" ${item.done ? "checked" : ""} onchange="toggleWatchlistDone('${item.id}')" style="cursor:pointer;transform:scale(1.2);">
        <select class="dash-select compact" onchange="updateWatchlistCategory('${item.id}', this.value)" style="flex:1;">
          ${cats.map(c => `<option value="${c}"${item.category === c ? " selected" : ""}>${c}</option>`).join("")}
        </select>
      </div>
      <input type="text" class="dash-input compact" placeholder="What was learned?" value="${escHtml(item.learned || "")}" onchange="updateWatchlistLearned('${item.id}', this.value)" style="margin-top:2px;">
    </div>
    <button class="lib-del-btn" onclick="deleteWatchlistItem('${item.id}')" title="Delete">🗑</button>
  `;
  return div;
}

function renderWlPlaylistCard(item) {
  const div = document.createElement("div");
  div.className = "wl-pl-card";
  const entries = item.entries || [];
  const total = entries.length;
  const done = entries.filter(e => e.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const durStr = item.totalDuration ? `⏱ ${wlFmt(item.totalDuration)} total` : "";
  const expanded = !!wlExpandState[item.id];
  const cats = ["Productive","Good Habit","Bad Habit","Time Pass","Entertainment"];

  const thumbHtml = item.thumb
    ? `<button class="wl-pl-thumb-btn" onclick="toggleWatchlistExpand('${item.id}')" title="${expanded ? "Hide" : "Show"} playlist videos"><img src="${escHtml(item.thumb)}" class="wl-pl-thumb" alt="" loading="lazy"></button>`
    : `<button class="wl-pl-thumb-btn" onclick="toggleWatchlistExpand('${item.id}')" title="${expanded ? "Hide" : "Show"} playlist videos"><div class="wl-pl-thumb wl-pl-thumb-empty">📋</div></button>`;

  const entriesHtml = entries.map((e, i) => {
    const eDur = e.duration ? `<span class="wl-e-dur">${wlFmt(e.duration)}</span>` : "";
    const eThumb = e.thumb
      ? `<img src="${escHtml(e.thumb)}" class="wl-e-thumb" alt="" loading="lazy">`
      : `<span class="wl-e-thumb wl-e-thumb-empty">🎬</span>`;
    return `<div class="wl-entry-row${e.done ? " wl-entry-done" : ""}">
      ${eThumb}
      <input type="checkbox" class="wl-e-chk" ${e.done ? "checked" : ""} onchange="togglePlaylistEntry('${item.id}',${i})">
      <span class="wl-e-num">${i + 1}.</span>
      <span class="wl-e-title">${escHtml(e.title)}</span>
      ${eDur}
      <button class="wl-e-del" onclick="deletePlaylistEntry('${item.id}',${i})" title="Remove">✕</button>
    </div>`;
  }).join("");

  div.innerHTML = `
    <div class="wl-pl-header">
      ${thumbHtml}
      <div class="wl-pl-info">
        <div class="wl-pl-title">${escHtml(item.title)}</div>
        <div class="wl-pl-meta">
          <span class="wl-pl-badge">PLAYLIST</span>
          <span>${total} video${total !== 1 ? "s" : ""}</span>
          ${durStr ? `<span class="wl-pl-dur">${escHtml(durStr)}</span>` : ""}
        </div>
      </div>
      <button class="lib-del-btn" onclick="deleteWatchlistItem('${item.id}')" title="Delete playlist">🗑</button>
    </div>
    <div class="wl-progress-wrap">
      <div class="wl-progress-track">
        <div class="wl-progress-fill" data-target="${pct}" style="width:${pct}%"></div>
      </div>
      <span class="wl-pct-label"><strong>${pct}%</strong> complete &nbsp;·&nbsp; ${done}/${total} watched</span>
    </div>
    <div class="wl-pl-controls">
      <select class="dash-select compact" onchange="updateWatchlistCategory('${item.id}', this.value)">
        ${cats.map(c => `<option value="${c}"${item.category === c ? " selected" : ""}>${c}</option>`).join("")}
      </select>
      <input type="text" class="dash-input compact wl-learned-input" placeholder="What was learned?" value="${escHtml(item.learned || "")}" onchange="updateWatchlistLearned('${item.id}', this.value)">
    </div>
    <button class="wl-expand-btn" onclick="toggleWatchlistExpand('${item.id}')">
      ${expanded ? "Hide lectures" : `Show ${total} lecture${total !== 1 ? "s" : ""}`}
    </button>
    <div class="wl-entries"${expanded ? "" : " hidden"}>
      ${entriesHtml || '<p class="wl-empty-pl">No videos in this playlist.</p>'}
    </div>
  `;
  return div;
}

/* ─── Planner Logic ────────────────────────────────────── */
let plannerTasks = [];

function loadPlanner() {
  try {
    const raw = localStorage.getItem("youme_planner");
    plannerTasks = raw ? JSON.parse(raw) : [];
  } catch (_) {
    plannerTasks = [];
  }
  renderPlanner();
}

function savePlanner() {
  localStorage.setItem("youme_planner", JSON.stringify(plannerTasks));
  renderPlanner();
}

function addPlannerTask() {
  const actName = document.getElementById("planActivity").value.trim();
  if (!actName) {
    showToast("Activity name is required", "error");
    return;
  }
  const time = document.getElementById("planTime").value.trim();
  const place = document.getElementById("planPlace").value.trim();
  const after = document.getElementById("planAfter").value.trim();
  const cat = document.getElementById("planCategory").value;
  
  plannerTasks.push({
    id: Date.now().toString(),
    actName, time, place, after, cat,
    done: false,
    reason: ""
  });
  
  document.getElementById("planActivity").value = "";
  document.getElementById("planTime").value = "";
  document.getElementById("planPlace").value = "";
  document.getElementById("planAfter").value = "";
  
  savePlanner();
  showToast("Activity added", "success");
}

function togglePlannerDone(id) {
  const t = plannerTasks.find(i => i.id === id);
  if (t) {
    t.done = !t.done;
    if (t.done) t.reason = ""; // clear reason if marked done
    savePlanner();
  }
}

function updatePlannerReason(id, val) {
  const t = plannerTasks.find(i => i.id === id);
  if (t) { t.reason = val; savePlanner(); }
}

function deletePlannerTask(id) {
  plannerTasks = plannerTasks.filter(i => i.id !== id);
  savePlanner();
}

function renderPlanner() {
  const list = document.getElementById("plannerList");
  if (!list) return;
  
  if (plannerTasks.length === 0) {
    list.innerHTML = '<p class="empty-msg">No activities planned.</p>';
    renderGraph();
    return;
  }
  
  list.innerHTML = "";
  plannerTasks.forEach(t => {
    const div = document.createElement("div");
    div.className = "card";
    div.style.padding = "16px";
    div.style.marginBottom = "0";
    div.style.position = "relative";
    
    let meta = [];
    if (t.time) meta.push(`⌚ ${t.time}`);
    if (t.place) meta.push(`📍 ${t.place}`);
    if (t.after) meta.push(`↳ After: ${t.after}`);
    
    // Determine color tick based on category
    let catColor = "var(--text-dim)";
    if (t.cat === "Studying" || t.cat === "Productive") catColor = "var(--green)";
    if (t.cat === "Time Pass") catColor = "var(--red)";
    if (t.cat === "Experimenting" || t.cat === "Exploring") catColor = "var(--accent)";

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="display:flex; gap:12px; align-items:flex-start; flex:1;">
          <input type="checkbox" ${t.done ? 'checked' : ''} onchange="togglePlannerDone('${t.id}')" style="cursor:pointer; transform:scale(1.4); margin-top:4px;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px;">
              <h4 style="margin:0; font-size:1.1rem; ${t.done ? 'text-decoration:line-through;opacity:0.6;' : ''}">${t.actName}</h4>
              <span style="font-size:0.7rem; padding:2px 6px; border-radius:4px; border:1px solid ${catColor}; color:${catColor};">${t.cat}</span>
            </div>
            ${meta.length ? `<p style="font-size:0.85rem; color:var(--text-dim); margin:6px 0 0 0;">${meta.join(' &nbsp;•&nbsp; ')}</p>` : ''}
            
            ${!t.done ? `
              <input type="text" class="dash-input compact" placeholder="Reason if not done/skipped?" value="${t.reason || ''}" onchange="updatePlannerReason('${t.id}', this.value)" style="margin-top:10px; max-width:100%; font-size:0.85rem; padding:6px 10px;">
            ` : ''}
          </div>
        </div>
        <button class="btn btn-icon-round" onclick="deletePlannerTask('${t.id}')" style="width:28px; height:28px; font-size:0.8rem; background:rgba(255,50,50,0.1); color:var(--red);">✖</button>
      </div>
    `;
    list.appendChild(div);
  });
  
  renderGraph();
}

function renderGraph() {
  const container = document.getElementById("plannerGraph");
  const scoreEl = document.getElementById("plannerScore");
  if (!container || !scoreEl) return;
  
  container.innerHTML = "";
  
  let score = 0;
  
  // Calculate score and build bars based on tasks
  // Productive Done = +10, Time Pass Done = -5
  // Productive Undone = -5, Time Pass Undone = 0
  
  const widthPerBar = Math.floor(100 / Math.max(1, plannerTasks.length));
  
  plannerTasks.forEach((t, i) => {
    let delta = 0;
    if (t.done) {
      if (t.cat === "Studying" || t.cat === "Experimenting" || t.cat === "Exploring") delta = 10;
      if (t.cat === "Time Pass") delta = -5;
    } else {
      if (t.cat === "Studying" || t.cat === "Experimenting" || t.cat === "Exploring") delta = -5;
    }
    
    score += delta;
    
    // Draw bar representing cumulative trend
    const bar = document.createElement("div");
    const h = Math.max(10, Math.min(100, 50 + (score * 2))); // normalize to 10-100%
    bar.style.height = `${h}%`;
    bar.style.flex = "1";
    bar.style.borderRadius = "4px 4px 0 0";
    bar.style.transition = "all 0.4s ease";
    
    if (score > 0) bar.style.background = "var(--green)";
    else if (score < 0) bar.style.background = "var(--red)";
    else bar.style.background = "var(--text-dim)";
    
    bar.title = `Task: ${t.actName} | Delta: ${delta > 0 ? '+'+delta : delta}`;
    container.appendChild(bar);
  });
  
  // If no tasks, default state
  if (plannerTasks.length === 0) {
    const defaultBar = document.createElement("div");
    defaultBar.style.height = "5%";
    defaultBar.style.flex = "1";
    defaultBar.style.background = "var(--text-dim)";
    container.appendChild(defaultBar);
  }
  
  scoreEl.textContent = `Daily Score: ${score > 0 ? '+' : ''}${score}`;
}

/* ─── Custom Background Logic ────────────────────────────── */
function getActiveTheme() {
  return document.documentElement.getAttribute("data-theme") || "batman";
}

function getCustomBackgroundKey(themeName) {
  return `youme_custom_bg_${themeName}`;
}

function runWallpaperMigrations() {
  // One-time reset for Spiderman theme so the new built-in wallpaper is visible.
  const migrationKey = "youme_wallpaper_migration_spiderman_v2";
  if (localStorage.getItem(migrationKey)) return;

  localStorage.removeItem("youme_custom_bg_spiderman");
  localStorage.removeItem("youme_custom_bg"); // legacy pre-theme-specific key
  localStorage.setItem(migrationKey, "1");
}

function loadCustomBackground() {
  try {
    runWallpaperMigrations();
    const bgLayer = document.querySelector('.bg-layer');
    const themeName = getActiveTheme();
    const bgData = localStorage.getItem(getCustomBackgroundKey(themeName));
    if (bgData) {
      applyCustomBackground(bgData);
      const hint = document.getElementById("customBgFileHint");
      if (hint) hint.textContent = "Custom wallpaper is active.";
    } else if (bgLayer) {
      // Clear inline background so CSS theme default wallpaper is visible.
      bgLayer.style.backgroundImage = "";
      bgLayer.style.backgroundPosition = "";
      bgLayer.style.backgroundSize = "";

      const hint = document.getElementById("customBgFileHint");
      if (hint) hint.textContent = "No custom image selected.";
    }
  } catch (_) {}
}

function applyCustomBackground(dataUrl) {
  const bgLayer = document.querySelector('.bg-layer');
  if (bgLayer) {
    bgLayer.style.backgroundImage = `url('${dataUrl}')`;
    bgLayer.style.backgroundPosition = "center";
    bgLayer.style.backgroundSize = "cover";
  }
}

function clearCustomBackground() {
  try {
    localStorage.removeItem(getCustomBackgroundKey(getActiveTheme()));
  } catch (_) {}
  const bgLayer = document.querySelector('.bg-layer');
  if (bgLayer) {
    bgLayer.style.backgroundImage = "";
    bgLayer.style.backgroundPosition = "";
    bgLayer.style.backgroundSize = "";
  }
  const input = document.getElementById("customBgInput");
  if (input) input.value = "";
  const hint = document.getElementById("customBgFileHint");
  if (hint) hint.textContent = "No custom image selected.";
  showToast("Custom wallpaper cleared", "success");
}

let cropper = null;

function getCropAspectRatio(value) {
  if (value === "free") return NaN;
  if (value === "16:9") return 16 / 9;
  if (value === "4:3") return 4 / 3;
  if (value === "1:1") return 1;
  return window.innerWidth / window.innerHeight;
}

function setCropAspectRatio(value) {
  if (!cropper) return;
  cropper.setAspectRatio(getCropAspectRatio(value));
}

function bindCropModalInteractions() {
  const modal = document.getElementById("cropModal");
  if (!modal || modal.dataset.bound === "true") return;

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeCropModal();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.style.display === "flex") {
      closeCropModal();
    }
  });

  modal.dataset.bound = "true";
}

function getWallpaperExportSize() {
  const viewportWidth = Math.max(1, window.innerWidth || 1366);
  const viewportHeight = Math.max(1, window.innerHeight || 768);
  const ratio = viewportWidth / viewportHeight;

  const maxWidth = 1920;
  const maxHeight = 1080;
  const scale = Math.min(1, maxWidth / viewportWidth, maxHeight / viewportHeight);
  const width = Math.round(viewportWidth * scale);
  const height = Math.round(width / ratio);
  return { width: Math.max(320, width), height: Math.max(180, height) };
}

function openImageInCropper(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Please drop an image file (PNG, JPG, WEBP…)", "error");
    return;
  }
  if (typeof Cropper === "undefined") {
    showToast("Cropper failed to load. Refresh and try again.", "error");
    return;
  }
  const hint = document.getElementById("customBgFileHint");
  if (hint) hint.textContent = `Selected: ${file.name}`;

  const reader = new FileReader();
  reader.onload = function(event) {
    const imageElement = document.getElementById('cropImage');
    imageElement.src = event.target.result;
    const ratioSelect = document.getElementById("cropAspectRatio");
    if (ratioSelect) ratioSelect.value = "screen";
    const modal = document.getElementById('cropModal');
    modal.style.display = 'flex';
    if (cropper) { cropper.destroy(); }
    cropper = new Cropper(imageElement, {
      aspectRatio: getCropAspectRatio("screen"),
      viewMode: 1,
      background: false,
      autoCropArea: 1,
      responsive: true,
    });
  };
  reader.readAsDataURL(file);
}

function initCustomBackground() {
  const input = document.getElementById("customBgInput");
  if (!input) return;
  bindCropModalInteractions();

  /* ── Drag & Drop zone wiring ── */
  const dropZone = document.getElementById("wallpaperDropZone");
  if (dropZone) {
    dropZone.addEventListener("click", (e) => {
      if (e.target === input || e.target.closest("label")) return;
      input.click();
    });
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", (e) => {
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove("drag-over");
      }
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) openImageInCropper(file);
    });
  }

  input.addEventListener("change", function(e) {
    const file = e.target.files[0];
    if (file) openImageInCropper(file);
  });
}

function closeCropModal() {
  const modal = document.getElementById('cropModal');
  modal.style.display = 'none';
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  const input = document.getElementById("customBgInput");
  if (input) input.value = '';
}

function saveCroppedImage() {
  if (!cropper) return;
  const exportSize = getWallpaperExportSize();
  
  const canvas = cropper.getCroppedCanvas({
    width: exportSize.width,
    height: exportSize.height,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  });
  
  if (!canvas) {
    showToast("Failed to crop image", "error");
    return;
  }
  
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  
  try {
    localStorage.setItem(getCustomBackgroundKey(getActiveTheme()), dataUrl);
    applyCustomBackground(dataUrl);
    showToast("Custom wallpaper set!", "success");
    closeCropModal();
  } catch (err) {
    showToast("Image too large to save! Try a smaller crop.", "error");
  }
}

function initParallaxBackground() {
  if (typeof window === "undefined" || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);

  const bgLayer = document.querySelector(".bg-layer");
  if (!bgLayer) return;

  gsap.to(bgLayer, {
    y: "15vh",
    ease: "none",
    scrollTrigger: {
      trigger: document.body,
      start: "top top",
      end: "bottom bottom",
      scrub: true
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    initApp();
    initParallaxBackground();
  });
} else {
  initApp();
  initParallaxBackground();
}
