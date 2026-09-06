import { TbmClient } from "./tbmApi.js";
import { FavoritesStore } from "./favorites.js";

const REFRESH_INTERVAL_MS = 30000; // matches TBM's own real-time refresh rate

const client = new TbmClient();
const favorites = new FavoritesStore();

const screens = {
  search: document.getElementById("screen-search"),
  board: document.getElementById("screen-board"),
  favorites: document.getElementById("screen-favorites"),
};

let refreshTimer = null;
let currentStop = null;

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

function stopRowElement(stop, onSelect) {
  const li = document.createElement("li");
  li.className = "stop-row";
  li.textContent = stop.name;
  li.addEventListener("click", () => onSelect(stop));
  return li;
}

function passageRowElement(passage) {
  const li = document.createElement("li");
  li.className = "passage-row";

  const code = document.createElement("span");
  code.className = "passage-line";
  code.textContent = passage.lineCode;

  const dest = document.createElement("span");
  dest.className = "passage-destination";
  dest.textContent = `→ ${passage.direction}`;

  const eta = document.createElement("span");
  eta.className = "passage-eta";
  eta.textContent = passage.bestTime
    ? passage.bestTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "?";

  li.append(code, dest, eta);
  return li;
}

async function runSearch(query) {
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "";
  const stops = await client.searchStops(query);
  for (const stop of stops) {
    resultsEl.appendChild(stopRowElement(stop, openBoard));
  }
}

async function refreshBoard() {
  if (!currentStop) return;
  const statusEl = document.getElementById("board-status");
  const listEl = document.getElementById("board-passages");
  try {
    const passages = await client.stopMonitoring(currentStop.refs);
    statusEl.textContent = passages.length ? "" : "Aucun passage prevu pour le moment";
    listEl.innerHTML = "";
    for (const passage of passages) {
      listEl.appendChild(passageRowElement(passage));
    }
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  }
}

function updateFavoriteButton() {
  const btn = document.getElementById("favorite-toggle");
  const isFavorite = favorites.load().includes(currentStop.ref);
  btn.textContent = isFavorite ? "★ Favori" : "☆ Ajouter aux favoris";
}

function openBoard(stop) {
  currentStop = stop;
  document.getElementById("board-title").textContent = stop.name;
  showScreen("board");
  updateFavoriteButton();
  refreshBoard();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshBoard, REFRESH_INTERVAL_MS);
}

async function renderFavorites() {
  const listEl = document.getElementById("favorites-list");
  listEl.innerHTML = "";
  const favoriteRefs = favorites.load();
  if (!favoriteRefs.length) return;
  const stops = await client.listStops();
  const byRef = new Map(stops.map((stop) => [stop.ref, stop]));
  for (const ref of favoriteRefs) {
    const stop = byRef.get(ref) ?? { ref, name: ref, refs: [ref] };
    listEl.appendChild(stopRowElement(stop, openBoard));
  }
}

document.getElementById("search-input").addEventListener("input", (event) => {
  runSearch(event.target.value);
});

document.getElementById("back-from-board").addEventListener("click", () => {
  if (refreshTimer) clearInterval(refreshTimer);
  showScreen("search");
});

document.getElementById("go-favorites").addEventListener("click", async () => {
  showScreen("favorites");
  await renderFavorites();
});

document.getElementById("back-from-favorites").addEventListener("click", () => {
  showScreen("search");
});

document.getElementById("favorite-toggle").addEventListener("click", () => {
  favorites.toggle(currentStop.ref);
  updateFavoriteButton();
});

showScreen("search");
