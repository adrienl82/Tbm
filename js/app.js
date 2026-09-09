import { TbmClient, stopNumericId } from "./tbmApi.js";
import { FavoritesStore } from "./favorites.js";
import { fetchLineShapes, lineNumericId } from "./lineShapes.js";
import {
  countByRoute,
  fetchActiveRouteIds,
  fetchVehiclePositions,
  fetchVehiclePositionsForRoutes,
  summarizeByDirection,
} from "./vehiclePositions.js";
import { distanceMeters, isNearAnyPoint, shapeCoversStops } from "./geoBounds.js";
import {
  bearingBetween,
  distanceToStopAhead,
  earliestStillSince,
  estimateVehiclePosition,
  isActuallyMoving,
  isStalled,
  lerpLatLng,
  trackStalledSince,
} from "./vehicleMotion.js";

const REFRESH_INTERVAL_MS = 10000; // TBM's own feed updates roughly every 10-30s
const DEFAULT_LINE_COLOR = "#0a3d62";

// Base sizes at "full" zoom for the map's own drawn elements. scaleForZoom()
// shrinks them together toward MIN_MAP_SCALE as the user zooms out, so a
// wide view isn't a mess of thick lines and fat dots.
const ROUTE_WEIGHT = 4; // route polyline stroke, px
const STOP_RADIUS = 5; // stop dot radius, px (a bit larger than ROUTE_WEIGHT)
const STOP_STROKE = 2; // stop dot white ring, px

// The map can't zoom out past the whole Bordeaux Metropole area, nor be
// panned off it -- the TBM network doesn't go further, and a world view of
// one tram line is just empty gray.
const BORDEAUX_BOUNDS = [
  [44.72, -0.78],
  [45.0, -0.42],
];
const MIN_MAP_ZOOM = 11;
const FULL_MAP_ZOOM = 13; // at/above this zoom everything is drawn full size
const MIN_MAP_SCALE = 1 / 3; // floor: reached at MIN_MAP_ZOOM (the widest view)
const LINE_FIT_ZOOM_IN = 2; // zoom levels to add after fitBounds on a single line

// Route lines, stop dots and vehicle badges all shrink together toward
// MIN_MAP_SCALE as the map zooms out, so a wide view isn't a fat tangle.
// Linear between FULL_MAP_ZOOM (scale 1) and MIN_MAP_ZOOM (scale MIN_MAP_SCALE).
function scaleForZoom(zoom) {
  const t = (FULL_MAP_ZOOM - zoom) / (FULL_MAP_ZOOM - MIN_MAP_ZOOM);
  return Math.max(MIN_MAP_SCALE, Math.min(1, 1 - t * (1 - MIN_MAP_SCALE)));
}

// The fleet map draws every line's route + stops only when there aren't too
// many (the 6 trams, yes; ~80 bus lines would be 80 network round-trips and
// an unreadable tangle).
const FLEET_MAP_MAX_LINES = 12;

// How far a live vehicle may sit from its own line's nearest stop and still
// be trusted (meters). TBM's GTFS-RT feed occasionally mistags a vehicle
// with the wrong route_id, which then reports a real position -- just for a
// different, distant line -- that a plain Bordeaux-area sanity check can't
// catch. A real Tram A vehicle checked against Tram A's own 89 stops never
// exceeded ~350m; a mistagged one is typically several kilometers off.
const VEHICLE_STOP_DISTANCE_METERS = 1000;

// How long a vehicle must have been continuously stopped (not just at this
// instant's fix, but across every refresh since we first noticed) before
// it's flagged as stalled rather than just "waiting at a stop".
const STALLED_THRESHOLD_MS = 5 * 60 * 1000;
// More than this many stalled vehicles on one line at once reads as a
// service problem rather than ordinary traffic/dwell delays.
const LINE_INCIDENT_THRESHOLD = 3;
const STALLED_COLOR = "#dc2626";

const client = new TbmClient();
const favorites = new FavoritesStore();

const screens = {
  search: document.getElementById("screen-search"),
  board: document.getElementById("screen-board"),
  favorites: document.getElementById("screen-favorites"),
  map: document.getElementById("screen-map"),
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

// The single color that best represents a line -- its own color for a
// tram, its badge/outline color for a bus -- reused for both the passage
// row and the line's route on the map.
function passageAccentColor(passage) {
  if (passage.mode === "tram") return TRAM_LINE_COLORS[passage.lineCode] ?? DEFAULT_LINE_COLOR;
  const style = busLineStyle(passage);
  return style?.background ?? style?.outline ?? DEFAULT_LINE_COLOR;
}

// Applies the same "Tram A" text-color / "Bus 35" background-badge look to
// any element, shared between passage rows and the home screen's line list.
function applyLineBadgeStyle(el, passage) {
  if (passage.mode === "tram") {
    const tramColor = TRAM_LINE_COLORS[passage.lineCode];
    if (tramColor) el.style.color = tramColor;
    return;
  }
  const style = busLineStyle(passage);
  if (style?.outline) {
    el.style.color = style.outline;
    el.style.background = "#ffffff";
    el.style.border = `1px solid ${style.outline}`;
    el.style.borderRadius = "4px";
    el.style.padding = "1px 6px";
  } else if (style) {
    el.style.background = style.background;
    el.style.color = style.color;
    el.style.borderRadius = "4px";
    el.style.padding = "1px 6px";
  }
}

// Adapts a Line (from TbmClient.listLines()) to the shape passageAccentColor
// / applyLineBadgeStyle / openLineMap expect from a Passage.
function lineAsPassage(line) {
  return { mode: line.mode, lineCode: line.code, lineName: line.name, lineRef: line.ref };
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

// onSelect, when given, makes the heading itself open a live map of every
// vehicle of that mode (see openFleetMap) rather than just labelling the
// list below it.
function lineGroupHeading(text, onSelect) {
  const li = document.createElement("li");
  li.className = "line-group-heading";
  li.textContent = text;
  if (onSelect) {
    li.classList.add("clickable");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.addEventListener("click", onSelect);
    li.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect();
    });
  }
  return li;
}

