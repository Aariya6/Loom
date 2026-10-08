import uuid
from fastapi.testclient import TestClient
from backend.app import app
c=TestClient(app)
def test_revision_restore_roundtrip():
    boot=c.get('/api/auth/bootstrap').json()['csrf_token']
    e=uuid.uuid4().hex[:10]+'@example.com'
    r=c.post('/api/auth/signup',headers={'X-CSRF-Token':boot},json={'display_name':'Versioner','email':e,'password':'version-safe-pass-2026'})
    csrf=r.json()['csrf_token']
    p=c.post('/api/projects',headers={'X-CSRF-Token':csrf},json={'name':'History','state':{'tempo':90,'tracks':[]}}).json();pid=p['id']
    c.put(f'/api/projects/{pid}',headers={'X-CSRF-Token':csrf},json={'state':{'tempo':140,'tracks':[]}})
    assert c.get(f'/api/projects/{pid}/versions').status_code==200
    rr=c.post(f'/api/projects/{pid}/versions/1/restore',headers={'X-CSRF-Token':csrf})
    assert rr.status_code==200 and rr.json()['state']['tempo']==90
