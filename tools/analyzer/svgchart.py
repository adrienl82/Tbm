"""A tiny, dependency-free inline SVG line/bar chart -- the dashboard is a
single static HTML file meant to work by double-clicking it (no server, no
build), so this avoids pulling in a charting library just to draw a couple of
curves.
"""

PALETTE = {"tram": "#7c3aed", "bus": "#f97316"}

BUCKET_PALETTE = {
    "avance": "#3b82f6",
    "heure": "#22c55e",
    "retard_modere": "#f59e0b",
    "retard_important": "#ef4444",
}
BUCKET_LABEL_FR = {
    "avance": "En avance",
    "heure": "A l'heure",
    "retard_modere": "Retard modere",
    "retard_important": "Retard important",
}


def stacked_bar_chart(buckets: list[dict], *, title="") -> str:
    """One 100%-stacked horizontal bar: bucket -> pct, in PUNCTUALITY_BUCKETS
    order. buckets: [{"bucket": "heure", "n": .., "pct": ..}, ...]."""
    total_n = sum(b["n"] for b in buckets)
    if not total_n:
        return f'<p class="chart-empty">{title}: pas de donnees</p>'
    width, height, bar_h = 760, 60, 34
    y = (height - bar_h) / 2
    parts = [f'<svg viewBox="0 0 {width} {height}" class="chart" role="img" aria-label="{title}">']
    x = 0.0
    for b in buckets:
        w = width * (b["pct"] / 100.0)
        color = BUCKET_PALETTE.get(b["bucket"], "#999")
        parts.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="{bar_h}" fill="{color}"/>')
        if w > 42:
            parts.append(
                f'<text x="{x + w / 2:.1f}" y="{y + bar_h / 2 + 4:.0f}" text-anchor="middle" '
                f'fill="#fff" font-size="12" font-weight="600">{b["pct"]:g}%</text>'
            )
        x += w
    parts.append("</svg>")
    legend = " ".join(
        f'<span class="legend-swatch" style="background:{BUCKET_PALETTE.get(b["bucket"], "#999")}"></span>'
        f'{BUCKET_LABEL_FR.get(b["bucket"], b["bucket"])} ({b["n"]})'
        for b in buckets
    )
    return f'<div class="chart-block"><h3>{title}</h3>{"".join(parts)}<div class="chart-legend">{legend}</div></div>'


def line_chart(
    series: dict[str, list[tuple[float, float]]], *, width=760, height=280, y_suffix="", title="",
    palette: dict[str, str] | None = None,
) -> str:
    """series: {name: [(x, y), ...]}. All series share one x/y scale. `palette`
    overrides/extends the default tram/bus PALETTE for this call (e.g. to give
    each tram letter its own color)."""
    palette = {**PALETTE, **(palette or {})}
    pad_l, pad_r, pad_t, pad_b = 46, 16, 24, 28
    xs = [x for pts in series.values() for x, _ in pts]
    ys = [y for pts in series.values() for _, y in pts if y is not None]
    if not xs or not ys:
        return f'<p class="chart-empty">{title}: pas de donnees</p>'
    x0, x1 = min(xs), max(xs)
    y0, y1 = 0, max(ys) * 1.15

    def sx(x):
        return pad_l + (x - x0) / (x1 - x0 or 1) * (width - pad_l - pad_r)

    def sy(y):
        return height - pad_b - (y - y0) / (y1 - y0 or 1) * (height - pad_t - pad_b)

    parts = [f'<svg viewBox="0 0 {width} {height}" class="chart" role="img" aria-label="{title}">']
    # gridlines + y labels
    for frac in (0, 0.25, 0.5, 0.75, 1):
        y = y0 + frac * (y1 - y0)
        gy = sy(y)
        parts.append(f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{width - pad_r}" y2="{gy:.1f}" class="chart-grid"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{gy + 4:.1f}" class="chart-axis" text-anchor="end">{y:.0f}{y_suffix}</text>')
    # x labels (sparse)
    xs_sorted = sorted(set(xs))
    step = max(1, len(xs_sorted) // 12)
    for x in xs_sorted[::step]:
        parts.append(f'<text x="{sx(x):.1f}" y="{height - pad_b + 16}" class="chart-axis" text-anchor="middle">{x:g}</text>')
    # series
    for name, pts in series.items():
        pts = sorted(pts)
        color = palette.get(name, "#0a3d62")
        path = " ".join(f"{'M' if i == 0 else 'L'}{sx(x):.1f},{sy(y):.1f}" for i, (x, y) in enumerate(pts) if y is not None)
        parts.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2.5"/>')
        for x, y in pts:
            if y is not None:
                parts.append(f'<circle cx="{sx(x):.1f}" cy="{sy(y):.1f}" r="2.5" fill="{color}"/>')
    parts.append("</svg>")
    legend = " ".join(
        f'<span class="legend-swatch" style="background:{palette.get(n, "#0a3d62")}"></span>{n}'
        for n in series
    )
    return f'<div class="chart-block"><h3>{title}</h3>{"".join(parts)}<div class="chart-legend">{legend}</div></div>'
