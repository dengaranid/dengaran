"use strict";

// Satu-satunya import: daftar stasiun dan tag yang disembunyikan (lihat blockedStationIds).
import blocklist from "./blocklist.json" with { type: "json" };

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
  legalUpdated: "13 Oktober 2026"
};

// Stasiun dan tag yang disembunyikan, dibaca juga oleh scripts/build_public.py untuk halaman
// daftar radio. Stasiun di "stations" disembunyikan atas permintaan pemilik stasiun atau pemegang
// hak cipta, atau karena tidak bisa diputar; "id" diisi stationuuid dari Radio Browser. Cara
// mencarinya: buka https://de1.api.radio-browser.info/json/stations/byname/<nama stasiun>
// lalu salin nilai "stationuuid" milik stasiun yang dimaksud.
// Stasiun di daftar ini tidak muncul di pencarian, Favorit, Baru diputar, maupun player.
// Di produksi bun memasukkan isi JSON ke bundle, jadi tidak ada request tambahan.
const blockedStationIds = new Set(blocklist.stations.map(station => String(station.id).toLowerCase()));

// Stasiun dengan salah satu tag di "tags" disembunyikan dari pencarian, Favorit, dan Baru diputar.
// Dicocokkan dengan tag persis, bukan potongan nama: "adult" tidak dipakai karena di Radio
// Browser berarti format musik (adult contemporary), dan "sex" ada di nama seperti "BBC Essex".
const BLOCKED_TAGS = new Set(blocklist.tags.map(tag => String(tag).toLowerCase()));

function isBlockedStation(station) {
  if (!station) return false;
  if (blockedStationIds.has(String(station.id).toLowerCase())) return true;
  return allTags(station.tags).some(tag => BLOCKED_TAGS.has(tag));
}

const DEFAULT_COUNTRY = "ID";
const ALL_COUNTRIES = "";
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
// Volume sistem tidak bisa dibaca dari browser. Supaya suara tidak langsung keras saat volume
// sistem masih tinggi, pemutaran yang dimulai pengguna naik dari -40 dB ke level slider.
const FADE_IN_MS = 3000;
const FADE_IN_FLOOR_DB = -40;
// hls.js hanya dimuat saat stasiun HLS diputar di browser yang tidak memutar HLS sendiri.
// Versi ditulis di nama file supaya aturan cache immutable untuk *.min.js tetap aman.
const HLS_SCRIPT = "vendor/hls-1.7.3.light.min.js";
const HLS_CONFIG = {
  // Worker hls.js dibuat dari blob: URL dan diblokir CSP. Transmux stream audio di main thread
  // ringan, jadi worker tidak dipakai.
  enableWorker: false,
  // Mulai 4 segmen di belakang ujung playlist live, satu di atas batas minimum spesifikasi HLS,
  // supaya buffer lebih tebal di jaringan yang naik turun. Jarak ke siaran live tidak penting
  // untuk radio.
  liveSyncDurationCount: 4,
  // Kecepatan putar tetap 1x. Menjaga pitch pada kecepatan selain 1x memakai time-stretching
  // browser, yang bisa terdengar pada musik.
  maxLiveSyncPlaybackRate: 1,
  // Tertinggal lebih dari 10 segmen: seek langsung ke posisi live. Seek membuat sebagian audio
  // tidak terputar, jadi batasnya dinaikkan dari 6.
  liveMaxLatencyDurationCount: 10,
  // Batasi buffer di depan dan di belakang posisi putar supaya kuota dan memori tidak terpakai
  // untuk audio yang tidak akan didengar. Pemilihan bitrate (ABR) memakai default hls.js.
  maxBufferLength: 15,
  backBufferLength: 10,
  // Metadata ID3, EMSG, dan DATERANGE dari stream tidak dipakai aplikasi. Kalau aktif, hls.js
  // membuat <track src="data:,WEBVTT"> untuk menampungnya, dan CSP media-src memblokir data:.
  enableID3MetadataCues: false,
  enableEmsgMetadataCues: false,
  enableDateRangeMetadataCues: false
};
const FAVORITE_KEY = "radio_online_favorites_v1";
const LAST_STATION_KEY = "radio_online_last_station_v1";
const HISTORY_KEY = "radio_online_history_v1";
const VOLUME_KEY = "radio_online_volume_v1";
const SHORTCUTS_KEY = "radio_online_shortcuts_v1";
const RECENT_COUNTRIES_KEY = "radio_online_recent_countries_v1";
const RECENT_COUNTRIES_LIMIT = 3;

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

// Ikon Lucide "globe" dan "check" untuk pemilih negara.
const COUNTRY_ICONS = {
  globe: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  check: '<svg class="icon picker-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
};

