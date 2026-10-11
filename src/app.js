"use strict";

// Radio Browser meminta klien mengambil daftar server dari all.api, mengacaknya, lalu pindah ke
// server berikutnya kalau satu gagal. API_MIRRORS dipakai kalau daftar itu gagal diambil.
const API_SERVER_LIST_URL = "https://all.api.radio-browser.info/json/servers";
const API_SERVER_LIST_TIMEOUT_MS = 2500;
const API_MIRRORS = [
  "https://de1.api.radio-browser.info/json"
];

// Isian dialog Tentang dan Dukung.
// Ubah legalUpdated setiap kali isi dialog Tentang diubah.
const SITE_INFO = {
  owner: "DengaranId",
  email: "dengaranid@gmail.com",
  supportPlatform: "Saweria",
  supportUrl: "https://saweria.co/dengaranid",
  legalUpdated: "9 Oktober 2026"
};

// Stasiun yang disembunyikan atas permintaan pemilik stasiun atau pemegang hak cipta.
// Isi dengan stationuuid dari Radio Browser. Cara mencarinya: buka
// https://de1.api.radio-browser.info/json/stations/byname/<nama stasiun>
// lalu salin nilai "stationuuid" milik stasiun yang dimaksud.
// Stasiun di daftar ini tidak muncul di pencarian, Favorit, Baru diputar, maupun player.
// Sesudah mengubah daftar ini, jalankan python3 scripts/build_public.py dan deploy ulang.
const BLOCKED_STATION_IDS = [
  // "contoh-uuid-0000-0000-000000000000", // nama stasiun, tanggal permintaan
];
const blockedStationIds = new Set(BLOCKED_STATION_IDS.map(id => String(id).toLowerCase()));

// Stasiun dengan salah satu tag ini disembunyikan dari pencarian, Favorit, dan Baru diputar.
// Dicocokkan dengan tag persis, bukan potongan nama: "adult" tidak dipakai karena di Radio
// Browser berarti format musik (adult contemporary), dan "sex" ada di nama seperti "BBC Essex".
const BLOCKED_TAGS = new Set(["erotic", "porn", "xxx", "nsfw"]);

function isBlockedStation(station) {
  if (!station) return false;
  if (blockedStationIds.has(String(station.id).toLowerCase())) return true;
  return allTags(station.tags).some(tag => BLOCKED_TAGS.has(tag));
}

const DEFAULT_COUNTRY = "ID";
// Di halaman HTTPS browser memblokir audio dari alamat http://, jadi pencarian
// hanya mengambil stasiun HTTPS. Di http:// atau localhost semua stasiun tampil.
const SECURE_PAGE = location.protocol === "https:";
const PAGE_SIZE = 30;
const HISTORY_LIMIT = 8;
// Batas tunggu sampai stream mulai berbunyi, dan batas buffering saat sedang memutar.
const CONNECT_TIMEOUT_MS = 12000;
const STALL_TIMEOUT_MS = 15000;
// Jeda sebelum tiap percobaan menyambung ulang stream yang putus saat sedang diputar.
// Sesudah percobaan terakhir gagal, stream dinyatakan gagal seperti biasa.
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
// Jeda debounce saat perangkat kembali online sebelum menyambung ulang, untuk memberi waktu
// rute jaringan dan DNS stabil terlebih dahulu.
const ONLINE_RECONNECT_DELAY_MS = 1000;
// Batas waktu fetch untuk mengekstrak URL audio dari playlist .pls atau .m3u
const PLAYLIST_RESOLVE_TIMEOUT_MS = 4000;
// Jumlah percobaan baru dikembalikan ke 0 sesudah stream hasil sambung ulang berbunyi selama ini.
// Tanpa batas ini, server yang memutus koneksi tiap beberapa detik disambung ulang tanpa henti.
const RECONNECT_RESET_SECONDS = 10;
// hls.js hanya dimuat saat stasiun HLS diputar di browser yang tidak memutar HLS sendiri.
// Versi ditulis di nama file supaya aturan cache immutable untuk *.min.js tetap aman.
const HLS_SCRIPT = "vendor/hls-1.7.3.light.min.js";
const HLS_CONFIG = {
  // Worker hls.js dibuat dari blob: URL dan diblokir CSP. Transmux stream audio di main thread
  // ringan, jadi worker tidak dipakai.
  enableWorker: false,
  // Mulai 3 segmen di belakang ujung playlist live, batas minimum yang diizinkan spesifikasi HLS.
  liveSyncDurationCount: 3,
  // Tertinggal 3 sampai 6 segmen: putar sedikit lebih cepat (maksimal 1.05x) sampai kembali ke
  // posisi live. Pitch tidak berubah karena preservesPitch elemen audio aktif secara default.
  maxLiveSyncPlaybackRate: 1.05,
  // Tertinggal lebih dari 6 segmen: seek langsung ke posisi live.
  liveMaxLatencyDurationCount: 6,
  // Batasi buffer di depan dan di belakang posisi putar supaya kuota dan memori tidak terpakai
  // untuk audio yang tidak akan didengar. Pemilihan bitrate (ABR) memakai default hls.js.
  maxBufferLength: 15,
  backBufferLength: 10
};
const FAVORITE_KEY = "radio_online_favorites_v1";
const LAST_STATION_KEY = "radio_online_last_station_v1";
const HISTORY_KEY = "radio_online_history_v1";
const VOLUME_KEY = "radio_online_volume_v1";
const SHORTCUTS_KEY = "radio_online_shortcuts_v1";

// Fallback jika endpoint /countries gagal dimuat.
const FALLBACK_COUNTRIES = [
  ["ID", "Indonesia"],
  ["MY", "Malaysia"],
  ["SG", "Singapura"],
  ["US", "Amerika Serikat"],
  ["GB", "Inggris"],
  ["JP", "Jepang"],
  ["KR", "Korea Selatan"],
  ["AU", "Australia"],
  ["DE", "Jerman"],
  ["FR", "Prancis"],
  ["NL", "Belanda"],
  ["SA", "Arab Saudi"],
  ["IN", "India"],
  ["BR", "Brasil"]
];

const ICONS = {
  play: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" fill="currentColor"/></svg>',
  stop: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" fill="currentColor"/></svg>',
  loader: '<svg class="icon spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
  heart: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>',
  volumeHigh: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>',
  volumeLow: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/></svg>',
  volumeOff: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
  heartOff: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4.893a5.5 5.5 0 0 1 1.091.931.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 1.872-1.002 3.356-2.187 4.655"/><path d="m16.967 16.967-3.459 3.346a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 2.747-4.761"/><path d="m2 2 20 20"/></svg>',
  wifiOff: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/></svg>',
  timer: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
};

const NOW_DOT_HTML = '<span class="now-dot" aria-hidden="true"></span>';

// Siaran live tidak punya jeda: hanya Putar dan Stop.
// Putar selalu memuat ulang stream supaya kembali ke siaran langsung.
const PLAY_STATES = {
  idle: { className: "btn-play", icon: "play", text: "Putar", label: name => `Putar ${name}` },
  stopped: { className: "btn-play", icon: "play", text: "Putar", label: name => `Putar ${name}` },
  connecting: {
    className: "btn-loading",
    icon: "loader",
    text: "Memuat...",
    label: name => `Batalkan memuat ${name}`
  },
  playing: { className: "btn-stop", icon: "stop", text: "Stop", label: name => `Stop ${name}` }
};

const root = document.documentElement;
const layout = document.getElementById("layout");
const searchInput = document.getElementById("searchInput");
const searchClearButton = document.getElementById("searchClearButton");
const controlsForm = document.getElementById("controls");
const countrySelect = document.getElementById("countrySelect");
const sortSelect = document.getElementById("sortSelect");
const activeFilter = document.getElementById("activeFilter");
const activeTagLabel = document.getElementById("activeTagLabel");
const clearTagButton = document.getElementById("clearTagButton");
const resultAnnouncer = document.getElementById("resultAnnouncer");
const radioSection = document.getElementById("radioSection");
const tabRadio = document.getElementById("tabRadio");
const tabFavorite = document.getElementById("tabFavorite");
const tabHistory = document.getElementById("tabHistory");
const radioScroll = document.getElementById("radioScroll");
const favoriteScroll = document.getElementById("favoriteScroll");
const historyScroll = document.getElementById("historyScroll");
const favoriteList = document.getElementById("favoriteList");
const favoriteCount = document.getElementById("favoriteCount");
const stationList = document.getElementById("stationList");
const stationCount = document.getElementById("stationCount");
const historySection = document.getElementById("historySection");
const appShell = document.querySelector(".app");
const heroHeader = document.querySelector(".hero");
const shortcutHint = document.querySelector(".shortcut-hint");
const shortcutOnText = document.getElementById("shortcutOnText");
const shortcutOffText = document.getElementById("shortcutOffText");
const shortcutToggle = document.getElementById("shortcutToggle");
const historyList = document.getElementById("historyList");
const historyListDesktop = document.getElementById("historyListDesktop");
const historyCount = document.getElementById("historyCount");
const historyTabCount = document.getElementById("historyTabCount");
const loadMoreButton = document.getElementById("loadMoreButton");
const audioPlayer = document.getElementById("audioPlayer");
const miniPlayer = document.getElementById("miniPlayer");
const nowPlaying = document.getElementById("nowPlaying");
const playerStatus = document.getElementById("playerStatus");
const liveBadge = document.getElementById("liveBadge");
const bufferBadge = document.getElementById("bufferBadge");
const sleepTimerBadge = document.getElementById("sleepTimerBadge");
const listenTime = document.getElementById("listenTime");
const retryButton = document.getElementById("retryButton");
const miniPlayButton = document.getElementById("miniPlayButton");
const sleepTimerButton = document.getElementById("sleepTimerButton");
const closePlayerButton = document.getElementById("closePlayerButton");
const sleepDialog = document.getElementById("sleepDialog");
const sleepTimerOptions = document.getElementById("sleepTimerOptions");
const muteButton = document.getElementById("muteButton");
const volumeInput = document.getElementById("volumeInput");
const volumeValue = document.getElementById("volumeValue");
const volumeControl = document.getElementById("volumeControl");
const toast = document.getElementById("toast");
const toastText = document.getElementById("toastText");
const toastIcon = document.getElementById("toastIcon");
const toastAction = document.getElementById("toastAction");