// A compact colored square showing just the line code (à la TBM's own site)
// -- solid fill for both tram and bus here, unlike the plain-text tram /
// badge-only-for-some-buses style used inline in a passage row.
function lineBadgeElement(line, onSelect) {
  const passage = lineAsPassage(line);
  const li = document.createElement("li");
  li.className = "line-badge";
  li.textContent = line.code;

  if (line.mode === "tram") {
    li.style.background = TRAM_LINE_COLORS[line.code] ?? DEFAULT_LINE_COLOR;
    li.style.color = "#ffffff";
  } else {
    const style = busLineStyle(passage);
    if (style?.outline) {
      li.style.background = "#ffffff";
      li.style.color = style.outline;
      li.style.border = `2px solid ${style.outline}`;
    } else {
      li.style.background = style?.background ?? DEFAULT_LINE_COLOR;
      li.style.color = style?.color ?? "#ffffff";
    }
  }

  li.addEventListener("click", () => onSelect(passage));
  return li;
}

function sortByCode(lines) {
  return lines.slice().sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
}

// Shown on the home screen when the search box is empty: every tram line,
// then every bus line, each opening straight onto its map. Respects the
// same tram/bus filter checkboxes as stop search.
// Cached briefly so toggling the tram/bus filter checkboxes -- which
// re-renders this list -- doesn't refetch the whole vehicle feed every time.
let activeRouteIdsCache = null;
let activeRouteIdsCacheAt = 0;
const ACTIVE_ROUTE_IDS_CACHE_MS = 20000;

// The set of numeric line ids with at least one vehicle actually running
// right now, or null if that couldn't be determined (a fetch failure) --
// callers should treat null as "unknown" and not hide anything on that
// basis, since a transient network error hiding every line would look like
// the app itself was broken rather than TBM's feed being briefly down.
async function getActiveRouteIds() {
  if (activeRouteIdsCache && Date.now() - activeRouteIdsCacheAt < ACTIVE_ROUTE_IDS_CACHE_MS) {
    return activeRouteIdsCache;
  }
  try {
    activeRouteIdsCache = await fetchActiveRouteIds();
    activeRouteIdsCacheAt = Date.now();
  } catch (err) {
    console.error("Impossible de determiner les lignes en service :", err);
  }
  return activeRouteIdsCache;
}

async function renderLinesBrowser() {
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "";
  resultsEl.classList.add("lines-grid");
  const [lines, activeIds] = await Promise.all([client.listLines(), getActiveRouteIds()]);
  const modes = selectedModes();
  const wantsTram = !modes || modes.includes("tram");
  const wantsBus = !modes || modes.includes("bus");
  // Many lines (TBNight, the SCODI school routes, event navettes...) only
  // run part of the day -- hide the ones with no vehicle in service right
  // now rather than list a line that opens onto an empty map.
  const inService = (line) => !activeIds || activeIds.has(lineNumericId(line.ref));

  if (wantsTram) {
    const trams = sortByCode(lines.filter((line) => line.mode === "tram" && inService(line)));
    if (trams.length > 0) {
      resultsEl.appendChild(lineGroupHeading("Trams", () => openFleetMap("tram")));
      for (const line of trams) resultsEl.appendChild(lineBadgeElement(line, openLineMap));
    }
  }
  if (wantsBus) {
    const buses = sortByCode(lines.filter((line) => line.mode === "bus" && inService(line)));
    if (buses.length > 0) {
      resultsEl.appendChild(lineGroupHeading("Bus", () => openFleetMap("bus")));
      for (const line of buses) resultsEl.appendChild(lineBadgeElement(line, openLineMap));
    }
  }
}

