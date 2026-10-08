"use strict";

// Daftar mirror API, dicoba berurutan jika salah satu down.
const API_MIRRORS = [
  "https://de1.api.radio-browser.info/json",
  "https://nl1.api.radio-browser.info/json",
  "https://at1.api.radio-browser.info/json"
];

// Isian dialog Tentang dan Dukung.
// Ubah legalUpdated setiap kali isi dialog Tentang diubah.
const SITE_INFO = {
  owner: "Dengaran",
  email: "dengaranid@gmail.com",
  supportPlatform: "Saweria",
  supportUrl: "https://saweria.co/dengaranid",
  legalUpdated: "8 Oktober 2026"
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

function isBlockedStation(station) {
  return Boolean(station && blockedStationIds.has(String(station.id).toLowerCase()));
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
const FAVORITE_KEY = "radio_online_favorites_v1";
const LAST_STATION_KEY = "radio_online_last_station_v1";
const HISTORY_KEY = "radio_online_history_v1";
const VOLUME_KEY = "radio_online_volume_v1";

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
  radio: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16v2"/><path d="M19 16v2"/><rect width="20" height="8" x="2" y="8" rx="2"/><path d="M18 12h.01"/></svg>'
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
const radioScroll = document.getElementById("radioScroll");
const favoriteGroup = document.getElementById("favoriteGroup");
const favoriteList = document.getElementById("favoriteList");
const favoriteCount = document.getElementById("favoriteCount");
const resultsTitle = document.getElementById("resultsTitle");
const resultsTitleText = document.getElementById("resultsTitleText");
const stationList = document.getElementById("stationList");
const stationCount = document.getElementById("stationCount");
const historySection = document.getElementById("historySection");
const appShell = document.querySelector(".app");
const heroHeader = document.querySelector(".hero");
const shortcutHint = document.querySelector(".shortcut-hint");
const historyList = document.getElementById("historyList");
const historyCount = document.getElementById("historyCount");
const loadMoreButton = document.getElementById("loadMoreButton");
const audioPlayer = document.getElementById("audioPlayer");
const miniPlayer = document.getElementById("miniPlayer");
const playerArt = document.getElementById("playerArt");
const nowPlaying = document.getElementById("nowPlaying");
const playerStatus = document.getElementById("playerStatus");
const liveBadge = document.getElementById("liveBadge");
const listenTime = document.getElementById("listenTime");
const retryButton = document.getElementById("retryButton");
const miniPlayButton = document.getElementById("miniPlayButton");
const closePlayerButton = document.getElementById("closePlayerButton");
const muteButton = document.getElementById("muteButton");
const volumeInput = document.getElementById("volumeInput");
const volumeValue = document.getElementById("volumeValue");
const volumeControl = document.getElementById("volumeControl");
const toast = document.getElementById("toast");
const toastText = document.getElementById("toastText");
const toastAction = document.getElementById("toastAction");
const navSearchButton = document.getElementById("navSearchButton");
const viewButtons = Array.from(document.querySelectorAll(".mobile-nav [data-view]"));

const regionNames = createRegionNames();

let stations = [];
let favorites = loadStationList(FAVORITE_KEY);
let history = loadStationList(HISTORY_KEY).slice(0, HISTORY_LIMIT);
let currentStation = null;
let isPlaying = false;
let isConnecting = false;
let isBuffering = false;
let activeTag = "";
let currentOffset = 0;
let hasMore = false;
let searchAbortController = null;
// Naik setiap kali pemutaran baru dimulai, dihentikan, atau dibatalkan.
// Promise play() dan timer dari permintaan lama dibandingkan dengan nilai ini dan diabaikan.
let playRequestId = 0;
let connectTimer = null;
let stallTimer = null;
const failedStations = new Set();
let toastTimer = null;
let toastToken = 0;
let toastRemaining = 0;
let toastStartedAt = 0;
let toastPaused = false;
let toastActionHandler = null;

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
audioPlayer.addEventListener("timeupdate", () => {
  if (isPlaying && !isBuffering) listenTime.textContent = formatTime(audioPlayer.currentTime);
});
audioPlayer.addEventListener("error", handleAudioError);

miniPlayButton.addEventListener("click", handleMiniPlayButton);
closePlayerButton.addEventListener("click", closePlayer);
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

navSearchButton.addEventListener("click", () => {
  setView("radio");
  searchInput.focus();
});
viewButtons.forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.view));
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
[favoriteList, stationList, historyList].forEach(list => {
  list.addEventListener("click", handleCardAction);
});

