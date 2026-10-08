"""End-to-end test of sharing, walkthrough recording, comments, collaboration and history.
Needs playwright + chromium. Run from the project root:  python tests/e2e/studio_share.py
Screen / camera / microphone / speech recognition are faked in the page (a headless browser has none of them);
everything else (MediaRecorder, upload, server, public page, polling, conflicts) is the real thing."""
import os, subprocess, sys, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
env = dict(os.environ, DATABASE_URL="sqlite:///" + Path(tempfile.gettempdir(), "loom_e2e_share.db").as_posix())
PORT = 8018
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.app:app", "--port", str(PORT)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
BASE = f"http://127.0.0.1:{PORT}"
results, errors = [], []


def ok(name, cond, extra=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))


FAKES = """
(() => {
  const md = navigator.mediaDevices; if (!md) return;
  const audioStream = () => { const ac = new AudioContext(); const o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream; };
  const canvasStream = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = 'hsl(' + (n++ * 9 % 360) + ',60%,50%)'; g.fillRect(0, 0, 640, 360); }, 50); return c.captureStream(20); };
  md.getDisplayMedia = async () => { const s = canvasStream(); audioStream().getAudioTracks().forEach(t => s.addTrack(t)); return s; };
  md.getUserMedia = async c => (c && c.video) ? canvasStream() : audioStream();
  const FakeSR = class { start() { this._t = setTimeout(() => { const r = [{ transcript: 'welcome to my lofi beat' }]; r.isFinal = true; this.onresult && this.onresult({ resultIndex: 0, results: [r] }); }, 1000); } stop() { clearTimeout(this._t); this.onend && this.onend(); } };
  ['SpeechRecognition', 'webkitSpeechRecognition'].forEach(k => Object.defineProperty(window, k, { value: FakeSR, configurable: true, writable: true }));
})();
"""


def share_tab(page, t):
    """Open the share dialog if needed, then switch tab."""
    if page.locator("#shareDlg[open]").count() == 0: page.click("#shareBtn")
    page.click(f"#shrTabs [data-tab={t}]")


def pick_project(page, value):
    """The project switcher lives inside the 'project' menu, as it does for a person."""
    if not page.evaluate("document.querySelector('#projMenu').open"): page.click("#projMenu summary")
    page.select_option("#projectSelect", value)


def signup(browser, name, init=None):
    ctx = browser.new_context(viewport={"width": 1500, "height": 900})
    if init: ctx.add_init_script(init)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(f"{name}: {e}")); pg.on("dialog", lambda d: d.accept())
    pg.goto(BASE + "/auth"); pg.click(".tabs button[data-mode=signup]")
    email = f"{name.lower()}{int(time.time() * 1000)}@example.com"
    pg.fill("[name=display_name]", name); pg.fill("[name=email]", email); pg.fill("[name=password]", "Violet-Harbor-42")
    pg.click("#authSubmit"); pg.wait_for_function("window.LOOM && LOOM.S && LOOM.S.tracks.length>3"); time.sleep(.8)
    return ctx, pg, email


