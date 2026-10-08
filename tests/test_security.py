import uuid
from fastapi.testclient import TestClient
from backend.app import app
c=TestClient(app)
def boot_signup(name):
    t=c.get('/api/auth/bootstrap').json()['csrf_token'];e=uuid.uuid4().hex[:10]+'@example.com';r=c.post('/api/auth/signup',headers={'X-CSRF-Token':t},json={'display_name':name,'email':e,'password':'different-safe-pass-2026'});return r.json()['csrf_token']
def test_csrf_and_owner_isolation():
    csrf=boot_signup('Owner A')
    bad=c.post('/api/projects',json={'name':'Blocked','state':{}});assert bad.status_code==403
    p=c.post('/api/projects',headers={'X-CSRF-Token':csrf},json={'name':'Private','state':{}}).json();pid=p['id']
    # create another identity: logout first using valid csrf
    c.post('/api/auth/logout',headers={'X-CSRF-Token':csrf})
    csrf2=boot_signup('Owner B')
    assert c.get(f'/api/projects/{pid}').status_code==404
    c.post('/api/auth/logout',headers={'X-CSRF-Token':csrf2})
