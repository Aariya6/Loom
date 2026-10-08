import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / 'frontend' / 'assets' / 'samples'
MANIFEST = json.loads((SAMPLES / 'manifest.json').read_text(encoding='utf-8'))
AUDIO_JS = (ROOT / 'frontend' / 'assets' / 'studio-audio.js').read_text(encoding='utf-8')


def test_every_file_in_the_manifest_exists_and_is_audio():
    for name, s in MANIFEST['instruments'].items():
        assert s['notes'] == sorted(s['notes']) and len(s['notes']) >= 5, name
        for n in s['notes']:
            f = SAMPLES / s['dir'] / f"{n}.{s['ext']}"
            assert f.exists() and f.stat().st_size > 2000, f
            head = f.read_bytes()[:3]
            assert head == b'ID3' or (head[0] == 0xFF and head[1] & 0xE0 == 0xE0), f"{f} is not an MP3"
    for name, k in MANIFEST['kits'].items():
        assert len(k['lanes']) >= 8, name
        for lane, f in k['lanes'].items():
            p = SAMPLES / k['dir'] / f
            assert p.exists() and p.read_bytes()[:4] == b'RIFF', p


def test_sampled_names_are_real_loom_instruments():
    for name in list(MANIFEST['instruments']) + list(MANIFEST['kits']):
        assert f"'{name}'" in AUDIO_JS, f"{name} is sampled but is not an instrument in studio-audio.js"
    assert set(MANIFEST['instruments']) >= {'Grand Piano', 'Acoustic Guitar', 'Electric Bass', 'Violin', 'Marimba'}


def test_credits_cover_every_source_and_exclude_the_unlicensed_set():
    credits = (SAMPLES / 'CREDITS.md').read_text(encoding='utf-8')
    for needle in ('FluidR3', 'Frank Wen', 'enoe', 'LinnDrum', 'CR-78', 'Creative Commons Attribution 3.0'):
        assert needle in credits, needle
    assert not any('909' in str(p) for p in SAMPLES.rglob('*')), 'the TR-909 set states no licence and must not be bundled'
    assert {c['license'] for c in MANIFEST['credits']} >= {'Creative Commons Attribution 3.0'}


def test_library_stays_a_sensible_size():
    total = sum(f.stat().st_size for f in SAMPLES.rglob('*') if f.is_file())
    assert total < 16 * 1024 * 1024, f'{total / 1048576:.1f} MB'


def test_samples_are_served_by_the_app():
    from fastapi.testclient import TestClient
    from backend.app import app
    c = TestClient(app)
    r = c.get('/assets/samples/manifest.json'); assert r.status_code == 200 and 'Grand Piano' in r.text
    one = next(iter(MANIFEST['instruments'].values())); n = one['notes'][0]
    assert c.get(f"/assets/samples/{one['dir']}/{n}.{one['ext']}").status_code == 200
