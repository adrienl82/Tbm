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

// Official TBM tram line colors.
const TRAM_LINE_COLORS = {
  A: "#802991", // Violet
  B: "#EE154A", // Rouge
  C: "#D34F98", // Rose
  D: "#8B64A5", // Violet clair / Parme
  E: "#80684C", // Brun / Taupe
  F: "#E8822F", // Orange
};

// Bus lines don't have one official color per line like trams do -- TBM
// colors them as badges (background + text) by category instead, inferred
// here from the line's own name (LineName from lines-discovery.json).
// A few individual lines (specific navettes, ex-TransGironde regional
// lines folded into the network) get their own dedicated colors by code.
const BUS_LINE_COLORS_BY_CODE = {
  18: { background: "#E01745", color: "#ffffff" }, // Navette Stade
  19: { background: "#CD117F", color: "#ffffff" }, // Navette Arena
  301: { background: "#6E8878", color: "#ffffff" },
  302: { background: "#B05F0F", color: "#ffffff" },
  303: { background: "#F0CB02", color: "#000000" },
  304: { background: "#EE0000", color: "#ffffff" },
  310: { background: "#77278D", color: "#ffffff" },
  313: { background: "#0073AE", color: "#ffffff" },
};

const SCODI_COLOR = "#0C4F9D";

const BUS_CATEGORY_COLORS = [
  [/^bus express/i, "#E52423"], // Lignes structurantes directes (G, H, F41-F44)
  [/^lianes/i, "#E65A00"],
  [/^principale/i, "#009639"],
  [/^locale/i, "#7D2181"],
  [/^directe/i, "#006CA9"],
  [/^flex'/i, "#F2AE00"],
  [/^tbnight/i, "#F2AE00"],
];

// Returns { background, color } for a badge, or { outline } for the
// scolaire (ScoDi) style: white background with a blue outline. null when
// the line doesn't match any known category (kept on the plain default).
function busLineStyle(passage) {
  const byCode = BUS_LINE_COLORS_BY_CODE[passage.lineCode];
  if (byCode) return byCode;
  if (/^scodi/i.test(passage.lineName ?? "")) return { outline: SCODI_COLOR };
  const match = BUS_CATEGORY_COLORS.find(([pattern]) => pattern.test(passage.lineName ?? ""));
  return match ? { background: match[1], color: "#ffffff" } : null;
}

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
  code.textContent = `${passage.mode === "tram" ? "Tram" : "Bus"} ${passage.lineCode}`;
  if (passage.mode === "tram") {
    const tramColor = TRAM_LINE_COLORS[passage.lineCode];
    if (tramColor) code.style.color = tramColor;
  } else {
    const style = busLineStyle(passage);
    if (style?.outline) {
      code.style.color = style.outline;
      code.style.background = "#ffffff";
      code.style.border = `1px solid ${style.outline}`;
      code.style.borderRadius = "4px";
      code.style.padding = "1px 6px";
    } else if (style) {
      code.style.background = style.background;
      code.style.color = style.color;
      code.style.borderRadius = "4px";
      code.style.padding = "1px 6px";
    }
  }

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

function selectedModes() {
  const tram = document.getElementById("filter-tram").checked;
  const bus = document.getElementById("filter-bus").checked;
  if (tram && bus) return null; // both selected == no filtering
  if (tram) return ["tram"];
  if (bus) return ["bus"];
  return null; // neither: shouldn't happen, at least one stays checked
}

// Keeps the URL's query string (?arret=...&modes=tram&modes=bus[&stop=ref])
// in sync with the current form/screen so a page refresh -- or a
// bookmarked/shared link -- restores the exact same search, filters, and
// (if one was open) stop board. The arret/modes part is built straight from
// the form's own GET encoding (FormData); stopRef is added on top when a
// board is showing.
function syncUrl(stopRef = null) {
  const params = new URLSearchParams(new FormData(searchForm));
  if (stopRef) params.set("stop", stopRef);
  const search = params.toString();
  history.replaceState(null, "", search ? `?${search}` : location.pathname);
}

async function runSearch(query) {
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "";
  const stops = await client.searchStops(query, { modes: selectedModes() });
  for (const stop of stops) {
    resultsEl.appendChild(stopRowElement(stop, openBoard));
  }
}

async function refreshBoard() {
  if (!currentStop) return;
  const statusEl = document.getElementById("board-status");
  const listEl = document.getElementById("board-passages");
  try {
    let passages = await client.stopMonitoring(currentStop.refs);
    const modes = selectedModes();
    if (modes) passages = passages.filter((passage) => modes.includes(passage.mode));
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
  syncUrl(stop.ref);
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

const searchForm = document.getElementById("search-form");

searchForm.addEventListener("submit", (event) => {
  event.preventDefault(); // stay a live-updating SPA; the GET encoding is only used for the URL
  syncUrl();
  runSearch(document.getElementById("search-input").value);
});

document.getElementById("search-input").addEventListener("input", (event) => {
  syncUrl();
  runSearch(event.target.value);
});

for (const id of ["filter-tram", "filter-bus"]) {
  document.getElementById(id).addEventListener("change", (event) => {
    const noneChecked =
      !document.getElementById("filter-tram").checked && !document.getElementById("filter-bus").checked;
    if (noneChecked) {
      event.target.checked = true; // keep at least one mode selected
      return;
    }
    // The filter is shared across screens: re-render whichever one is showing.
    if (!screens.board.hidden) {
      syncUrl(currentStop.ref);
      refreshBoard();
    } else {
      syncUrl();
      runSearch(document.getElementById("search-input").value);
    }
  });
}

function goHome() {
  if (refreshTimer) clearInterval(refreshTimer);
  showScreen("search");
  syncUrl(); // drop the ?stop= param, keep the search text/filters
}

document.getElementById("home-link").addEventListener("click", goHome);
document.getElementById("back-from-board").addEventListener("click", goHome);
document.getElementById("back-from-favorites").addEventListener("click", goHome);

document.getElementById("go-favorites").addEventListener("click", async () => {
  showScreen("favorites");
  await renderFavorites();
});

document.getElementById("favorite-toggle").addEventListener("click", () => {
  favorites.toggle(currentStop.ref);
  updateFavoriteButton();
});

async function init() {
  showScreen("search");

  const params = new URLSearchParams(location.search);
  document.getElementById("search-input").value = params.get("arret") ?? "";
  const modes = params.getAll("modes");
  if (modes.length > 0) {
    document.getElementById("filter-tram").checked = modes.includes("tram");
    document.getElementById("filter-bus").checked = modes.includes("bus");
  }
  if (!document.getElementById("filter-tram").checked && !document.getElementById("filter-bus").checked) {
    document.getElementById("filter-tram").checked = true; // never leave both unchecked
  }

  const stopRef = params.get("stop");
  if (stopRef) {
    const stops = await client.listStops();
    const stop = stops.find((s) => s.ref === stopRef || s.refs.includes(stopRef));
    if (stop) {
      openBoard(stop); // refreshing the board page reopens the same stop instead of losing it
      return;
    }
  }

  if (document.getElementById("search-input").value) {
    runSearch(document.getElementById("search-input").value);
  }
}

init();
