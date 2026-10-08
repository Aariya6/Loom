import json
from pathlib import Path

def test_source_manifest_is_present():
    p=Path(__file__).parents[1]/'data'/'source_manifest.json'
    data=json.loads(p.read_text())
    assert data['sources'] and all(x['url'].startswith('http') for x in data['sources'])