const regionNames = createRegionNames();

let stations = [];
let favorites = loadStationList(FAVORITE_KEY);
let activeTab = "radio";
let history = loadStationList(HISTORY_KEY).slice(0, HISTORY_LIMIT);
let currentStation = null;
let isPlaying = false;
let isConnecting = false;
let isBuffering = false;
// Posisi audio saat status menunggu dimulai. Kalau currentTime melewati nilai ini, audio masih berjalan.
let bufferingStartTime = 0;
let activeTag = "";
let currentOffset = 0;
let hasMore = false;
let searchAbortController = null;
// Naik setiap kali pemutaran baru dimulai, dihentikan, atau dibatalkan.
// Promise play() dan timer dari permintaan lama dibandingkan dengan nilai ini dan diabaikan.
let playRequestId = 0;
let connectTimer = null;
let stallTimer = null;
// True selama elemen audio memutar stream milik currentStation. Event pause dan error yang
// dikirim sesudah stream dilepas diabaikan berdasarkan nilai ini.
let streamAttached = false;
// Instance hls.js untuk stream yang sedang dipasang, dan promise pemuatan script-nya.
let hls = null;
let hlsLoader = null;
// Lama mendengar stream yang sedang dipasang. Dihitung dari kenaikan currentTime, bukan dari
// nilainya, karena stream HLS live tidak mulai dari 0 dan hls.js bisa melakukan seek ke posisi live.
// listenSeconds tidak direset saat sambung ulang; streamSeconds direset tiap stream dipasang.
let listenSeconds = 0;
let streamSeconds = 0;
let lastMediaTime = null;
// Jumlah percobaan sambung ulang yang sudah dijalankan. 0 berarti tidak sedang menyambung ulang.
let reconnectAttempt = 0;
let reconnectTimer = null;
let onlineTimer = null;
// True saat percobaan berikutnya ditahan sampai browser melaporkan jaringan tersambung.
let waitingForNetwork = false;
const failedStations = new Set();
let toastTimer = null;
let toastToken = 0;
let toastRemaining = 0;
let toastStartedAt = 0;
let toastPaused = false;
let toastActionHandler = null;
// State pengatur waktu tidur (Sleep Timer)
let sleepTimerMinutes = 0;
let sleepTimerEnd = null;
let sleepTimerTicker = null;
let sleepFadeTicker = null;
let sleepOriginalVolume = null;
// Pintasan satu huruf bisa dimatikan (WCAG 2.1.4). Nilai selain false dianggap aktif.
let shortcutsEnabled = loadJson(SHORTCUTS_KEY, true) !== false;

document.addEventListener("DOMContentLoaded", init);

controlsForm.addEventListener("submit", event => {
  event.preventDefault();
  startNewSearch();
});
searchInput.addEventListener("input", debounce(() => startNewSearch(), 600));
searchInput.addEventListener("input", updateSearchClear);
searchClearButton.addEventListener("click", () => {
  searchInput.value = "";
  updateSearchClear();
  startNewSearch();
  searchInput.focus();
});
countrySelect.addEventListener("change", () => startNewSearch());
sortSelect.addEventListener("change", () => startNewSearch());
loadMoreButton.addEventListener("click", () => loadStations({ append: true }));
clearTagButton.addEventListener("click", () => {
  setActiveTag("");
  searchInput.focus();
});

audioPlayer.addEventListener("pause", handleAudioPause);
audioPlayer.addEventListener("playing", handleAudioPlaying);
audioPlayer.addEventListener("waiting", handleAudioWaiting);
audioPlayer.addEventListener("stalled", handleAudioWaiting);
audioPlayer.addEventListener("timeupdate", handleAudioTimeUpdate);
audioPlayer.addEventListener("error", handleAudioError);
audioPlayer.addEventListener("ended", handleAudioEnded);
window.addEventListener("online", handleOnline);

miniPlayButton.addEventListener("click", handleMiniPlayButton);
closePlayerButton.addEventListener("click", closePlayer);
if (sleepTimerOptions) {
  sleepTimerOptions.addEventListener("click", event => {
    const btn = event.target.closest(".sleep-option");
    if (!btn) return;
    const minutes = Number(btn.dataset.sleepMinutes || 0);
    setSleepTimer(minutes);
    if (sleepDialog && sleepDialog.open) sleepDialog.close();
  });
}
retryButton.addEventListener("click", () => {
  if (currentStation) playStation(currentStation);
});
muteButton.addEventListener("click", toggleMute);
volumeInput.addEventListener("input", () => {
  audioPlayer.volume = Number(volumeInput.value);
  if (audioPlayer.muted && audioPlayer.volume > 0) audioPlayer.muted = false;
  saveJson(VOLUME_KEY, audioPlayer.volume);
  updateVolumeUI();
});

tabRadio.addEventListener("click", () => setActiveTab("radio"));
tabFavorite.addEventListener("click", () => setActiveTab("favorite"));
tabHistory.addEventListener("click", () => setActiveTab("history"));

toastAction.addEventListener("click", () => {
  const handler = toastActionHandler;
  hideToast();
  if (handler) handler();
});
// Toast tidak hilang selama dibaca atau difokus (WCAG 2.2.1).
toast.addEventListener("mouseenter", pauseToast);
toast.addEventListener("focusin", pauseToast);
toast.addEventListener("mouseleave", resumeToast);
toast.addEventListener("focusout", resumeToast);

// Event delegation: satu listener untuk semua tombol kartu dan baris.
[favoriteList, stationList, historyList, historyListDesktop].filter(Boolean).forEach(list => {
  list.addEventListener("click", handleCardAction);
});


document.addEventListener("keydown", handleShortcut);
shortcutToggle.addEventListener("click", () => {
  shortcutsEnabled = !shortcutsEnabled;
  saveJson(SHORTCUTS_KEY, shortcutsEnabled);
  updateShortcutUI();
  updateLayoutHeight();
});

setupDialogs();

async function init() {
  renderFavorites();
  renderHistory();
  restoreVolume();
  updateShortcutUI();
  restoreLastStation();
  updatePlaybackUI();
  observeLayout();
  observeLoadMore();
  selectInitialCountry();
  loadCountries();
  await startNewSearch();
}

// ---------- Negara ----------

const INDONESIA_TIME_ZONES = new Set([
  "Asia/Jakarta", "Asia/Pontianak", "Asia/Makassar", "Asia/Jayapura"
]);

// Negara awal ditebak dari browser. Zona waktu Indonesia dicek lebih dulu,
// karena banyak pengguna di Indonesia memakai bahasa en-US di perangkatnya.
function detectCountry() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (INDONESIA_TIME_ZONES.has(timeZone)) return DEFAULT_COUNTRY;

    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const language of languages) {
      if (!language) continue;
      // "pl" tanpa kode negara dilengkapi jadi "pl-Latn-PL" oleh maximize().
      const region = new Intl.Locale(language).maximize().region;
      if (region && /^[A-Z]{2}$/.test(region)) return region;
    }
  } catch (error) {
    // Intl.Locale tidak tersedia atau bahasa tidak valid: pakai default.
  }
  return DEFAULT_COUNTRY;
}

// Select negara di HTML baru berisi Indonesia. Negara hasil tebakan ditambahkan
// sebagai opsi sementara, supaya pencarian pertama tidak menunggu /countries.
function selectInitialCountry() {
  const code = detectCountry();
  if (code === DEFAULT_COUNTRY) return;
  const option = document.createElement("option");
  option.value = code;
  option.textContent = localizedCountry(code, code);
  countrySelect.append(option);
  countrySelect.value = code;
}

function createRegionNames() {
  try {
    return new Intl.DisplayNames(["id"], { type: "region" });
  } catch (error) {
    return null;
  }
}

// Nama negara dari API berbahasa Inggris; tampilkan versi Indonesia bila tersedia.
function localizedCountry(code, fallback) {
  if (!regionNames || !code) return fallback;
  try {
    return regionNames.of(String(code).toUpperCase()) || fallback;
  } catch (error) {
    return fallback;
  }
}

async function loadCountries() {
  let countries = null;

  const data = await apiFetch("/countries?hidebroken=true");

  if (Array.isArray(data)) {
    countries = data
      .filter(item => item.iso_3166_1 && item.name)
      .map(item => {
        const code = item.iso_3166_1.toUpperCase();
        return [code, localizedCountry(code, item.name)];
      })
      .sort((a, b) => a[1].localeCompare(b[1], "id"));
  }

  if (!countries || countries.length === 0) {
    countries = FALLBACK_COUNTRIES;
  }

  const previousValue = countrySelect.value || DEFAULT_COUNTRY;

  countrySelect.innerHTML = countries
    .map(([code, name]) =>
      `<option value="${escapeHtml(code)}">${escapeHtml(name)}</option>`
    )
    .join("");

  // Pastikan default/pilihan sebelumnya tetap terpilih.
  countrySelect.value = previousValue;
  if (countrySelect.selectedIndex === -1) {
    // Negara hasil tebakan tidak punya stasiun di API: muat ulang dengan Indonesia.
    countrySelect.value = DEFAULT_COUNTRY;
    startNewSearch();
  }
}