function passageRowElement(passage) {
  const li = document.createElement("li");
  li.className = "passage-row";

  const code = document.createElement("span");
  code.className = "passage-line";
  code.textContent = `${passage.mode === "tram" ? "Tram" : "Bus"} ${passage.lineCode}`;
  applyLineBadgeStyle(code, passage);

  const dest = document.createElement("span");
  dest.className = "passage-destination";
  dest.textContent = `→ ${passage.direction}`;

  const eta = document.createElement("span");
  eta.className = "passage-eta";
  eta.textContent = passage.bestTime
    ? passage.bestTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "?";

  code.addEventListener("click", () => openLineMap(passage));

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
  if (!query.trim()) {
    await renderLinesBrowser();
    return;
  }
  const resultsEl = document.getElementById("search-results");
  resultsEl.classList.remove("lines-grid");
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

let lineMap = null;
let lineMapLayer = null;
let stopMarkersLayer = null;
let vehicleLayer = null;
let vehicleRefreshTimer = null;
let vehicleAnimationFrame = null;
// The live vehicles from the last real refresh, each paired with its own
// marker -- animateVehicles() re-projects these on every animation frame
// between refreshes so markers glide smoothly toward their estimated live
// position instead of sitting frozen at their last fix for up to
// REFRESH_INTERVAL_MS (or jumping in visible steps).
let activeVehicles = [];
// The id of the vehicle the user tapped to follow, or null. Kept across
// refreshes (markers are recreated every REFRESH_INTERVAL_MS) by matching
// on this id each time, so the selection and its open tooltip survive a
// refresh instead of resetting to nothing.
let followedVehicleId = null;
// The line's own trusted route shape (see openLineMap), as one or more
// [lat, lon] arrays -- animateVehicles() makes estimated positions follow
// this rather than cut across in a straight line. Empty when no route
// shape passed the cross-check against the line's stops.
let currentRoutePolylines = [];
let currentLinePassage = null;
// Set instead of currentLinePassage when the map is showing every vehicle
// of one mode (see openFleetMap) rather than a single line -- { mode,
// linesById } where linesById maps each line's numeric id (lineNumericId)
// to its Line, used to recover which line (and so which color/code) a
// given vehicle belongs to. Exactly one of currentLinePassage /
// currentFleetContext is non-null while the map screen is open.
let currentFleetContext = null;
let mapReturnScreen = "search";
let geoRequestId = 0;
let userLocationMarker = null;
let currentStopNames = new Map();
let currentStopPoints = [];
let lineMapRequestId = 0;

function ensureLineMap() {
  if (lineMap) return lineMap;
  lineMap = L.map("line-map", {
    minZoom: MIN_MAP_ZOOM,
    maxBounds: BORDEAUX_BOUNDS,
    // A firm wall rather than a rubber-band bounce back from beyond the edge.
    maxBoundsViscosity: 1,
  });
  // A lighter, less cluttered basemap than the default OSM raster tiles'
  // dense orange/yellow road network -- closer to how infotbm.com's own
  // line maps read. (CARTO's Positron tiles are the closest visual match,
  // but CARTO now requires a personal API key even for anonymous use, so
  // this uses Esri's free-without-a-key Light Gray Canvas instead: a plain
  // gray base layer plus a separate transparent overlay for roads/labels.)
  const attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Esri, HERE, Garmin';
  // maxNativeZoom: this service has no tiles past z16 for most areas (it
  // serves an explicit "Map data not yet available" placeholder instead) --
  // Leaflet upscales the z16 tile for deeper zoom levels rather than
  // requesting one that doesn't exist.
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { attribution, maxZoom: 19, maxNativeZoom: 16 },
  ).addTo(lineMap);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, maxNativeZoom: 16 },
  ).addTo(lineMap);
  lineMapLayer = L.layerGroup().addTo(lineMap);
  stopMarkersLayer = L.layerGroup().addTo(lineMap);
  vehicleLayer = L.layerGroup().addTo(lineMap);
  // A manual pan means the user wants to look elsewhere -- fighting that by
  // keeping the camera locked onto a followed vehicle would be worse than
  // just letting go of it.
  lineMap.on("dragstart", () => {
    followedVehicleId = null;
  });
  lineMap.on("zoomend", applyZoomScale);
  return lineMap;
}

// Resizes the map's own drawn elements -- route polylines, stop dots and
// vehicle badges -- to scaleForZoom(current zoom), so zooming out shrinks
// them together instead of leaving a thick tangle. Called on every zoomend
// and once after each map (re)build. Vehicle markers created between calls
// already start at the right scale (see syncVehicleMarkers).
function applyZoomScale() {
  if (!lineMap) return;
  const scale = scaleForZoom(lineMap.getZoom());
  lineMapLayer?.eachLayer((layer) => {
    if (typeof layer.setStyle === "function") layer.setStyle({ weight: ROUTE_WEIGHT * scale });
  });
  stopMarkersLayer?.eachLayer((layer) => {
    if (typeof layer.setRadius === "function") {
      layer.setRadius(STOP_RADIUS * scale);
      layer.setStyle({ weight: STOP_STROKE * scale });
    }
  });
  for (const entry of activeVehicles) {
    entry.marker.getElement()?.querySelector(".vehicle-scale")?.style.setProperty("--veh", scale);
  }
}

