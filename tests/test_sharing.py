import json
import struct
import uuid

from fastapi.testclient import TestClient

from backend.app import app


def wav_bytes(n=400):
    pcm = b"\x00\x00" * n
    return b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 22050, 44100, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm


WEBM = bytes([0x1A, 0x45, 0xDF, 0xA3]) + b"\x01\x00\x00\x00" + bytes(range(256)) * 8   # looks like a WebM header; 2 KB


def new_user(name="Person"):
    c = TestClient(app)
    boot = c.get('/api/auth/bootstrap').json()['csrf_token']
    email = uuid.uuid4().hex[:10] + '@example.com'
    r = c.post('/api/auth/signup', headers={'X-CSRF-Token': boot}, json={'display_name': name, 'email': email, 'password': 'sharing-safe-pass-2026'})
    return c, {'X-CSRF-Token': r.json()['csrf_token']}, email


def new_project(c, h, state=None):
    return c.post('/api/projects', headers=h, json={'name': 'Song', 'state': state or {'tempo': 90, 'tracks': []}}).json()['id']


# ------------------------------------------------------------------ collaboration
def test_collaborator_can_edit_but_not_delete_or_share():
    owner, oh, _ = new_user('Owner'); friend, fh, femail = new_user('Friend'); stranger, sh, _ = new_user('Stranger')
    pid = new_project(owner, oh)
    assert friend.get(f'/api/projects/{pid}').status_code == 404                                  # not invited yet
    assert owner.post(f'/api/projects/{pid}/collaborators', headers=oh, json={'email': femail}).status_code == 200
    assert friend.get(f'/api/projects/{pid}').json()['shared'] is True
    assert pid in [p['id'] for p in friend.get('/api/projects').json()]
    r = friend.put(f'/api/projects/{pid}', headers=fh, json={'state': {'tempo': 100, 'tracks': []}, 'base_revision': 1}); assert r.status_code == 200 and r.json()['revision'] == 2
    assert owner.get(f'/api/projects/{pid}').json()['state']['tempo'] == 100                      # the owner sees the edit
    assert friend.delete(f'/api/projects/{pid}', headers=fh).status_code == 404                  # only the owner deletes
    assert friend.put(f'/api/projects/{pid}/share', headers=fh, json={'title': 'x', 'state': {}}).status_code == 404
    assert friend.post(f'/api/projects/{pid}/collaborators', headers=fh, json={'email': femail}).status_code == 404
    assert stranger.get(f'/api/projects/{pid}').status_code == 404 and stranger.get(f'/api/projects/{pid}/audio').status_code == 404
    up = friend.post(f'/api/projects/{pid}/audio', headers=fh, files={'file': ('a.wav', wav_bytes(), 'audio/wav')}); assert up.status_code == 200   # editors may add audio
    assert owner.get(f'/api/projects/{pid}/audio/{up.json()["id"]}').status_code == 200
    assert owner.delete(f'/api/projects/{pid}/collaborators/{friend.get("/api/auth/me").json()["user"]["id"]}', headers=oh).status_code == 200
    assert friend.get(f'/api/projects/{pid}').status_code == 404                                  # access revoked


def test_invite_needs_an_existing_account_and_cannot_invite_self():
    owner, oh, oemail = new_user(); pid = new_project(owner, oh)
    assert owner.post(f'/api/projects/{pid}/collaborators', headers=oh, json={'email': 'nobody-here@example.com'}).status_code == 404
    assert owner.post(f'/api/projects/{pid}/collaborators', headers=oh, json={'email': oemail}).status_code == 400


def test_stale_save_is_a_conflict_not_an_overwrite():
    a, ah, _ = new_user('Ann'); b, bh, bemail = new_user('Bo')
    pid = new_project(a, ah); a.post(f'/api/projects/{pid}/collaborators', headers=ah, json={'email': bemail})
    assert b.put(f'/api/projects/{pid}', headers=bh, json={'state': {'tempo': 111, 'tracks': []}, 'base_revision': 1}).status_code == 200
    r = a.put(f'/api/projects/{pid}', headers=ah, json={'state': {'tempo': 77, 'tracks': []}, 'base_revision': 1})   # Ann still thinks it is revision 1
    assert r.status_code == 409 and r.json()['saved_by'] == 'Bo' and r.json()['revision'] == 2
    assert a.get(f'/api/projects/{pid}').json()['state']['tempo'] == 111                                          # nothing was overwritten


