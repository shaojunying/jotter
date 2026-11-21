"""Turn raw app screenshots into the framed images used by the README.

Raw shots come from tools/cdp.mjs `shot` (2x device pixels, window content only):
    raw-hero.png  raw-find.png  raw-menu.png  raw-dialog.png  raw-banner.png
This script lays them out in small HTML pages and renders those with headless Edge:
the hero gets a Windows 11 title bar, rounded corners and a shadow on a gradient;
the feature shots are rounded crops on a transparent background.

    python tools/make-readme-images.py <raw-dir> [out-dir=docs]
"""
import pathlib
import subprocess
import sys
import tempfile
import time

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
SCALE = 1.5          # output device scale: crisp on high-DPI screens, files stay small
RAW_W, RAW_H = 1187, 705   # logical size of the raw window shots

raw = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "docs").resolve()
out.mkdir(parents=True, exist_ok=True)
icon = (pathlib.Path(__file__).parent / ".." / "docs" / "icon.png").resolve()

BASE_CSS = """
html, body { margin: 0; background: transparent; }
body { font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif; }
"""


PROFILE = pathlib.Path(tempfile.gettempdir()) / "jotter-readme-edge"


def render(name, html, width, height):
    page = PROFILE.parent / f"jotter-readme-{name}.html"
    page.write_text(html, encoding="utf-8")
    target = out / name
    target.unlink(missing_ok=True)
    subprocess.run([
        EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        f"--force-device-scale-factor={SCALE}", "--default-background-color=00000000",
        f"--window-size={width},{height}", f"--user-data-dir={PROFILE}",
        f"--screenshot={target}", page.as_uri(),
    ], check=True, capture_output=True)
    # msedge.exe can return before the headless browser has written the file.
    for _ in range(100):
        if target.exists() and target.stat().st_size > 0:
            break
        time.sleep(0.2)
    else:
        sys.exit(f"Edge did not write {target}")
    time.sleep(0.5)
    print(f"{target.name}: {target.stat().st_size // 1024} KB")


def hero():
    pad_x, pad_y, bar = 56, 44, 32
    w, h = RAW_W + 2 * pad_x, RAW_H + bar + 2 * pad_y
    html = f"""<!doctype html><meta charset="utf-8"><style>{BASE_CSS}
    body {{ width: {w}px; height: {h}px; display: grid; place-items: center;
      background: radial-gradient(120% 90% at 15% 10%, #24406e 0%, transparent 55%),
                  radial-gradient(110% 90% at 90% 95%, #4b2a6b 0%, transparent 55%), #10131a; }}
    .win {{ width: {RAW_W}px; border-radius: 9px; overflow: hidden; background: #161618;
      box-shadow: 0 0 0 1px rgba(255,255,255,.09), 0 30px 80px rgba(0,0,0,.55), 0 8px 24px rgba(0,0,0,.35); }}
    .bar {{ height: {bar}px; display: flex; align-items: center; color: #d4d4d4; font-size: 12px; }}
    .bar img {{ width: 16px; height: 16px; margin: 0 9px 0 12px; }}
    .bar .t {{ flex: 1; }}
    .bar .b {{ width: 46px; text-align: center; font: 10px "Segoe Fluent Icons", "Segoe MDL2 Assets"; color: #d4d4d4; }}
    .shot {{ display: block; width: {RAW_W}px; height: {RAW_H}px; }}
    </style><body><div class="win">
      <div class="bar"><img src="{icon.as_uri()}"><span class="t">release-notes.md - Jotter</span>
        <span class="b">&#xE921;</span><span class="b">&#xE922;</span><span class="b">&#xE8BB;</span></div>
      <img class="shot" src="{(raw / 'raw-hero.png').as_uri()}">
    </div></body>"""
    render("screenshot.png", html, w, h)


def crop(name, src, x, y, cw, ch):
    """A rounded crop of a raw shot (coordinates in logical px), with a soft shadow."""
    m = 24
    html = f"""<!doctype html><meta charset="utf-8"><style>{BASE_CSS}
    body {{ width: {cw + 2 * m}px; height: {ch + 2 * m}px; display: grid; place-items: center; }}
    .c {{ width: {cw}px; height: {ch}px; border-radius: 14px; overflow: hidden;
      background: url("{(raw / src).as_uri()}") -{x}px -{y}px / {RAW_W}px {RAW_H}px no-repeat;
      box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 12px 32px rgba(0,0,0,.35); }}
    </style><body><div class="c"></div></body>"""
    render(name, html, cw + 2 * m, ch + 2 * m)


hero()
crop("find.png", "raw-find.png", 0, 170, 600, 510)
crop("menu.png", "raw-menu.png", 860, 0, 327, 470)
crop("dialog.png", "raw-dialog.png", 370, 80, 450, 210)
crop("banner.png", "raw-banner.png", 0, 0, 1187, 240)
