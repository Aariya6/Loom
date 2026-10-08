import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Every test run gets its own throwaway database. (The audio-quota tests upload ~60 MB each run; against the default
# loom.db that quietly grew a developer database to hundreds of MB.) This must run before backend.core is imported.
_TMP = tempfile.mkdtemp(prefix="loom-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + Path(_TMP, "test.db").as_posix()
atexit.register(shutil.rmtree, _TMP, ignore_errors=True)

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """The limiter is process-global; tests that sign up several users would otherwise trip it."""
    from backend import core
    core.ATTEMPTS.clear()
    yield
