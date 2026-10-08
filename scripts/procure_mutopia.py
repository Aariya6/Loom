"""Refresh a small, source-linked Mutopia metadata snapshot.
No audio is copied into this repository. The script is network-optional and
accepts a saved HTML fixture for deterministic testing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "mutopia_snapshot.json"
DEFAULT_URL = "https://www.mutopiaproject.org/cgibin/make-table.cgi"

def parse_html(html: str) -> list[dict[str, str]]:
    rows = []
    for match in re.finditer(r"(?P<title>[A-Z][^<]{1,80})\s+by\s+(?P<com>[A-Z][^<]{2,80})", html):
        title = re.sub(r"\s+", " ", match.group("title")).strip()
        composer = re.sub(r"\s+", " ", match.group("com")).strip()
        rows.append({"title": title, "composer": composer, "source_url": DEFAULT_URL})
    seen = set(); unique=[]
    for row in rows:
        k=(row["title"],row["composer"])
        if k not in seen: seen.add(k); unique.append(row)
    return unique[:50]

def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--fixture"); ap.add_argument("--url", default=DEFAULT_URL); args=ap.parse_args()
    if args.fixture:
        html = Path(args.fixture).read_text(encoding="utf-8")
    else:
        req = Request(args.url, headers={"User-Agent": "LOOM research metadata refresher/1.0"})
        try:
            html = urlopen(req, timeout=15).read().decode("utf-8", "ignore")
        except Exception as exc:
            print(f"network refresh unavailable: {exc}", file=sys.stderr); return 2
    rows = parse_html(html)
    payload = [{**x, "fetched_at": datetime.now(timezone.utc).isoformat()} for x in rows]
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {len(payload)} metadata rows -> {OUT}")
    return 0
if __name__ == "__main__": raise SystemExit(main())