function selectedCountryName() {
  const option = countrySelect.options[countrySelect.selectedIndex];
  return option ? option.textContent : "negara ini";
}

// ---------- Daftar radio: favorit + hasil pencarian ----------

// Tombol X hanya tampil saat kolom pencarian berisi teks.
function updateSearchClear() {
  searchClearButton.hidden = searchInput.value === "";
}

function startNewSearch() {
  updateSearchClear();
  currentOffset = 0;
  return loadStations({ append: false });
}

function setActiveTag(tag) {
  activeTag = tag;
  activeFilter.hidden = !tag;
  activeTagLabel.textContent = tag;
  startNewSearch();
}

async function loadStations({ append = false } = {}) {
  const countryCode = countrySelect.value || DEFAULT_COUNTRY;
  const searchTerm = searchInput.value.trim();
  const order = sortSelect.value;

  // Batalkan request sebelumnya agar hasil tidak saling tumpang tindih.
  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();
  const { signal } = searchAbortController;

  if (!append) {
    // Favorit ikut disaring kata pencarian dan genre, jadi dirender ulang di sini.
    renderFavorites();
    radioScroll.scrollTop = 0;
    stationList.innerHTML = `<div class="loading">Memuat daftar radio...</div>`;
    stationCount.textContent = "";
    loadMoreButton.hidden = true;
  } else {
    loadMoreButton.disabled = true;
    loadMoreButton.textContent = "Memuat...";
  }

  const params = new URLSearchParams({
    countrycode: countryCode,
    name: searchTerm,
    hidebroken: "true",
    limit: String(PAGE_SIZE),
    offset: String(currentOffset),
    order: order,
    reverse: order === "name" ? "false" : "true"
  });
  if (activeTag) params.set("tag", activeTag);
  if (SECURE_PAGE) params.set("is_https", "true");

  const data = await apiFetch(`/stations/search?${params.toString()}`, { signal });

  // Request dibatalkan karena ada pencarian baru: abaikan.
  if (data === "aborted") return;

  loadMoreButton.disabled = false;
  loadMoreButton.textContent = "Muat lebih banyak";

  if (!Array.isArray(data)) {
    if (append) {
      showToast("Gagal memuat radio berikutnya. Periksa koneksi internet.", {
        icon: "wifiOff",
        actionLabel: "Coba lagi",
        onAction: () => loadStations({ append: true })
      });
      return;
    }

    stations = [];
    stationList.innerHTML = `
      <div class="empty">
        Gagal memuat daftar radio. Periksa koneksi internet.
        <br />
        <button class="btn btn-inline" type="button" data-action="retry-list">Coba lagi</button>
      </div>
    `;
    // Jumlah radio tidak diketahui saat gagal, jadi badge dikosongkan (tersembunyi), bukan 0.
    stationCount.textContent = "";
    announce("Gagal memuat daftar radio.");
    loadMoreButton.hidden = true;
    return;
  }

  const newStations = data
    .filter(station => station.stationuuid && (station.url_resolved || station.url))
    .map(normalizeStation)
    .filter(station => !isBlockedStation(station));

  currentOffset += PAGE_SIZE;
  hasMore = data.length === PAGE_SIZE;

  if (append) {
    // Sisipkan kartu baru saja. Kartu lama tidak diganti, jadi fokus keyboard tetap.
    stations = stations.concat(newStations);
    stationList.insertAdjacentHTML("beforeend", newStations.map(createStationCard).join(""));
    updateStationCount();
    loadMoreButton.hidden = !hasMore;
    announce(`${newStations.length} radio lagi dimuat.`);
  } else {
    stations = newStations;
    renderStations();
  }

  // Observer tidak terpicu lagi kalau tombol masih di area yang sama setelah render.
  requestAnimationFrame(checkLoadMoreProximity);
}

function normalizeStation(station) {
  return {
    id: station.stationuuid,
    name: station.name || "Radio tanpa nama",
    country: station.country || "",
    countryCode: station.countrycode || "",
    language: station.language || "",
    tags: station.tags || "",
    bitrate: station.bitrate || 0,
    codec: station.codec || "",
    hls: station.hls === 1,
    url: station.url_resolved || station.url
  };
}

// Favorit yang cocok dengan kata pencarian dan genre aktif.
function visibleFavorites() {
  const term = searchInput.value.trim().toLowerCase();
  return favorites.filter(station => {
    if (term && !station.name.toLowerCase().includes(term)) return false;
    if (activeTag && !allTags(station.tags).includes(activeTag)) return false;
    return true;
  });
}

// Hasil pencarian radio. Stasiun favorit tetap muncul di sini.
function visibleResults() {
  return stations;
}

// ---------- Render ----------

function updateStationCount() {
  // Selama daftar dimuat, count dibiarkan kosong sampai hasil baru dirender.
  if (stationList.querySelector(".loading")) return;
  const resultTotal = stationList.querySelectorAll(".card").length;
  stationCount.textContent = String(resultTotal);
}

function renderStations() {
  const results = visibleResults();

  if (results.length === 0) {
    const searchTerm = searchInput.value.trim();
    const filters = [];
    if (searchTerm) filters.push(`bernama <strong>${escapeHtml(searchTerm)}</strong>`);
    if (activeTag) filters.push(`bergenre <strong>${escapeHtml(activeTag)}</strong>`);

    if (filters.length) {
      stationList.innerHTML = `
        <div class="empty">
          Tidak ada radio ${filters.join(" dan ")} di ${escapeHtml(selectedCountryName())}.
          <br />
          <button class="btn btn-inline" type="button" data-action="clear-filters">Hapus pencarian</button>
        </div>
      `;
    } else {
      stationList.innerHTML = `<div class="empty">Belum ada radio untuk ${escapeHtml(selectedCountryName())}. Coba negara lain.</div>`;
    }

    updateStationCount();
    announce("Tidak ada radio yang cocok.");
    loadMoreButton.hidden = !hasMore;
    return;
  }

  stationList.innerHTML = results.map(createStationCard).join("");
  updateStationCount();
  announce(`${results.length} radio ditampilkan${activeTag ? ` untuk genre ${activeTag}` : ""}.`);
  loadMoreButton.hidden = !hasMore;
}

function setActiveTab(tab) {
  activeTab = tab;
  layout.dataset.tab = tab;
  tabRadio.setAttribute("aria-selected", String(tab === "radio"));
  tabFavorite.setAttribute("aria-selected", String(tab === "favorite"));
  tabHistory.setAttribute("aria-selected", String(tab === "history"));
  radioScroll.hidden = tab !== "radio";
  favoriteScroll.hidden = tab !== "favorite";
  if (historyScroll) historyScroll.hidden = tab !== "history";

  if (tab === "radio") {
    requestAnimationFrame(checkLoadMoreProximity);
  }
}

function renderFavorites() {
  const list = visibleFavorites();
  favoriteCount.textContent = String(list.length);

  if (list.length === 0) {
    const term = searchInput.value.trim();
    if (term || activeTag) {
      favoriteList.innerHTML = `<div class="empty">Tidak ada stasiun favorit yang cocok dengan filter pencarian.</div>`;
    } else {
      favoriteList.innerHTML = `<div class="empty">Belum ada radio favorit tersimpan. Tekan ikon hati pada radio yang ingin disimpan.</div>`;
    }
    return;
  }

  favoriteList.innerHTML = list.map(createStationCard).join("");
}

function renderHistory() {
  const countStr = String(history.length);
  historyCount.textContent = countStr;
  if (historyTabCount) historyTabCount.textContent = countStr;

  const html = history.length === 0
    ? `<li class="empty">Belum ada radio yang diputar.</li>`
    : history.map(createHistoryRow).join("");

  if (historyList) historyList.innerHTML = html;
  if (historyListDesktop) historyListDesktop.innerHTML = html;
  updateLayoutHeight();
}

// Penanda baris hanya untuk stasiun yang sedang dimuat atau berbunyi.
function stateClasses(state) {
  if (state === "playing") return "is-current is-playing";
  if (state === "connecting") return "is-current";
  return "";
}

// Favorit dan Baru diputar bisa berisi stasiun HTTP yang disimpan sebelumnya: beri label.
function isInsecureStream(station) {
  return SECURE_PAGE && /^http:/i.test(String(station.url || ""));
}

function insecureBadgeHtml(station) {
  return isInsecureStream(station)
    ? `<span class="insecure-badge" title="Stream HTTP: bisa diblokir browser di halaman HTTPS">HTTP</span>`
    : "";
}

function metaText(station, { withLanguage = true } = {}) {
  const parts = [
    localizedCountry(station.countryCode, station.country) || "Negara tidak diketahui"
  ];
  const language = withLanguage ? formatLanguage(station.language) : "";
  if (language) parts.push(language);
  if (station.bitrate) parts.push(`${station.bitrate} kbps`);
  return parts.join(" • ");
}

