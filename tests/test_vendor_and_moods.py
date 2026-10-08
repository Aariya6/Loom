import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'frontend' / 'assets' / 'vendor'


def test_mp3_encoder_is_shipped_unmodified_with_its_licence_and_loaded_only_on_demand():
    assert (VENDOR / 'lame.min.js').stat().st_size > 100_000
    assert 'GNU LESSER GENERAL PUBLIC LICENSE' in (VENDOR / 'LGPL-3.0.txt').read_text(encoding='utf-8')
    assert 'LAME' in (VENDOR / 'lamejs-LICENSE.txt').read_text(encoding='utf-8')
    # LGPL: a separate file that is not bundled into our own scripts, and not even downloaded unless someone exports an MP3
    assert 'lame.min.js' not in (ROOT / 'frontend' / 'studio.html').read_text(encoding='utf-8')
    assert 'lame.min.js' in (ROOT / 'frontend' / 'assets' / 'studio.js').read_text(encoding='utf-8')
    assert 'LAME' in (ROOT / 'frontend' / 'assets' / 'samples' / 'CREDITS.md').read_text(encoding='utf-8') or 'LAME' in (VENDOR / 'README.md').read_text(encoding='utf-8')


def test_poetry_beds_have_no_vocal_part_and_the_moods_cover_what_people_ask_for():
    data = json.loads((ROOT / 'data' / 'genres.json').read_text(encoding='utf-8'))
    poems = [g for g in data['genres'] if g.get('poem')]
    assert len(poems) >= 8 and all(g['vox'] is None and g['family'] == 'Poetry & spoken word' for g in poems)
    families = {g['family'] for g in data['genres']}
    assert {'Country', 'Acoustic & soothing', 'Retro', 'Jazz', 'Poetry & spoken word'} <= families
    for fam, need in {'Country': 5, 'Acoustic & soothing': 4, 'Retro': 5, 'Jazz': 4}.items():
        assert sum(g['family'] == fam for g in data['genres']) >= need, fam
    assert len(data['genres']) >= 60


def test_beats_added_for_those_moods_exist():
    beats = {b['id'] for b in json.loads((ROOT / 'data' / 'beats.json').read_text(encoding='utf-8'))['beats']}
    assert {'brush-ballad', 'smooth-jazz', 'honky-tonk', 'doo-wop', 'rockabilly', 'soft-pulse', 'soul-70s'} <= beats and len(beats) >= 44