const SORT_OPTIONS = [
  { order: "clickcount", label: "Terpopuler" },
  { order: "votes", label: "Paling disukai" },
  { order: "name", label: "Nama A-Z" },
  { order: "bitrate", label: "Bitrate tertinggi" }
];

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
const countryButton = document.getElementById("countryButton");
const countryButtonText = document.getElementById("countryButtonText");
const countryPopover = document.getElementById("countryPopover");
const countryFilter = document.getElementById("countryFilter");
const countryList = document.getElementById("countryList");
const countryEmpty = document.getElementById("countryEmpty");
const sortButton = document.getElementById("sortButton");
const sortButtonText = document.getElementById("sortButtonText");
const sortPopover = document.getElementById("sortPopover");
const sortList = document.getElementById("sortList");
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
const appFooter = document.querySelector(".app-footer");
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
// Kode negara yang dipakai pencarian. ALL_COUNTRIES berarti tanpa filter negara.
let selectedCountry = DEFAULT_COUNTRY;
// Nilai order untuk /stations/search, dipilih lewat pemilih urutan.
let sortOrder = "clickcount";
let sortActiveIndex = 0;
// Negara hasil tebakan browser, ditampilkan di grup Disarankan.
let detectedCountry = DEFAULT_COUNTRY;
let recentCountries = loadJson(RECENT_COUNTRIES_KEY, []);
if (!Array.isArray(recentCountries)) recentCountries = [];
// Daftar negara untuk pemilih: { code, name, english, key }. key adalah teks yang sudah
// dinormalisasi untuk pencocokan.
let countryOptions = [];
// Opsi yang sedang disorot di pemilih negara, berupa indeks di countryMatches.
let countryMatches = [];
let countryActiveIndex = -1;
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
// URL yang benar-benar dipasang ke elemen audio. Bisa berbeda dari station.url kalau URL
// stasiun adalah playlist .pls atau .m3u yang sudah diekstrak, atau kalau URL http:// diubah
// ke https:// oleh secureStreamUrl.
let streamUrl = "";
// True kalau URL stasiun atau URL hasil playlist aslinya http:// dan diubah ke https://.
let streamUpgraded = false;
// True kalau URL berpath / dipasang dengan path /; (lihat shoutcastStreamUrl). Diisi saat
// percobaan dengan /; dimulai, dan dipertahankan selama sambung ulang supaya sambung ulang
// tidak kembali ke path / yang gagal.
let shoutcastPath = false;
// Fetch playlist yang sedang berjalan. Dibatalkan saat stream dilepas atau diganti.
let playlistAbortController = null;
// Instance hls.js untuk stream yang sedang dipasang, dan promise pemuatan script-nya.
let hls = null;
let hlsLoader = null;
// Detik listenSeconds terakhir yang dikirim ke setPositionState, supaya timeupdate yang
// dikirim beberapa kali per detik tidak mengirim posisi yang sama berulang kali.
let lastPositionSecond = -1;
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
// Level slider yang dituju fade-in. null saat tidak ada fade-in yang menunggu atau berjalan.
let fadeInTarget = null;
let fadeInTicker = null;
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
countryButton.addEventListener("click", () => {
  if (countryPopover.hidden) openCountryPicker();
  else closeCountryPicker({ focusButton: false });
});
countryButton.addEventListener("keydown", handleCountryButtonKey);
countryFilter.addEventListener("input", () => renderCountryList(countryFilter.value));
countryFilter.addEventListener("keydown", handleCountryFilterKey);
// mousedown dicegah supaya fokus tetap di kolom ketik saat opsi diklik.
countryList.addEventListener("mousedown", event => event.preventDefault());
countryList.addEventListener("click", event => {
  const option = event.target.closest('[role="option"]');
  if (option) chooseCountry(option.dataset.code);
});
document.addEventListener("pointerdown", event => {
  if (countryPopover.hidden) return;
  if (countryPopover.contains(event.target) || countryButton.contains(event.target)) return;
  closeCountryPicker({ focusButton: false });
});
countryPopover.addEventListener("focusout", event => {
  // Tab keluar dari pemilih menutupnya. Fokus ke tombol pemilih ditangani tombol itu sendiri.
  if (event.relatedTarget && !countryPopover.contains(event.relatedTarget) && event.relatedTarget !== countryButton) {
    closeCountryPicker({ focusButton: false });
  }
});
sortButton.addEventListener("click", () => {
  if (sortPopover.hidden) openSortPicker();
  else closeSortPicker({ focusButton: false });
});
sortButton.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openSortPicker();
  }
});
sortList.addEventListener("keydown", handleSortListKey);
sortList.addEventListener("click", event => {
  const option = event.target.closest('[role="option"]');
  if (option) chooseSort(option.dataset.order);
});
document.addEventListener("pointerdown", event => {
  if (sortPopover.hidden) return;
  if (sortPopover.contains(event.target) || sortButton.contains(event.target)) return;
  closeSortPicker({ focusButton: false });
});
sortList.addEventListener("blur", event => {
  if (event.relatedTarget !== sortButton) closeSortPicker({ focusButton: false });
});
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
  stopFadeIn();
  audioPlayer.volume = Number(volumeInput.value);
  if (audioPlayer.muted && audioPlayer.volume > 0) audioPlayer.muted = false;
  saveJson(VOLUME_KEY, audioPlayer.volume);
  updateVolumeUI();
});

