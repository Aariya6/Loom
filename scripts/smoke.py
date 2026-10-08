"""Quick browser smoke test: sign up, open the generated song, place a drum hit in the step grid, save.
Needs playwright + chromium. Run from the project root: python scripts/smoke.py"""
import os, subprocess, sys, tempfile, time, urllib.request, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = '8765'
env = {**os.environ, 'DATABASE_URL': 'sqlite:///' + Path(tempfile.gettempdir(), 'loom_smoke.db').as_posix()}
p = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', PORT], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(60):                       # wait until the server answers instead of guessing how long start-up takes
        try:
            urllib.request.urlopen('http://127.0.0.1:' + PORT + '/api/health', timeout=1); break
        except Exception:
            time.sleep(.5)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:' + PORT + '/', wait_until='networkidle')
        assert 'Make the music' in page.text_content('h1')
        page.goto('http://127.0.0.1:' + PORT + '/auth', wait_until='networkidle')
        page.get_by_role('button', name='sign up').click()
        page.locator('input[name=display_name]').fill('Studio Guest')
        page.locator('input[name=email]').fill(uuid.uuid4().hex[:10] + '@example.com')
        page.locator('input[name=password]').fill('a-secure-pass-2026-xyz')
        page.get_by_role('button', name='Create account').click()
        page.wait_for_url('**/studio')
        page.wait_for_selector('#trackList .trk')
        assert page.locator('#trackList .trk').count() >= 5, 'a new account should start with a five-element song'
        page.locator('#tabs [data-view=steps]').click()
        before = page.locator('#stepGrid .st.on').count()
        page.locator('#stepGrid .st:not(.on)').first.click()
        assert page.locator('#stepGrid .st.on').count() == before + 1
        page.get_by_role('button', name='save').click()
        page.wait_for_selector('text=Saved')
        assert not errors, errors
        page.screenshot(path=str(ROOT / 'tests' / 'smoke-studio.png'))
        browser.close()
    print('BROWSER SMOKE: PASS')
finally:
    p.terminate(); p.wait(timeout=5)
