from pathlib import Path
import subprocess, sys

def test_mutopia_fixture_parser(tmp_path):
    fixture=tmp_path/'page.html';fixture.write_text('<div>Air by J. S. Bach</div><div>Wiegenlied by J. Brahms</div>')
    script=Path(__file__).parents[1]/'scripts'/'procure_mutopia.py'
    before=(Path(__file__).parents[1]/'data'/'mutopia_snapshot.json').read_text()
    p=subprocess.run([sys.executable,str(script),'--fixture',str(fixture)],capture_output=True,text=True)
    (Path(__file__).parents[1]/'data'/'mutopia_snapshot.json').write_text(before)
    assert p.returncode==0 and 'wrote 2' in p.stdout