tabRadio.addEventListener("click", () => setActiveTab("radio"));
tabFavorite.addEventListener("click", () => setActiveTab("favorite"));
tabHistory.addEventListener("click", () => setActiveTab("history"));
radioSection.querySelector('[role="tablist"]').addEventListener("keydown", event => {
  // Tab Baru diputar disembunyikan CSS di desktop, jadi hanya tab yang tampil yang dilewati.
  const tabs = [tabRadio, tabFavorite, tabHistory].filter(tab => tab.getClientRects().length > 0);
  const nextIndex = tabIndexForKey(event.key, tabs.indexOf(event.target), tabs.length);
  if (nextIndex === null) return;
  event.preventDefault();
  tabs[nextIndex].click();
  tabs[nextIndex].focus();
});

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
  restoreLinkedStation();
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

// Negara hasil tebakan langsung dipakai pencarian pertama, tanpa menunggu /countries.
function selectInitialCountry() {
  detectedCountry = detectCountry();
  setSelectedCountry(detectedCountry);
}

function setSelectedCountry(code) {
  selectedCountry = code;
  countryButtonText.textContent = countryLabel(code);
}

function countryLabel(code) {
  if (code === ALL_COUNTRIES) return "Semua negara";
  const option = countryOptions.find(item => item.code === code);
  return option ? option.name : localizedCountry(code, code);
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
        return [code, localizedCountry(code, item.name), item.name];
      });
  }

  if (!countries || countries.length === 0) {
    countries = FALLBACK_COUNTRIES.map(([code, name]) => [code, name, ""]);
  }

  // API bisa mengembalikan kode yang sama lebih dari sekali dengan ejaan nama berbeda.
  const seen = new Set();
  countryOptions = countries
    .filter(([code]) => !seen.has(code) && seen.add(code))
    .map(([code, name, english]) => ({
      code,
      name,
      english,
      key: normalizeSearchText(`${name} ${english} ${code}`)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));

  if (selectedCountry !== ALL_COUNTRIES && !countryOptions.some(item => item.code === selectedCountry)) {
    // Negara hasil tebakan tidak punya stasiun di API: muat ulang dengan Indonesia.
    setSelectedCountry(DEFAULT_COUNTRY);
    startNewSearch();
  } else {
    setSelectedCountry(selectedCountry);
  }
  if (!countryPopover.hidden) renderCountryList(countryFilter.value);
}

function selectedCountryName() {
  return countryLabel(selectedCountry);
}