// A small circular badge with a single letter ("T" for tram, "B" for bus),
// distinct from the smaller plain dots used for stops. Moving vehicles get
// a pulsing halo (a common "live" indicator); a stopped one is shown dimmed
// with no pulse, so the two states are visually distinct at a glance. A
// vehicle stopped long enough to count as stalled (see refreshVehicles)
// turns red regardless of its line's own color, and stays at full opacity
// so it stands out rather than fading into the dimmed "stopped" look.
// Tapping a marker follows it (see refreshVehicles/animateVehicles);
// is-followed adds a visible ring so it's clear which one that is. A small
// triangle pointing in the vehicle's own reported bearing (0=north, as a
// compass heading) sits just outside the circle, rotated around its
// center -- omitted entirely when bearing isn't known rather than pointing
// somewhere meaningless.
function vehicleDivIcon(letter, color, moving, followed, stalled, bearing, scale = 1) {
  const badgeColor = stalled ? STALLED_COLOR : color;
  const arrow =
    bearing === null
      ? ""
      : `<div class="vehicle-heading" style="transform: rotate(${bearing}deg)"><div class="vehicle-arrow" style="border-bottom-color:${badgeColor}"></div></div>`;
  // .vehicle-scale is display:contents (no box of its own, so the absolutely
  // positioned .vehicle-pulse/.vehicle-heading still resolve against the
  // Leaflet marker icon) -- it only carries --veh, which the badge/arrow
  // sizes are computed from. applyZoomScale() pokes --veh on zoom without
  // rebuilding the icon. iconSize stays 24 so the anchor point doesn't move.
  return L.divIcon({
    className: `vehicle-marker ${moving ? "is-moving" : "is-stopped"}${followed ? " is-followed" : ""}${stalled ? " is-stalled" : ""}`,
    html:
      `<div class="vehicle-scale" style="--veh:${scale}">` +
      `<div class="vehicle-pulse" style="background:${badgeColor}"></div>${arrow}` +
      `<div class="vehicle-badge" style="background:${badgeColor}">${letter}</div>` +
      `</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// The letter/color/fallback tooltip title a vehicle marker should use --
// the same for every vehicle in single-line mode (currentLinePassage), but
// resolved per vehicle in fleet mode (currentFleetContext) since a fleet
// view mixes vehicles from several different lines, each with its own
// color. Falls back to a plain default when a fleet vehicle's route_id
// isn't one of this mode's known lines (a brand-new or renamed line the
// static line list doesn't have yet).
function vehicleStyle(vehicle) {
  if (currentLinePassage) {
    const passage = currentLinePassage;
    return {
      letter: passage.mode === "tram" ? "T" : "B",
      color: passageAccentColor(passage),
      fallbackLabel: `${passage.mode === "tram" ? "Tram" : "Bus"} ${passage.lineCode}`,
    };
  }
  const { mode, linesById } = currentFleetContext;
  const letter = mode === "tram" ? "T" : "B";
  const modeLabel = mode === "tram" ? "Tram" : "Bus";
  const line = linesById.get(vehicle.routeId);
  if (!line) return { letter, color: DEFAULT_LINE_COLOR, fallbackLabel: modeLabel };
  return {
    letter,
    color: passageAccentColor(lineAsPassage(line)),
    fallbackLabel: `${modeLabel} ${line.code}`,
  };
}

// Builds the vehicle's tooltip: its destination, then either its speed and
// where it's headed (moving) or which stop it's sitting at (stopped) --
// whichever of those is actually known, since stop_id doesn't always
// resolve to a stop this line's own list has a name for.
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// isStalled/stalledSince come from refreshVehicles' cross-refresh tracking
// (see there) of how long this vehicle has been continuously stopped.
function vehicleTooltip(vehicle, fallbackLabel, vehicleIsStalled, stalledSince) {
  const title = vehicle.label || fallbackLabel;
  const stopName = vehicle.stopId ? currentStopNames.get(vehicle.stopId) : null;
  const time = vehicle.timestamp ? formatTime(vehicle.timestamp) : null;
  let detail;
  if (!vehicle.moving) {
    detail = `a l'arret${stopName ? ` : ${stopName}` : ""}`;
  } else {
    const parts = [stopName ? `vers ${stopName}` : "en circulation"];
    if (vehicle.speedKmh !== null) parts.push(`${vehicle.speedKmh} km/h`);
    detail = parts.join(" - ");
  }
  const idLine = vehicle.id ? `<br>vehicule ${vehicle.id}` : "";
  const stalledLine = vehicleIsStalled ? `<br>bloque depuis ${Math.floor((Date.now() - stalledSince) / 60000)} min` : "";
  return `${title}<br>${detail}${idLine}${stalledLine}${time ? `<br>${time}` : ""}`;
}

// How long a marker takes to ease from wherever it was displayed (its
// dead-reckoned estimate, which is rarely exact) to a fresh real fix,
// instead of snapping there the instant a new fetch lands.
const POSITION_TRANSITION_MS = 2000;

// Tapping a vehicle toggles whether the map follows it (animateVehicles
// re-centers on it every frame). Updates the tapped marker's icon (and the
// previously-followed one's, if different) right away, rather than waiting
// for the next refresh to redraw with the new is-followed class -- without
// this the camera would already be tracking the vehicle while its own
// marker still looked unselected for up to REFRESH_INTERVAL_MS.
function setFollowedVehicle(id) {
  const previousId = followedVehicleId;
  followedVehicleId = previousId === id ? null : id;
  if (!currentLinePassage && !currentFleetContext) return;
  for (const entry of activeVehicles) {
    if (entry.vehicle.id !== previousId && entry.vehicle.id !== followedVehicleId) continue;
    const isFollowed = entry.vehicle.id === followedVehicleId;
    const { letter, color } = vehicleStyle(entry.vehicle);
    const scale = lineMap ? scaleForZoom(lineMap.getZoom()) : 1;
    entry.marker.setIcon(
      vehicleDivIcon(letter, color, entry.vehicle.moving, isFollowed, entry.isStalled, entry.vehicle.bearing, scale),
    );
    if (isFollowed) entry.marker.openTooltip();
  }
}

// Shows/hides the below-the-map incident notice based on how many vehicles
// on the currently open line have been stalled (see refreshVehicles) at
// once -- more than LINE_INCIDENT_THRESHOLD reads as a service problem
// rather than ordinary traffic or dwell delays.
function updateLineIncidentStatus(stalledCount) {
  const el = document.getElementById("line-incident");
  if (stalledCount <= LINE_INCIDENT_THRESHOLD) {
    el.hidden = true;
    return;
  }
  const vehicleWord = currentLinePassage?.mode === "tram" ? "trams" : "bus";
  el.textContent = `Possible incident sur la ligne : ${stalledCount} ${vehicleWord} sont actuellement a l'arret depuis plus de 5 minutes.`;
  el.hidden = false;
}

// The #vehicle-stats table is shared between the single-line recap (rows per
// direction) and the fleet recap (rows per line), so its two header cells
// are set by whichever is populating it.
function setStatsHeader(first, second) {
  const cells = document.querySelectorAll("#vehicle-stats thead th");
  if (cells[0]) cells[0].textContent = first;
  if (cells[1]) cells[1].textContent = second;
}

// Small per-line, per-direction recap shown below the map as a table: one
// row per direction (see summarizeByDirection), so "2 vers X, 4 vers Y"
// reads at a glance instead of just a single total.
function updateVehicleStats(vehicles, passage) {
  const table = document.getElementById("vehicle-stats");
  const body = document.getElementById("vehicle-stats-body");
  body.innerHTML = "";
  if (vehicles.length === 0) {
    table.hidden = true;
    return;
  }
  const noun = passage.mode === "tram" ? "tram" : "bus";
  const vehicleCount = (count) => `${count} ${noun}${count > 1 ? "s" : ""}`;

  setStatsHeader("Sens", "Vehicules");
  document.getElementById("vehicle-stats-caption").textContent =
    `${vehicleCount(vehicles.length)} en circulation`;

  for (const direction of summarizeByDirection(vehicles)) {
    const row = document.createElement("tr");
    const sensCell = document.createElement("td");
    // Destination labels come straight from TBM's live feed -- textContent
    // rather than innerHTML so nothing in there is ever parsed as markup.
    sensCell.textContent = direction.label ? `Vers ${direction.label}` : "Sens inconnu";
    const countCell = document.createElement("td");
    countCell.textContent = String(direction.count);
    row.append(sensCell, countCell);
    body.appendChild(row);
  }
  table.hidden = false;
}

// Per-line recap for the fleet ("every tram"/"every bus") map: one row per
// line that currently has a vehicle out, "A ... 6", ordered like the home
// line list (tram A-F, then buses; a route the static line list doesn't know
// yet comes last as "?"). A small colour dot ties each row to its markers.
function updateFleetStats(vehicles, context) {
  const table = document.getElementById("vehicle-stats");
  const body = document.getElementById("vehicle-stats-body");
  body.innerHTML = "";
  if (vehicles.length === 0) {
    table.hidden = true;
    return;
  }
  const modeLabel = context.mode === "tram" ? "trams" : "bus";

  setStatsHeader("Ligne", context.mode === "tram" ? "Trams" : "Bus");
  document.getElementById("vehicle-stats-caption").textContent =
    `${vehicles.length} ${modeLabel} en circulation`;

  const rows = countByRoute(vehicles).map(({ routeId, count }) => {
    const line = routeId === null ? null : context.linesById.get(routeId);
    return {
      code: line ? line.code : "?",
      color: line ? passageAccentColor(lineAsPassage(line)) : DEFAULT_LINE_COLOR,
      known: Boolean(line),
      count,
    };
  });
  rows.sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1;
    return a.code.localeCompare(b.code, "fr", { numeric: true });
  });

  for (const r of rows) {
    const row = document.createElement("tr");
    const lineCell = document.createElement("td");
    const dot = document.createElement("span");
    dot.className = "line-dot";
    dot.style.background = r.color;
    lineCell.append(dot, document.createTextNode(` ${r.code}`));
    const countCell = document.createElement("td");
    countCell.textContent = String(r.count);
    row.append(lineCell, countCell);
    body.appendChild(row);
  }
  table.hidden = false;
}