function createStationCard(station) {
  const state = playStateFor(station.id);

  const tags = parseTags(station.tags);
  const tagsHtml = tags.length
    ? `<ul class="tags" aria-label="Genre">${tags
        .map(
          tag => `<li><button class="tag" type="button" data-action="filter-tag"
            data-tag="${escapeHtml(tag)}" aria-label="Tampilkan genre ${escapeHtml(tag)}">${escapeHtml(tag)}</button></li>`
        )
        .join("")}</ul>`
    : "";

  return `
    <article class="card ${stateClasses(state)}" data-station-id="${escapeHtml(station.id)}">
      <div class="card-main">
        <h4 class="card-title" title="${escapeHtml(station.name)}">
          ${NOW_DOT_HTML}
          <span class="card-name">${escapeHtml(station.name)}</span>
        </h4>

        <div class="card-sub">
          ${insecureBadgeHtml(station)}
          <p class="meta">${escapeHtml(metaText(station))}</p>
          ${tagsHtml}
        </div>
        <p class="card-flag" ${failedStations.has(station.id) ? "" : "hidden"}>
          Tidak bisa diputar. Stasiun mungkin offline.
        </p>
      </div>

      <div class="card-actions">
        ${playButtonHtml(station, state, "icon")}
        ${favButtonHtml(station)}
      </div>
    </article>
  `;
}

function createHistoryRow(station) {
  const state = playStateFor(station.id);
  return `
    <li class="row ${stateClasses(state)}" data-station-id="${escapeHtml(station.id)}">
      <div class="row-main">
        <span class="row-name">${NOW_DOT_HTML}<span>${escapeHtml(station.name)}</span></span>
        <span class="row-meta">${insecureBadgeHtml(station)}${escapeHtml(metaText(station, { withLanguage: false }))}</span>
      </div>
      ${playButtonHtml(station, state, "icon")}
      ${favButtonHtml(station)}
    </li>
  `;
}

function playButtonHtml(station, state, variant = "text") {
  const view = PLAY_STATES[state];
  return `
    <button
      class="${playButtonClass(variant, view)}"
      type="button"
      data-play-button
      data-variant="${variant}"
      data-action="toggle-play"
      data-id="${escapeHtml(station.id)}"
      data-name="${escapeHtml(station.name)}"
      aria-label="${escapeHtml(view.label(station.name))}"
      ${variant === "icon" ? `title="${escapeHtml(view.text)}"` : ""}
    >${playButtonContent(variant, view)}</button>
  `;
}

function playButtonClass(variant, view) {
  return `${variant === "icon" ? "icon-btn" : "btn-small"} ${view.className}`;
}

function playButtonContent(variant, view) {
  return variant === "icon" ? ICONS[view.icon] : `${ICONS[view.icon]}<span>${view.text}</span>`;
}

function favButtonHtml(station) {
  const isFav = isFavorite(station.id);
  return `
    <button
      class="icon-btn fav-btn"
      type="button"
      data-action="toggle-favorite"
      data-id="${escapeHtml(station.id)}"
      aria-pressed="${isFav ? "true" : "false"}"
      aria-label="Favorit: ${escapeHtml(station.name)}"
      title="${isFav ? "Hapus dari favorit" : "Tambah ke favorit"}"
    >${ICONS.heart}</button>
  `;
}

// Ubah tombol hati di semua list tanpa render ulang,
// supaya fokus keyboard dan posisi scroll tetap.
function updateFavoriteButtons() {
  document.querySelectorAll('[data-action="toggle-favorite"]').forEach(button => {
    const isFav = isFavorite(button.dataset.id);
    button.setAttribute("aria-pressed", isFav ? "true" : "false");
    button.title = isFav ? "Hapus dari favorit" : "Tambah ke favorit";
  });
}

function playStateFor(stationId) {
  if (!currentStation || currentStation.id !== stationId) return "idle";
  if (isConnecting) return "connecting";
  return isPlaying ? "playing" : "stopped";
}

// Update ringan: hanya tombol putar, penanda baris, dan player.
// Tanpa re-render list, jadi scroll tidak melompat dan gambar tidak reload.
function updatePlaybackUI() {
  document.querySelectorAll("[data-play-button]").forEach(button => {
    const view = PLAY_STATES[playStateFor(button.dataset.id)];
    const variant = button.dataset.variant;
    button.className = playButtonClass(variant, view);
    button.innerHTML = playButtonContent(variant, view);
    button.setAttribute("aria-label", view.label(button.dataset.name));
    if (variant === "icon") button.title = view.text;
  });

  document.querySelectorAll("[data-station-id]").forEach(item => {
    const id = item.dataset.stationId;
    const state = playStateFor(id);
    item.classList.toggle("is-current", state === "connecting" || state === "playing");
    item.classList.toggle("is-playing", state === "playing");
    const flag = item.querySelector(".card-flag");
    if (flag) flag.hidden = !failedStations.has(id);
  });

  const hasStation = Boolean(currentStation);
  const state = hasStation ? playStateFor(currentStation.id) : "idle";
  const view = PLAY_STATES[state];
  const miniLabel = { idle: "Putar", stopped: "Putar", connecting: "Batalkan memuat", playing: "Stop" }[state];

  miniPlayButton.disabled = !hasStation;
  closePlayerButton.disabled = !hasStation;
  miniPlayButton.className = `icon-btn play-main ${view.className}`;
  miniPlayButton.innerHTML = ICONS[view.icon];
  miniPlayButton.title = miniLabel;
  miniPlayButton.setAttribute("aria-label", miniLabel);

  miniPlayer.classList.toggle("is-empty", !hasStation);
  // LIVE hanya saat audio benar-benar mengalir, tidak saat buffering.
  liveBadge.hidden = !(isPlaying && !isBuffering);
  bufferBadge.hidden = !(hasStation && (isBuffering || (isConnecting && reconnectAttempt > 0)));
  listenTime.hidden = !(isPlaying && !isBuffering);
}

function setPlayerStation(station) {
  nowPlaying.textContent = station ? station.name : "Belum ada radio diputar";
}

// ---------- Aksi kartu (event delegation) ----------

function handleCardAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "toggle-play") togglePlay(id);
  else if (action === "toggle-favorite") {
    if (isFavorite(id)) removeFavorite(id, button);
    else addFavorite(id, button);
  } else if (action === "filter-tag") {
    setActiveTag(button.dataset.tag);
    // Tombol tag ikut hilang saat daftar dimuat ulang: fokus ke tombol hapus filter.
    clearTagButton.focus();
  } else if (action === "retry-list") startNewSearch();
  else if (action === "clear-filters") {
    searchInput.value = "";
    if (activeTag) setActiveTag("");
    else startNewSearch();
    searchInput.focus();
  }
}


// ---------- Dialog Tentang dan Dukung ----------

function setupDialogs() {
  fillSiteInfo();

  document.querySelectorAll("[data-open-dialog]").forEach(button => {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.dataset.openDialog);
      if (dialog && !dialog.open) {
        const firstTab = dialog.querySelector('.dialog-tabs [role="tab"]');
        if (firstTab) selectDialogTab(firstTab, false);
        dialog.showModal();
      }
    });
  });

  document.querySelectorAll("dialog.dialog").forEach(dialog => {
    dialog.querySelectorAll("[data-close-dialog]").forEach(button => {
      button.addEventListener("click", () => dialog.close());
    });

    // Klik di area gelap di luar kotak dialog menutupnya.
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });

    setupDialogTabs(dialog);
  });
}

function setupDialogTabs(dialog) {
  const tablist = dialog.querySelector('.dialog-tabs[role="tablist"]');
  if (!tablist) return;

  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

  tablist.addEventListener("click", event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && tabs.includes(tab)) selectDialogTab(tab, true);
  });

  tablist.addEventListener("keydown", event => {
    const currentTab = event.target.closest('[role="tab"]');
    if (!currentTab || !tabs.includes(currentTab)) return;

    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const targetTab = tabs[nextIndex];
      selectDialogTab(targetTab, true);
      targetTab.focus();
    }
  });
}

function selectDialogTab(selectedTab, shouldScroll = false) {
  const tablist = selectedTab.closest('[role="tablist"]');
  const dialog = selectedTab.closest("dialog");
  if (!tablist || !dialog) return;

  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  tabs.forEach(tab => {
    const isSelected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    const panelId = tab.getAttribute("aria-controls");
    const panel = dialog.querySelector(`#${cssEscape(panelId)}`);
    if (panel) panel.hidden = !isSelected;
  });

  if (shouldScroll) {
    const body = dialog.querySelector(".dialog-body");
    if (body) body.scrollTop = 0;
  }
}

function fillSiteInfo() {
  const values = {
    owner: SITE_INFO.owner,
    email: SITE_INFO.email,
    platform: SITE_INFO.supportPlatform,
    updated: SITE_INFO.legalUpdated
  };

  document.querySelectorAll("[data-fill]").forEach(element => {
    element.textContent = values[element.dataset.fill] || "";
  });

  document.getElementById("contactLink").href = `mailto:${SITE_INFO.email}`;
  document.getElementById("supportLink").href = SITE_INFO.supportUrl;
}

// ---------- Pintasan keyboard ----------

function handleShortcut(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  // Dialog terbuka: pintasan halaman tidak aktif, Esc ditangani dialog.
  if (document.querySelector("dialog[open]")) return;

  const target = event.target;
  const tag = target.tagName;
  const isTyping = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;

  if (event.key === "Escape" && target === searchInput && searchInput.value) {
    searchInput.value = "";
    startNewSearch();
    return;
  }

  if (isTyping || !shortcutsEnabled) return;

  const key = event.key.toLowerCase();

  if (key === "/") {
    event.preventDefault();
    setActiveTab("radio");
    searchInput.focus();
    searchInput.select();
  } else if (key === "n" || key === "p") {
    event.preventDefault();
    playAdjacent(key === "n" ? 1 : -1);
  } else if (key === "m") {
    event.preventDefault();
    toggleMute();
  } else if (key === " " && tag !== "BUTTON" && tag !== "A" && currentStation) {
    // Spasi pada tombol dan link tetap menjalankan fungsi bawaannya.
    event.preventDefault();
    handleMiniPlayButton();
  }
}