// Huruf kecil tanpa tanda diakritik, supaya "cote" cocok dengan "Côte d'Ivoire".
function normalizeSearchText(text) {
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// ---------- Pemilih negara ----------

function openCountryPicker(initialText = "") {
  closeSortPicker({ focusButton: false });
  countryPopover.hidden = false;
  countryButton.setAttribute("aria-expanded", "true");
  countryFilter.value = initialText;
  renderCountryList(initialText);
  countryFilter.focus();
}

function closeCountryPicker({ focusButton = true } = {}) {
  if (countryPopover.hidden) return;
  countryPopover.hidden = true;
  countryButton.setAttribute("aria-expanded", "false");
  countryFilter.removeAttribute("aria-activedescendant");
  if (focusButton) countryButton.focus();
}

function chooseCountry(code) {
  const changed = code !== selectedCountry;
  if (code !== ALL_COUNTRIES) {
    recentCountries = [code, ...recentCountries.filter(item => item !== code)].slice(0, RECENT_COUNTRIES_LIMIT);
    saveJson(RECENT_COUNTRIES_KEY, recentCountries);
  }
  setSelectedCountry(code);
  closeCountryPicker();
  if (changed) startNewSearch();
}

// Urutan hasil: nama yang diawali teks ketikan, lalu kata di dalam nama yang diawali teks itu,
// lalu sisanya yang memuat teks itu. Kode negara dua huruf yang sama persis ikut di urutan pertama.
// Tanpa ketikan, daftar disusun seperti pemilih negara pada umumnya: "Semua negara" (menempel
// di atas), grup Disarankan, lalu daftar negara A-Z. Negara di grup Disarankan muncul dua kali.
function matchCountries(query) {
  const term = normalizeSearchText(query);
  const all = { code: ALL_COUNTRIES, name: "Semua negara", key: "semua negara all" };
  if (!term) {
    const suggestedCodes = [...new Set([selectedCountry, detectedCountry, ...recentCountries])];
    const suggested = suggestedCodes
      .filter(code => code !== ALL_COUNTRIES)
      .map(code => countryOptions.find(option => option.code === code))
      .filter(Boolean)
      .map(option => ({ ...option, group: "suggested" }));
    return [all, ...suggested, ...countryOptions.map(option => ({ ...option, group: "az" }))];
  }

  const ranked = [];
  for (const option of [all, ...countryOptions]) {
    const index = option.key.indexOf(term);
    if (index === -1) continue;
    let rank = 2;
    if (index === 0 || option.code.toLowerCase() === term) rank = 0;
    else if (/[\s\-(']/.test(option.key[index - 1])) rank = 1;
    ranked.push({ option, rank });
  }
  // sort() stabil, jadi urutan abjad dari countryOptions tetap di dalam tiap peringkat.
  return ranked.sort((a, b) => a.rank - b.rank).map(item => item.option);
}

function renderCountryList(query) {
  countryMatches = matchCountries(query);
  const term = normalizeSearchText(query);

  const groupTitles = { suggested: "Disarankan", az: "Daftar negara A-Z" };
  countryList.innerHTML = countryMatches
    .map((option, index) => {
      const selected = option.code === selectedCountry;
      const icon = option.code === ALL_COUNTRIES ? COUNTRY_ICONS.globe : "";
      const startsGroup = option.group && option.group !== countryMatches[index - 1]?.group;
      const title = startsGroup
        ? `<li class="picker-group" role="presentation">${groupTitles[option.group]}</li>`
        : "";
      return `${title}<li id="country-option-${index}" class="picker-option${option.code === ALL_COUNTRIES ? " is-all" : ""}"
        role="option" aria-selected="${selected}" data-code="${escapeHtml(option.code)}">
        ${icon}<span class="picker-option-name">${highlightMatch(option.name, term)}</span>${selected ? COUNTRY_ICONS.check : ""}
      </li>`;
    })
    .join("");

  countryEmpty.hidden = countryMatches.length > 0;
  // Daftar selalu dibuka dari atas. Tanpa ketikan, sorotan ada di pilihan sekarang, yang pertama
  // kali muncul di dekat atas (di grup Disarankan). Dengan ketikan, di hasil teratas.
  countryList.scrollTop = 0;
  const selectedIndex = countryMatches.findIndex(option => option.code === selectedCountry);
  setCountryActive(term ? 0 : Math.max(selectedIndex, 0));
}

// Tandai bagian nama yang cocok dengan ketikan. Pencocokan memakai teks tanpa diakritik,
// jadi posisi dicari di nama yang dinormalisasi per karakter.
function highlightMatch(name, term) {
  if (!term) return escapeHtml(name);
  const chars = Array.from(name);
  const plain = chars.map(char => normalizeSearchText(char) || char).join("");
  const index = plain.indexOf(term);
  if (index === -1 || plain.length !== chars.length) return escapeHtml(name);
  return escapeHtml(chars.slice(0, index).join(""))
    + `<mark>${escapeHtml(chars.slice(index, index + term.length).join(""))}</mark>`
    + escapeHtml(chars.slice(index + term.length).join(""));
}

function setCountryActive(index, { block = "nearest" } = {}) {
  const previous = countryList.querySelector(".is-active");
  if (previous) previous.classList.remove("is-active");
  countryActiveIndex = countryMatches.length ? Math.min(Math.max(index, 0), countryMatches.length - 1) : -1;
  if (countryActiveIndex === -1) {
    countryFilter.removeAttribute("aria-activedescendant");
    return;
  }
  const option = document.getElementById(`country-option-${countryActiveIndex}`);
  option.classList.add("is-active");
  countryFilter.setAttribute("aria-activedescendant", option.id);
  option.scrollIntoView({ block });
}

function handleCountryFilterKey(event) {
  const pageStep = 8;
  const last = countryMatches.length - 1;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setCountryActive(countryActiveIndex >= last ? 0 : countryActiveIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setCountryActive(countryActiveIndex <= 0 ? last : countryActiveIndex - 1);
  } else if (event.key === "PageDown") {
    event.preventDefault();
    setCountryActive(countryActiveIndex + pageStep);
  } else if (event.key === "PageUp") {
    event.preventDefault();
    setCountryActive(countryActiveIndex - pageStep);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (countryActiveIndex !== -1) chooseCountry(countryMatches[countryActiveIndex].code);
  } else if (event.key === "Escape") {
    event.preventDefault();
    // Esc pertama menghapus ketikan, Esc kedua menutup pemilih.
    if (countryFilter.value) {
      countryFilter.value = "";
      renderCountryList("");
    } else {
      closeCountryPicker();
    }
  }
}

// Panah bawah membuka pemilih. Huruf yang diketik saat tombol difokus langsung jadi ketikan
// pencarian, sama seperti select bawaan yang melompat ke huruf awal.
function handleCountryButtonKey(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openCountryPicker();
  } else if (
    event.key.length === 1 && event.key !== " " && event.key !== "/"
    && !event.metaKey && !event.ctrlKey && !event.altKey
  ) {
    event.preventDefault();
    openCountryPicker(event.key);
  }
}

// ---------- Pemilih urutan ----------

// Daftar pendek tanpa kolom ketik: fokus pindah ke listbox, dan opsi disorot lewat
// aria-activedescendant seperti di pemilih negara.
function openSortPicker() {
  closeCountryPicker({ focusButton: false });
  sortPopover.hidden = false;
  sortButton.setAttribute("aria-expanded", "true");
  sortList.innerHTML = SORT_OPTIONS
    .map((option, index) => {
      const selected = option.order === sortOrder;
      return `<li id="sort-option-${index}" class="picker-option" role="option" aria-selected="${selected}"
        data-order="${option.order}"><span class="picker-option-name">${option.label}</span>${selected ? COUNTRY_ICONS.check : ""}</li>`;
    })
    .join("");
  setSortActive(Math.max(SORT_OPTIONS.findIndex(option => option.order === sortOrder), 0));
  sortList.focus();
}

function closeSortPicker({ focusButton = true } = {}) {
  if (sortPopover.hidden) return;
  sortPopover.hidden = true;
  sortButton.setAttribute("aria-expanded", "false");
  if (focusButton) sortButton.focus();
}

function chooseSort(order) {
  const changed = order !== sortOrder;
  sortOrder = order;
  sortButtonText.textContent = SORT_OPTIONS.find(option => option.order === order).label;
  closeSortPicker();
  if (changed) startNewSearch();
}

function setSortActive(index) {
  const previous = sortList.querySelector(".is-active");
  if (previous) previous.classList.remove("is-active");
  sortActiveIndex = (index + SORT_OPTIONS.length) % SORT_OPTIONS.length;
  const option = document.getElementById(`sort-option-${sortActiveIndex}`);
  option.classList.add("is-active");
  sortList.setAttribute("aria-activedescendant", option.id);
}

function handleSortListKey(event) {
  if (event.key === "ArrowDown") setSortActive(sortActiveIndex + 1);
  else if (event.key === "ArrowUp") setSortActive(sortActiveIndex - 1);
  else if (event.key === "Home") setSortActive(0);
  else if (event.key === "End") setSortActive(SORT_OPTIONS.length - 1);
  else if (event.key === "Enter" || event.key === " ") chooseSort(SORT_OPTIONS[sortActiveIndex].order);
  else if (event.key === "Escape") closeSortPicker();
  else if (event.key === "Tab") {
    closeSortPicker({ focusButton: false });
    return;
  } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    // Huruf awal melompat ke opsi yang diawali huruf itu, seperti select bawaan.
    const letter = event.key.toLowerCase();
    const count = SORT_OPTIONS.length;
    for (let step = 1; step <= count; step++) {
      const index = (sortActiveIndex + step) % count;
      if (SORT_OPTIONS[index].label.toLowerCase().startsWith(letter)) {
        setSortActive(index);
        break;
      }
    }
  } else {
    return;
  }
  event.preventDefault();
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
  const countryCode = selectedCountry;
  const searchTerm = searchInput.value.trim();
  const order = sortOrder;

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
    name: searchTerm,
    hidebroken: "true",
    limit: String(PAGE_SIZE),
    offset: String(currentOffset),
    order: order,
    reverse: order === "name" ? "false" : "true"
  });
  if (countryCode !== ALL_COUNTRIES) params.set("countrycode", countryCode);
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

    const inCountry = selectedCountry === ALL_COUNTRIES ? "" : ` di ${escapeHtml(selectedCountryName())}`;

    if (filters.length) {
      // Pencarian di satu negara kosong: tawarkan mencari nama yang sama di semua negara.
      const allCountriesButton = selectedCountry === ALL_COUNTRIES
        ? ""
        : `<button class="btn btn-inline" type="button" data-action="search-all-countries">Cari di semua negara</button>`;
      stationList.innerHTML = `
        <div class="empty">
          Tidak ada radio ${filters.join(" dan ")}${inCountry}.
          <br />
          <span class="empty-actions">
            ${allCountriesButton}
            <button class="btn btn-inline${allCountriesButton ? " btn-quiet" : ""}" type="button" data-action="clear-filters">Hapus pencarian</button>
          </span>
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
  tabRadio.tabIndex = tab === "radio" ? 0 : -1;
  tabFavorite.tabIndex = tab === "favorite" ? 0 : -1;
  tabHistory.tabIndex = tab === "history" ? 0 : -1;
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
    ? `<span class="insecure-badge" title="Stream HTTP: diputar lewat HTTPS kalau server stasiun mendukung">HTTP</span>`
    : "";
}

function metaText(station, { withLanguage = true } = {}) {
  const parts = [
    localizedCountry(station.countryCode, station.country) || "Negara tidak diketahui"
  ];
  const language = withLanguage ? formatLanguage(station.language) : "";
  if (language) parts.push(language);
  const quality = qualityText(station);
  if (quality) parts.push(quality);
  return parts.join(" • ");
}

// Codec ditampilkan di samping bitrate karena kbps saja tidak bisa dibandingkan antar codec:
// AAC+ 64 kbps umumnya terdengar setara MP3 sekitar 128 kbps. Radio Browser menulis "UNKNOWN"
// kalau codec tidak terdeteksi, dan stream HLS video bisa berisi beberapa codec ("AAC,H.264"),
// jadi hanya codec pertama yang diambil.
function qualityText(station) {
  const codec = (station.codec || "").split(",")[0].trim().toUpperCase();
  const parts = [];
  if (codec && codec !== "UNKNOWN") parts.push(codec);
  if (station.bitrate) parts.push(`${station.bitrate} kbps`);
  return parts.join(" ");
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
  else if (action === "search-all-countries") {
    setSelectedCountry(ALL_COUNTRIES);
    startNewSearch();
    countryButton.focus();
  }
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

    const nextIndex = tabIndexForKey(event.key, tabs.indexOf(currentTab), tabs.length);

    if (nextIndex !== null) {
      event.preventDefault();
      const targetTab = tabs[nextIndex];
      selectDialogTab(targetTab, true);
      targetTab.focus();
    }
  });
}

// Pola tablist WAI-ARIA: panah kiri/kanan berpindah melingkar, Home dan End ke ujung.
// Mengembalikan null untuk tombol lain, atau kalau fokus tidak berada di salah satu tab.
function tabIndexForKey(key, currentIndex, length) {
  if (currentIndex < 0) return null;
  if (key === "ArrowRight") return (currentIndex + 1) % length;
  if (key === "ArrowLeft") return (currentIndex - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
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

async function playStation(station, { reconnect = false, shoutcastRetry = false } = {}) {
  clearStreamTimers();
  // Pemutaran yang dimulai pengguna membatalkan sambung ulang yang sedang berjalan.
  if (!reconnect) cancelReconnect();
  if (!reconnect) shoutcastPath = shoutcastRetry;
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

  // Sambung ulang dan percobaan dengan path /; bukan klik baru: jumlah klik di Radio Browser
  // tidak ditambah lagi.
  if (!reconnect && !shoutcastRetry) {
    listenSeconds = 0;
    lastPositionSecond = -1;
    saveJson(LAST_STATION_KEY, station);
    reportClick(station.id);
  }

  // Sambung ulang tidak di-fade: sisa buffer stream lama masih berbunyi di level slider.
  if (!reconnect) prepareFadeIn();

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
  startFadeIn();
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

  cancelPlaylistFetch();
  const controller = new AbortController();
  playlistAbortController = controller;
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
    if (playlistAbortController === controller) playlistAbortController = null;
  }
}

function cancelPlaylistFetch() {
  if (playlistAbortController) {
    playlistAbortController.abort();
    playlistAbortController = null;
  }
}

// Di halaman HTTPS, URL http:// diblokir CSP (media-src dan connect-src hanya https: dan blob:)
// sebelum browser sempat mengubahnya sendiri ke https://. Banyak server stream juga melayani
// HTTPS di host dan port yang sama, jadi URL dicoba sebagai https://. Kalau versi HTTPS gagal,
// stream gagal seperti biasa dan pesan gagal menyebut stream HTTP.
function secureStreamUrl(url) {
  return SECURE_PAGE ? String(url).replace(/^http:/i, "https:") : url;
}

// Server Shoutcast v2 membalas request browser ke path / dengan redirect ke halaman status
// (index.html?sid=1), bukan audio, dan Chrome memblokir halaman itu. Path /; di server yang
// sama mengirim audio. URL dengan path lain, query, atau hash tidak diubah.
function shoutcastStreamUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return url;
    parsed.pathname = "/;";
    return parsed.href;
  } catch (error) {
    return url;
  }
}

// Pasang stream ke elemen audio. Mengganti stream otomatis menghentikan yang sebelumnya.
// HLS diputar lewat hls.js (Media Source Extensions) kalau browser tidak memutarnya sendiri,
// misalnya Firefox. Safari dan stream Icecast/MP3 biasa langsung lewat elemen audio.
async function attachStream(station, requestId) {
  detachStream();
  // Tidak dikosongkan saat stream dilepas: pesan gagal masih membacanya sesudah abortStream.
  streamUrl = secureStreamUrl(station.url);
  streamUpgraded = streamUrl !== station.url;
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
    let mediaErrorRecovered = false;
    // Error yang tidak fatal dipulihkan sendiri oleh hls.js. Error media fatal (decode atau
    // buffer MSE) dicoba pulihkan sekali dengan recoverMediaError. Error fatal lainnya, atau
    // error media kedua, diperlakukan sama dengan event error elemen audio.
    instance.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal || requestId !== playRequestId) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaErrorRecovered) {
        mediaErrorRecovered = true;
        instance.recoverMediaError();
        return;
      }
      handleStreamFailure(station);
    });
    instance.loadSource(streamUrl);
    instance.attachMedia(audioPlayer);
    // Error fatal yang dikirim sinkron di atas sudah melepas stream ini.
    if (requestId !== playRequestId) return;
  } else {
    const resolvedUrl = await resolvePlaylistUrl(streamUrl, requestId);
    if (requestId !== playRequestId) return;
    // URL hasil playlist bisa http:// walau URL playlist-nya https://.
    streamUrl = secureStreamUrl(resolvedUrl);
    if (streamUrl !== resolvedUrl) streamUpgraded = true;
    if (shoutcastPath) streamUrl = shoutcastStreamUrl(streamUrl);
    audioPlayer.src = streamUrl;
    audioPlayer.load();
  }
  streamAttached = true;
}

function detachStream() {
  streamAttached = false;
  cancelPlaylistFetch();
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
  // Sambung ulang sudah dijadwalkan. Stream lama tetap terpasang selama jeda itu, jadi event
  // error atau ended yang menyusul darinya diabaikan. Tanpa pengecekan ini, kegagalan kedua
  // membaca isPlaying false dan menandai stasiun gagal, atau memasang timer sambung ulang kedua.
  if (isReconnectPending()) return;

  const wasStreaming = isPlaying || reconnectAttempt > 0;
  const blocked = error && error.name === "NotAllowedError";

  // Stream yang gagal sebelum berbunyi dari URL berpath / dicoba sekali lagi dengan path /;.
  // Timeout tidak dicoba lagi supaya pengguna tidak menunggu CONNECT_TIMEOUT_MS dua kali.
  if (
    !wasStreaming && !blocked && !shoutcastPath && navigator.onLine &&
    !(error && error.name === "TimeoutError") &&
    !isHlsStation(station) && shoutcastStreamUrl(streamUrl) !== streamUrl
  ) {
    playStation(station, { shoutcastRetry: true });
    return;
  }

  if (wasStreaming && !blocked && reconnectAttempt < RECONNECT_DELAYS_MS.length) {
    // Stream lama tidak dilepas: sisa buffer, misalnya buffer hls.js sesudah error jaringan
    // fatal, tetap berbunyi sampai stream baru dipasang oleh playStation.
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
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => runReconnect(station), delay);
}

function isReconnectPending() {
  return reconnectTimer !== null || onlineTimer !== null || waitingForNetwork;
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
  clearPendingReconnect();
  reconnectAttempt = 0;
}

// Batalkan percobaan yang sedang ditunggu tanpa mengubah reconnectAttempt.
function clearPendingReconnect() {
  clearTimeout(reconnectTimer);
  clearTimeout(onlineTimer);
  reconnectTimer = null;
  onlineTimer = null;
  waitingForNetwork = false;
}

function stopPlayback(message) {
  abortStream();
  stopFadeIn();
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
  stopFadeIn();
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

  const unsupported = Boolean(error && error.name === "UnsupportedCodec");
  // Perangkat offline: stasiunnya belum tentu rusak, jadi tidak ditandai gagal.
  const offline = !unsupported && !navigator.onLine;
  if (!offline) failedStations.add(station.id);
  // Format yang tidak didukung tidak berubah dengan mencoba lagi.
  retryButton.hidden = unsupported;
  const failureMsg = offline
    ? "Perangkat tidak tersambung ke internet. Periksa koneksi, lalu coba lagi."
    : streamFailureMessage(station, error);
  showStatus(failureMsg, true);
  if (!unsupported) {
    showToast(failureMsg, {
      icon: "wifiOff",
      actionLabel: "Coba lagi",
      // Pengguna bisa sudah memilih stasiun lain sebelum toast hilang. Tombol ini hanya
      // memutar ulang stasiun yang gagal kalau stasiun itu masih ada di player.
      onAction: () => {
        if (currentStation && currentStation.id === station.id) playStation(station);
      }
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
  // Stream HTTP sudah dicoba sebagai HTTPS oleh secureStreamUrl dan tetap gagal.
  if (streamUpgraded) {
    return `${station.name} memakai stream HTTP. Versi HTTPS-nya sudah dicoba dan tidak bisa diputar.`;
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
  // Posisi di lock screen diperbarui tiap 5 detik, satu kali per detik itu.
  const second = Math.floor(listenSeconds);
  if (second % 5 === 0 && second !== lastPositionSecond) {
    lastPositionSecond = second;
    updateMediaSessionPosition();
  }
}

function handleAudioPlaying() {
  if (!currentStation || !streamAttached) return;

  // Stream lama berbunyi lagi selama jeda sambung ulang: percobaan yang dijadwalkan tidak
  // diperlukan dan akan mengganti stream yang sedang berbunyi.
  clearPendingReconnect();
  clearStreamTimers();
  isConnecting = false;
  isPlaying = true;
  isBuffering = false;
  retryButton.hidden = true;
  startFadeIn();
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
// Selama fade-in, UI menampilkan level slider, bukan volume yang sedang naik.
function updateVolumeUI() {
  const level = fadeInTarget === null ? audioPlayer.volume : fadeInTarget;
  const percent = Math.round(level * 100);
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
  shortcutToggle.textContent = shortcutsEnabled ? "Nonaktifkan pintasan" : "Aktifkan pintasan";
}

function restoreVolume() {
  const volume = Number(loadJson(VOLUME_KEY, 1));
  const safeVolume = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;
  audioPlayer.volume = safeVolume;
  volumeInput.value = String(safeVolume);
  updateVolumeUI();
}

// Volume diturunkan ke FADE_IN_FLOOR_DB sebelum stream tersambung. Kenaikannya baru dimulai
// startFadeIn saat audio berbunyi, supaya waktu menyambung tidak mengurangi durasi fade.
function prepareFadeIn() {
  // Fade-out sleep timer sedang mengatur volume: dua interval tidak boleh menulis bersamaan.
  if (sleepFadeTicker) return;
  stopFadeIn();
  fadeInTarget = Number(volumeInput.value);
  audioPlayer.volume = fadeInTarget * Math.pow(10, FADE_IN_FLOOR_DB / 20);
}

// Naik linier dalam desibel, alasannya sama dengan startSleepFadeOut.
function startFadeIn() {
  if (fadeInTarget === null || fadeInTicker) return;
  const target = fadeInTarget;
  const fadeStart = Date.now();

  fadeInTicker = setInterval(() => {
    const progress = Math.min(1, (Date.now() - fadeStart) / FADE_IN_MS);
    audioPlayer.volume = target * Math.pow(10, (FADE_IN_FLOOR_DB * (1 - progress)) / 20);
    if (progress >= 1) stopFadeIn();
  }, 50);
}

// Menghentikan fade-in dan langsung memasang level slider.
function stopFadeIn() {
  clearInterval(fadeInTicker);
  fadeInTicker = null;
  if (fadeInTarget === null) return;
  audioPlayer.volume = fadeInTarget;
  fadeInTarget = null;
}

// ---------- Pengatur Waktu Tidur (Sleep Timer) ----------

function setSleepTimer(minutes) {
  cancelSleepTimer();

  if (minutes <= 0) {
    sleepTimerMinutes = 0;
    updateSleepTimerUI();
    showToast("Pengatur waktu tidur dinonaktifkan.", { icon: "timer" });
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
  stopFadeIn();
  sleepOriginalVolume = audioPlayer.volume;
  const startVol = audioPlayer.volume;
  const fadeStart = Date.now();
  const fadeDuration = 5000;

  sleepFadeTicker = setInterval(() => {
    const elapsed = Date.now() - fadeStart;
    const progress = Math.min(1, elapsed / fadeDuration);
    // Volume turun linier dalam desibel (0 sampai -60 dB), karena telinga mendengar volume
    // secara logaritmik. Penurunan linier pada nilai volume terdengar lambat lalu hilang
    // mendadak di akhir. -60 dB (0.001) ke 0 di langkah terakhir tidak terdengar.
    audioPlayer.volume = progress >= 1 ? 0 : startVol * Math.pow(10, (-60 * progress) / 20);
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
    // Siaran live tidak punya durasi. Spesifikasi Media Session memakai duration Infinity untuk
    // itu, jadi lock screen tidak menampilkan progress bar yang selalu penuh.
    if (isPlaying && !isBuffering && listenSeconds > 0) {
      navigator.mediaSession.setPositionState({
        duration: Infinity,
        playbackRate: 1,
        position: listenSeconds
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

const STATION_PARAM = "station";
const STATION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Link dari halaman daftar radio (/?station=<uuid>) menyiapkan stasiun itu di player,
// menggantikan stasiun terakhir. Tanpa auto-play, sama seperti restoreLastStation.
async function restoreLinkedStation() {
  const params = new URLSearchParams(location.search);
  const id = (params.get(STATION_PARAM) || "").trim();
  if (!params.has(STATION_PARAM)) return;

  // Parameter dibuang dari alamat supaya muat ulang dan bookmark tidak memilih stasiun ini lagi.
  params.delete(STATION_PARAM);
  const query = params.toString();
  window.history.replaceState(null, "", location.pathname + (query ? `?${query}` : "") + location.hash);

  // Isian kosong atau bukan uuid: stasiun terakhir tetap dipakai.
  if (!STATION_UUID_PATTERN.test(id)) return;

  const stationBeforeFetch = currentStation;
  const requestBeforeFetch = playRequestId;
  const result = await apiFetch(`/stations/byuuid/${encodeURIComponent(id)}`);
  // Pengguna sudah memilih, menyambung, atau memutar stasiun selama request berjalan:
  // pilihannya dipakai. playRequestId juga berubah kalau Putar ditekan untuk stasiun terakhir
  // yang sama, yang tidak terlihat dari currentStation.
  if (
    isPlaying || isConnecting || playRequestId !== requestBeforeFetch ||
    currentStation !== stationBeforeFetch
  ) return;

  // null (semua server gagal), "aborted", atau array kosong (uuid tidak dikenal Radio Browser).
  const found = Array.isArray(result) ? result[0] : null;
  const station = found ? normalizeStation(found) : null;
  // Di halaman HTTPS pencarian hanya menampilkan stasiun HTTPS; link ke stasiun HTTP diperlakukan sama.
  const insecure = Boolean(station?.url) && SECURE_PAGE && !station.url.startsWith("https:");
  if (!station || !station.url || insecure || isBlockedStation(station)) {
    showStatus("Stasiun dari link tidak ditemukan. Pilih radio lain dari daftar.", true);
    return;
  }

  currentStation = station;
  setPlayerStation(station);
  updatePlaybackUI();
  showStatus("Tekan Putar untuk mendengarkan.");
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
    appFooter.offsetHeight +
    (appFooter.offsetHeight
      ? (parseFloat(appStyle.rowGap) || 0) + parseFloat(getComputedStyle(appFooter).marginTop)
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
