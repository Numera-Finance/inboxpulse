#!/usr/bin/env python3
"""
Render the handbook's architecture diagram to SVG and PNG from one layout.

The diagram was ASCII box-drawing inside a fenced block. That renders correctly
in a terminal and badly everywhere else: converted to .docx it splits across a
page boundary mid-figure and the box glyphs fall out of alignment, because Word
reflows the monospace block against a proportional page.

Two outputs, one source of truth:

    docs/handbook/diagrams/architecture.svg   referenced by the markdown
    docs/handbook/diagrams/architecture.png   used by the .docx build

pandoc cannot rasterize SVG without rsvg-convert, which is not installed, so the
PNG is drawn directly with Pillow from the same coordinates rather than
converted. Both renderers read the LAYOUT below, so they cannot drift.

Usage:
    python3 scripts/build-diagrams.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join("docs", "handbook", "diagrams")
W, H = 1120, 545
SCALE = 2  # PNG supersampling, so the image stays sharp when Word scales it

# Word and pandoc size a PNG as pixels / DPI. Writing the DPI that makes the
# image exactly this wide is how the figure gets a print size without a pandoc
# extension: gfm does not support link_attributes, so `{width=...}` is not
# available. 6.2in fits US Letter with 1in margins and keeps the figure on one
# page.
TARGET_WIDTH_IN = 6.2

INK = "#1f2328"
BOX = "#d0d7de"
FILL = "#ffffff"
BAND = "#f6f8fa"
ACCENT = "#0969da"
MUTED = "#57606a"

# ---------------------------------------------------------------------------
# Layout. x, y, w, h in SVG user units; both renderers consume this verbatim.
# ---------------------------------------------------------------------------
BOX_W, BOX_H = 230, 52

SERVICES = [
    # key,            label,            sub,                     x,   y
    ("addon",     "crm-addon",         "apps/addon",            300,  36),
    ("ext",       "Chrome extension",  "apps/chrome-extension", 300, 104),
    ("web",       "crm-web",           "apps/web",              300, 172),
    ("gmail",     "crm-gmail",         "apps/gmail",            300, 256),
    ("analysis",  "crm-analysis",      "apps/analysis",         300, 324),
    ("notif",     "crm-notifications", "apps/notifications",    300, 392),
    ("manager",   "crm-manager",       "apps/manager",          300, 466),
]

CALLERS = [
    ("Gmail sidebar",    "Workspace add-on", 40,  36, "addon"),
    ("Gmail right rail", "in-page rail",     40, 104, "ext"),
    ("Browser",          "inboxpulse…com",   40, 172, "web"),
    ("Gmail push",       "Pub/Sub",          40, 256, "gmail"),
]

API = {"x": 800, "y": 172, "w": 210, "h": 52, "label": "crm-api", "sub": "apps/api"}
DB = {"x": 840, "y": 436, "w": 170, "h": 56, "label": "Postgres", "sub": "Neon"}

# edges into crm-api, with the credential each one presents
EDGES = [
    ("addon",    "x-internal-api-key"),
    ("ext",      "session cookie"),
    ("web",      "session cookie"),
    ("gmail",    "x-internal-api-key"),
    ("analysis", "x-internal-api-key"),
    ("notif",    "x-internal-api-key"),
]

by_key = {k: (x, y) for k, _l, _s, x, y in SERVICES}


def cx(box):
    return box["x"] + box["w"] / 2


# ---------------------------------------------------------------------------
# SVG
# ---------------------------------------------------------------------------
def esc(t: str) -> str:
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg_box(x, y, w, h, label, sub, bold=False, fill=FILL):
    weight = "600" if bold else "500"
    ty = y + 22 if sub else y + h / 2 + 5
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" '
        f'fill="{fill}" stroke="{BOX}" stroke-width="1.5"/>',
        f'<text x="{x + 14}" y="{ty}" font-family="Helvetica,Arial,sans-serif" '
        f'font-size="15" font-weight="{weight}" fill="{INK}">{esc(label)}</text>',
    ]
    if sub:
        out.append(
            f'<text x="{x + 14}" y="{y + 40}" '
            f'font-family="ui-monospace,Menlo,monospace" font-size="12" '
            f'fill="{MUTED}">{esc(sub)}</text>'
        )
    return out


def build_svg() -> str:
    p = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" '
        f'aria-label="InboxPulse service architecture">',
        '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" '
        'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{MUTED}"/></marker></defs>',
        f'<rect width="{W}" height="{H}" fill="{BAND}"/>',
    ]

    # caller labels and their arrow into the service box
    for label, sub, x, y, target in CALLERS:
        p.append(
            f'<text x="{x}" y="{y + 20}" font-family="Helvetica,Arial,sans-serif" '
            f'font-size="14" font-weight="600" fill="{INK}">{esc(label)}</text>'
        )
        p.append(
            f'<text x="{x}" y="{y + 37}" font-family="Helvetica,Arial,sans-serif" '
            f'font-size="12" fill="{MUTED}">{esc(sub)}</text>'
        )
        ty = y + BOX_H / 2
        p.append(
            f'<line x1="{x + 175}" y1="{ty}" x2="{by_key[target][0] - 8}" y2="{ty}" '
            f'stroke="{MUTED}" stroke-width="1.5" marker-end="url(#a)"/>'
        )

    for _k, label, sub, x, y in SERVICES:
        p += svg_box(x, y, BOX_W, BOX_H, label, sub)

    p += svg_box(API["x"], API["y"], API["w"], API["h"], API["label"], API["sub"],
                 bold=True, fill="#ffffff")
    p += svg_box(DB["x"], DB["y"], DB["w"], DB["h"], DB["label"], DB["sub"],
                 fill="#ffffff")

    # service -> crm-api, orthogonal: right, along a spine, then into the box
    spine = 745
    api_mid = API["y"] + API["h"] / 2
    for key, cred in EDGES:
        sx, sy = by_key[key]
        y0 = sy + BOX_H / 2
        p.append(
            f'<path d="M{sx + BOX_W} {y0} H{spine} V{api_mid} H{API["x"] - 8}" '
            f'fill="none" stroke="{MUTED}" stroke-width="1.5" marker-end="url(#a)"/>'
        )
        p.append(
            f'<text x="{sx + BOX_W + 8}" y="{y0 - 7}" '
            f'font-family="ui-monospace,Menlo,monospace" font-size="11" '
            f'fill="{ACCENT}">{esc(cred)}</text>'
        )

    # crm-api -> Postgres, and crm-manager -> Postgres
    p.append(
        f'<path d="M{cx(API)} {API["y"] + API["h"]} V{DB["y"] - 8}" fill="none" '
        f'stroke="{MUTED}" stroke-width="1.5" marker-end="url(#a)"/>'
    )
    mx, my = by_key["manager"]
    p.append(
        f'<path d="M{mx + BOX_W} {my + BOX_H / 2} H{DB["x"] - 8}" fill="none" '
        f'stroke="{MUTED}" stroke-width="1.5" marker-end="url(#a)"/>'
    )
    p.append("</svg>")
    return "\n".join(p)


# ---------------------------------------------------------------------------
# PNG, same coordinates
# ---------------------------------------------------------------------------
def font(name, size):
    for path in (
        f"/System/Library/Fonts/Supplemental/{name}",
        f"/System/Library/Fonts/{name}",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def arrow(d, x, y, s):
    d.polygon([(x, y), (x - s, y - s * 0.55), (x - s, y + s * 0.55)], fill=MUTED)


def arrow_down(d, x, y, s):
    d.polygon([(x, y), (x - s * 0.55, y - s), (x + s * 0.55, y - s)], fill=MUTED)


def png_box(d, s, x, y, w, h, label, sub, f_lab, f_sub):
    """x, y, w, h are UNSCALED layout units; every offset is scaled here."""
    d.rounded_rectangle([x * s, y * s, (x + w) * s, (y + h) * s],
                        radius=6 * s, fill=FILL, outline=BOX, width=max(2, int(1.5 * s)))
    if sub:
        d.text(((x + 14) * s, (y + 9) * s), label, font=f_lab, fill=INK)
        d.text(((x + 14) * s, (y + 29) * s), sub, font=f_sub, fill=MUTED)
    else:
        d.text(((x + 14) * s, (y + h / 2 - 9) * s), label, font=f_lab, fill=INK)


def build_png(path: str):
    s = SCALE
    img = Image.new("RGB", (W * s, H * s), BAND)
    d = ImageDraw.Draw(img)
    f_lab = font("Arial Bold.ttf", 15 * s)
    f_sub = font("Menlo.ttc", 12 * s)
    f_cal = font("Arial Bold.ttf", 14 * s)
    f_cs = font("Arial.ttf", 12 * s)
    f_cred = font("Menlo.ttc", 11 * s)

    def line(x1, y1, x2, y2):
        d.line([x1 * s, y1 * s, x2 * s, y2 * s], fill=MUTED, width=int(1.5 * s))

    for label, sub, x, y, target in CALLERS:
        d.text((x * s, (y + 8) * s), label, font=f_cal, fill=INK)
        d.text((x * s, (y + 26) * s), sub, font=f_cs, fill=MUTED)
        ty = y + BOX_H / 2
        line(x + 175, ty, by_key[target][0] - 8, ty)
        arrow(d, (by_key[target][0] - 6) * s, ty * s, 6 * s)

    for _k, label, sub, x, y in SERVICES:
        png_box(d, s, x, y, BOX_W, BOX_H, label, sub, f_lab, f_sub)

    png_box(d, s, API["x"], API["y"], API["w"], API["h"],
            API["label"], API["sub"], f_lab, f_sub)
    png_box(d, s, DB["x"], DB["y"], DB["w"], DB["h"],
            DB["label"], DB["sub"], f_lab, f_sub)

    spine = 745
    api_mid = API["y"] + API["h"] / 2
    for key, cred in EDGES:
        sx, sy = by_key[key]
        y0 = sy + BOX_H / 2
        line(sx + BOX_W, y0, spine, y0)
        line(spine, y0, spine, api_mid)
        line(spine, api_mid, API["x"] - 8, api_mid)
        arrow(d, (API["x"] - 6) * s, api_mid * s, 6 * s)
        d.text(((sx + BOX_W + 8) * s, (y0 - 18) * s), cred, font=f_cred, fill=ACCENT)

    line(cx(API), API["y"] + API["h"], cx(API), DB["y"] - 8)
    arrow_down(d, cx(API) * s, (DB["y"] - 6) * s, 6 * s)
    mx, my = by_key["manager"]
    line(mx + BOX_W, my + BOX_H / 2, DB["x"] - 8, my + BOX_H / 2)
    arrow(d, (DB["x"] - 6) * s, (my + BOX_H / 2) * s, 6 * s)

    dpi = round(W * s / TARGET_WIDTH_IN)
    img.save(path, "PNG", dpi=(dpi, dpi))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    svg_path = os.path.join(OUT_DIR, "architecture.svg")
    png_path = os.path.join(OUT_DIR, "architecture.png")
    with open(svg_path, "w", encoding="utf-8") as fh:
        fh.write(build_svg() + "\n")
    build_png(png_path)
    print(f"  {svg_path}  {os.path.getsize(svg_path):,} bytes")
    print(f"  {png_path}  {os.path.getsize(png_path):,} bytes")


if __name__ == "__main__":
    main()