// Urutan navigasi keyboard mengikuti daftar yang sedang aktif dibuka.
function playAdjacent(step) {
  let list = [];
  let activePanel = null;

  if (activeTab === "favorite") {
    activePanel = favoriteScroll;
    const cards = Array.from(activePanel.querySelectorAll(".card[data-station-id]"));
    list = cards.map(card => findStationById(card.dataset.stationId)).filter(Boolean);
  } else if (activeTab === "history") {
    activePanel = historyScroll || historySection;
    const rows = Array.from((activePanel || historyList).querySelectorAll(".row[data-station-id]"));
    list = rows.map(row => findStationById(row.dataset.stationId)).filter(Boolean);
  } else {
    activePanel = radioScroll;
    const cards = Array.from(activePanel.querySelectorAll(".card[data-station-id]"));
    list = cards.map(card => findStationById(card.dataset.stationId)).filter(Boolean);
  }

  if (list.length === 0) return;

  const index = currentStation ? list.findIndex(station => station.id === currentStation.id) : -1;
  const nextIndex = index === -1
    ? (step > 0 ? 0 : list.length - 1)
    : (index + step + list.length) % list.length;
  const next = list[nextIndex];

  playStation(next);

  const el = activePanel.querySelector(`[data-station-id="${cssEscape(next.id)}"]`);
  if (el) el.scrollIntoView({ block: "nearest" });
}

// ---------- Pemutaran ----------

async function togglePlay(stationId) {
  const station = findStationById(stationId);

  if (!station) {
    showStatus("Radio tidak ditemukan.", true);
    return;
  }

  const isSame = currentStation && currentStation.id === station.id;

  if (isSame && isConnecting) {
    stopPlayback("Batal memuat.");
    return;
  }

  if (isSame && isPlaying) {
    stopPlayback("Dihentikan.");
    return;
  }

  // Selalu muat ulang stream: siaran live dilanjutkan dari posisi sekarang,
  // bukan dari buffer lama.
  await playStation(station);
}

async function playStation(station, { reconnect = false } = {}) {
  clearStreamTimers();
  // Pemutaran yang dimulai pengguna membatalkan sambung ulang yang sedang berjalan.
  if (!reconnect) cancelReconnect();
  const requestId = ++playRequestId;

  currentStation = station;
  isPlaying = false;
  isConnecting = true;
  isBuffering = false;
  failedStations.delete(station.id);

  setPlayerStation(station);
  retryButton.hidden = true;
  showStatus(
    reconnect
      ? `Menyambung ulang ke stream (percobaan ${reconnectAttempt} dari ${RECONNECT_DELAYS_MS.length})...`
      : "Menghubungkan ke stream..."
  );
  updatePlaybackUI();

  // Browser tanpa decoder AAC (misalnya ABP browser Android) tidak mengirim event error:
  // stream tersambung lalu menggantung sampai CONNECT_TIMEOUT_MS. Kalau browser sudah
  // menyatakan tidak bisa memutar AAC, gagal seketika. HLS dilewati karena diputar hls.js
  // lewat Media Source Extensions, yang dukungan formatnya tidak diukur canPlayType.
  if (isAacStation(station) && !isHlsStation(station) && !canPlayAac()) {
    // Stream stasiun sebelumnya dihentikan supaya tidak tetap berbunyi di belakang pesan gagal.
    abortStream();
    markStreamFailed(station, { name: "UnsupportedCodec" });
    return;
  }

  // Sambung ulang bukan klik baru: jumlah klik di Radio Browser tidak ditambah lagi.
  if (!reconnect) {
    listenSeconds = 0;
    saveJson(LAST_STATION_KEY, station);
    reportClick(station.id);
  }

  // Stream yang menggantung tidak memicu event error: batasi waktunya.
  connectTimer = failAfter(CONNECT_TIMEOUT_MS, station, requestId);

  try {
    await attachStream(station, requestId);
    if (requestId !== playRequestId) return;
    await audioPlayer.play();
  } catch (error) {
    // Permintaan ini sudah diganti stasiun lain, dihentikan, atau habis waktu:
    // state sekarang milik permintaan yang lebih baru.
    if (requestId !== playRequestId) return;

    if (error.name === "AbortError") {
      clearStreamTimers();
      isConnecting = false;
      isPlaying = false;
      showStatus("Dihentikan.");
      updatePlaybackUI();
      return;
    }

    handleStreamFailure(station, error);
    return;
  }

  if (requestId !== playRequestId) return;

  clearStreamTimers();
  isConnecting = false;
  isPlaying = true;
  showStatus("Sedang memutar.");
  setMediaSession(station);
  addToHistory(station);
  updatePlaybackUI();
}

// Radio Browser menulis codec "AAC" atau "AAC+". Favorit yang disimpan sebelum field codec
// ada berisi codec kosong, jadi tidak dikenali sebagai AAC.
function isAacStation(station) {
  return /^AAC/i.test(station.codec || "");
}

// canPlayType mengembalikan "" kalau browser yakin tidak bisa memutar formatnya.
// Dua bentuk dicek karena browser berbeda mengenali MIME type yang berbeda.
function canPlayAac() {
  return audioPlayer.canPlayType("audio/aac") !== "" ||
    audioPlayer.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== "";
}

// Radio Browser menandai stasiun HLS dengan hls = 1. Favorit yang disimpan sebelum field itu
// ada dikenali dari URL .m3u8.
function isHlsStation(station) {
  return station.hls === true || /\.m3u8(\?|$)/i.test(station.url);
}

// Format playlist audio (.pls atau .m3u biasa non-HLS) sering berisi URL stream audio langsung.
function isPlaylistUrl(url) {
  return /\.(pls|m3u)(\?|$)/i.test(url);
}

function parsePlsPlaylist(content) {
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^File\d+=(https?:\/\/.+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parseM3uPlaylist(content) {
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line && !line.startsWith("#") && /^https?:\/\//i.test(line)) {
      return line;
    }
  }
  return null;
}

// Unduh isi playlist dan ekstrak URL stream audio langsung jika tersedia.
// Jika CORS memblokir atau format tidak valid, kembalikan URL asli sebagai fallback.
async function resolvePlaylistUrl(url, requestId) {
  if (!isPlaylistUrl(url)) return url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAYLIST_RESOLVE_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return url;
    if (requestId !== playRequestId) return url;

    const text = await response.text();
    if (requestId !== playRequestId) return url;

    const isPls = /\.pls(\?|$)/i.test(url);
    const resolved = isPls ? parsePlsPlaylist(text) : parseM3uPlaylist(text);
    return resolved || url;
  } catch (error) {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// Pasang stream ke elemen audio. Mengganti stream otomatis menghentikan yang sebelumnya.
// HLS diputar lewat hls.js (Media Source Extensions) kalau browser tidak memutarnya sendiri,
// misalnya Firefox. Safari dan stream Icecast/MP3 biasa langsung lewat elemen audio.
async function attachStream(station, requestId) {
  detachStream();
  streamSeconds = 0;
  lastMediaTime = null;

  if (isHlsStation(station) && !audioPlayer.canPlayType("application/vnd.apple.mpegurl")) {
    // Stream sebelumnya dihentikan sekarang. Kalau tidak, ia tetap terdengar selama hls.js diunduh.
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();

    const Hls = await loadHls();
    if (requestId !== playRequestId) return;
    if (!Hls.isSupported()) throw new Error("Browser tidak mendukung Media Source Extensions");

    const instance = new Hls(HLS_CONFIG);
    hls = instance;
    // Error yang tidak fatal dipulihkan sendiri oleh hls.js. Error fatal diperlakukan sama
    // dengan event error elemen audio.
    instance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal && requestId === playRequestId) handleStreamFailure(station);
    });
    instance.loadSource(station.url);
    instance.attachMedia(audioPlayer);
    // Error fatal yang dikirim sinkron di atas sudah melepas stream ini.
    if (requestId !== playRequestId) return;
  } else {
    const resolvedUrl = await resolvePlaylistUrl(station.url, requestId);
    if (requestId !== playRequestId) return;
    audioPlayer.src = resolvedUrl;
    audioPlayer.load();
  }
  streamAttached = true;
}

function detachStream() {
  streamAttached = false;
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

// Script dimuat sekali dan dipakai ulang. Kalau gagal dimuat, percobaan berikutnya memuat ulang.
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoader) {
    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HLS_SCRIPT;
      script.onload = () => {
        if (window.Hls) {
          resolve(window.Hls);
          return;
        }
        hlsLoader = null;
        reject(new Error("hls.js tidak terpasang sesudah dimuat"));
      };
      script.onerror = () => {
        script.remove();
        hlsLoader = null;
        reject(new Error("hls.js gagal dimuat"));
      };
      document.head.append(script);
    });
  }
  return hlsLoader;
}

function failAfter(ms, station, requestId) {
  return setTimeout(() => {
    if (requestId !== playRequestId) return;
    handleStreamFailure(station, { name: "TimeoutError" });
  }, ms);
}

function clearStreamTimers() {
  clearTimeout(connectTimer);
  clearTimeout(stallTimer);
  connectTimer = null;
  stallTimer = null;
}

// Lepas stream dari elemen audio. Event pause dan error yang menyusul diabaikan
// karena streamAttached sudah false, dan promise play() yang tertunda jadi permintaan lama.
function abortStream() {
  playRequestId++;
  clearStreamTimers();
  detachStream();
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
}

