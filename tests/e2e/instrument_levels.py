"""Offline-renders every instrument through the audio engine and flags silence, NaN or clipping.
Run from the project root:  python tests/e2e/instrument_levels.py"""
import sys, subprocess, time, os, json, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
env = dict(os.environ, DATABASE_URL="sqlite:///" + Path(tempfile.gettempdir(), "loom_e2e_levels.db").as_posix())
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.app:app", "--port", "8015"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"]); pg = b.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://127.0.0.1:8015/auth"); pg.click(".tabs button[data-mode=signup]")
        pg.fill("[name=display_name]", "Lvl"); pg.fill("[name=email]", f"l{int(time.time())}@example.com"); pg.fill("[name=password]", "Violet-Harbor-42")
        pg.click("#authSubmit"); pg.wait_for_function("window.LOOM && LOOM.S"); time.sleep(1)
        res = pg.evaluate("""async()=>{
          const A=LOOM.A, out={};
          for(const [ek,el] of Object.entries(A.ELEMENTS)){
            for(const ins of el.instruments){
              if(ins==='Audio Clips')continue;
              const S={tempo:120,swing:0,master:{gain:.8,reverb:.6,comp:true},tracks:[{id:'x',name:'x',element:ek,instrument:ins,mute:false,solo:false,clips:[],layer:null,
                params:{...A.BASE_PARAMS,...A.INSTRUMENT_DEFAULTS[ins]},
                notes: ek==='drums'? A.DRUM_LANES.map((l,i)=>({pitch:l[0],start:i,duration:.5,velocity:.9})) : [{pitch:ek==='bass'?36:64,start:0,duration:2,velocity:.9}]}]};
              const r=await A.renderWav(S,()=>null,{from:0,to:ek==='drums'?16:4,tail:1});
              const d=r.buffer.getChannelData(0); let pk=0,sq=0,nan=0; for(const v of d){if(v!==v)nan++; pk=Math.max(pk,Math.abs(v)); sq+=v*v}
              out[ek+'/'+ins]={peak:+pk.toFixed(3),rms:+Math.sqrt(sq/d.length).toFixed(4),nan};
            }}
          return out}""")
        bad = []
        for k, v in res.items():
            flag = "" if (v['nan'] == 0 and .05 < v['peak'] < 1.0 and v['rms'] > .004) else "  <-- CHECK"
            if flag: bad.append(k)
            print(f"{k:30s} peak={v['peak']:<6} rms={v['rms']:<7} nan={v['nan']}{flag}")
        print("instruments:", len(res), "needing a look:", bad)
        print("ERRORS:", errs or "none")
        b.close()
finally:
    srv.terminate()

sys.exit(1 if bad else 0)