try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctxA, A, emailA = signup(b, "Alice", FAKES); ev = A.evaluate

        # ---------------- publish a link
        A.evaluate("LOOM.S.lyrics=[{t:0,text:'First line of the poem',stanza:1},{t:8,text:'A second line, later',stanza:1},{t:16,text:'Then a new stanza',stanza:2}]; LOOM.app.markDirty()")
        A.click("#shareBtn"); A.wait_for_selector("#shPublish"); A.fill("#shTitleIn", "Late night <i>sketch</i>"); A.click("#shPublish")
        A.wait_for_selector("#shUrl"); url = A.input_value("#shUrl")
        ok("share link published", "/share/" in url and len(url.split("/share/")[1]) >= 24, url)

        # ---------------- the public page, as an anonymous visitor
        V = b.new_context(viewport={"width": 1300, "height": 900}); vp = V.new_page(); vp.on("pageerror", lambda e: errors.append(f"viewer: {e}"))
        vp.goto(url); vp.wait_for_selector("#shMain:not([hidden])")
        ok("public page shows the title as plain text", vp.inner_text("#shTitle") == "Late night <i>sketch</i>" and vp.locator("#shTitle i").count() == 0)
        ok("...and who made it", "Alice" in vp.inner_text("#shBy"))
        vp.on("console", lambda m: print("   viewer console:", m.type, m.text) if m.type in ("error", "warning") else None)
        try:
            vp.wait_for_function("!document.querySelector('#songPlay').disabled", timeout=60000)
        except Exception:
            print("   song status:", vp.inner_text("#songStatus")); raise
        ok("song is prepared for playback without any login", True)
        ok("the poem's lines are shown on the public page", vp.locator("#lyrics .ly").count() == 3 and "First line of the poem" in vp.inner_text("#lyrics"))
        vp.click('#lyrics .ly >> nth=2'); time.sleep(1.0); ok("clicking a lyric jumps the song there and highlights it", vp.evaluate("+document.querySelector('#songSeek').value") > 100 and vp.locator("#lyrics .ly.now").count() == 1)
        time.sleep(1.2); ok("the song plays on the public page", vp.evaluate("document.querySelector('#songPlay').textContent") == "⏸" and vp.evaluate("document.querySelector('#songSeek').value") != "0")
        vp.click("#songPlay"); vp.click('#shTabs [data-t=summary]'); ok("summary lists the sections", "Intro" in vp.inner_text("#sumBody") and "BPM" in vp.inner_text("#sumBody"))
        vp.click('#shTabs [data-t=comments]'); vp.fill("#cName", "Fan <b>1</b>"); vp.fill("#cBody", "<img src=x onerror=window.__xss=1> love this bass"); vp.click("#cSend")
        vp.wait_for_selector("#cList .cm"); ok("comment appears, pinned to a time", vp.locator("#cList .cm .when").count() == 1)
        ok("HTML in a comment is shown as text, never executed", vp.locator("#cList img").count() == 0 and vp.evaluate("window.__xss") is None and "<img" in vp.inner_text("#cList"))
        vp.click('#reactBar [data-e="🔥"]'); time.sleep(.5)
        vp.reload(); vp.wait_for_selector("#shMain:not([hidden])"); vp.wait_for_selector("#cList .cm")
        ok("comments and reactions persist", vp.inner_text('#reactBar [data-e="🔥"] b') == "1")
        ok("a viewer cannot reach the editor's data", vp.evaluate("fetch('/api/projects').then(r=>r.status)") == 401)

        # ---------------- the owner sees the feedback and can moderate it
        share_tab(A, "feedback"); A.wait_for_selector("#shrBody .fb")
        ok("owner sees the viewer's comment and the reaction", "love this bass" in A.inner_text("#shrBody") and "🔥 1" in A.inner_text("#shrBody"))
        A.click('#shrBody [data-cdel]'); time.sleep(.5); ok("owner can delete a comment", "No comments yet" in A.inner_text("#shrBody"))
        A.click('#shrTabs [data-tab=summary]'); ok("studio summary tab works", "BPM" in A.inner_text("#shrBody") and "Intro" in A.inner_text("#shrBody"))

        # ---------------- record a walkthrough and attach it
        A.click('#shrTabs [data-tab=walk]'); A.wait_for_selector("#wkStart"); A.click("#wkStart"); A.wait_for_selector("#recBar:not([hidden])")
        time.sleep(3.2); A.click("#recStop"); A.wait_for_selector("#shrBody video", timeout=15000)
        ok("recording stops and previews", A.evaluate("document.querySelector('#shrBody video').src").startswith("blob:") and "transcript lines" in A.inner_text("#shrBody"))
        A.click("#wkPublish"); A.wait_for_function("document.querySelector('#shrBody').innerText.includes('Walkthrough') || true"); time.sleep(2.5)
        A.click('#shrTabs [data-tab=link]'); ok("walkthrough attached to the link", "attached" in A.inner_text("#shrBody"))
        vp.goto(url); vp.wait_for_selector("#shMain:not([hidden])")
        ok("public page shows the walkthrough video", not vp.locator("#videoCard").is_hidden())
        vp.wait_for_function("document.querySelector('#vid').readyState >= 1", timeout=15000); ok("video loads (served with Range support)", vp.evaluate("document.querySelector('#vid').duration") > 1)
        ok("transcript tab appears and is searchable", not vp.locator("#tTab").is_hidden())
        vp.click("#tTab"); vp.fill("#tSearch", "lofi"); ok("transcript search highlights a match", vp.locator("#tList mark").count() == 1)
        vp.fill("#tSearch", "zzzz"); ok("...and filters the rest", vp.locator("#tList .tl").count() == 0)
        vp.fill("#tSearch", ""); vp.click("#tList .tl"); time.sleep(.5)
        vp.click('#shTabs [data-t=comments]'); vp.evaluate("document.querySelector('#vid').currentTime = 1.5"); vp.fill("#cBody", "nice intro at this second"); vp.click("#cSend"); vp.wait_for_selector("#cList .cm")
        ok("comments on the video are tied to the video time", "🎬" in vp.inner_text("#cList"))

        # ---------------- collaboration between two people
        ctxB, Bp, emailB = signup(b, "Bobby"); Bev = Bp.evaluate
        share_tab(A, "team"); A.wait_for_selector("#tmEmail"); A.fill("#tmEmail", emailB); A.click("#tmInvite"); time.sleep(.8)
        ok("owner invites a friend by email", "Bobby" in A.inner_text("#shrBody"))
        A.fill("#tmEmail", "nobody-at-all@example.com"); A.click("#tmInvite"); time.sleep(.5); ok("unknown email is refused with a helpful message", "sign up first" in A.inner_text("#shrBody"))
        A.keyboard.press("Escape")
        Bp.reload(); Bp.wait_for_function("window.LOOM && LOOM.S"); time.sleep(.5)
        label = Bp.evaluate("[...document.querySelectorAll('#projectSelect option')].find(o=>o.textContent.includes('shared by')).value")
        pick_project(Bp, label); Bp.wait_for_function("LOOM.app.project.shared===true"); time.sleep(.5)
        ok("the invited friend sees the shared song", "shared by Alice" in Bp.evaluate("document.querySelector('#projectSelect').selectedOptions[0].textContent") and Bp.locator("#delBtn").is_disabled() and Bp.locator("#shareBtn").is_hidden())
        n0 = ev("LOOM.S.tracks[0].notes.length")
        Bev("(()=>{LOOM.app.pushUndo();LOOM.S.tracks[0].notes.push({pitch:36,start:60,duration:.5,velocity:.9});LOOM.app.changed()})()"); Bp.click("#saveBtn"); time.sleep(.8)
        A.wait_for_function("LOOM.S.tracks[0].notes.length === %d" % (n0 + 1), timeout=20000); ok("a collaborator's save appears in the owner's studio automatically", True)
        A.wait_for_function("document.querySelector('#presence').innerText.includes('Bobby')", timeout=15000); ok("owner sees Bobby is here", True)

        # a real conflict: Alice has unsaved edits, Bobby saves first
        Aev = ev; Aev("(()=>{LOOM.app.pushUndo();LOOM.S.tracks[0].notes.push({pitch:38,start:61,duration:.5,velocity:.9});LOOM.app.changed()})()")
        Bev("(()=>{LOOM.app.pushUndo();LOOM.S.tracks[0].notes.push({pitch:42,start:62,duration:.5,velocity:.9});LOOM.app.changed()})()"); Bp.click("#saveBtn")
        A.wait_for_selector("#syncBar:not([hidden])", timeout=20000); ok("owner is warned that a newer version exists", "Bobby" in A.inner_text("#syncBar"))
        A.click("#syKeep"); A.click("#saveBtn"); A.wait_for_selector("#conflictDlg[open]"); ok("saving over their work asks first", "Bobby" in A.inner_text("#conflictForm"))
        A.click("#cfCopy"); time.sleep(1.0)
        ok("'keep both' saves mine as a new project and leaves the original alone", "(my version)" in A.evaluate("document.querySelector('#projectSelect').selectedOptions[0].textContent") and Aev("LOOM.S.tracks[0].notes.some(n=>n.start===61)"))

        # history that says what changed
        orig = A.evaluate("[...document.querySelectorAll('#projectSelect option')].find(o=>!o.textContent.includes('my version')).value")
        if not A.evaluate("LOOM.app.isDirty()"): pick_project(A, orig); time.sleep(.8)
        A.evaluate("document.querySelector('#projMenu').open = true"); A.click("#historyBtn"); A.wait_for_function("[...document.querySelectorAll('#historyList .diff')].some(d=>/notes/.test(d.textContent))", timeout=20000)
        ok("history lists who saved and what changed", "Bobby" in A.inner_text("#historyList") and "+1 notes" in A.inner_text("#historyList"))
        b.close()
finally:
    srv.terminate()
print(f"\n{sum(results)}/{len(results)} checks passed")
print("ERRORS:", errors or "none")
sys.exit(0 if all(results) and not errors else 1)
