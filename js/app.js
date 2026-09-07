import { TbmClient, stopNumericId } from "./tbmApi.js";
import { FavoritesStore } from "./favorites.js";
import { fetchLineShapes } from "./lineShapes.js";
import { fetchVehiclePositions } from "./vehiclePositions.js";
import { isNearAnyPoint, shapeCoversStops } from "./geoBounds.js";
import { distanceToStopAhead, estimateVehiclePosition, lerpLatLng } from "./vehicleMotion.js";

const REFRESH_INTERVAL_MS = 10000; // TBM's own feed updates roughly every 10-30s
const DEFAULT_LINE_COLOR = "#0a3d62";

// How far a live vehicle may sit from its own line's nearest stop and still
// be trusted (meters). TBM's GTFS-RT feed occasionally mistags a vehicle
// with the wrong route_id, which then reports a real position -- just for a
// different, distant line -- that a plain Bordeaux-area sanity check can't
// catch. A real Tram A vehicle checked against Tram A's own 89 stops never
// exceeded ~350m; a mistagged one is typically several kilometers off.
const VEHICLE_STOP_DISTANCE_METERS = 1000;

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

function lineGroupHeading(text) {
  const li = document.createElement("li");
  li.className = "line-group-heading";
  li.textContent = text;
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
async function renderLinesBrowser() {
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "";
  resultsEl.classList.add("lines-grid");
  const lines = await client.listLines();
  const modes = selectedModes();
  const wantsTram = !modes || modes.includes("tram");
  const wantsBus = !modes || modes.includes("bus");

  if (wantsTram) {
    const trams = sortByCode(lines.filter((line) => line.mode === "tram"));
    if (trams.length > 0) {
      resultsEl.appendChild(lineGroupHeading("Trams"));
      for (const line of trams) resultsEl.appendChild(lineBadgeElement(line, openLineMap));
    }
  }
  if (wantsBus) {
    const buses = sortByCode(lines.filter((line) => line.mode === "bus"));
    if (buses.length > 0) {
      resultsEl.appendChild(lineGroupHeading("Bus"));
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
let mapReturnScreen = "search";
let geoRequestId = 0;
let userLocationMarker = null;
let currentStopNames = new Map();
let currentStopPoints = [];
let lineMapRequestId = 0;

function ensureLineMap() {
  if (lineMap) return lineMap;
  lineMap = L.map("line-map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(lineMap);
  lineMapLayer = L.layerGroup().addTo(lineMap);
  stopMarkersLayer = L.layerGroup().addTo(lineMap);
  vehicleLayer = L.layerGroup().addTo(lineMap);
  // A manual pan means the user wants to look elsewhere -- fighting that by
  // keeping the camera locked onto a followed vehicle would be worse than
  // just letting go of it.
  lineMap.on("dragstart", () => {
    followedVehicleId = null;
  });
  return lineMap;
}

// A small circular badge with a single letter ("T" for tram, "B" for bus),
// distinct from the smaller plain dots used for stops. Moving vehicles get
// a pulsing halo (a common "live" indicator); a stopped one is shown dimmed
// with no pulse, so the two states are visually distinct at a glance.
// Tapping a marker follows it (see refreshVehicles/animateVehicles);
// is-followed adds a visible ring so it's clear which one that is.
function vehicleDivIcon(letter, color, moving, followed) {
  return L.divIcon({
    className: `vehicle-marker ${moving ? "is-moving" : "is-stopped"}${followed ? " is-followed" : ""}`,
    html: `<div class="vehicle-pulse" style="background:${color}"></div><div class="vehicle-badge" style="background:${color}">${letter}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Builds the vehicle's tooltip: its destination, then either its speed and
// where it's headed (moving) or which stop it's sitting at (stopped) --
// whichever of those is actually known, since stop_id doesn't always
// resolve to a stop this line's own list has a name for.
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function vehicleTooltip(vehicle, fallbackLabel) {
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
  return `${title}<br>${detail}${time ? `<br>${time}` : ""}`;
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
  if (!currentLinePassage) return;
  const letter = currentLinePassage.mode === "tram" ? "T" : "B";
  const color = passageAccentColor(currentLinePassage);
  for (const entry of activeVehicles) {
    if (entry.vehicle.id !== previousId && entry.vehicle.id !== followedVehicleId) continue;
    const isFollowed = entry.vehicle.id === followedVehicleId;
    entry.marker.setIcon(vehicleDivIcon(letter, color, entry.vehicle.moving, isFollowed));
    if (isFollowed) entry.marker.openTooltip();
  }
}

async function refreshVehicles(passage) {
  if (!passage || !vehicleLayer) return;
  const letter = passage.mode === "tram" ? "T" : "B";
  const label = `${passage.mode === "tram" ? "Tram" : "Bus"} ${passage.lineCode}`;
  try {
    const vehicles = await fetchVehiclePositions(passage.lineRef);
    // The user may have switched to a different line (or closed the map)
    // while this fetch was in flight -- drop the response rather than
    // paint another line's vehicles onto the one now showing.
    if (currentLinePassage?.lineRef !== passage.lineRef) return;
    const color = passageAccentColor(passage);

    // Matched by vehicle id so a vehicle already on screen keeps the same
    // marker (and so its open tooltip / follow ring / in-flight position
    // transition survive) instead of being torn down and rebuilt from
    // scratch every refresh.
    const previousById = new Map(activeVehicles.filter((entry) => entry.vehicle.id).map((entry) => [entry.vehicle.id, entry]));
    const seenIds = new Set();
    const nextActiveVehicles = [];

    for (const vehicle of vehicles) {
      // TBM's GTFS-RT feed occasionally mistags a vehicle with the wrong
      // route_id -- it then reports a real position, just nowhere near this
      // line's own stops. Drop it rather than show it confidently in the
      // wrong place.
      if (!isNearAnyPoint([vehicle.latitude, vehicle.longitude], currentStopPoints, VEHICLE_STOP_DISTANCE_METERS)) {
        continue;
      }
      const isFollowed = Boolean(vehicle.id) && vehicle.id === followedVehicleId;
      const icon = vehicleDivIcon(letter, color, vehicle.moving, isFollowed);
      const previous = vehicle.id ? previousById.get(vehicle.id) : null;
      if (vehicle.id) seenIds.add(vehicle.id);

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
        marker.setTooltipContent(vehicleTooltip(vehicle, label));
      } else {
        marker = L.marker([vehicle.latitude, vehicle.longitude], { icon })
          // A fixed direction (rather than Leaflet's default "auto", which
          // picks left/right based on space around the marker) matters most
          // for a followed vehicle: it sits pinned at the map's center, so
          // "auto" would otherwise flip sides on the smallest jitter.
          .bindTooltip(vehicleTooltip(vehicle, label), { direction: "top", offset: [0, -14], className: "vehicle-tooltip" })
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
        // Distance to the line's own closest stop actually ahead of this
        // vehicle at this last known fix -- animateVehicles() uses it so a
        // fast vehicle's estimated position never creeps past a stop it's
        // about to reach before its next fix.
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
  } catch (err) {
    console.error("Impossible de charger les positions des vehicules :", err);
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
  // The line list opens the map straight from search; a passage badge opens
  // it from the board. "Retour" should go back to whichever that was.
  mapReturnScreen = Object.keys(screens).find((key) => !screens[key].hidden) ?? "search";
  showScreen("map");
  const map = ensureLineMap();
  // The map container was hidden (display:none) until showScreen ran just
  // above, so Leaflet needs a nudge to pick up its now-real size.
  requestAnimationFrame(() => map.invalidateSize());

  currentLinePassage = passage;
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
          weight: 4,
          opacity: shape.direction === "retour" ? 0.55 : 0.9,
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
      radius: 3,
      color: "#ffffff",
      weight: 1,
      fillColor: color,
      fillOpacity: 1,
    })
      .bindTooltip(stop.name)
      .addTo(stopMarkersLayer);
  }

  // Fit to whichever points are actually trustworthy: the route when it
  // checked out, otherwise the stops so the map still lands on the line.
  const fitPoints = routeBounds.length > 0 ? routeBounds : stopPoints;
  if (fitPoints.length > 0) map.fitBounds(fitPoints, { padding: [20, 20] });
  centerOnUserLocation(map);

  refreshVehicles(passage);
  if (vehicleRefreshTimer) clearInterval(vehicleRefreshTimer);
  vehicleRefreshTimer = setInterval(() => refreshVehicles(currentLinePassage), REFRESH_INTERVAL_MS);
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