def test_status_reports_presence_and_last_editor_and_versions_say_who():
    a, ah, _ = new_user('Ann'); b, bh, bemail = new_user('Bo')
    pid = new_project(a, ah); a.post(f'/api/projects/{pid}/collaborators', headers=ah, json={'email': bemail})
    b.put(f'/api/projects/{pid}', headers=bh, json={'state': {'tempo': 120, 'tracks': []}})
    b.get(f'/api/projects/{pid}/status'); st = a.get(f'/api/projects/{pid}/status').json()
    assert st['revision'] == 2 and st['saved_by'] == 'Bo' and st['saved_by_me'] is False and st['collaborators'] == 1
    assert {p['name'] for p in st['presence']} == {'Ann', 'Bo'}
    versions = a.get(f'/api/projects/{pid}/versions').json(); assert [v['by'] for v in versions] == ['Bo', 'Ann']
    assert a.get(f'/api/projects/{pid}/versions/1').json()['state']['tempo'] == 90


# ------------------------------------------------------------------ sharing
def publish(c, h, pid, **extra):
    body = {'title': 'My <b>song</b>', 'allow_comments': True, 'state': {'tempo': 90, 'tracks': [{'id': 't1', 'name': 'Vox', 'clips': extra.pop('clips', [])}]}, **extra}
    r = c.put(f'/api/projects/{pid}/share', headers=h, json=body); assert r.status_code == 200, r.text
    return r.json()


def test_public_page_needs_no_login_and_shows_the_snapshot_not_later_edits():
    owner, oh, _ = new_user('Maker'); pid = new_project(owner, oh); share = publish(owner, oh, pid)
    anon = TestClient(app)
    got = anon.get(f"/api/public/{share['token']}").json()
    assert got['title'] == 'My <b>song</b>' and got['author'] == 'Maker' and got['state']['tempo'] == 90
    owner.put(f'/api/projects/{pid}', headers=oh, json={'state': {'tempo': 200, 'tracks': []}})
    assert anon.get(f"/api/public/{share['token']}").json()['state']['tempo'] == 90                  # snapshot is frozen until re-published
    assert anon.get(f"/share/{share['token']}").status_code == 200 and 'LOOM' in anon.get(f"/share/{share['token']}").text
    assert publish(owner, oh, pid, title='Again')['token'] == share['token']                          # same link after re-publishing
    assert anon.get('/api/public/not-a-real-token-1234').status_code == 404


def test_comments_reactions_limits_and_owner_moderation():
    owner, oh, _ = new_user('Maker'); pid = new_project(owner, oh); share = publish(owner, oh, pid); tok = share['token']; anon = TestClient(app)
    r = anon.post(f'/api/public/{tok}/comments', json={'name': 'Fan', 'body': '<script>alert(1)</script> love the\x00 bass', 'at': 12.5, 'kind': 'song'}); assert r.status_code == 200
    assert r.json()['body'] == '<script>alert(1)</script> love the bass'                               # stored as plain text; the page escapes it
    assert anon.post(f'/api/public/{tok}/comments', json={'body': 'x' * 501, 'at': 1}).status_code == 422
    assert anon.post(f'/api/public/{tok}/comments', json={'body': '   ', 'at': 1}).status_code in (422,)
    assert anon.post(f'/api/public/{tok}/reactions', json={'emoji': '🔥', 'at': 3}).status_code == 200
    assert anon.post(f'/api/public/{tok}/reactions', json={'emoji': '<img>', 'at': 3}).status_code == 422
    listing = anon.get(f'/api/public/{tok}/comments').json(); assert len(listing['comments']) == 1 and listing['reactions'][0]['emoji'] == '🔥'
    mine = owner.get(f'/api/projects/{pid}/share').json(); assert mine['reactions'] == {'🔥': 1} and len(mine['comments']) == 1
    from backend import core
    codes = [anon.post(f'/api/public/{tok}/comments', json={'body': f'c{i}', 'at': i}).status_code for i in range(12)]
    assert codes.count(429) >= 3, codes                                                               # per-IP rate limit
    core.ATTEMPTS.clear()
    assert owner.delete(f"/api/projects/{pid}/share/comments/{mine['comments'][0]['id']}", headers=oh).status_code == 200
    assert all(c['body'] != 'love the bass' for c in anon.get(f'/api/public/{tok}/comments').json()['comments'])


