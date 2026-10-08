import os
from fastapi.testclient import TestClient
from backend.app import app

client=TestClient(app)

def get_csrf():
    r=client.get('/api/auth/bootstrap'); assert r.status_code==200; return r.json()['csrf_token']

def test_health():
    r=client.get('/api/health'); assert r.status_code==200; assert r.json()['service']=='loom'

def test_auth_and_project():
    import uuid
    email=f'{uuid.uuid4().hex[:10]}@example.com'
    token=get_csrf()
    r=client.post('/api/auth/signup',headers={'X-CSRF-Token':token},json={'display_name':'Ada','email':email,'password':'not-a-common-pass-8765'})
    assert r.status_code==200
    csrf=r.json()['csrf_token']
    r=client.get('/api/auth/me'); assert r.status_code==200
    p=client.post('/api/projects',headers={'X-CSRF-Token':csrf},json={'name':'Study No. 1','state':{'tempo':110,'tracks':[]}})
    assert p.status_code==200
    pid=p.json()['id']
    g=client.get(f'/api/projects/{pid}'); assert g.status_code==200
    up=client.put(f'/api/projects/{pid}',headers={'X-CSRF-Token':csrf},json={'state':{'tempo':120,'tracks':[{'notes':[{'pitch':60,'start':0}]}]}})
    assert up.status_code==200
    a=client.post('/api/analyze',headers={'X-CSRF-Token':csrf},json={'notes':[{'pitch':60,'start':0,'duration':.25,'velocity':.8},{'pitch':64,'start':.5,'duration':.25,'velocity':.7},{'pitch':67,'start':1,'duration':.25,'velocity':.9}]})
    assert a.status_code==200
    assert len(a.json()['pitch_profile'])==12
    out=client.post('/api/auth/logout',headers={'X-CSRF-Token':csrf}); assert out.status_code==200