// Fallback logo: sembunyikan gambar rusak, tampilkan inisial di belakangnya.
[favoriteList, stationList, historyList, playerArt].forEach(element => {
  element.addEventListener("error", handleLogoError, true);
});

document.addEventListener("keydown", handleShortcut);

setupDialogs();

async function init() {
  renderHistory();
  restoreVolume();
  restoreLastStation();
  updatePlaybackUI();
  observeLayout();
  observeLoadMore();
  loadCountries();
  await startNewSearch();
}

// ---------- Negara ----------

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
    countrySelect.value = DEFAULT_COUNTRY;
  }
  updateResultsTitle();
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
    updateResultsTitle();
    radioScroll.scrollTop = 0;
    stationList.innerHTML = `<div class="loading">Memuat daftar radio...</div>`;
    stationCount.textContent = "Memuat...";
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
    updateStationCount();
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
    // Sisipkan kartu baru saja. Kartu lama tidak diganti, jadi fokus keyboard
    // dan gambar logo yang sudah dimuat tetap.
    stations = stations.concat(newStations);
    const added = newStations.filter(station => !isFavorite(station.id));
    stationList.insertAdjacentHTML("beforeend", added.map(createStationCard).join(""));
    updateStationCount();
    loadMoreButton.hidden = !hasMore;
    announce(`${added.length} radio lagi dimuat.`);
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
    favicon: station.favicon || "",
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

// Hasil pencarian tanpa stasiun yang sudah tampil di grup Favorit.
function visibleResults() {
  return stations.filter(station => !isFavorite(station.id));
}

function updateResultsTitle() {
  const searchTerm = searchInput.value.trim();
  resultsTitleText.textContent = searchTerm || activeTag
    ? "Hasil pencarian"
    : `Radio di ${selectedCountryName()}`;
}

// ---------- Render ----------

function updateStationCount() {
  const favoriteTotal = favoriteGroup.hidden ? 0 : favoriteList.querySelectorAll(".card").length;
  const resultTotal = stationList.querySelectorAll(".card").length;
  stationCount.textContent = favoriteTotal
    ? `${favoriteTotal} favorit • ${resultTotal} radio`
    : `${resultTotal} radio`;
}

