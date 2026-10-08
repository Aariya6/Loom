from __future__ import annotations
import argparse, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def run(cmd):
    p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True);return p.returncode,p.stdout[-2000:],p.stderr[-2000:]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--json',action='store_true');a=ap.parse_args(); checks={}
    checks['python_compile']=run([sys.executable,'-m','compileall','-q','backend'])[0]==0
    checks['tests']=run([sys.executable,'-m','pytest','-q'])[0]==0
    checks['html'] = all(p.read_text(encoding='utf-8').lower().startswith('<!doctype html>') for p in (ROOT/'frontend').glob('*.html'))
    checks['docs']=all((ROOT/x).exists() for x in ['README.md','REPORT.md','PROGRESS.md','SKILL_GAP_COVERAGE.md'])
    out={'project':'loom','checks':checks,'pass':all(checks.values())}
    print(json.dumps(out,indent=2) if a.json else ('PASS' if out['pass'] else 'FAIL'))
    return 0 if out['pass'] else 1
if __name__=='__main__':raise SystemExit(main())
