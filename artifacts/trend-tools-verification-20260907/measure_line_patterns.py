"""Measure visible blue dash pixels from the three specified final source frames."""
import json
import math
from pathlib import Path
import statistics
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
CASES = [
    ("tradingview-dashed-3px", "01-trendline-tradingview-lock/00005.png", (601, 235), (889, 523), (20, 165)),
    ("tradingview-dotted-3px", "01-trendline-tradingview-dotted/00003.png", (583, 235), (871, 523), (20, 165)),
    ("rtx-dashed-3px", "01-trendline-rtx-style-lock-after/00004.png", (1301, 420), (1564, 299), (20, 260)),
]
results = []
for name, source, start, end, bounds in CASES:
    im = Image.open(ROOT / source).convert("RGB")
    arr = np.array(im).astype(int)
    yy, xx = np.indices(arr.shape[:2])
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    along = (xx - start[0]) * ux + (yy - start[1]) * uy
    across = -(xx - start[0]) * uy + (yy - start[1]) * ux
    blue = (arr[:, :, 2] > 140) & (arr[:, :, 2] - arr[:, :, 0] > 60) & (arr[:, :, 2] - arr[:, :, 1] > 35)
    mask = blue & (np.abs(across) < 3) & (along > bounds[0]) & (along < bounds[1])
    pixels = set(zip(*np.where(mask)))
    components = []
    while pixels:
        seed = pixels.pop()
        component, todo = [seed], [seed]
        while todo:
            y, x = todo.pop()
            for oy in (-1, 0, 1):
                for ox in (-1, 0, 1):
                    p = (y + oy, x + ox)
                    if p in pixels:
                        pixels.remove(p)
                        todo.append(p)
                        component.append(p)
        ts = [float(along[y, x]) for y, x in component]
        # Ignore components cut by the measurement window.
        if min(ts) - bounds[0] < 2 or bounds[1] - max(ts) < 2:
            continue
        footprint = abs(ux) + abs(uy)
        components.append({"start_px": min(ts), "end_px": max(ts), "projected_footprint_length_px": max(ts) - min(ts) + footprint, "centroid_px": statistics.mean(ts), "pixels": len(component)})
    components.sort(key=lambda part: part["start_px"])
    periods = [b["centroid_px"] - a["centroid_px"] for a, b in zip(components, components[1:])]
    gaps = [b["start_px"] - a["end_px"] - (abs(ux) + abs(uy)) for a, b in zip(components, components[1:])]
    result = {"name": name, "source": source, "line_start": start, "line_end": end, "measurement_window_along_line_px": bounds, "blue_mask": "B>140, B-R>60, B-G>35; perpendicular distance<3px", "median_colored_length_px": statistics.median(c["projected_footprint_length_px"] for c in components), "median_clear_gap_px": statistics.median(gaps), "median_centroid_period_px": statistics.median(periods), "components": components}
    results.append(result)
    print(name, json.dumps({k: round(result[k], 2) for k in ("median_colored_length_px", "median_clear_gap_px", "median_centroid_period_px")}))
    # Nearest-neighbor enlargement preserves raster evidence for cap inspection.
    cx, cy = start[0] + ux * 80, start[1] + uy * 80
    crop = im.crop((int(cx)-48, int(cy)-48, int(cx)+48, int(cy)+48)).resize((768, 768), Image.Resampling.NEAREST)
    crop.save(ROOT / f"{name}-pixel-crop.png")
(ROOT / "line-pattern-measurement.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
