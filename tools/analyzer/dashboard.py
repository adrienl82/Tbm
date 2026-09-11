"""Builds the two self-contained dashboard pages from the rollups (see
rollups.py). Both are single HTML files with their data inlined as a
<script> JSON blob -- they're opened straight off disk (double-click, or a
Samba mount) with no server and no fetch(), which a file:// page can't do
reliably across browsers anyway.
"""

import html
import json
from pathlib import Path

from svgchart import line_chart

WEEKDAY_FR = {1: "Lundi", 2: "Mardi", 3: "Mercredi", 4: "Jeudi", 5: "Vendredi", 6: "Samedi", 7: "Dimanche"}


def _esc(value) -> str:
    return html.escape(str(value)) if value is not None else ""


def _sessions_table(sessions: list[dict]) -> str:
    if not sessions:
        return "<p>Aucune session traitee pour le moment.</p>"
    rows = []
    for s in sessions:
        tags = []
        if s["is_public_holiday"]:
            tags.append(f'<span class="tag tag-holiday">ferie: {_esc(s["holiday_name"])}</span>')
        if s["is_school_holiday"]:
            tags.append(f'<span class="tag tag-vacation">vacances: {_esc(s["vacation_name"])}</span>')
        rows.append(f"""
          <tr>
            <td>{_esc(str(s["start_ft"])[:16])}</td>
            <td>{WEEKDAY_FR.get(s["weekday"], "?")}</td>
            <td>{"".join(tags) or "-"}</td>
            <td>{s["n_trams"]}</td>
            <td>{s["n_buses"]}</td>
            <td>{s["avg_tram_kmh"] if s["avg_tram_kmh"] is not None else "-"}</td>
            <td>{s["avg_bus_kmh"] if s["avg_bus_kmh"] is not None else "-"}</td>
            <td>{s["n_alerts"]}</td>
          </tr>""")
    return f"""
      <table class="sessions">
        <thead><tr>
          <th>Debut</th><th>Jour</th><th>Type</th><th>Trams</th><th>Bus</th>
          <th>V. tram (km/h)</th><th>V. bus (km/h)</th><th>Alertes</th>
        </tr></thead>
        <tbody>{"".join(rows)}</tbody>
      </table>"""


def _comparison_block(title: str, rows: list[dict], key: str, label_fn) -> str:
    if not rows:
        return ""
    items = "".join(
        f'<li><strong>{label_fn(r[key])}</strong> : {r["avg_tram_kmh"]} km/h '
        f'<span class="muted">({r["n_sessions"]} session{"s" if r["n_sessions"] > 1 else ""})</span></li>'
        for r in rows
    )
    small_n = any(r["n_sessions"] < 3 for r in rows)
    note = (
        '<p class="muted small">Echantillon trop petit pour une vraie comparaison -- '
        "revient plus parlant apres quelques semaines de collecte.</p>"
        if small_n
        else ""
    )
    return f"<div class='compare-block'><h3>{title}</h3><ul>{items}</ul>{note}</div>"


def build_index_html(*, hourly: list[dict], sessions: list[dict], comparisons: dict, generated_at: str) -> str:
    by_mode: dict[str, list[tuple[float, float]]] = {}
    for r in hourly:
        by_mode.setdefault(r["mode"], []).append((r["hour"], r["avg_kmh"]))
    chart = line_chart(by_mode, y_suffix=" km/h", title="Vitesse moyenne par heure de la journee")

    compare_html = "".join([
        _comparison_block("Jour ferie vs normal", comparisons["public_holiday"], "is_public_holiday",
                           lambda v: "Ferie" if v else "Normal"),
        _comparison_block("Vacances scolaires (Zone A) vs periode scolaire", comparisons["school_holiday"],
                           "is_school_holiday", lambda v: "Vacances" if v else "Periode scolaire"),
        _comparison_block("Par jour de semaine", comparisons["by_weekday"], "weekday",
                           lambda v: WEEKDAY_FR.get(v, str(v))),
    ])

    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><title>TBM -- tableau de bord trafic</title>
<style>{_CSS}</style></head>
<body>
<header><h1>TBM -- trafic observe</h1><p class="muted">Genere le {_esc(generated_at)} -- <a href="map.html">carte du trafic &rarr;</a></p></header>
<main>
  {chart}
  <section><h2>Comparaisons</h2>{compare_html or "<p class='muted'>Pas encore assez de sessions.</p>"}</section>
  <section><h2>Sessions traitees ({len(sessions)})</h2>{_sessions_table(sessions)}</section>
