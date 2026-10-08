import sys, subprocess, time, os, tempfile, json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(r"C:\Users\BIT\Downloads\LOOM (music proj)")
OUT = ROOT / "docs" / "tutorial"; OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob("*.png"): f.unlink()
env = dict(os.environ, DATABASE_URL="sqlite:///" + Path(tempfile.gettempdir(), "loom_tut.db").as_posix())
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.app:app", "--port", "8033"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(5)
BASE = "http://127.0.0.1:8033"
POEM = """The evening folds its hands
and the river learns to sleep,
while somewhere far away
a porch light starts to keep

A slow and golden promise
for everyone who waits.
Hold on a little longer.
The morning knows your name."""
HL = """(sels)=>{document.querySelectorAll('.tut-hl').forEach(e=>e.remove());
 const host=document.querySelector('dialog[open]')||document.body; let n=0;
 for(const s of sels){const els=[...document.querySelectorAll(s)].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2});
  if(!els.length)continue; const r=els[0].getBoundingClientRect(); n++;
  const d=document.createElement('div'); d.className='tut-hl';
  d.style.cssText=`position:fixed;z-index:99999;pointer-events:none;left:${r.left-4}px;top:${r.top-4}px;width:${r.width+8}px;height:${r.height+8}px;border:3px solid #e0301e;border-radius:6px;box-shadow:0 0 0 2px #fff8`;
  const b=document.createElement('div'); b.textContent=n; b.style.cssText='position:absolute;left:-12px;top:-14px;width:24px;height:24px;border-radius:50%;background:#e0301e;color:#fff;font:700 14px/24px sans-serif;text-align:center;box-shadow:0 1px 4px #0006';
  d.appendChild(b); host.appendChild(d);} return n}"""