// Stream yang sudah berbunyi lalu putus disambung ulang dengan jeda yang makin panjang.
// Stream yang belum pernah berbunyi berarti stasiun offline atau URL rusak, jadi langsung gagal.
function handleStreamFailure(station, error) {
  const wasStreaming = isPlaying || reconnectAttempt > 0;
  const blocked = error && error.name === "NotAllowedError";

  if (wasStreaming && !blocked && reconnectAttempt < RECONNECT_DELAYS_MS.length) {
    // Jangan bunuh elemen audio jika audio masih berbunyi dari buffer lokal.
    // Matikan timer koneksi/stall, namun biarkan sisa buffer berbunyi hingga
    // sambung ulang berikutnya siap memasang stream baru.
    clearStreamTimers();
    scheduleReconnect(station);
    return;
  }

  abortStream();
  const lostAfterRetry = reconnectAttempt > 0 && !blocked;
  cancelReconnect();
  markStreamFailed(station, lostAfterRetry ? { name: "ConnectionLost" } : error);
}

function scheduleReconnect(station) {
  const delay = RECONNECT_DELAYS_MS[reconnectAttempt];
  isPlaying = false;
  isBuffering = false;
  isConnecting = true;
  showStatus(`Koneksi terputus. Menyambung ulang dalam ${delay / 1000} detik...`);
  updatePlaybackUI();
  reconnectTimer = setTimeout(() => runReconnect(station), delay);
}

// Tanpa jaringan percobaan pasti gagal. Jumlah percobaan tidak bertambah sampai event online dikirim.
function runReconnect(station) {
  reconnectTimer = null;
  if (!navigator.onLine) {
    waitingForNetwork = true;
    showStatus("Koneksi terputus. Menunggu jaringan tersambung lagi...");
    return;
  }
  reconnectAttempt += 1;
  playStation(station, { reconnect: true });
}

function handleOnline() {
  if (!waitingForNetwork || !currentStation) return;
  // Beri jeda debounce agar koneksi jaringan dan rute DNS stabil sebelum mencoba lagi.
  clearTimeout(onlineTimer);
  showStatus("Jaringan terdeteksi kembali. Menyiapkan sambung ulang...");
  onlineTimer = setTimeout(() => {
    onlineTimer = null;
    if (!waitingForNetwork || !currentStation) return;
    waitingForNetwork = false;
    runReconnect(currentStation);
  }, ONLINE_RECONNECT_DELAY_MS);
}

function cancelReconnect() {
  clearTimeout(reconnectTimer);
  clearTimeout(onlineTimer);
  reconnectTimer = null;
  onlineTimer = null;
  reconnectAttempt = 0;
  waitingForNetwork = false;
}

function stopPlayback(message) {
  abortStream();
  cancelReconnect();
  isConnecting = false;
  isPlaying = false;
  isBuffering = false;
  retryButton.hidden = true;
  showStatus(message);
  setMediaPlaybackState("paused");
  updateMediaSessionPosition();
  updatePlaybackUI();
}

function closePlayer() {
  abortStream();
  cancelReconnect();
  cancelSleepTimer();
  currentStation = null;
  isPlaying = false;
  isConnecting = false;
  isBuffering = false;
  retryButton.hidden = true;
  removeJson(LAST_STATION_KEY);
  setPlayerStation(null);
  showStatus("Pilih radio lalu tekan Putar.");
  clearMediaSession();
  updatePlaybackUI();
}

function markStreamFailed(station, error) {
  clearStreamTimers();
  isConnecting = false;
  isPlaying = false;
  isBuffering = false;

  // Autoplay diblokir browser: stasiunnya tidak rusak, cukup tekan Putar lagi.
  if (error && error.name === "NotAllowedError") {
    showStatus("Browser memblokir audio. Tekan Putar sekali lagi.");
    setMediaPlaybackState("paused");
    updatePlaybackUI();
    return;
  }

  failedStations.add(station.id);
  const unsupported = Boolean(error && error.name === "UnsupportedCodec");
  // Format yang tidak didukung tidak berubah dengan mencoba lagi.
  retryButton.hidden = unsupported;
  const failureMsg = streamFailureMessage(station, error);
  showStatus(failureMsg, true);
  if (!unsupported) {
    showToast(failureMsg, {
      icon: "wifiOff",
      actionLabel: "Coba lagi",
      onAction: () => playStation(station)
    });
  }
  setMediaPlaybackState("none");
  updatePlaybackUI();
}

function streamFailureMessage(station, error) {
  const name = error ? error.name : "";
  // Dua pesan AAC dimulai dengan faktanya, bukan nama stasiun: di HP status terpotong
  // satu baris, dan nama stasiun sudah tampil di atasnya.
  if (name === "UnsupportedCodec") {
    return "Format AAC tidak didukung browser ini. Coba buka Dengaran di browser lain, misalnya Chrome.";
  }
  if (name === "ConnectionLost") {
    return `Koneksi ke ${station.name} terputus dan tidak bisa disambung ulang. Coba lagi atau pilih stasiun lain.`;
  }
  // Sebagian browser menyatakan bisa memutar AAC padahal tidak, lalu stream menggantung
  // sampai batas waktu. Penyebabnya tidak bisa dibedakan dari stasiun offline, jadi
  // pesan ini menyebut keduanya.
  if (name === "TimeoutError" && isAacStation(station)) {
    return "Tidak merespons. Stasiun mungkin offline, atau browser ini tidak bisa memutar format AAC. Coba lagi atau buka di browser lain.";
  }
  if (name === "TimeoutError") {
    return `${station.name} tidak merespons. Coba lagi atau pilih stasiun lain.`;
  }
  if (isInsecureStream(station)) {
    return `${station.name} memakai stream HTTP yang diblokir browser di halaman HTTPS.`;
  }
  return `${station.name} tidak bisa diputar. Stasiun mungkin sedang offline.`;
}

function handleMiniPlayButton() {
  if (!currentStation) return;
  togglePlay(currentStation.id);
}

function handleAudioPause() {
  // Stream sudah dilepas berarti stop, batal, gagal, atau sambung ulang: pesannya sudah ditulis di sana.
  if (!streamAttached) return;
  // Server menutup koneksi: event ended menyusul dan ditangani handleAudioEnded.
  if (audioPlayer.ended) return;

  // Jeda dari luar halaman (tombol headset, lepas Bluetooth) diperlakukan sebagai Stop.
  if (currentStation && isPlaying) stopPlayback("Dihentikan.");
}

function handleAudioWaiting() {
  if (!currentStation || !isPlaying || isBuffering) return;

  isBuffering = true;
  bufferingStartTime = audioPlayer.currentTime;
  showStatus("Menunggu data stream...");
  stallTimer = failAfter(STALL_TIMEOUT_MS, currentStation, playRequestId);
  updateMediaSessionPosition();
  updatePlaybackUI();
}

// Chrome mengirim "stalled" kalau data stream tidak datang sekitar 3 detik, walau audio masih
// berjalan dari buffer. Event "playing" tidak menyusul karena audio tidak pernah berhenti, jadi
// tanpa pengecekan ini timer STALL_TIMEOUT_MS menghentikan stream yang masih berbunyi.
function handleAudioTimeUpdate() {
  if (isBuffering && !audioPlayer.paused && audioPlayer.currentTime > bufferingStartTime) {
    handleAudioPlaying();
  }
  if (!isPlaying || isBuffering) return;

  // timeupdate dikirim beberapa kali per detik. Selisih di atas 2 detik berarti seek,
  // bukan waktu yang didengar.
  const now = audioPlayer.currentTime;
  const delta = lastMediaTime === null ? 0 : now - lastMediaTime;
  if (delta > 0 && delta < 2) {
    listenSeconds += delta;
    streamSeconds += delta;
  }
  lastMediaTime = now;
  if (reconnectAttempt > 0 && streamSeconds >= RECONNECT_RESET_SECONDS) reconnectAttempt = 0;
  listenTime.textContent = formatTime(listenSeconds);
  // Update posisi media session tiap beberapa detik
  if (Math.floor(listenSeconds) % 5 === 0) {
    updateMediaSessionPosition();
  }
}

function handleAudioPlaying() {
  if (!currentStation || !streamAttached) return;

  clearStreamTimers();
  isConnecting = false;
  isPlaying = true;
  isBuffering = false;
  retryButton.hidden = true;
  showStatus("Sedang memutar.");
  setMediaPlaybackState("playing");
  updateMediaSessionPosition();
  updatePlaybackUI();
}

function handleAudioError() {
  if (!currentStation || !streamAttached) return;
  handleStreamFailure(currentStation);
}

// Stream live tidak punya akhir. ended berarti server menutup koneksi, misalnya saat restart.
function handleAudioEnded() {
  if (!currentStation || !streamAttached) return;
  handleStreamFailure(currentStation);
}

// ---------- Volume ----------

function toggleMute() {
  audioPlayer.muted = !audioPlayer.muted;
  updateVolumeUI();
  showToast(audioPlayer.muted ? "Suara dibisukan." : "Suara dinyalakan.", {
    icon: audioPlayer.muted ? "volumeOff" : "volumeHigh"
  });
}

// Ikon Lucide mengikuti level: volume-x (bisu atau 0), volume-1 (di bawah 50%), volume-2.
function updateVolumeUI() {
  const percent = Math.round(audioPlayer.volume * 100);
  const silent = audioPlayer.muted || percent === 0;

  muteButton.innerHTML = silent ? ICONS.volumeOff : percent < 50 ? ICONS.volumeLow : ICONS.volumeHigh;
  muteButton.setAttribute("aria-pressed", audioPlayer.muted ? "true" : "false");
  muteButton.setAttribute("aria-label", audioPlayer.muted ? "Nyalakan suara" : "Bisukan");
  muteButton.title = audioPlayer.muted ? "Nyalakan suara (M)" : "Bisukan (M)";

  volumeInput.style.setProperty("--vol", `${percent}%`);
  volumeInput.setAttribute("aria-valuetext", `${percent}%`);
  volumeValue.textContent = `${percent}%`;
  volumeControl.classList.toggle("is-muted", audioPlayer.muted);
}