function renderStations() {
  const results = visibleResults();
  updateResultsTitle();

  if (results.length === 0) {
    const searchTerm = searchInput.value.trim();
    const filters = [];
    if (searchTerm) filters.push(`bernama <strong>${escapeHtml(searchTerm)}</strong>`);
    if (activeTag) filters.push(`bergenre <strong>${escapeHtml(activeTag)}</strong>`);

    if (stations.length > 0) {
      stationList.innerHTML = `<div class="empty">Semua hasil sudah ada di Favorit.</div>`;
    } else if (filters.length) {
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

function renderFavorites() {
  const list = visibleFavorites();
  favoriteGroup.hidden = list.length === 0;
  favoriteCount.textContent = `${list.length} radio`;
  favoriteList.innerHTML = list.map(createStationCard).join("");
  updateStationCount();
}

function renderHistory() {
  historyCount.textContent = `${history.length} radio`;

  if (history.length === 0) {
    historyList.innerHTML = `<li class="empty">Belum ada radio yang diputar.</li>`;
    return;
  }

  historyList.innerHTML = history.map(createHistoryRow).join("");
  updateLayoutHeight();
}

// Penanda baris hanya untuk stasiun yang sedang dimuat atau berbunyi.
function stateClasses(state) {
  if (state === "playing") return "is-current is-playing";
  if (state === "connecting") return "is-current";
  return "";
}

function logoHtml(station) {
  return `
    <span class="logo-wrap" aria-hidden="true">
      <span>${escapeHtml(getInitials(station.name))}</span>
      ${
        station.favicon
          ? `<img src="${escapeHtml(station.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
          : ""
      }
    </span>
  `;
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
      ${logoHtml(station)}

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
      ${logoHtml(station)}
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
  listenTime.hidden = !(isPlaying && !isBuffering);
}

function setPlayerStation(station) {
  if (!station) {
    playerArt.innerHTML = ICONS.radio;
    nowPlaying.textContent = "Belum ada radio diputar";
    return;
  }

  playerArt.innerHTML = `
    <span>${escapeHtml(getInitials(station.name))}</span>
    ${
      station.favicon
        ? `<img src="${escapeHtml(station.favicon)}" alt="" referrerpolicy="no-referrer" />`
        : ""
    }
  `;
  nowPlaying.textContent = station.name;
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

function handleLogoError(event) {
  const img = event.target;
  if (img.tagName === "IMG" && img.closest(".logo-wrap")) {
    img.hidden = true;
  }
}

// ---------- Navigasi mobile ----------

function setView(view) {
  layout.dataset.view = view;
  viewButtons.forEach(button => {
    button.setAttribute("aria-pressed", button.dataset.view === view ? "true" : "false");
  });
  if (view === "radio") requestAnimationFrame(checkLoadMoreProximity);
}

// ---------- Dialog Tentang dan Dukung ----------

function setupDialogs() {
  fillSiteInfo();

  document.querySelectorAll("[data-open-dialog]").forEach(button => {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.dataset.openDialog);
      if (dialog && !dialog.open) dialog.showModal();
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
  });
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

  if (isTyping) return;

  const key = event.key.toLowerCase();

  if (key === "/") {
    event.preventDefault();
    setView("radio");
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

// Urutan sama dengan yang terlihat di Daftar Radio: favorit dulu, lalu hasil.
function playAdjacent(step) {
  const cards = Array.from(radioScroll.querySelectorAll(".card[data-station-id]"));
  const list = cards.map(card => findStationById(card.dataset.stationId)).filter(Boolean);
  if (list.length === 0) return;

  const index = currentStation ? list.findIndex(station => station.id === currentStation.id) : -1;
  const nextIndex = index === -1
    ? (step > 0 ? 0 : list.length - 1)
    : (index + step + list.length) % list.length;
  const next = list[nextIndex];

  playStation(next);

  const card = radioScroll.querySelector(`[data-station-id="${cssEscape(next.id)}"]`);
  if (card) card.scrollIntoView({ block: "nearest" });
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

async function playStation(station) {
  clearStreamTimers();
  const requestId = ++playRequestId;

  currentStation = station;
  isPlaying = false;
  isConnecting = true;
  isBuffering = false;
  failedStations.delete(station.id);

  // Mengganti src otomatis menghentikan stream sebelumnya.
  audioPlayer.src = station.url;
  audioPlayer.load();

  setPlayerStation(station);
  retryButton.hidden = true;
  showStatus("Menghubungkan ke stream...");
  updatePlaybackUI();

  saveJson(LAST_STATION_KEY, station);
  reportClick(station.id);

  // Stream yang menggantung tidak memicu event error: batasi waktunya.
  connectTimer = failAfter(CONNECT_TIMEOUT_MS, station, requestId);

  try {
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

    markStreamFailed(station, error);
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

function failAfter(ms, station, requestId) {
  return setTimeout(() => {
    if (requestId !== playRequestId) return;
    abortStream();
    markStreamFailed(station, { name: "TimeoutError" });
  }, ms);
}

function clearStreamTimers() {
  clearTimeout(connectTimer);
  clearTimeout(stallTimer);
  connectTimer = null;
  stallTimer = null;
}

// Lepas stream dari elemen audio. Event pause dan error yang menyusul diabaikan
// karena src sudah kosong, dan promise play() yang tertunda jadi permintaan lama.
function abortStream() {
  playRequestId++;
  clearStreamTimers();
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
}

function stopPlayback(message) {
  abortStream();
  isConnecting = false;
  isPlaying = false;
  isBuffering = false;
  retryButton.hidden = true;
  showStatus(message);
  setMediaPlaybackState("paused");
  updatePlaybackUI();
}

function closePlayer() {
  abortStream();
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
    showStatus("Browser menahan audio. Tekan Putar sekali lagi.");
    updatePlaybackUI();
    return;
  }

  failedStations.add(station.id);
  retryButton.hidden = false;
  showStatus(
    error && error.name === "TimeoutError"
      ? `${station.name} tidak merespons. Coba lagi atau pilih stasiun lain.`
      : isInsecureStream(station)
        ? `${station.name} memakai stream HTTP yang diblokir browser di halaman HTTPS.`
        : `${station.name} tidak bisa diputar. Stasiun mungkin sedang offline.`,
    true
  );
  setMediaPlaybackState("none");
  updatePlaybackUI();
}

function handleMiniPlayButton() {
  if (!currentStation) return;
  togglePlay(currentStation.id);
}

function handleAudioPause() {
  // Tanpa src berarti stop, batal, atau gagal: pesannya sudah ditulis di sana.
  if (!audioPlayer.getAttribute("src")) return;

  // Jeda dari luar halaman (tombol headset, lepas Bluetooth) diperlakukan sebagai Stop.
  if (currentStation && isPlaying) stopPlayback("Dihentikan.");
}

function handleAudioWaiting() {
  if (!currentStation || !isPlaying || isBuffering) return;

  isBuffering = true;
  showStatus("Menunggu data stream...");
  stallTimer = failAfter(STALL_TIMEOUT_MS, currentStation, playRequestId);
  updatePlaybackUI();
}

function handleAudioPlaying() {
  if (!currentStation) return;

  clearStreamTimers();
  isConnecting = false;
  isPlaying = true;
  isBuffering = false;
  retryButton.hidden = true;
  showStatus("Sedang memutar.");
  setMediaPlaybackState("playing");
  updatePlaybackUI();
}

function handleAudioError() {
  if (!currentStation || !audioPlayer.getAttribute("src")) return;
  markStreamFailed(currentStation);
}

// ---------- Volume ----------

function toggleMute() {
  audioPlayer.muted = !audioPlayer.muted;
  updateVolumeUI();
  showToast(audioPlayer.muted ? "Suara dibisukan." : "Suara dinyalakan.");
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

function restoreVolume() {
  const volume = Number(loadJson(VOLUME_KEY, 1));
  const safeVolume = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;
  audioPlayer.volume = safeVolume;
  volumeInput.value = String(safeVolume);
  updateVolumeUI();
}

// ---------- Media Session (lock screen / notifikasi HP) ----------

function setMediaSession(station) {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: localizedCountry(station.countryCode, station.country) || "Dengaran",
    album: "Dengaran",
    artwork: station.favicon ? [{ src: station.favicon }] : []
  });

  setMediaAction("play", () => {
    if (currentStation && !isPlaying && !isConnecting) playStation(currentStation);
  });
  setMediaAction("pause", () => stopPlayback("Dihentikan."));
  setMediaAction("stop", () => stopPlayback("Dihentikan."));
  setMediaAction("nexttrack", () => playAdjacent(1));
  setMediaAction("previoustrack", () => playAdjacent(-1));
  setMediaPlaybackState("playing");
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

function clearMediaSession() {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  }
}

// ---------- Favorit ----------

// Stasiun pindah dari hasil pencarian ke grup Favorit di atas daftar,
// jadi tidak tampil dua kali.
function addFavorite(stationId, sourceButton) {
  const station = findStationById(stationId);
  if (!station || isFavorite(station.id)) return;

  const fromResults = Boolean(sourceButton && stationList.contains(sourceButton));

  favorites.unshift(station);
  saveJson(FAVORITE_KEY, favorites);
  renderFavorites();

  const resultCard = stationList.querySelector(`[data-station-id="${cssEscape(station.id)}"]`);
  if (resultCard) resultCard.remove();
  if (!stationList.querySelector(".card")) renderStations();
  updateStationCount();
  updateFavoriteButtons();

  // Tombol yang diklik ikut pindah: fokus ke tombol hati kartu yang sama di grup Favorit.
  if (fromResults) {
    const heart = favoriteList.querySelector(
      `[data-action="toggle-favorite"][data-id="${cssEscape(station.id)}"]`
    );
    if (heart) heart.focus({ preventScroll: true });
  }

  showToast(`${station.name} dipindah ke Favorit di atas daftar.`);
}

function removeFavorite(stationId, sourceButton) {
  const index = favorites.findIndex(station => station.id === stationId);
  if (index === -1) return;

  const removedStation = favorites[index];
  const favoriteHearts = Array.from(favoriteList.querySelectorAll('[data-action="toggle-favorite"]'));
  const visibleIndex = favoriteHearts.indexOf(sourceButton);

  favorites.splice(index, 1);
  refreshFavoriteViews();

  // Tombol yang diklik ikut hilang saat grup di-render ulang:
  // pindahkan fokus ke kartu favorit di posisi yang sama, atau ke judul hasil.
  if (visibleIndex !== -1) focusFavoriteAt(visibleIndex);

  showToast(`${removedStation.name} dihapus dari favorit.`, {
    actionLabel: "Batalkan",
    onAction: () => {
      if (isFavorite(removedStation.id)) return;
      favorites.splice(Math.min(index, favorites.length), 0, removedStation);
      refreshFavoriteViews();
      showToast(`${removedStation.name} dikembalikan ke favorit.`);
    }
  });
}

function refreshFavoriteViews() {
  saveJson(FAVORITE_KEY, favorites);
  renderFavorites();
  renderStations();
  updateFavoriteButtons();
}

function focusFavoriteAt(index) {
  const hearts = favoriteList.querySelectorAll('[data-action="toggle-favorite"]');
  const target = hearts[Math.min(index, hearts.length - 1)];
  (target || resultsTitle).focus({ preventScroll: Boolean(target) });
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

  const row = historyList.querySelector(".row");
  const rowHeight = row ? row.getBoundingClientRect().height : 61;
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
async function apiFetch(path, { signal } = {}) {
  for (const base of API_MIRRORS) {
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
  fetch(`${API_MIRRORS[0]}/url/${encodeURIComponent(stationId)}`).catch(() => {});
}

// ---------- Util ----------

// Daftar stasiun tersimpan. Isi yang rusak (bukan array) dianggap kosong, dan stasiun
// yang diblokir sesudah disimpan pengguna ikut disaring.
function loadStationList(key) {
  const saved = loadJson(key, []);
  if (!Array.isArray(saved)) return [];
  return saved.filter(station => station && station.id && !isBlockedStation(station));
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

function showToast(message, { actionLabel = "", onAction = null } = {}) {
  const token = ++toastToken;
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
    if (token === toastToken) toastText.textContent = message;
  }, 60);

  scheduleToastHide(actionLabel ? 6000 : 3500);
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
  clearTimeout(toastTimer);
  toastRemaining -= Date.now() - toastStartedAt;
}

function resumeToast() {
  if (toast.hidden || !toastPaused) return;
  // Fokus atau kursor masih di dalam toast: tetap tunggu.
  if (toast.matches(":hover") || toast.contains(document.activeElement)) return;
  toastPaused = false;
  scheduleToastHide(Math.max(toastRemaining, 1500));
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
  toastPaused = false;
  toastActionHandler = null;
}

function getInitials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "R";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
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