// Rebuilds the vehicle markers layer from a fresh vehicle list, matched by
// id against the previous refresh's markers so a vehicle already on screen
// keeps the same marker -- and so its open tooltip, follow ring and
// in-flight position transition survive -- instead of being torn down and
// rebuilt from scratch every refresh. Shared between single-line mode and
// the fleet ("every tram"/"every bus") map: vehicleStyle(vehicle) resolves
// each vehicle's own letter/color/fallback label, which differs per vehicle
// in fleet mode since several lines show at once. Returns how many of the
// given vehicles are currently stalled.
function syncVehicleMarkers(vehicles) {
  const previousById = new Map(activeVehicles.filter((entry) => entry.vehicle.id).map((entry) => [entry.vehicle.id, entry]));
  const seenIds = new Set();
  const nextActiveVehicles = [];
  const mapScale = lineMap ? scaleForZoom(lineMap.getZoom()) : 1;

  for (const vehicle of vehicles) {
    const isFollowed = Boolean(vehicle.id) && vehicle.id === followedVehicleId;
    const previous = vehicle.id ? previousById.get(vehicle.id) : null;
    if (vehicle.id) seenIds.add(vehicle.id);

    // How long this vehicle has been continuously stopped, carried forward
    // across refreshes (matched by id) rather than reset every time. The
    // very first time it's noticed not actually moving, the clock starts
    // from its own last reported fix rather than from right now (see
    // earliestStillSince) -- otherwise reopening this line (or just
    // reloading the page) would reset a vehicle that's already been stuck
    // for a while back to a fresh STALLED_THRESHOLD_MS countdown.
    const stalledSince = trackStalledSince(
      isActuallyMoving(vehicle),
      previous?.stalledSince ?? null,
      earliestStillSince(vehicle.timestamp?.getTime() ?? null, Date.now()),
    );
    const vehicleIsStalled = isStalled(stalledSince, Date.now(), STALLED_THRESHOLD_MS);

    const { letter, color, fallbackLabel } = vehicleStyle(vehicle);
    const icon = vehicleDivIcon(letter, color, vehicle.moving, isFollowed, vehicleIsStalled, vehicle.bearing, mapScale);

    let marker;
    let transition = null;
    if (previous) {
      marker = previous.marker;
      // Ease from wherever the marker is actually displayed right now
      // (its dead-reckoned estimate) to this fresh fix, rather than
      // jumping straight to it -- animateVehicles() blends the two over
      // POSITION_TRANSITION_MS.
      const current = marker.getLatLng();
      transition = { from: [current.lat, current.lng], start: Date.now() };
      marker.setIcon(icon);
      marker.setTooltipContent(vehicleTooltip(vehicle, fallbackLabel, vehicleIsStalled, stalledSince));
    } else {
      marker = L.marker([vehicle.latitude, vehicle.longitude], { icon })
        // A fixed direction (rather than Leaflet's default "auto", which
        // picks left/right based on space around the marker) matters most
        // for a followed vehicle: it sits pinned at the map's center, so
        // "auto" would otherwise flip sides on the smallest jitter.
        .bindTooltip(vehicleTooltip(vehicle, fallbackLabel, vehicleIsStalled, stalledSince), {
          direction: "top",
          offset: [0, -14],
          className: "vehicle-tooltip",
        })
        .addTo(vehicleLayer);
      if (vehicle.id) {
        marker.on("click", () => setFollowedVehicle(vehicle.id));
      }
    }
    // A freshly (re)opened tooltip so the selection reads as continuous
    // across refreshes instead of closing and reopening.
    if (isFollowed) marker.openTooltip();

    nextActiveVehicles.push({
      vehicle,
      marker,
      transition,
      stalledSince,
      isStalled: vehicleIsStalled,
      // The direction-arrow element inside this marker's own icon, kept
      // around so animateVehicles() can rotate it every frame directly
      // (see there) rather than only on real refreshes -- setIcon just
      // replaced the icon DOM node, so this has to be re-queried now
      // rather than reused from the previous entry.
      headingEl: marker.getElement()?.querySelector(".vehicle-heading") ?? null,
      // Carried forward across refreshes so animateVehicles() can tell how
      // far (and which way) the marker actually moved since last frame,
      // instead of resetting to "no movement yet" every refresh.
      lastAnimatedPosition: previous?.lastAnimatedPosition ?? null,
      // Distance to the line's own closest stop actually ahead of this
      // vehicle at this last known fix -- animateVehicles() uses it so a
      // fast vehicle's estimated position never creeps past a stop it's
      // about to reach before its next fix. Always null in fleet mode
      // (no single line's stops are loaded there), which simply means no
      // braking is applied -- the same graceful fallback as a line whose
      // own route shape/stops didn't check out.
      nearestStopMeters: distanceToStopAhead([vehicle.latitude, vehicle.longitude], vehicle.bearing, currentStopPoints),
    });
  }

  // Vehicles from the previous refresh that no longer appear (finished
  // service, or a matched marker was already reused above) get removed.
  for (const [id, entry] of previousById) {
    if (!seenIds.has(id)) vehicleLayer.removeLayer(entry.marker);
  }
  // Vehicles with no id could never be matched for reuse; the old ones
  // among them are stale copies still sitting on the layer.
  for (const entry of activeVehicles) {
    if (!entry.vehicle.id) vehicleLayer.removeLayer(entry.marker);
  }

  activeVehicles = nextActiveVehicles;
  return nextActiveVehicles.filter((entry) => entry.isStalled).length;
}