function updateShortcutUI() {
  shortcutOnText.hidden = !shortcutsEnabled;
  shortcutOffText.hidden = shortcutsEnabled;
  shortcutToggle.textContent = shortcutsEnabled ? "Matikan pintasan" : "Aktifkan pintasan";
}

function restoreVolume() {
  const volume = Number(loadJson(VOLUME_KEY, 1));
  const safeVolume = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;
  audioPlayer.volume = safeVolume;
  volumeInput.value = String(safeVolume);
  updateVolumeUI();
}

// ---------- Pengatur Waktu Tidur (Sleep Timer) ----------

function setSleepTimer(minutes) {
  cancelSleepTimer();

  if (minutes <= 0) {
    sleepTimerMinutes = 0;
    updateSleepTimerUI();
    showToast("Pengatur waktu tidur dimatikan.", { icon: "timer" });
    return;
  }

  sleepTimerMinutes = minutes;
  sleepTimerEnd = Date.now() + minutes * 60 * 1000;
  updateSleepTimerUI();
  showToast(`Waktu tidur diatur: ${minutes} menit.`, { icon: "timer" });

  sleepTimerTicker = setInterval(tickSleepTimer, 1000);
  tickSleepTimer();
}

function cancelSleepTimer() {
  clearInterval(sleepTimerTicker);
  clearInterval(sleepFadeTicker);
  sleepTimerTicker = null;
  sleepFadeTicker = null;

  if (sleepOriginalVolume !== null) {
    audioPlayer.volume = sleepOriginalVolume;
    sleepOriginalVolume = null;
    updateVolumeUI();
  }

  sleepTimerMinutes = 0;
  sleepTimerEnd = null;
  updateSleepTimerUI();
}

function tickSleepTimer() {
  if (!sleepTimerEnd) return;

  const remainingMs = sleepTimerEnd - Date.now();
  if (remainingMs <= 0) {
    clearInterval(sleepTimerTicker);
    sleepTimerTicker = null;
    finishSleepTimer();
    return;
  }

  const remainingSecs = Math.max(0, Math.ceil(remainingMs / 1000));
  sleepTimerBadge.innerHTML = `${ICONS.timer} ${formatTime(remainingSecs)}`;

  // Fade out 5 detik sebelum waktu habis saat audio sedang berbunyi
  if (remainingMs <= 5000 && !sleepFadeTicker && (isPlaying || streamAttached)) {
    startSleepFadeOut();
  }
}

function startSleepFadeOut() {
  if (sleepFadeTicker) return;
  sleepOriginalVolume = audioPlayer.volume;
  const startVol = audioPlayer.volume;
  const fadeStart = Date.now();
  const fadeDuration = 5000;

  sleepFadeTicker = setInterval(() => {
    const elapsed = Date.now() - fadeStart;
    const progress = Math.min(1, elapsed / fadeDuration);
    audioPlayer.volume = Math.max(0, startVol * (1 - progress));
    updateVolumeUI();

    if (progress >= 1) {
      clearInterval(sleepFadeTicker);
      sleepFadeTicker = null;
    }
  }, 100);
}

function finishSleepTimer() {
  stopPlayback("Waktu tidur selesai.");
  showToast("Waktu tidur selesai. Pemutaran dihentikan.", { icon: "timer" });
  cancelSleepTimer();
}

function updateSleepTimerUI() {
  const isActive = sleepTimerMinutes > 0 && sleepTimerEnd !== null;
  sleepTimerBadge.hidden = !isActive;
  sleepTimerButton.classList.toggle("is-active", isActive);

  if (!isActive) {
    sleepTimerBadge.textContent = "";
  }

  if (sleepTimerOptions) {
    sleepTimerOptions.querySelectorAll(".sleep-option").forEach(btn => {
      const mins = Number(btn.dataset.sleepMinutes || 0);
      const isSelected = mins === sleepTimerMinutes;
      btn.classList.toggle("is-active", isSelected);
      btn.setAttribute("aria-checked", String(isSelected));
      let statusEl = btn.querySelector(".sleep-option-status");
      if (isSelected && mins > 0) {
        if (!statusEl) {
          statusEl = document.createElement("span");
          statusEl.className = "sleep-option-status";
          btn.appendChild(statusEl);
        }
        statusEl.textContent = "Aktif";
      } else if (mins === 0) {
        if (statusEl) statusEl.textContent = isSelected ? "Nonaktif" : "";
      } else if (statusEl) {
        statusEl.remove();
      }
    });
  }
}

// ---------- Media Session (lock screen / notifikasi HP) ----------

function setMediaSession(station) {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: localizedCountry(station.countryCode, station.country) || "Dengaran",
    album: "Dengaran"
  });

  setMediaAction("play", () => {
    if (currentStation && !isPlaying && !isConnecting) playStation(currentStation);
  });
  setMediaAction("pause", () => stopPlayback("Dihentikan."));
  setMediaAction("stop", () => stopPlayback("Dihentikan."));
  setMediaAction("nexttrack", () => playAdjacent(1));
  setMediaAction("previoustrack", () => playAdjacent(-1));
  setMediaPlaybackState("playing");
  updateMediaSessionPosition();
}

// Browser lama melempar error untuk action yang tidak didukung.
function setMediaAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch (error) {
    // Action tidak didukung: lewati.
  }
}

function setMediaPlaybackState(state) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

function updateMediaSessionPosition() {
  if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") return;
  try {
    if (isPlaying && !isBuffering && listenSeconds > 0) {
      navigator.mediaSession.setPositionState({
        duration: Math.max(listenSeconds, 1),
        playbackRate: 1,
        position: Math.max(listenSeconds, 0)
      });
    } else {
      navigator.mediaSession.setPositionState(null);
    }
  } catch (error) {
    // Format durasi tidak didukung atau status posisi live diabaikan oleh browser.
  }
}

function clearMediaSession() {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    try {
      if (typeof navigator.mediaSession.setPositionState === "function") {
        navigator.mediaSession.setPositionState(null);
      }
    } catch (error) {}
  }
}

// ---------- Favorit ----------

function addFavorite(stationId, sourceButton) {
  const station = findStationById(stationId);
  if (!station || isFavorite(station.id)) return;

  favorites.unshift(station);
  refreshFavoriteViews();

  showToast("ditambahkan ke Favorit.", {
    strong: station.name,
    icon: "heart",
    tone: "favorite"
  });
}

function removeFavorite(stationId, sourceButton) {
  const index = favorites.findIndex(station => station.id === stationId);
  if (index === -1) return;

  const removedStation = favorites[index];
  const favoriteHearts = Array.from(favoriteList.querySelectorAll('[data-action="toggle-favorite"]'));
  const visibleIndex = favoriteHearts.indexOf(sourceButton);

  favorites.splice(index, 1);
  refreshFavoriteViews();

  // Tombol yang diklik di tab favorit ikut hilang:
  // pindahkan fokus ke kartu favorit di posisi yang sama, atau ke tab favorit.
  if (visibleIndex !== -1) focusFavoriteAt(visibleIndex);

  showToast("dihapus dari favorit.", {
    strong: removedStation.name,
    icon: "heartOff",
    actionLabel: "Batalkan",
    onAction: () => {
      if (isFavorite(removedStation.id)) return;
      favorites.splice(Math.min(index, favorites.length), 0, removedStation);
      refreshFavoriteViews();
      showToast("dikembalikan ke favorit.", {
        strong: removedStation.name,
        icon: "heart",
        tone: "favorite"
      });
    }
  });
}

function refreshFavoriteViews() {
  saveJson(FAVORITE_KEY, favorites);
  renderFavorites();
  updateFavoriteButtons();
}

function focusFavoriteAt(index) {
  const hearts = favoriteList.querySelectorAll('[data-action="toggle-favorite"]');
  const target = hearts[Math.min(index, hearts.length - 1)];
  (target || tabFavorite).focus({ preventScroll: Boolean(target) });
}

function findStationById(stationId) {
  return (
    stations.find(station => station.id === stationId) ||
    favorites.find(station => station.id === stationId) ||
    history.find(station => station.id === stationId) ||
    (currentStation && currentStation.id === stationId ? currentStation : null)
  );
}

function isFavorite(stationId) {
  return favorites.some(station => station.id === stationId);
}

// ---------- Baru diputar & stasiun terakhir ----------

function addToHistory(station) {
  // Tombol yang sedang difokus ikut diganti saat render ulang: catat aksinya dulu.
  const active = document.activeElement;
  const focusKey = active && historyList.contains(active) && active.dataset.action
    ? { action: active.dataset.action, id: active.dataset.id }
    : null;

  history = [station]
    .concat(history.filter(item => item.id !== station.id))
    .slice(0, HISTORY_LIMIT);
  saveJson(HISTORY_KEY, history);
  renderHistory();

  if (focusKey) {
    const target = historyList.querySelector(
      `[data-action="${focusKey.action}"][data-id="${cssEscape(focusKey.id)}"]`
    );
    if (target) target.focus();
  }
}