</main>
</body></html>"""


_CSS = """
:root { color-scheme: light dark; --bg:#f5f7fa; --text:#1c1c1e; --muted:#6b7280; --border:#e2e5ea; --card:#ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b0e14; --text:#f2f2f2; --muted:#9aa1ac; --border:#2a2f3a; --card:#151a23; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
header, main { max-width: 900px; margin: 0 auto; padding: 16px 20px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.muted { color: var(--muted); } .small { font-size: 12px; }
a { color: #4da3ff; }
.chart-block { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 16px 0; }
.chart-block h3 { margin: 0 0 8px; font-size: 14px; }
.chart-empty { color: var(--muted); font-style: italic; }
.chart-grid { stroke: var(--border); stroke-width: 1; }
.chart-axis { fill: var(--muted); font-size: 10px; }
.chart-legend { margin-top: 6px; font-size: 12px; color: var(--muted); }
.legend-swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin: 0 4px 0 10px; vertical-align: middle; }
table.sessions { width: 100%; border-collapse: collapse; font-size: 13px; }
table.sessions th, table.sessions td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
table.sessions th { color: var(--muted); font-weight: 600; }
.tag { display:inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-right: 4px; }
.tag-holiday { background: #fde2e2; color: #9b1c1c; }
.tag-vacation { background: #dbeafe; color: #1e40af; }
.compare-block { margin-bottom: 14px; }
.compare-block ul { margin: 4px 0; padding-left: 18px; }
"""


def build_map_html(grid_rows: list[list], generated_at: str) -> str:
    # Each row is [cell_lat, cell_lon, hour, mode, n, avg_kmh] -- see
    # rollups.grid_for_map -- to keep the inlined JSON from paying for
    # repeated key names across ~tens of thousands of rows.
    data = json.dumps(grid_rows, separators=(",", ":"))
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><title>TBM -- carte du trafic</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<style>
  :root {{ color-scheme: light dark; }}
  html,body {{ margin:0; height:100%; font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; }}
  #map {{ position:absolute; inset:0; }}
  #panel {{ position:absolute; z-index:1000; top:10px; left:10px; background:#fffffff0; color:#111;
            padding:10px 14px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.25); width: 260px; }}
  #panel h1 {{ font-size:14px; margin:0 0 8px; }}
  #panel label {{ display:block; font-size:12px; margin-top:8px; }}
  #hour-value {{ font-weight:700; }}
  #legend {{ margin-top:8px; font-size:11px; }}
  .swatch {{ display:inline-block; width:12px; height:12px; margin-right:4px; vertical-align:middle; }}
  a {{ color:#1a73e8; }}
</style></head>
<body>
<div id="map"></div>
<div id="panel">
  <h1>Trafic observe par heure</h1>
  <p class="muted" style="font-size:11px;margin:0">Genere le {_esc(generated_at)} -- <a href="index.html">&larr; tableau de bord</a></p>
  <label>Mode
    <select id="mode-select">
      <option value="tram">Tram</option>
      <option value="bus">Bus</option>
    </select>
  </label>
  <label>Heure : <span id="hour-value">12</span>h
    <input type="range" id="hour-slider" min="0" max="23" step="1" value="12" style="width:100%"/>
  </label>
  <div id="legend">
    <span class="swatch" style="background:#d73027"></span>lent
    <span class="swatch" style="background:#fee08b"></span>moyen
    <span class="swatch" style="background:#1a9850"></span>rapide
    <br/>opacite = densite de passages
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
// row = [cell_lat, cell_lon, hour, mode, n, avg_kmh]
const GRID = {data};
const DLAT = {0.003};
const DLON = {0.0042};

const map = L.map("map").setView([44.84, -0.58], 12);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{{z}}/{{y}}/{{x}}", {{ maxZoom: 19 }}).addTo(map);

function speedColor(kmh) {{
  // slow (red) -> fast (green); tuned around typical tram/bus urban speeds
  const t = Math.max(0, Math.min(1, (kmh - 8) / (28 - 8)));
  const stops = [[215,48,39],[254,224,139],[26,152,80]];
  const seg = t < 0.5 ? [stops[0], stops[1], t*2] : [stops[1], stops[2], (t-0.5)*2];
  const [a,b,f] = seg;
  const mix = (i) => Math.round(a[i] + (b[i]-a[i])*f);
  return `rgb(${{mix(0)}},${{mix(1)}},${{mix(2)}})`;
}}

let rects = [];
function render() {{
  for (const r of rects) map.removeLayer(r);
  rects = [];
  const mode = document.getElementById("mode-select").value;
  const hour = Number(document.getElementById("hour-slider").value);
  const here = GRID.filter(([, , h, m]) => m === mode && h === hour);
  const maxN = Math.max(1, ...here.map(([, , , , n]) => n));
  for (const [lat, lon, , , n, kmh] of here) {{
    const bounds = [[lat, lon], [lat + DLAT, lon + DLON]];
    const opacity = 0.25 + 0.6 * Math.min(1, n / (maxN * 0.6));
    rects.push(L.rectangle(bounds, {{ color: speedColor(kmh), weight: 0, fillOpacity: opacity }})
      .bindTooltip(`${{kmh}} km/h -- ${{n}} passages`)
      .addTo(map));
  }}
}}

document.getElementById("hour-slider").addEventListener("input", (e) => {{
  document.getElementById("hour-value").textContent = e.target.value;
  render();
}});
document.getElementById("mode-select").addEventListener("change", render);
render();
</script>
</body></html>"""


def write_dashboard(dashboard_dir: Path, *, hourly, sessions, comparisons, grid_rows, generated_at: str) -> None:
    dashboard_dir.mkdir(parents=True, exist_ok=True)
    (dashboard_dir / "index.html").write_text(
        build_index_html(hourly=hourly, sessions=sessions, comparisons=comparisons, generated_at=generated_at),
        encoding="utf-8",
    )
    (dashboard_dir / "map.html").write_text(build_map_html(grid_rows, generated_at), encoding="utf-8")
