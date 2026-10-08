import json
import struct
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app

ROOT = Path(__file__).resolve().parents[1]


def wav_bytes(n=400):
    pcm = b"\x00\x00" * n
    return b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 22050, 44100, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm


def user():
    c = TestClient(app)
    boot = c.get('/api/auth/bootstrap').json()['csrf_token']
    r = c.post('/api/auth/signup', headers={'X-CSRF-Token': boot}, json={'display_name': 'Aud', 'email': uuid.uuid4().hex[:10] + '@example.com', 'password': 'audio-safe-pass-2026'})
    csrf = r.json()['csrf_token']
    pid = c.post('/api/projects', headers={'X-CSRF-Token': csrf}, json={'name': 'A', 'state': {}}).json()['id']
    return c, {'X-CSRF-Token': csrf}, pid


def test_audio_roundtrip_and_isolation():
    c, h, pid = user()
    r = c.post(f'/api/projects/{pid}/audio', headers=h, files={'file': ('vox take.wav', wav_bytes(), 'audio/wav')})
    assert r.status_code == 200, r.text
    aid = r.json()['id']
    got = c.get(f'/api/projects/{pid}/audio/{aid}')
    assert got.status_code == 200 and got.content == wav_bytes()
    assert got.headers['content-type'] == 'application/octet-stream' and got.headers['x-content-type-options'] == 'nosniff'
    assert [a['id'] for a in c.get(f'/api/projects/{pid}/audio').json()] == [aid]
    other, _, _ = user()
    assert other.get(f'/api/projects/{pid}/audio/{aid}').status_code == 404
    assert c.delete(f'/api/projects/{pid}/audio/{aid}', headers=h).status_code == 200
    assert c.get(f'/api/projects/{pid}/audio/{aid}').status_code == 404


def test_audio_rejects_bad_input():
    c, h, pid = user()
    up = lambda body, name='x.wav': c.post(f'/api/projects/{pid}/audio', headers=h, files={'file': (name, body, 'audio/wav')})
    assert up(b'<html><script>alert(1)</script></html>', 'x.html').status_code == 415
    assert up(b'').status_code == 400
    assert up(wav_bytes() + b'\x00' * (12 * 1024 * 1024)).status_code == 413
    assert c.post(f'/api/projects/{pid}/audio', files={'file': ('x.wav', wav_bytes(), 'audio/wav')}).status_code == 403   # no CSRF header


def test_audio_project_quota():
    c, h, pid = user()
    chunk = wav_bytes(5_000_000)           # ~10 MB each, under the per-file cap
    ok = [c.post(f'/api/projects/{pid}/audio', headers=h, files={'file': ('c.wav', chunk, 'audio/wav')}).status_code for _ in range(7)]
    assert ok[:6] == [200] * 6 and ok[6] == 413


def test_beats_data_is_well_formed():
    d = json.loads((ROOT / 'data' / 'beats.json').read_text(encoding='utf-8'))
    assert len(d['beats']) >= 20 and len({b['id'] for b in d['beats']}) == len(d['beats'])
    for b in d['beats']:
        for key in ('pattern', 'fill', 'lead'):
            for pitch, pat in (b.get(key) or {}).items():
                assert pitch in d['lanes'], (b['id'], pitch)
                assert len(pat) == 16 and set(pat) <= set('Xxo.'), (b['id'], pitch, pat)


def test_genres_reference_real_beats_and_structures():
    g = json.loads((ROOT / 'data' / 'genres.json').read_text(encoding='utf-8'))
    beats = {b['id'] for b in json.loads((ROOT / 'data' / 'beats.json').read_text(encoding='utf-8'))['beats']}
    assert len(g['genres']) >= 16
    for x in g['genres']:
        assert x['beat'] is None or x['beat'] in beats, x['id']
        assert x['structure'] in g['structures'] and x['harmony'] in ('Major', 'Minor', 'Dorian', 'Mixolydian')
        assert 30 <= x['tempo'] <= 240 and 0 <= x['root'] < 12 and x['prog']
    assert client_get('/api/genres')['genres'] and client_get('/api/beats')['beats']


def client_get(path):
    return TestClient(app).get(path).json()


def test_deleting_a_project_removes_its_audio():
    from backend.core import AudioAsset, SessionLocal
    from sqlalchemy import func, select
    c, h, pid = user()
    assert c.post(f'/api/projects/{pid}/audio', headers=h, files={'file': ('a.wav', wav_bytes(), 'audio/wav')}).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count(AudioAsset.id)).where(AudioAsset.project_id == pid)) == 1
    assert c.delete(f'/api/projects/{pid}', headers=h).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count(AudioAsset.id)).where(AudioAsset.project_id == pid)) == 0
