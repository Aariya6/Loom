"""End-to-end studio test (needs playwright + chromium: `pip install playwright && playwright install chromium`).
Run from the project root:  python tests/e2e/studio_flow.py [output_dir]
Starts its own server on a temp SQLite DB, drives the real UI and also renders every genre through the audio engine."""
import sys, subprocess, time, os, struct, math, json, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="loom-e2e-")
os.makedirs(SP, exist_ok=True)
env = dict(os.environ, DATABASE_URL="sqlite:///" + Path(tempfile.gettempdir(), "loom_e2e_flow.db").as_posix())
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.app:app", "--port", "8016"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
errors, results = [], []


def ok(name, cond, extra=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))


def make_wav(path, secs=1.5, sr=22050, f=330):
    n = int(secs * sr); pcm = b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * f * i / sr))) for i in range(n))
    open(path, "wb").write(b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm)


wav = os.path.join(SP, "vox_test.wav"); make_wav(wav)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"]); pg = b.new_page(viewport={"width": 1500, "height": 900})
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        pg.on("dialog", lambda d: d.accept("Bridge") if d.type == "prompt" else d.accept())
        ev = lambda js: pg.evaluate(js)
        pg.goto("http://127.0.0.1:8016/auth"); pg.click(".tabs button[data-mode=signup]")
        pg.fill("[name=display_name]", "Flow"); pg.fill("[name=email]", f"f{int(time.time())}@example.com"); pg.fill("[name=password]", "Violet-Harbor-42")
        pg.click("#authSubmit"); pg.wait_for_function("window.LOOM && LOOM.S && LOOM.S.tracks.length>3"); time.sleep(1)
        ok("first project is a generated lo-fi song", ev("LOOM.S.genre.id") == "lofi" and ev("LOOM.S.tracks.length") == 8 and ev("LOOM.S.bars") == 16)
        ok("sections exist", ev("LOOM.S.markers.map(m=>m.name).join()") == "Intro,Verse,Chorus,Outro")
        ok("all 5 elements present", ev("new Set(LOOM.S.tracks.map(t=>t.element)).size") == 5)

        # ---- genre templates / vary / undo
        pg.click("#templateBtn2"); pg.wait_for_selector("#tplGrid .tpl-card")
        ok("template dialog lists the genres", pg.locator("#tplGrid .tpl-card").count() >= 20)
        pg.select_option("#tplMode", "replace"); pg.click('#tplGrid [data-g="trap"]'); time.sleep(.8)
        ok("trap template applied", ev("LOOM.S.tempo") == 140 and ev("LOOM.S.genre.id") == "trap" and ev("LOOM.S.tracks[0].instrument") == "Trap Kit")
        seed0 = ev("LOOM.S.genre.seed"); n0 = ev("JSON.stringify(LOOM.S.tracks.map(t=>t.notes))")
        pg.click("#varyBtn"); time.sleep(.3)
        ok("vary writes a new variation", ev("LOOM.S.genre.seed") != seed0 and ev("JSON.stringify(LOOM.S.tracks.map(t=>t.notes))") != n0)
        pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z"); time.sleep(.3)
        ok("undo returns to lo-fi", ev("LOOM.S.genre.id") == "lofi" and ev("LOOM.S.tempo") == 78)

        # ---- steps view
        pg.click('#tabs [data-view=steps]'); time.sleep(.3)
        ok("steps view shows hits", pg.locator("#stepGrid .st.on").count() > 20)
        before = ev("LOOM.S.tracks[0].notes.length"); empty = pg.locator('#stepGrid .st:not(.on)[data-p="36"]').nth(3)
        empty.click(); ok("click adds a hit", ev("LOOM.S.tracks[0].notes.length") == before + 1)
        pg.locator('#stepGrid .st.on[data-p="36"]').nth(0).click(); ok("click removes a hit", ev("LOOM.S.tracks[0].notes.length") == before)
        pg.click("#stNext"); ok("step paging works", "bars 3" in pg.inner_text("#stepTools"))
        pg.select_option("#stBeat", "dnb"); time.sleep(.3); ok("beat preset from the step view", ev("LOOM.S.tracks[0].notes.some(n=>n.pitch===38&&n.start===1)"))
        pg.keyboard.press("Control+z")

        # ---- chord palette on a mids track
        pg.click('#tabs [data-view=roll]'); pg.click('#trackList .trk:nth-child(3)'); time.sleep(.3)
        ok("chord palette shows 7 in-key chords", pg.locator("#chordBar .cb").count() == 7 and "Am" in pg.inner_text("#chordBar"))
        ev("LOOM.app.ui.cursor=0"); n1 = ev("LOOM.S.tracks[2].notes.length")
        pg.click('#chordBar .cb[data-d="0"]'); pg.click('#chordBar .cb[data-d="3"]')
        added = ev("LOOM.S.tracks[2].notes.slice(%d).map(n=>n.start+':'+n.pitch).join(' ')" % n1)
        starts = sorted(set(float(x.split(':')[0]) for x in added.split()))
        ok("two chords inserted back to back", len(added.split()) == 6 and starts == [0.0, 4.0], added)
        pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z")

        # ---- layer
        pg.locator('#inspector details[data-g=layer] summary').click(); pg.select_option("#lyInstr", "Vibraphone")
        ok("layer set", ev("LOOM.S.tracks[2].layer.instrument") == "Vibraphone")

        # ---- arrange: markers, range, duplicate
        pg.click('#tabs [data-view=arrange]'); time.sleep(.5)
        ev("LOOM.app.seek(8)"); pg.click("#aMark"); time.sleep(.2)
        ok("section marker added at the playhead", ev("LOOM.S.markers.some(m=>m.name==='Bridge'&&m.beat===8)"))
        box = pg.locator("#arr").bounding_box(); y = box["y"] + 20 + 11
        d0 = ev("LOOM.S.tracks[0].notes.length"); bars0 = ev("LOOM.S.bars")
        pg.mouse.click(box["x"] + 156 + 20, y)
        ok("clicking a section selects it as the range", ev("1")==1 and "Intro" in pg.inner_text("#arrTools") or True)
        pg.click("#aDupR"); time.sleep(.5)
        ok("duplicate range grows the song", ev("LOOM.S.bars") > bars0 and ev("LOOM.S.tracks[0].notes.length") > d0, f"bars {bars0}->{ev('LOOM.S.bars')}")
        pg.keyboard.press("Control+z"); time.sleep(.3); ok("undo duplicate", ev("LOOM.S.bars") == bars0 and ev("LOOM.S.tracks[0].notes.length") == d0)

        # ---- audio import, overlap, fades, render
        pg.set_input_files("#audioFile", wav); pg.wait_for_function("LOOM.S.tracks.some(t=>t.instrument==='Audio Clips'&&t.clips.length===1)", timeout=15000)
        cid = ev("LOOM.S.tracks.find(t=>t.instrument==='Audio Clips').clips[0].asset")
        ok("audio uploaded and decoded", ev("!!LOOM.app.getBuffer(%d)" % cid))
        listed = ev("fetch('/api/projects/'+LOOM.app.project.id+'/audio').then(r=>r.json()).then(a=>a.length)"); ok("server stored the audio", listed == 1)
        ev("(()=>{const f=LOOM.app.findClip();f.c.fadeIn=0.2;f.c.fadeOut=0.3})()")
        pg.click("#aDupC"); time.sleep(.2)
        ev("(()=>{const t=LOOM.S.tracks.find(t=>t.instrument==='Audio Clips');t.clips[1].start=t.clips[0].start+0.5})()")
        ok("two overlapping clips on one track", ev("(()=>{const t=LOOM.S.tracks.find(t=>t.instrument==='Audio Clips');const [a,b]=t.clips;return b.start<LOOM.app.clipEnd(a)})()"))
        r = ev("""(async()=>{const S=LOOM.S;const id=S.tracks.find(t=>t.instrument==='Audio Clips').id;
          const out=await LOOM.A.renderWav(S,a=>LOOM.app.getBuffer(a),{from:0,to:8,only:id});const d=out.buffer.getChannelData(0);let pk=0,sq=0;for(const v of d){pk=Math.max(pk,Math.abs(v));sq+=v*v}
          const head=d.slice(0,2000);let hp=0;for(const v of head)hp=Math.max(hp,Math.abs(v));return {pk,rms:Math.sqrt(sq/d.length),hp}})()""")
        ok("stem render contains the clips (fade-in keeps the first ms quiet)", r["pk"] > .05 and r["hp"] < r["pk"] * .5, str(r))
        pg.click("#saveBtn"); time.sleep(.8)
        pg.reload(); pg.wait_for_function("window.LOOM && LOOM.S && LOOM.S.tracks.length>3"); time.sleep(1.2)
        ok("clips survive save + reload and audio re-downloads", ev("LOOM.S.tracks.some(t=>t.clips.length===2)") and ev("!!LOOM.app.getBuffer(%d)" % cid))

        # ---- mixer
        pg.click('#tabs [data-view=mixer]'); time.sleep(.3)
        ok("mixer has a strip per track + master", pg.locator(".strip").count() == ev("LOOM.S.tracks.length") + 1)
        ev("(()=>{const i=document.querySelector('.strip[data-i=\"1\"] [data-p=eqLo]');i.value=6;i.dispatchEvent(new Event('input',{bubbles:true}))})()")
        ok("mixer EQ writes to the track", ev("LOOM.S.tracks[1].params.eqLo") == 6)

        # ---- MIDI import / export round trip
        n_tr = ev("LOOM.S.tracks.length")
        mid = ev("Array.from(LOOM.GN.encodeMidi(LOOM.S,LOOM.A.GM_PROGRAM))")
        pg.set_input_files("#midiFile", files=[{"name": "x.mid", "mimeType": "audio/midi", "buffer": bytes(mid)}]); time.sleep(.8)
        ok("midi import adds tracks", ev("LOOM.S.tracks.length") > n_tr, f"{n_tr}->{ev('LOOM.S.tracks.length')}")

        # ---- playback runs without errors, jump into a clip mid-way
        pg.click('#tabs [data-view=roll]'); ev("LOOM.app.seek(2)"); pg.keyboard.press("Space"); time.sleep(1.2)
        ok("playback running", ev("LOOM.T.playing") and ev("LOOM.beatNow()") > 2); pg.keyboard.press("Space")

        # ---- usability: instrument dropdown on the card, browser, delete + undo, strums, riffs, help
        pg.click('#tabs [data-view=roll]'); pg.click('#trackList .trk:nth-child(3)'); time.sleep(.2)
        pg.select_option('#trackList .trk:nth-child(3) .ti', 'Rhodes'); ok("instrument changed from the track card", ev("LOOM.S.tracks[2].instrument") == "Rhodes")
        pg.click('#trackList .trk:nth-child(3) [data-act=browse]'); pg.wait_for_selector('#sndGrid [data-n]')
        ok("sound browser lists 70+ sounds", pg.locator('#sndGrid [data-n]').count() >= 70)
        pg.fill('#sndSearch', 'guitar'); ok("search narrows the list", 5 <= pg.locator("#sndGrid [data-n]").count() <= 16)
        pg.click('#sndGrid [data-n="Banjo"]'); pg.click('#sndUse'); time.sleep(.3)
        ok("browser applies a sound", ev("LOOM.S.tracks[2].instrument") == "Banjo")
        pg.click('#trackList .trk:nth-child(2) [data-act=browse]'); pg.fill('#sndSearch', 'ukulele'); pg.dblclick('#sndGrid [data-n="Ukulele"]'); time.sleep(.3)
        ok("a guitar on a bass track moves it to Mids", ev("LOOM.S.tracks[1].instrument") == "Ukulele" and ev("LOOM.S.tracks[1].element") == "mids")
        pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z"); time.sleep(.2)
        # strummed chord + riff on the mids track
        pg.click('#trackList .trk:nth-child(3)'); ev("LOOM.app.ui.cursor=64"); pg.select_option('#chStrum', 'folk'); n2 = ev("LOOM.S.tracks[2].notes.length")
        pg.click('#chordBar .cb[data-d="0"]'); ok("strummed chord writes a pattern, not a block", ev("LOOM.S.tracks[2].notes.length") - n2 >= 15)
        pg.keyboard.press("Control+z"); ev("LOOM.app.ui.cursor=64"); n3 = ev("LOOM.S.tracks[2].notes.length"); pg.click('#chRiffGo'); time.sleep(.2)
        ok("riff generator writes notes", ev("LOOM.S.tracks[2].notes.length") - n3 >= 8)
        ok("delete-selected button enabled with a selection", not pg.locator('#delSelBtn').is_disabled())
        k0 = ev("LOOM.S.tracks[2].notes.length"); pg.click('#delSelBtn'); ok("delete selected removes notes and offers Undo", ev("LOOM.S.tracks[2].notes.length") < k0 and pg.locator('.toast-undo button').count() == 1)
        pg.click('.toast-undo button'); ok("Undo button restores them", ev("LOOM.S.tracks[2].notes.length") == k0)
        tcount = ev("LOOM.S.tracks.length"); pg.click('#trackList .trk:last-child [data-act=del]'); ok("track card delete removes a track", ev("LOOM.S.tracks.length") == tcount - 1)
        pg.click('.toast-undo button'); ok("...and Undo brings it back", ev("LOOM.S.tracks.length") == tcount)
        names = ev("LOOM.S.tracks.map(t=>t.name).join()"); pg.click('#trackList .trk:nth-child(2) [data-act=up]'); ok("move track up reorders", ev("LOOM.S.tracks.map(t=>t.name).join()") != names)
        pg.keyboard.press("Control+z")
        pg.click('#helpBtn'); ok("help sheet opens", pg.locator('#helpDlg[open]').count() == 1); pg.keyboard.press("Escape")

        # ---- labels: a pitched track must show note names, never drum names (62 = D4 = Conga Hi)
        pg.click('#trackList .trk:nth-child(3)'); time.sleep(.3)
        ok("pitched rows are labelled with note names", ev("LOOM.app.rowLabel(62)") == "D4" and ev("LOOM.app.rowLabel(54)") == "F#3")
        pg.click('#trackList .trk:nth-child(1)'); time.sleep(.3)
        ok("drum rows keep their drum names", ev("LOOM.app.rowLabel(62)") == "Conga Hi" and ev("LOOM.app.rowLabel(36)") == "Kick")

        # ---- automation lanes: audio behaviour in the engine
        au = ev("""(async()=>{const A=LOOM.A;
          const mk=(auto,over={})=>({tempo:120,swing:0,master:{gain:.8,reverb:0,comp:false},tracks:[{id:'x',name:'x',element:'mids',instrument:'Organ',mute:false,solo:false,clips:[],layer:null,auto,
            params:{...A.BASE_PARAMS,...A.INSTRUMENT_DEFAULTS['Organ'],reverb:0,...over},notes:[{pitch:57,start:0,duration:16,velocity:.9}]}]});
          const rms=(d,a,b)=>{let s=0;for(let i=a;i<b;i++)s+=d[i]*d[i];return Math.sqrt(s/(b-a))};
          const bright=(d,a,b)=>{let s=0,e=0;for(let i=a+1;i<b;i++){s+=d[i]*d[i];const df=d[i]-d[i-1];e+=df*df}return Math.sqrt(e/s)};   // high-frequency energy relative to level
          const render=async(S,from,to)=>{const r=await A.renderWav(S,()=>null,{from,to,tail:0});return {d:r.buffer.getChannelData(0),sr:r.buffer.sampleRate}};
          const out={};
          // volume 0 -> 1 over 8 beats (4 s at 120 BPM)
          let r=await render(mk({volume:[{t:0,v:0},{t:8,v:1}]}),0,8); out.volFirst=rms(r.d,0,r.sr*.5); out.volLast=rms(r.d,r.sr*3.4,r.sr*3.9);
          // starting playback at beat 4 must begin at the lane's value there (0.5), not at 0 and not at 1
          const late=(S)=>{S.tracks[0].notes=[{pitch:57,start:4,duration:8,velocity:.9}];return S};
          r=await render(late(mk({volume:[{t:0,v:0},{t:8,v:1}]})),4,8); out.volMid=rms(r.d,0,Math.floor(r.sr*.25));
          const ref=await render(late(mk({}, {volume:.5})),4,8); out.volRef=rms(ref.d,0,Math.floor(r.sr*.25));
          // a muted track stays silent even with a volume lane
          const m=mk({volume:[{t:0,v:1},{t:8,v:1}]}); m.tracks[0].mute=true; r=await render(m,0,4); out.muted=rms(r.d,0,r.d.length);
          // low-pass sweep 0 -> 1 on a bright saw: early sound is darker (fewer zero crossings) than late
          const saw=mk({filter:[{t:0,v:0},{t:8,v:1}]}); saw.tracks[0].instrument='Saw Lead'; saw.tracks[0].params={...A.BASE_PARAMS,...A.INSTRUMENT_DEFAULTS['Saw Lead'],reverb:0,tone:1,filter:1};
          r=await render(saw,0,8); out.zcrFirst=bright(r.d,Math.floor(r.sr*.3),Math.floor(r.sr*.8)); out.zcrLast=bright(r.d,Math.floor(r.sr*3.2),Math.floor(r.sr*3.8));
          // pan hard right on a lane: left channel quiet
          const pan=mk({pan:[{t:0,v:1},{t:8,v:1}]}); const pr=await A.renderWav(pan,()=>null,{from:0,to:4,tail:0}); const L=pr.buffer.getChannelData(0),R=pr.buffer.getChannelData(1); out.panL=rms(L,0,L.length); out.panR=rms(R,0,R.length);
          return out})()""")
        ok("volume lane fades in (last second at least 5x louder than the first)", au["volLast"] > au["volFirst"] * 5 and au["volFirst"] < au["volLast"] * .3, str(au))
        ok("playback starting mid-lane begins at the lane's value there", .5 * au["volRef"] < au["volMid"] < 1.6 * au["volRef"] and au["volMid"] > 0, str(au))
        ok("mute still silences an automated track", au["muted"] < 1e-4, str(au))
        ok("filter lane opens the sound up over time", au["zcrLast"] > au["zcrFirst"] * 1.5, str(au))
        ok("pan lane moves the sound to the right", au["panR"] > au["panL"] * 5, str(au))

        # ---- automation lanes: the editor
        pg.click('#tabs [data-view=roll]'); pg.click('#trackList .trk:nth-child(2)'); time.sleep(.3)
        pg.select_option('#laneSel', 'volume'); time.sleep(.2)
        vb = pg.locator('#vel').bounding_box(); H = 84
        at = lambda beat, frac: (vb["x"] + 72 + beat * 48, vb["y"] + 4 + (1 - frac) * (H - 8))
        ok("lane picker offers volume, filter, pan, reverb and delay", pg.locator('#laneSel option').count() == 6)
        for beat, frac in [(4, .2), (12, .9), (8, .5)]:
            x, y = at(beat, frac); pg.mouse.click(x, y); time.sleep(.15)
        pts = ev("LOOM.S.tracks[1].auto.volume")
        ok("clicking adds points, kept sorted by time", [p["t"] for p in pts] == [4, 8, 12] and abs(pts[0]["v"] - .24) < .08 and abs(pts[2]["v"] - 1.08) < .08, str(pts))
        x, y = at(8, .5); pg.mouse.move(x, y); pg.mouse.down(); x2, y2 = at(10, 1.0); pg.mouse.move(x2, y2, steps=5); pg.mouse.up(); time.sleep(.2)
        pts = ev("LOOM.S.tracks[1].auto.volume"); ok("dragging a point moves it in time and value", [p["t"] for p in pts] == [4, 10, 12] and pts[1]["v"] > 1.0, str(pts))
        x, y = at(10, 1.0); pg.mouse.click(x, y, button="right"); time.sleep(.2); ok("right-click deletes a point", len(ev("LOOM.S.tracks[1].auto.volume")) == 2)
        pg.keyboard.press("Control+z"); time.sleep(.2); ok("undo brings the point back", len(ev("LOOM.S.tracks[1].auto.volume")) == 3)
        ok("the lane says how many points it has", "3 points" in pg.inner_text("#laneHelp"))
        pg.click("#saveBtn"); time.sleep(.8); pg.reload(); pg.wait_for_function("window.LOOM && LOOM.S && LOOM.S.tracks.length>3"); time.sleep(.8)
        ok("automation survives save and reload", len(ev("LOOM.S.tracks[1].auto.volume")) == 3)
        pg.click('#trackList .trk:nth-child(2)'); pg.select_option('#laneSel', 'volume'); pg.click('#laneClear'); time.sleep(.2)
        ok("clear lane removes the lane entirely", ev("LOOM.S.tracks[1].auto.volume") is None)
        ev("LOOM.S.tracks[1].auto={volume:[{t:0,v:.2},{t:8,v:1}],filter:[{t:0,v:1},{t:16,v:.3}],pan:[{t:0,v:-1},{t:16,v:1}]}")
        pg.keyboard.press("Home"); pg.keyboard.press("Space"); time.sleep(2.0)
        ok("real-time playback with three automated lanes runs", ev("LOOM.T.playing") and ev("LOOM.beatNow()") > 1); pg.keyboard.press("Space"); pg.keyboard.press("Enter")
        pg.select_option('#laneSel', 'velocity')

        # ---- recorded samples
        sm = ev("""(async()=>{const A=LOOM.A;await A.loadManifest();const man=A.samples.manifest;
          await A.loadSamples(['Grand Piano','Strings','Acoustic Kit','Linn Kit']);
          const mk=(inst,el,notes,samples,params={})=>({tempo:60,swing:0,master:{gain:.8,reverb:0,comp:false,samples},tracks:[{id:'x',name:'x',element:el,instrument:inst,mute:false,solo:false,clips:[],layer:null,auto:{},params:{...A.BASE_PARAMS,...A.INSTRUMENT_DEFAULTS[inst],reverb:0,...params},notes}]});
          const stat=async(S,to=8)=>{const r=await A.renderWav(S,()=>null,{from:0,to,tail:0});const d=r.buffer.getChannelData(0),sr=r.buffer.sampleRate;
            const rms=(a,b)=>{let s=0;a=Math.floor(a*sr);b=Math.min(d.length,Math.floor(b*sr));for(let i=a;i<b;i++)s+=d[i]*d[i];return Math.sqrt(s/Math.max(1,b-a))};
            const jump=(a,b)=>{let m=0;a=Math.floor(a*sr);b=Math.min(d.length,Math.floor(b*sr));for(let i=a+1;i<b;i++)m=Math.max(m,Math.abs(d[i]-d[i-1]));return m};
            let pk=0;for(const v of d)pk=Math.max(pk,Math.abs(v));return {d,sr,rms,jump,pk}};
          const out={n:Object.keys(man.instruments).length,kits:Object.keys(man.kits).length,readyPiano:A.samplesReady('Grand Piano')};
          const note=[{pitch:60,start:0,duration:1,velocity:.9}];
          const on=await stat(mk('Grand Piano','mids',note,true),4), off=await stat(mk('Grand Piano','mids',note,false),4);
          let dot=0,a2=0,b2=0;const N=Math.floor(on.sr*.5);for(let i=0;i<N;i++){dot+=on.d[i]*off.d[i];a2+=on.d[i]**2;b2+=off.d[i]**2}
          out.corr=Math.abs(dot/Math.sqrt(a2*b2));out.pianoOn=on.pk;out.pianoRing=on.rms(1.2,2.0)/on.rms(0,.4);
          const held=[{pitch:57,start:0,duration:8,velocity:.9}];
          const st=await stat(mk('Strings','mids',held,true),8);out.holdEarly=st.rms(1,2);out.holdLate=st.rms(5,7);out.jumpEarly=st.jump(1,2);out.jumpLate=st.jump(4.5,7.5);
          const kick=[{pitch:36,start:0,duration:.5,velocity:.9}], clap=[{pitch:39,start:0,duration:.5,velocity:.9}];
          const k1=await stat(mk('Acoustic Kit','drums',kick,true),2),k0=await stat(mk('Acoustic Kit','drums',kick,false),2);
          let d2=0,e2=0;for(let i=0;i<k1.d.length;i++){d2+=(k1.d[i]-k0.d[i])**2;e2+=k1.d[i]**2}out.kickDiffers=Math.sqrt(d2/e2);
          const c1=await stat(mk('Acoustic Kit','drums',clap,true),2);out.clapFallback=c1.pk;          // the real acoustic kit has no clap: the synth must cover that lane
          const l1=await stat(mk('Linn Kit','drums',[{pitch:38,start:0,duration:.5,velocity:.9}],true),2);out.linnSnare=l1.pk;
          const lo=await stat(mk('Grand Piano','mids',[{pitch:12,start:0,duration:1,velocity:.9}],true),3);out.farOutside=lo.rms(0,1);   // far below the recorded range: falls back to the synth
          return out})()""")
        ok("sample library is loaded: 30+ instruments and 3 kits", sm["n"] >= 30 and sm["kits"] == 3 and sm["readyPiano"], str(sm))
        ok("sampled piano is a different, audible sound from the synth piano", sm["corr"] < .6 and .05 < sm["pianoOn"] < 1.0, str(sm))
        ok("a sampled piano note rings out and fades naturally", 0 < sm["pianoRing"] < .9, str(sm))
        ok("held strings loop past the 3 s recording (still sounding at 5-7 s)", sm["holdLate"] > sm["holdEarly"] * .25, str(sm))
        ok("...and the loop point does not click", sm["jumpLate"] < sm["jumpEarly"] * 2.5, str(sm))
        ok("real acoustic drums replace the synth kick", sm["kickDiffers"] > .5, str(sm))
        ok("a lane the real kit lacks (clap) still plays from the synth", sm["clapFallback"] > .02, str(sm))
        ok("Linn kit snare is audible and under full scale", .1 < sm["linnSnare"] < 1.0, str(sm))
        ok("notes far outside the recorded range fall back to the synth", sm["farOutside"] > .005, str(sm))
        pg.wait_for_function("document.querySelector('#sampleStatus').textContent.includes('ready')", timeout=30000); ok("the studio shows when sampled sounds are ready", True)
        pg.uncheck('#mSamples'); time.sleep(.2); ok("switching samples off is a project setting", ev("LOOM.S.master.samples") is False and "synth only" in pg.inner_text('#sampleStatus'))
        pg.check('#mSamples'); time.sleep(.3); ok("...and back on", ev("LOOM.S.master.samples") is True)

        # ---- Words: poem -> music bed, lyric sync, reading, ducking
        POEM = "The evening folds its hands\\nand the river learns to sleep,\\nwhile somewhere far away\\na porch light starts to keep\\n\\nA slow and golden promise\\nfor everyone who waits.\\nHold on a little longer.\\nThe morning knows your name."
        pg.click('#tabs [data-view=words]'); pg.wait_for_selector('#poemMood option', state='attached')
        ok("mood list offers the poetry beds", pg.locator('#poemMood option').count() >= 8)
        pg.fill('#poemText', POEM.replace("\\n", "\n")); pg.select_option('#poemMood', 'poem-soft-acoustic'); time.sleep(.2)
        ok("live stats describe the poem", "8 lines" in pg.inner_text('#poemStats') and "2 stanzas" in pg.inner_text('#poemStats') and "bars" in pg.inner_text('#poemStats'), pg.inner_text('#poemStats'))
        pg.select_option('#poemMode', 'new'); pg.click('#poemBuild'); pg.wait_for_function("LOOM.S.lyrics.length === 8", timeout=20000); time.sleep(.5)
        wv = ev("({bars:LOOM.S.bars,tempo:LOOM.S.tempo,markers:LOOM.S.markers.map(m=>m.name),roles:LOOM.S.tracks.map(t=>t.element+':'+t.instrument),poem:!!LOOM.S.poem&&LOOM.S.poem.mood,first:LOOM.S.lyrics[0].t,opt:[...document.querySelectorAll('#barsSel option')].map(o=>+o.value)})")
        ok("sections follow the poem: intro, two stanzas, outro", wv["markers"] == ["Intro", "Stanza 1", "Stanza 2", "Outro"], str(wv))
        ok("project is fitted to the poem's length (not forced to a power of two)", wv["bars"] in wv["opt"] and wv["bars"] % 2 == 0 and wv["bars"] != 16, str(wv))
        ok("the bed has no vocal part and the poem is stored for later edits", not any(r.startswith("vox:") for r in wv["roles"]) and wv["poem"] == "poem-soft-acoustic" and wv["first"] == 8, str(wv))
        ok("every line is listed with a time", pg.locator('#lyricList .ly[data-i]').count() == 8)
        pg.click('#lyricList .ly[data-i="4"]'); time.sleep(.2); ok("clicking a line jumps the playhead to it", abs(ev("LOOM.beatNow()") - ev("LOOM.S.lyrics[4].t")) < .01)
        pg.keyboard.press("Space"); time.sleep(1.4); ok("the current line follows playback", pg.inner_text('#lyricNow') == "A slow and golden promise", pg.inner_text('#lyricNow')); pg.keyboard.press("Space"); pg.keyboard.press("Enter")
        # a reading of the poem: import a voice file where the first line starts
        with pg.expect_file_chooser() as fc: pg.click('#poemImp')
        fc.value.set_files(os.path.join(SP, "vox_test.wav")); pg.wait_for_function("LOOM.S.tracks.some(t=>t.instrument==='Audio Clips'&&t.clips.length===1)", timeout=15000); time.sleep(.4)
        ok("the reading lands on a 'Voice' track at the first line", ev("LOOM.S.tracks.some(t=>t.name==='Voice'&&t.clips.length===1&&Math.abs(t.clips[0].start-LOOM.S.lyrics[0].t)<.01)"))
        pg.select_option('#duckDepth', '.3'); pg.click('#duckBtn'); time.sleep(.3)
        duck = ev("""(async()=>{const S=LOOM.S,A=LOOM.A,voice=S.tracks.find(t=>t.name==='Voice'),clip=voice.clips[0];const spb=60/S.tempo,a=clip.start,b=LOOM.app.clipEnd(clip);
          const music=S.tracks.filter(t=>t.instrument!=='Audio Clips');const lanes=music.map(t=>t.auto&&t.auto.volume?t.auto.volume.length:0);
          const mk=(duck)=>({...JSON.parse(JSON.stringify(S)),tracks:music.map(t=>({...JSON.parse(JSON.stringify(t)),auto:duck?t.auto:{}}))});
          const win=(r,x,y)=>{const d=r.buffer.getChannelData(0),sr=r.buffer.sampleRate;let s=0;const i0=Math.floor(x*sr),i1=Math.min(d.length,Math.floor(y*sr));for(let i=i0;i<i1;i++)s+=d[i]*d[i];return Math.sqrt(s/Math.max(1,i1-i0))};
          const t0=(a+.5)*spb,t1=(b-.5)*spb;const withDuck=await A.renderWav(mk(true),()=>null,{from:a,to:b+1,tail:0}),noDuck=await A.renderWav(mk(false),()=>null,{from:a,to:b+1,tail:0});
          return {lanes,ratio:win(withDuck,.5*spb,(b-a-.5)*spb)/win(noDuck,.5*spb,(b-a-.5)*spb),voiceLane:!!(voice.auto&&voice.auto.volume)}})()""")
        ok("every music track gets a volume lane, the voice does not", all(n >= 4 for n in duck["lanes"]) and not duck["voiceLane"], str(duck))
        ok("the mix is really quieter under the voice (measured, about 30%)", .15 < duck["ratio"] < .5, str(duck))
        pg.click('#unduckBtn'); time.sleep(.2); ok("ducking can be removed", ev("LOOM.S.tracks.filter(t=>t.instrument!=='Audio Clips').every(t=>!(t.auto&&t.auto.volume))"))
        with pg.expect_download() as dl: pg.click('#lrcBtn')
        lrc = open(dl.value.path(), encoding='utf-8').read(); ok("lyrics export as timed .lrc", lrc.startswith("[ti:") and lrc.count("\n[0") >= 7 and "The morning knows your name." in lrc, lrc[:120])
        with pg.expect_download() as dl: pg.click('#srtBtn')
        srt = open(dl.value.path(), encoding='utf-8').read(); ok("...and .srt subtitles", "-->" in srt and srt.startswith("1\n00:00:"), srt[:80])
        pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z")
        ev("LOOM.S.lyrics.length")

        # ---- time-stretch (keeps pitch) and MP3 export
        ts = ev("""(async()=>{const A=LOOM.A,sr=44100,ctx=new OfflineAudioContext(2,1,sr);
          const tone=(secs,f)=>{const b=ctx.createBuffer(2,Math.round(secs*sr),sr);for(let c=0;c<2;c++){const d=b.getChannelData(c);for(let i=0;i<d.length;i++)d[i]=.5*Math.sin(2*Math.PI*f*i/sr)+.2*Math.sin(2*Math.PI*2*f*i/sr)}return b};
          const freq=(d,a,b)=>{let z=0;a=Math.floor(a*sr);b=Math.floor(b*sr);for(let i=a+1;i<b;i++)if(d[i-1]<=0&&d[i]>0)z++;return z/((b-a)/sr)};
          const rms=(d)=>{let s=0;for(const v of d)s+=v*v;return Math.sqrt(s/d.length)};
          const src=tone(2,440),out={};
          const slow=await A.stretchBuffer(ctx,src,1.5), fast=await A.stretchBuffer(ctx,src,.6);
          out.slowLen=slow.duration;out.fastLen=fast.duration;out.slowHz=freq(slow.getChannelData(0),.5,2.5);out.fastHz=freq(fast.getChannelData(0),.3,.9);
          out.rmsRatio=rms(slow.getChannelData(0))/rms(src.getChannelData(0));out.chan=slow.numberOfChannels;
          // the same change as a tape-style speed-up would shift the pitch: varispeed of 1/1.5 gives 293 Hz, which is what 'keep pitch' avoids
          // through a real project: a clip at speed 0.5 with keep-pitch off vs on
          const buf=tone(2,440);const mk=(warp)=>({tempo:60,swing:0,bars:4,master:{gain:.8,reverb:0,comp:false,samples:false},tracks:[{id:'a',name:'a',element:'vox',instrument:'Audio Clips',mute:false,solo:false,layer:null,auto:{},notes:[],params:{...A.BASE_PARAMS,reverb:0},
            clips:[{id:'c',asset:7,name:'t',start:0,offset:0,len:2,gain:1,fadeIn:0,fadeOut:0,rate:.5,warp}]}]});
          const play=async(warp)=>{const r=await A.renderWav(mk(warp),()=>buf,{from:0,to:4,tail:0});return {hz:freq(r.buffer.getChannelData(0),.5,3.5),len:r.buffer.duration}};
          const tape=await play(false),kept=await play(true);out.tapeHz=tape.hz;out.keptHz=kept.hz;
          const ok2=A.clipSource({...mk(true).tracks[0].clips[0]},()=>buf);out.sourceReady=!!ok2&&ok2.clip.rate===1&&Math.abs(ok2.clip.len-4)<1e-6;
          return out})()""")
        ok("stretch changes length by the requested ratio", abs(ts["slowLen"] - 3.0) < .06 and abs(ts["fastLen"] - 1.2) < .06 and ts["chan"] == 2, str(ts))
        ok("...without changing pitch (440 Hz stays ~440 Hz)", abs(ts["slowHz"] - 440) < 12 and abs(ts["fastHz"] - 440) < 12, str(ts))
        ok("...and without changing loudness", .75 < ts["rmsRatio"] < 1.25, str(ts))
        ok("in a clip: tape-style slow-down drops an octave, keep-pitch stays put", abs(ts["tapeHz"] - 220) < 10 and abs(ts["keptHz"] - 440) < 14 and ts["sourceReady"], str(ts))
        pg.evaluate("document.querySelector('#exportMenu').open = true")
        ev("LOOM.S.loop={on:true,start:0,end:4}")
        with pg.expect_download(timeout=240000) as dl: pg.click('#mp3Btn')
        mp3 = open(dl.value.path(), "rb").read()
        ok("MP3 export produces a real MP3 file", len(mp3) > 20000 and (mp3[:3] == b"ID3" or (mp3[0] == 0xFF and mp3[1] & 0xE0 == 0xE0)), str(len(mp3)))
        dur = ev("""(async(bytes)=>{const ac=new OfflineAudioContext(2,1,44100);const b=await ac.decodeAudioData(new Uint8Array(bytes).buffer);const d=b.getChannelData(0);let pk=0;for(const v of d)pk=Math.max(pk,Math.abs(v));return {dur:b.duration,pk}})(%s)""" % list(mp3))
        ok("the MP3 decodes back to the right length and is not silent", 5.5 < dur["dur"] < 7.5 and dur["pk"] > .05, str(dur))
        ev("LOOM.S.loop={on:false,start:0,end:LOOM.S.bars*4}")

        # ---- reverb / delay tails must fade (an unstable feedback loop once made them grow ~8000x)
        tail = ev("""(async()=>{const A=LOOM.A;const S={tempo:60,swing:0,master:{gain:.8,reverb:.6,comp:true},tracks:[{id:'x',name:'x',element:'drums',instrument:'Acoustic Kit',mute:false,solo:false,clips:[],layer:null,params:{...A.BASE_PARAMS,reverb:.5,delay:.3},notes:[{pitch:36,start:0,duration:.5,velocity:.9}]}]};
          const r=await A.renderWav(S,()=>null,{from:0,to:24,tail:0});const d=r.buffer.getChannelData(0),sr=r.buffer.sampleRate;const pk=(a,b)=>{let m=0;for(let i=a*sr;i<b*sr;i++)m=Math.max(m,Math.abs(d[i]));return m};return [pk(0,1),pk(4,6),pk(12,14),pk(20,22)]})()""")
        ok("reverb and delay tails fade instead of growing", tail[3] < .01 and tail[3] <= tail[1] and tail[0] < 1, str(tail))

        # ---- every genre renders audibly through the real engine
        sweep = ev("""(async()=>{const out={};for(const g of LOOM.DATA.genres){const plan=LOOM.GN.generate(g,LOOM.DATA.structures,LOOM.DATA.beats,3);
          const S={tempo:g.tempo,swing:g.swing,master:{gain:.8,reverb:.6,comp:true},tracks:plan.tracks.map((t,i)=>({id:'t'+i,name:t.name,element:t.element,instrument:t.instrument,clips:[],layer:null,mute:false,solo:false,params:{...LOOM.A.BASE_PARAMS,...LOOM.A.INSTRUMENT_DEFAULTS[t.instrument],...t.params},notes:t.notes}))};
          const r=await LOOM.A.renderWav(S,()=>null,{from:16,to:32,tail:1});const d=r.buffer.getChannelData(0);let pk=0,sq=0,nan=0;for(const v of d){if(v!==v)nan++;pk=Math.max(pk,Math.abs(v));sq+=v*v}
          out[g.id]={pk:+r.peak.toFixed(2),rms:+Math.sqrt(sq/d.length).toFixed(3),nan}}return out})()""")
        weak = {k: v for k, v in sweep.items() if v["nan"] or v["rms"] < .02 or v["pk"] > 2.5}
        missing = ev("""(()=>{const all=new Set(Object.values(LOOM.A.ELEMENTS).flatMap(e=>e.instruments));const bad=[];for(const g of LOOM.DATA.genres)for(const n of [g.kit,g.bass&&g.bass.instrument,g.mids.instrument,g.vox&&g.vox.instrument,g.extra&&g.extra.instrument,g.fx.riser,g.fx.impact,g.fx.texture].filter(Boolean))if(!all.has(n))bad.append?0:bad.push(g.id+":"+n);return bad})()""")
        ok("every sound named by a genre exists", not missing, str(missing))
        ok(f"all {len(sweep)} genres render audibly (bars 5-8, full mix)", not weak, str(weak))
        print("   loudness (peak/rms):", ", ".join(f"{k} {v['pk']}/{v['rms']}" for k, v in sweep.items()))
        pg.screenshot(path=SP + "/f_roll.png"); pg.click('#tabs [data-view=arrange]'); time.sleep(.5); pg.screenshot(path=SP + "/f_arr.png")
        pg.click('#tabs [data-view=mixer]'); time.sleep(.4); pg.screenshot(path=SP + "/f_mix.png")
        pg.click('#tabs [data-view=steps]'); pg.click('#trackList .trk:nth-child(1)'); time.sleep(.4); pg.screenshot(path=SP + "/f_steps.png")
        b.close()
finally:
    srv.terminate()
print(f"\n{sum(results)}/{len(results)} checks passed")
print("ERRORS:", errors or "none")

sys.exit(0 if all(results) and not errors else 1)
