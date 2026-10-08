from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def main():
    checks = {}
    checks['python_compile'] = run([sys.executable, '-m', 'compileall', '-q', 'backend'])[0] == 0
    checks['pytest'] = run([sys.executable, '-m', 'pytest', '-q'])[0] == 0
    checks['javascript'] = all(run(['node', '--check', f'frontend/assets/{f}.js'])[0] == 0 for f in ('site', 'studio', 'studio-audio', 'studio-gen', 'studio-views', 'studio-sounds', 'studio-share', 'studio-words', 'share'))
    checks['music_logic_tests'] = run(['node', 'tests/gen.test.js'])[0] == 0
    checks['ruby'] = run(['ruby', '-c', 'interop/ruby/manifest_check.rb'])[0] == 0
    checks['progress'] = run([sys.executable, 'scripts/check_progress.py'])[0] == 0
    checks['required_docs'] = all((ROOT / p).exists() for p in [
        'README.md','REPORT.md','PROGRESS.md','SECURITY.md','SKILL_GAP_COVERAGE.md',
        '.env.example','V10_TUTORIAL_NOTES.pdf','reports/VERIFICATION.md','reports/verification.json'
    ])
    checks['screenshots'] = len(list((ROOT/'docs/screenshots').glob('*.png'))) >= 2
    # Runtime test imports may create local SQLite files; release packaging removes them.
    checks['release_hygiene_rule_present'] = '*.db' in (ROOT/'.gitignore').read_text()
    result = {'project': ROOT.name, 'release': '10.0.0', 'checks': checks, 'pass': all(checks.values())}
    print(json.dumps(result, indent=2))
    return 0 if result['pass'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
