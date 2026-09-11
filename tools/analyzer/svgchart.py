"""A tiny, dependency-free inline SVG line/bar chart -- the dashboard is a
single static HTML file meant to work by double-clicking it (no server, no
build), so this avoids pulling in a charting library just to draw a couple of
curves.
"""

PALETTE = {"tram": "#7c3aed", "bus": "#f97316"}


def line_chart(series: dict[str, list[tuple[float, float]]], *, width=760, height=280, y_suffix="", title="") -> str:
    """series: {name: [(x, y), ...]}. All series share one x/y scale."""
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
        color = PALETTE.get(name, "#0a3d62")
        path = " ".join(f"{'M' if i == 0 else 'L'}{sx(x):.1f},{sy(y):.1f}" for i, (x, y) in enumerate(pts) if y is not None)
        parts.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2.5"/>')
        for x, y in pts:
            if y is not None:
                parts.append(f'<circle cx="{sx(x):.1f}" cy="{sy(y):.1f}" r="2.5" fill="{color}"/>')
    parts.append("</svg>")
    legend = " ".join(
        f'<span class="legend-swatch" style="background:{PALETTE.get(n, "#0a3d62")}"></span>{n}'
        for n in series
    )
    return f'<div class="chart-block"><h3>{title}</h3>{"".join(parts)}<div class="chart-legend">{legend}</div></div>'