function restoreLastStation() {
  const last = loadJson(LAST_STATION_KEY, null);

  if (!last || !last.id || !last.url || isBlockedStation(last)) {
    setPlayerStation(null);
    return;
  }

  // Siapkan di player tanpa auto-play (browser memblokir autoplay audio).
  currentStation = last;
  isPlaying = false;
  setPlayerStation(last);
  showStatus("Terakhir diputar. Tekan Putar untuk mendengarkan.");
}

// ---------- Layout & observer ----------

// Tinggi player dipakai CSS untuk posisi toast. Tinggi panel dipakai CSS desktop
// supaya jendela pas dengan judul Baru diputar ditambah HISTORY_LIMIT baris.
function observeLayout() {
  updateLayoutHeight();
  if (!("ResizeObserver" in window)) return;

  const observer = new ResizeObserver(() => {
    root.style.setProperty("--player-h", `${miniPlayer.offsetHeight}px`);
    updateLayoutHeight();
  });

  observer.observe(miniPlayer);
  observer.observe(historySection);
  observer.observe(heroHeader);
  observer.observe(controlsForm);
  window.addEventListener("resize", updateLayoutHeight);
}

// Tinggi panel = judul + baris utuh. Jumlah baris = HISTORY_LIMIT, atau sebanyak yang
// muat di layar (minimal 3), supaya baris terakhir tidak terpotong oleh player.
function updateLayoutHeight() {
  const header = historySection.querySelector(".section-header");
  // Panel tersembunyi (mobile): ukurannya 0, jangan timpa nilai terakhir.
  if (!header || header.offsetHeight === 0) return;

  // Di desktop, tab history disembunyikan. Jika sedang dalam state history, kembalikan ke radio.
  if (activeTab === "history") {
    setActiveTab("radio");
  }

  const row = (historyListDesktop && historyListDesktop.querySelector(".row")) || historyList.querySelector(".row");
  const measuredHeight = row ? row.getBoundingClientRect().height : 0;
  const rowHeight = measuredHeight > 0 ? measuredHeight : 61;
  const headerHeight = header.getBoundingClientRect().height;

  const appStyle = getComputedStyle(appShell);
  const chromeHeight =
    parseFloat(appStyle.paddingTop) +
    parseFloat(appStyle.paddingBottom) +
    (parseFloat(appStyle.rowGap) || 0) +
    heroHeader.offsetHeight +
    shortcutHint.offsetHeight +
    (shortcutHint.offsetHeight
      ? (parseFloat(appStyle.rowGap) || 0) + parseFloat(getComputedStyle(shortcutHint).marginTop)
      : 0) +
    controlsForm.offsetHeight +
    miniPlayer.offsetHeight +
    2; // border atas dan bawah jendela
  const fittingRows = Math.floor((window.innerHeight - chromeHeight - headerHeight) / rowHeight);
  const rows = Math.max(3, Math.min(HISTORY_LIMIT, fittingRows));

  root.style.setProperty("--layout-h", `${Math.ceil(headerHeight + rowHeight * rows)}px`);
}

// Muat halaman berikutnya otomatis saat tombol berjarak 400px dari tepi bawah panel.
// Tombolnya tetap ada untuk browser tanpa IntersectionObserver.
function observeLoadMore() {
  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    entries => {
      if (entries.some(entry => entry.isIntersecting)) checkLoadMoreProximity();
    },
    { root: radioScroll, rootMargin: "0px 0px 400px 0px" }
  );

  observer.observe(loadMoreButton);
}

function checkLoadMoreProximity() {
  if (loadMoreButton.hidden || loadMoreButton.disabled) return;
  // Panel tersembunyi (tampilan Baru diputar di mobile): posisi tombol tidak berarti.
  if (radioSection.offsetParent === null) return;

  const panelBottom = radioScroll.getBoundingClientRect().bottom;
  if (loadMoreButton.getBoundingClientRect().top < panelBottom + 400) {
    loadStations({ append: true });
  }
}

// ---------- API helper ----------

// Mencoba setiap mirror berurutan. Mengembalikan:
// - data JSON jika berhasil
// - "aborted" jika request dibatalkan (pencarian baru)
// - null jika semua mirror gagal
let apiServersPromise = null;
let apiServers = null;

// Daftar server diambil sekali per kunjungan. Hanya host *.api.radio-browser.info yang dipakai,
// karena isi respons menentukan ke mana fetch berikutnya dikirim.
function getApiServers() {
  if (!apiServersPromise) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_SERVER_LIST_TIMEOUT_MS);
    apiServersPromise = fetch(API_SERVER_LIST_URL, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : []))
      .then(list => {
        const names = Array.isArray(list)
          ? list.map(server => server && server.name).filter(name => /^[a-z0-9-]+\.api\.radio-browser\.info$/i.test(name || ""))
          : [];
        const servers = shuffle([...new Set(names)]).map(name => `https://${name}/json`);
        apiServers = servers.length ? servers : API_MIRRORS;
        return apiServers;
      })
      .catch(() => (apiServers = API_MIRRORS))
      .finally(() => clearTimeout(timer));
  }
  return apiServersPromise;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Request pertama tidak menunggu daftar server: selama daftar belum ada, API_MIRRORS dipakai,
// jadi daftar stasiun pertama tidak tertunda satu request tambahan.
async function apiFetch(path, { signal } = {}) {
  getApiServers();
  const servers = apiServers || API_MIRRORS;
  for (const base of servers) {
    try {
      const response = await fetch(base + path, { signal });
      if (!response.ok) continue;
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") return "aborted";
      // Mirror gagal, lanjut ke mirror berikutnya.
    }
  }
  return null;
}

// Laporkan "click" ke Radio Browser agar ranking popularitas akurat.
// Fire-and-forget: kegagalan diabaikan, cukup satu mirror.
function reportClick(stationId) {
  getApiServers()
    .then(servers => fetch(`${servers[0]}/url/${encodeURIComponent(stationId)}`))
    .catch(() => {});
}

// ---------- Util ----------

// Daftar stasiun tersimpan. Isi yang rusak (bukan array) dianggap kosong, dan stasiun
// yang diblokir sesudah disimpan pengguna ikut disaring.
function loadStationList(key) {
  const saved = loadJson(key, []);
  if (!Array.isArray(saved)) return [];
  // Stasiun yang disimpan sebelum logo dihapus masih berisi field favicon: dibuang saat dibaca.
  return saved
    .filter(station => station && station.id && !isBlockedStation(station))
    .map(({ favicon, ...station }) => station);
}

function loadJson(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Penyimpanan penuh atau diblokir: abaikan.
  }
}

function removeJson(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    // Penyimpanan diblokir: abaikan.
  }
}

function showStatus(message, isError = false) {
  playerStatus.textContent = message;
  playerStatus.classList.toggle("error", isError);
}

function announce(message) {
  resultAnnouncer.textContent = message;
}

// strong: nama stasiun, ditebalkan di depan pesan. icon: kunci ICONS. tone: warna ikon.
function showToast(message, { actionLabel = "", onAction = null, strong = "", icon = "", tone = "" } = {}) {
  const token = ++toastToken;
  const iconHtml = ICONS[icon] || "";
  toastIcon.innerHTML = iconHtml;
  toastIcon.hidden = !iconHtml;
  toast.dataset.tone = tone;
  toast.classList.remove("is-paused");
  toastAction.textContent = actionLabel;
  toastAction.hidden = !actionLabel;
  toastActionHandler = onAction;
  toastPaused = false;

  // Tampilkan dulu, isi teks sesudahnya: screen reader mengumumkan perubahan
  // isi live region, bukan elemen yang baru muncul.
  toastText.textContent = "";
  toast.hidden = true;
  void toast.offsetWidth;
  toast.hidden = false;
  setTimeout(() => {
    if (token !== toastToken) return;
    if (strong) {
      const name = document.createElement("strong");
      name.textContent = strong;
      toastText.replaceChildren(name, ` ${message}`);
    } else {
      toastText.textContent = message;
    }
  }, 60);

  const duration = actionLabel ? 6000 : 3500;
  // Garis waktu di bawah toast berjalan selama durasi yang sama.
  toast.style.setProperty("--toast-ms", `${duration}ms`);
  scheduleToastHide(duration);
}

function scheduleToastHide(ms) {
  clearTimeout(toastTimer);
  toastRemaining = ms;
  toastStartedAt = Date.now();
  toastTimer = setTimeout(hideToast, ms);
}

function pauseToast() {
  if (toast.hidden || toastPaused) return;
  toastPaused = true;
  toast.classList.add("is-paused");
  clearTimeout(toastTimer);
  toastRemaining -= Date.now() - toastStartedAt;
}

function resumeToast() {
  if (toast.hidden || !toastPaused) return;
  // Fokus atau kursor masih di dalam toast: tetap tunggu.
  if (toast.matches(":hover") || toast.contains(document.activeElement)) return;
  toastPaused = false;
  toast.classList.remove("is-paused");
  scheduleToastHide(Math.max(toastRemaining, 1500));
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
  toastPaused = false;
  toastActionHandler = null;
}

// "bahasa indonesia,indonesian" menjadi "Bahasa Indonesia".
function formatLanguage(value) {
  const first = String(value || "").split(",")[0].trim();
  if (!first) return "";
  return first.replace(/(^|\s)\S/g, letter => letter.toUpperCase());
}

function allTags(value) {
  return String(value || "")
    .split(",")
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);
}

// Tiga tag pertama yang unik dan pendek, untuk ditampilkan di kartu.
function parseTags(value) {
  const seen = new Set();
  return allTags(value)
    .filter(tag => tag.length <= 20 && !seen.has(tag) && seen.add(tag))
    .slice(0, 3);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

function debounce(callback, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => callback.apply(this, args), delay);
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
