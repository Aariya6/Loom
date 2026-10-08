import json
from pathlib import Path
p=json.loads((Path(__file__).parents[1]/"progress_matrix.json").read_text())
assert len(p["versions"])==10
assert all(len(items)>=20 for items in p["versions"].values())
print("progress matrix: 10 versions x >=20 themes PASS")