async function refreshVehicles() {
  if (!vehicleLayer) return;
  if (currentLinePassage) {
    const passage = currentLinePassage;
    try {
      const vehicles = await fetchVehiclePositions(passage.lineRef);
      // The user may have switched to a different line (or closed the map)
      // while this fetch was in flight -- drop the response rather than
      // paint another line's vehicles onto the one now showing.
      if (currentLinePassage?.lineRef !== passage.lineRef) return;
      // TBM's GTFS-RT feed occasionally mistags a vehicle with the wrong
      // route_id -- it then reports a real position, just nowhere near this
      // line's own stops. Drop it rather than show it confidently in the
      // wrong place.
      const filtered = vehicles.filter((vehicle) =>
        isNearAnyPoint([vehicle.latitude, vehicle.longitude], currentStopPoints, VEHICLE_STOP_DISTANCE_METERS),
      );
      const stalledCount = syncVehicleMarkers(filtered);
      updateVehicleStats(filtered, passage);
      updateLineIncidentStatus(stalledCount);
    } catch (err) {
      console.error("Impossible de charger les positions des vehicules :", err);
    }
    return;
  }
  if (currentFleetContext) {
    const context = currentFleetContext;
    try {
      const vehicles = await fetchVehiclePositionsForRoutes(new Set(context.linesById.keys()));
      // The user may have switched mode (or closed the map) while this
      // fetch was in flight.
      if (currentFleetContext !== context) return;
      syncVehicleMarkers(vehicles);
      updateFleetStats(vehicles, context);
      document.getElementById("map-status").textContent =
        `${vehicles.length} ${context.mode === "tram" ? "trams" : "bus"} en circulation`;
    } catch (err) {
      console.error("Impossible de charger les positions des vehicules :", err);
    }
  }
}

// Between real refreshes, glides every vehicle's marker toward its
// estimated current position (dead-reckoned from its last fix's speed and
// bearing, following the line's own route shape when one is trusted) so the
// map reads as continuously live rather than updating in visible jumps every
// REFRESH_INTERVAL_MS. Runs on requestAnimationFrame rather than a
// fixed-interval timer so the motion is as smooth as the display can
// render, not stepped.
// Also, when a vehicle is being followed (see refreshVehicles), keeps it
// centered on every frame as it moves -- setView with animate:false snaps
// straight to the new center instead of stacking a pan transition on top
// of one already running from the previous frame.
// A dead-reckoned vehicle following a route polyline curves through turns
// between real GPS fixes (see estimateVehiclePosition), but the arrow's
// rotation was until now only set once per real refresh from the vehicle's
// raw reported bearing -- it stayed frozen at that same angle through
// REFRESH_INTERVAL_MS worth of on-screen curving, most noticeably wrong
// right where a vehicle actually turns. Ignore movements smaller than this
// (meters) when deriving a frame's heading -- floating-point noise on a
// stopped vehicle's unchanging position, not an actual direction.
const HEADING_UPDATE_MIN_METERS = 0.2;

function animateVehicles() {
  const now = Date.now();
  for (const entry of activeVehicles) {
    const { vehicle, marker, nearestStopMeters, transition } = entry;
    const estimated = estimateVehiclePosition(vehicle, now, { nearestStopMeters, routePolylines: currentRoutePolylines });
    let position = estimated;
    if (transition) {
      const t = (now - transition.start) / POSITION_TRANSITION_MS;
      if (t >= 1) {
        entry.transition = null;
      } else {
        position = lerpLatLng(transition.from, estimated, t);
      }
    }
    marker.setLatLng(position);

    if (entry.headingEl && entry.lastAnimatedPosition) {
      const moved = distanceMeters(entry.lastAnimatedPosition, position);
      if (moved >= HEADING_UPDATE_MIN_METERS) {
        entry.headingEl.style.transform = `rotate(${bearingBetween(entry.lastAnimatedPosition, position)}deg)`;
      }
    }
    entry.lastAnimatedPosition = position;

    if (vehicle.id && vehicle.id === followedVehicleId) {
      lineMap.setView(position, lineMap.getZoom(), { animate: false });
    }
  }
  vehicleAnimationFrame = requestAnimationFrame(animateVehicles);
}

