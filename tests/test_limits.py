import uuid
from fastapi.testclient import TestClient
from backend.app import app

c = TestClient(app)


def _login():
    boot = c.get('/api/auth/bootstrap').json()['csrf_token']
    email = uuid.uuid4().hex[:10] + '@example.com'
    r = c.post('/api/auth/signup', headers={'X-CSRF-Token': boot}, json={'display_name': 'Limits', 'email': email, 'password': 'limits-safe-pass-2026'})
    return r.json()['csrf_token']


def test_oversized_state_rejected():
    csrf = _login()
    h = {'X-CSRF-Token': csrf}
    big = {'blob': 'a' * 1_200_000}
    assert c.post('/api/projects', headers=h, json={'name': 'big', 'state': big}).status_code == 422
    pid = c.post('/api/projects', headers=h, json={'name': 'ok', 'state': {'tempo': 90}}).json()['id']
    assert c.put(f'/api/projects/{pid}', headers=h, json={'state': big}).status_code == 422
    assert c.put(f'/api/projects/{pid}', headers=h, json={'state': {'tempo': 100}}).status_code == 200