def test_comments_can_be_turned_off_and_the_link_revoked():
    owner, oh, _ = new_user(); pid = new_project(owner, oh); share = publish(owner, oh, pid, allow_comments=False); tok = share['token']; anon = TestClient(app)
    assert anon.post(f'/api/public/{tok}/comments', json={'body': 'hi', 'at': 1}).status_code == 403
    assert owner.delete(f'/api/projects/{pid}/share', headers=oh).status_code == 200
    assert anon.get(f'/api/public/{tok}').status_code == 404 and anon.get(f'/share/{tok}').status_code == 200   # page shell loads, data does not
    assert owner.get(f'/api/projects/{pid}/share').json() == {'exists': False}


def test_walkthrough_video_is_served_with_range_and_only_what_the_share_references():
    owner, oh, _ = new_user(); pid = new_project(owner, oh)
    v = owner.post(f'/api/projects/{pid}/audio', headers=oh, files={'file': ('walk.webm', WEBM, 'video/webm')}, data={'video': 'true'}); assert v.status_code == 200 and v.json()['kind'] == 'webmv'
    clip_audio = owner.post(f'/api/projects/{pid}/audio', headers=oh, files={'file': ('a.wav', wav_bytes(), 'audio/wav')}).json()['id']
    secret_audio = owner.post(f'/api/projects/{pid}/audio', headers=oh, files={'file': ('private.wav', wav_bytes(), 'audio/wav')}).json()['id']
    share = publish(owner, oh, pid, walkthrough_asset_id=v.json()['id'], clips=[{'id': 'c1', 'asset': clip_audio}], transcript=[{'t': 1.5, 'text': 'welcome to my song'}]); tok = share['token']; anon = TestClient(app)
    full = anon.get(f"/api/public/{tok}/media/{v.json()['id']}"); assert full.status_code == 200 and full.headers['content-type'] == 'video/webm' and full.content == WEBM
    part = anon.get(f"/api/public/{tok}/media/{v.json()['id']}", headers={'Range': 'bytes=0-9'}); assert part.status_code == 206 and part.content == WEBM[:10] and part.headers['content-range'].startswith('bytes 0-9/')
    assert anon.get(f"/api/public/{tok}/media/{v.json()['id']}", headers={'Range': 'bytes=999999-'}).status_code == 416
    assert anon.get(f"/api/public/{tok}/media/{clip_audio}").status_code == 200                      # a clip used by the shared song
    assert anon.get(f"/api/public/{tok}/media/{secret_audio}").status_code == 404                    # a private file in the same project is not exposed
    meta = anon.get(f'/api/public/{tok}').json(); assert meta['walkthrough']['asset_id'] == v.json()['id'] and meta['transcript'][0]['text'] == 'welcome to my song'
    assert owner.put(f'/api/projects/{pid}/share', headers=oh, json={'title': 't', 'state': {}, 'walkthrough_asset_id': clip_audio}).status_code == 400   # audio is not a walkthrough


def test_video_upload_validation_and_quota():
    c, h, _ = new_user(); pid = new_project(c, h)
    assert c.post(f'/api/projects/{pid}/audio', headers=h, files={'file': ('x.webm', wav_bytes(), 'video/webm')}, data={'video': 'true'}).status_code == 415   # WAV is not a video
    assert c.post(f'/api/projects/{pid}/audio', headers=h, files={'file': ('x.webm', WEBM + b'\0' * (49 * 1024 * 1024), 'video/webm')}, data={'video': 'true'}).status_code == 413
    ok = [c.post(f'/api/projects/{pid}/audio', headers=h, files={'file': ('w.webm', WEBM, 'video/webm')}, data={'video': 'true'}).status_code for _ in range(7)]
    assert ok[:6] == [200] * 6 and ok[6] == 413


def test_deleting_a_project_removes_its_share_comments_and_collaborators():
    from backend.core import Collaborator, SessionLocal, ShareComment, ShareLink
    from sqlalchemy import func, select
    owner, oh, _ = new_user(); friend, fh, femail = new_user(); pid = new_project(owner, oh)
    owner.post(f'/api/projects/{pid}/collaborators', headers=oh, json={'email': femail}); tok = publish(owner, oh, pid)['token']
    TestClient(app).post(f'/api/public/{tok}/comments', json={'body': 'hello', 'at': 1})
    assert owner.delete(f'/api/projects/{pid}', headers=oh).status_code == 200
    with SessionLocal() as db:
        for model in (ShareLink, Collaborator):
            assert db.scalar(select(func.count(model.id)).where(model.project_id == pid)) == 0
        assert db.scalar(select(func.count(ShareComment.id))) == db.scalar(select(func.count(ShareComment.id)).where(ShareComment.share_id.in_(select(ShareLink.id))))