// Recenters the map on the user's live position once geolocation resolves,
// keeping whatever zoom the route/stops fit already picked. Marked directly
// on the map object (not one of the layer groups openLineMap() clears) so it
// survives switching lines; a request id discards a stale fix if the user
// switches lines again before it resolves. Silent on failure/denial: this is
// a progressive enhancement, not something worth showing an error for.
function centerOnUserLocation(map) {
  if (!navigator.geolocation) return;
  const requestId = ++geoRequestId;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (requestId !== geoRequestId) return;
      const userPoint = [position.coords.latitude, position.coords.longitude];
      if (userLocationMarker) userLocationMarker.remove();
      userLocationMarker = L.circleMarker(userPoint, {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: "#1a73e8",
        fillOpacity: 1,
      })
        .bindTooltip("Vous etes ici")
        .addTo(map);
      map.setView(userPoint, map.getZoom());
    },
    (err) => {
      console.warn("Geolocalisation indisponible :", err.message);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

async function openLineMap(passage) {
  // Opening a line is async (stops, then shape, both fetched over the
  // network); if the user switches to another line before those resolve, a
  // late response must not paint its stops/route onto the line now showing.
  // Each call gets its own id and checks after every await that it's still
  // the most recent one before touching any layer.
  const requestId = ++lineMapRequestId;
  document.getElementById("map-title").textContent = `${passage.mode === "tram" ? "Tram" : "Bus"} ${passage.lineCode}`;
  const statusEl = document.getElementById("map-status");
  statusEl.textContent = "";
  document.getElementById("line-incident").hidden = true;
  document.getElementById("vehicle-stats").hidden = true;
  // The line list opens the map straight from search; a passage badge opens
  // it from the board. "Retour" should go back to whichever that was.
  mapReturnScreen = Object.keys(screens).find((key) => !screens[key].hidden) ?? "search";
  showScreen("map");
  const map = ensureLineMap();
  // The map container was hidden (display:none) until showScreen ran just
  // above, so Leaflet needs a nudge to pick up its now-real size.
  requestAnimationFrame(() => map.invalidateSize());

  currentLinePassage = passage;
  currentFleetContext = null;
  followedVehicleId = null;
  lineMapLayer.clearLayers();
  stopMarkersLayer.clearLayers();
  vehicleLayer.clearLayers();
  activeVehicles = [];

  const color = passageAccentColor(passage);

  let stops = [];
  try {
    stops = await client.stopsForLine(passage.lineRef);
  } catch (err) {
    console.error("Impossible de charger les arrets de la ligne :", err);
  }
  if (requestId !== lineMapRequestId) return;
  const stopPoints = stops.map((stop) => [stop.latitude, stop.longitude]);
  currentStopNames = new Map(
    stops.map((stop) => [stopNumericId(stop.ref), stop.name]).filter(([id]) => id !== null),
  );
  currentStopPoints = stopPoints;

  let routeBounds = [];
  currentRoutePolylines = [];
  try {
    const shapes = await fetchLineShapes(passage.lineRef);
    const shapePoints = shapes.flatMap((shape) => shape.latLngs);
    // Bordeaux Metropole's open data frequently tags a route shape with the
    // wrong line id -- if it doesn't actually pass near most of this line's
    // own stops, it's not this line's route: skip drawing it rather than
    // show a confidently wrong path.
    if (shapes.length > 0 && !shapeCoversStops(shapePoints, stopPoints)) {
      statusEl.textContent = "Trace indisponible pour cette ligne";
    } else {
      for (const shape of shapes) {
        L.polyline(shape.latLngs, {
          color,
          weight: ROUTE_WEIGHT,
          // Faded enough that a same-colored vehicle marker sitting on the
          // route still stands out against it.
          opacity: shape.direction === "retour" ? 0.3 : 0.5,
        }).addTo(lineMapLayer);
      }
      routeBounds = shapePoints;
      currentRoutePolylines = shapes.map((shape) => shape.latLngs);
    }
  } catch (err) {
    console.error("Impossible de charger le trace de la ligne :", err);
  }
  if (requestId !== lineMapRequestId) return;

  for (const stop of stops) {
    L.circleMarker([stop.latitude, stop.longitude], {
      // A touch larger than the route polyline with a crisper white ring, so
      // stops read clearly against the line rather than blending into it.
      radius: STOP_RADIUS,
      color: "#ffffff",
      weight: STOP_STROKE,
      fillColor: color,
      fillOpacity: 1,
    })
      .bindTooltip(stop.name)
      .addTo(stopMarkersLayer);
  }
  applyZoomScale();

  // Fit to whichever points are actually trustworthy: the route when it
  // checked out, otherwise the stops so the map still lands on the line.
  // fitBounds on a whole line lands quite wide; nudge in a step so it opens
  // closer to street level (still recenters on the user's location if geo
  // resolves, keeping this zoom).
  const fitPoints = routeBounds.length > 0 ? routeBounds : stopPoints;
  if (fitPoints.length > 0) {
    map.fitBounds(fitPoints, { padding: [20, 20], animate: false });
    map.setZoom(Math.min(map.getMaxZoom(), map.getZoom() + LINE_FIT_ZOOM_IN), { animate: false });
  }
  centerOnUserLocation(map);

  refreshVehicles();
  if (vehicleRefreshTimer) clearInterval(vehicleRefreshTimer);
  vehicleRefreshTimer = setInterval(refreshVehicles, REFRESH_INTERVAL_MS);
  if (vehicleAnimationFrame) cancelAnimationFrame(vehicleAnimationFrame);
  vehicleAnimationFrame = requestAnimationFrame(animateVehicles);
}

// Draws every line's route shapes + stop dots onto the fleet map, each in
// its own line colour, faded so live vehicles still read on top. Only for a
// handful of lines (see FLEET_MAP_MAX_LINES) -- fires one fetch pair per
// line. Also fills currentStopNames so vehicle tooltips can name stops here
// too. `guard()` returns false once a newer openFleetMap/openLineMap has
// started, so a slow response never paints onto the wrong screen.
async function drawFleetLines(linesByRef, guard) {
  await Promise.all(
    [...linesByRef.values()].map(async (line) => {
      const lineColor = passageAccentColor(lineAsPassage(line));
      const [shapes, stops] = await Promise.all([
        fetchLineShapes(line.ref).catch(() => []),
        client.stopsForLine(line.ref).catch(() => []),
      ]);
      if (!guard()) return;
      for (const shape of shapes) {
        L.polyline(shape.latLngs, {
          color: lineColor,
          weight: ROUTE_WEIGHT,
          opacity: shape.direction === "retour" ? 0.25 : 0.4,
        }).addTo(lineMapLayer);
      }
      for (const stop of stops) {
        L.circleMarker([stop.latitude, stop.longitude], {
          radius: STOP_RADIUS,
          color: "#ffffff",
          weight: STOP_STROKE,
          fillColor: lineColor,
          fillOpacity: 1,
        })
          .bindTooltip(stop.name)
          .addTo(stopMarkersLayer);
        const numericId = stopNumericId(stop.ref);
        if (numericId !== null) currentStopNames.set(numericId, stop.name);
      }
    }),
  );
  if (guard()) applyZoomScale();
}

// Shows every vehicle of one mode (every tram, or every bus) at once,
// rather than a single line's -- opened by tapping the "Trams"/"Bus"
// heading on the home line list. For a small network (the trams) it also
// draws every line's route + stops for context (drawFleetLines); vehicles
// are still dead-reckoned in a straight line with no stop-approach braking,
// and there's no incident notice. The recap below the map lists vehicles
// per line (updateFleetStats) rather than per direction.
async function openFleetMap(mode) {
  const requestId = ++lineMapRequestId;
  document.getElementById("map-title").textContent = mode === "tram" ? "Tous les trams" : "Tous les bus";
  const statusEl = document.getElementById("map-status");
  statusEl.textContent = "";
  document.getElementById("line-incident").hidden = true;
  document.getElementById("vehicle-stats").hidden = true;
  mapReturnScreen = Object.keys(screens).find((key) => !screens[key].hidden) ?? "search";
  showScreen("map");
  const map = ensureLineMap();
  requestAnimationFrame(() => map.invalidateSize());

  currentLinePassage = null;
  followedVehicleId = null;
  lineMapLayer.clearLayers();
  stopMarkersLayer.clearLayers();
  vehicleLayer.clearLayers();
  activeVehicles = [];
  currentRoutePolylines = [];
  currentStopPoints = [];
  currentStopNames = new Map();

  let lines = [];
  try {
    lines = await client.listLines();
  } catch (err) {
    console.error("Impossible de charger les lignes :", err);
  }
  if (requestId !== lineMapRequestId) return;
  const modeLines = lines.filter((line) => line.mode === mode);
  const linesById = new Map(modeLines.map((line) => [lineNumericId(line.ref), line]));
  currentFleetContext = { mode, linesById };

  // No single route to fit the view to -- start centered on Bordeaux itself,
  // then centerOnUserLocation narrows in once geolocation resolves.
  map.setView([44.84, -0.58], 12);
  centerOnUserLocation(map);

  if (modeLines.length > 0 && modeLines.length <= FLEET_MAP_MAX_LINES) {
    const linesByRef = new Map(modeLines.map((line) => [line.ref, line]));
    drawFleetLines(linesByRef, () => requestId === lineMapRequestId && currentFleetContext?.mode === mode);
  }

  refreshVehicles();
  if (vehicleRefreshTimer) clearInterval(vehicleRefreshTimer);
  vehicleRefreshTimer = setInterval(refreshVehicles, REFRESH_INTERVAL_MS);
  if (vehicleAnimationFrame) cancelAnimationFrame(vehicleAnimationFrame);
  vehicleAnimationFrame = requestAnimationFrame(animateVehicles);
}

function closeLineMap() {
  if (vehicleRefreshTimer) {
    clearInterval(vehicleRefreshTimer);
    vehicleRefreshTimer = null;
  }
  if (vehicleAnimationFrame) {
    cancelAnimationFrame(vehicleAnimationFrame);
    vehicleAnimationFrame = null;
  }
  activeVehicles = [];
  currentRoutePolylines = [];
  followedVehicleId = null;
  currentLinePassage = null;
  currentFleetContext = null;
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
  closeLineMap();
  showScreen("search");
  syncUrl(); // drop the ?stop= param, keep the search text/filters
}

document.getElementById("home-link").addEventListener("click", goHome);
document.getElementById("back-from-board").addEventListener("click", goHome);
document.getElementById("back-from-favorites").addEventListener("click", goHome);
document.getElementById("back-from-map").addEventListener("click", () => {
  closeLineMap();
  showScreen(mapReturnScreen);
});

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

  await runSearch(document.getElementById("search-input").value);
}

init();
