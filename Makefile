PY=python
run:
	$(PY) -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
install:
	$(PY) -m pip install -r requirements.txt
test:
	$(PY) -m pytest -q
compile:
	$(PY) -m compileall backend
verify:
	$(PY) scripts/verify.py --json
