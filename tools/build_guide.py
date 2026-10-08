"""Render docs/guide/LOOM-Guide.html to docs/LOOM-Guide.pdf (needs: pip install playwright && playwright install chromium)."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
src = ROOT / "docs" / "guide" / "LOOM-Guide.html"
out = ROOT / "docs" / "LOOM-Guide.pdf"
footer = ('<div style="font:8pt Segoe UI,Arial;color:#6b5f58;width:100%;padding:0 16mm;display:flex;justify-content:space-between">'
          '<span>LOOM — User &amp; Production Guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(src.as_uri())
    pg.pdf(path=str(out), format="A4", print_background=True, prefer_css_page_size=True,
           display_header_footer=True, header_template="<span></span>", footer_template=footer)
    b.close()
print("wrote", out, out.stat().st_size, "bytes")