log = []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"]); pg = b.new_page(viewport={"width": 1440, "height": 860}); pg.on("dialog", lambda d: d.accept())
    def shot(name, sels=()):
        try:
            n = pg.evaluate(HL, list(sels)) if sels else 0
            if sels and n < len(sels): log.append((name, "highlight found %d/%d" % (n, len(sels))))
            time.sleep(.25); pg.screenshot(path=str(OUT / (name + ".png")))
            pg.evaluate("document.querySelectorAll('.tut-hl').forEach(e=>e.remove())")
        except Exception as e: log.append((name, str(e)[:120]))
    def step(fn):
        try: fn()
        except Exception as e: log.append((fn.__name__, str(e)[:150]))
    pg.goto(BASE + "/auth"); pg.click(".tabs button[data-mode=signup]")
    pg.fill("[name=display_name]", "Mira"); pg.fill("[name=email]", f"m{int(time.time())}@example.com"); pg.fill("[name=password]", "Violet-Harbor-42")
    shot("t01-signup", ['.tabs button[data-mode=signup]', '[name=display_name]', '[name=password]', '#authSubmit'])
    pg.click("#authSubmit"); pg.wait_for_function("window.LOOM && LOOM.S && LOOM.S.tracks.length>3"); time.sleep(1.5)
    shot("t02-studio-first", ['#playBtn', '#trackList', '#tabs', '#hintX'])
    pg.click("#hintX"); pg.keyboard.press("Space"); time.sleep(2.2)
    shot("t03-playing", ['#playBtn', '#timeRead', '#trackList .trk >> nth=0'] if False else ['#playBtn', '#timeRead', '#roll'])
    pg.keyboard.press("Space")
    pg.click("#templateBtn2"); pg.wait_for_selector("#tplGrid .tpl-card"); shot("t04-templates-open", ['#tplFilters', '#tplMode', '#tplSeed'])
    pg.click('#tplFilters [data-f="Country"]'); time.sleep(.3); shot("t05-templates-country", ['#tplFilters [data-f="Country"]', '#tplGrid [data-g="country-ballad"]'])
    pg.select_option("#tplMode", "replace"); pg.click('#tplGrid [data-g="country-ballad"]'); time.sleep(1.5)
    shot("t06-country-built", ['#trackList', '#roll', '#songName'])
    i = pg.evaluate("LOOM.S.tracks.findIndex(t=>t.instrument==='Acoustic Guitar')"); pg.evaluate("LOOM.app.selectTrack(%d)" % i); time.sleep(.5)
    shot("t07-track-card", ['#trackList .trk.active', '#trackList .trk.active select', '#trackList .trk.active [data-act=browse]', '#inspector'])
    pg.click('#trackList .trk.active [data-act=browse]'); pg.wait_for_selector("#sndGrid [data-n]"); pg.fill("#sndSearch", "banjo"); time.sleep(.4)
    shot("t08-sound-browser", ['#sndSearch', '#sndCats', '#sndGrid [data-n]', '#sndUse'])
    pg.evaluate("document.querySelector('#soundDlg').close()")
    pg.click("#varyBtn"); time.sleep(1); shot("t09-vary", ['#varyBtn', '#undoBtn'])
    # --- notes
    pg.click("#tabs [data-view=roll]"); pg.evaluate("LOOM.app.selectTrack(%d)" % i); time.sleep(.4)
    shot("t10-roll-tools", ['#tools', '#snapSel', '#quantBtn', '#roll'])
    pg.click("#clearBtn"); time.sleep(.3); pg.keyboard.press("1")
    bb = pg.locator("#roll").bounding_box()
    for k, (fx, fy) in enumerate([(.12, .45), (.2, .40), (.28, .36), (.36, .40)]): pg.mouse.click(bb["x"] + 70 + (bb["width"] - 80) * fx, bb["y"] + 20 + (bb["height"] - 40) * fy); time.sleep(.15)
    shot("t11-notes-drawn", ['#roll', '#tools'])
    shot("t12-chord-palette", ['#chordBar', '#chStrum', '#chRiffGo'])
    pg.click("#chordBar button >> nth=0"); time.sleep(.4); pg.click("#chordBar button >> nth=3"); time.sleep(.4)
    shot("t13-chords-inserted", ['#roll', '#chordBar'])
    shot("t14-velocity-lane", ['#vel', '#laneSel', '#humBtn'])
    pg.select_option("#laneSel", "filter"); time.sleep(.4); bb = pg.locator("#vel").bounding_box()
    for fx, fy in [(.05, .8), (.4, .6), (.7, .2), (.95, .3)]: pg.mouse.click(bb["x"] + 10 + (bb["width"] - 20) * fx, bb["y"] + 8 + (bb["height"] - 16) * fy); time.sleep(.15)
    shot("t15-automation-filter", ['#laneSel', '#vel', '#laneClear']); pg.select_option("#laneSel", "velocity") if False else None
    # --- drums
    j = pg.evaluate("LOOM.S.tracks.findIndex(t=>t.element==='drums')"); pg.evaluate("LOOM.app.selectTrack(%d)" % j); pg.click("#tabs [data-view=steps]"); time.sleep(.6)
    shot("t16-steps", ['#stepGrid', '#stBeat', '#stNext'])
    # --- arrange
    pg.click("#tabs [data-view=arrange]"); time.sleep(.8); shot("t17-arrange", ['#arr', '#aMark', '#aDupR', '#aImp', '#aRec'])
    # --- mixer
    pg.click("#tabs [data-view=mixer]"); time.sleep(.6); shot("t18-mixer", ['#mixerStrips .strip.active', '#mGain', '#mSamples'])
    # --- words
    pg.click("#tabs [data-view=words]"); pg.wait_for_selector('#poemMood option', state='attached'); pg.fill('#poemText', POEM); pg.select_option('#poemMood', 'poem-country'); time.sleep(.3)
    shot("t19-words-input", ['#poemText', '#poemMood', '#poemPace', '#poemMode', '#poemBuild'])
    pg.select_option('#poemMode', 'new'); pg.click('#poemBuild'); pg.wait_for_function("LOOM.S.lyrics.length === 8", timeout=30000); time.sleep(1)
    shot("t20-words-built", ['#lyricList', '#lyricNow', '#poemRec', '#poemImp'])
    wav = str(Path(tempfile.gettempdir(), "loom_demo_voice.wav"))
    if Path(wav).exists():
        pg.set_input_files("#audioFile", wav); pg.wait_for_function("LOOM.S.tracks.some(t=>t.instrument==='Audio Clips'&&t.clips.length===1)", timeout=20000); time.sleep(.5)
        pg.evaluate("(()=>{const f=LOOM.app.findClip();f.c.start=LOOM.S.lyrics[0].t;LOOM.app.markDirty()})()"); pg.click('#duckBtn'); time.sleep(.5)
        shot("t21-duck", ['#duckDepth', '#duckBtn', '#unduckBtn', '#lrcBtn', '#srtBtn'])
        pg.click("#tabs [data-view=arrange]"); time.sleep(.8); shot("t22-poem-arrange", ['#arr'])
    # --- share + export
    pg.click("#shareBtn"); pg.wait_for_selector("#shPublish"); shot("t23-share-dialog", ['#shrTabs', '#shPublish'])
    pg.click("#shPublish"); pg.wait_for_selector("#shUrl"); time.sleep(.4); shot("t24-share-published", ['#shUrl'])
    pg.evaluate("document.querySelector('#shareDlg').close()")
    pg.click("#saveBtn"); time.sleep(.8); shot("t25-save", ['#saveBtn', '#dirtyDot'])
    pg.evaluate("document.querySelector('#exportMenu').open=true") ; time.sleep(.3); shot("t26-export", ['#exportMenu', '#wavBtn', '#mp3Btn', '#stemBtn'])
    pg.keyboard.press("?"); time.sleep(.5); shot("t27-shortcuts", [])
    b.close()
srv.terminate()
print("shots:", len(list(OUT.glob("*.png")))); print("\n".join(map(str, log)) or "no problems")
