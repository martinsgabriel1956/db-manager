"""Builds dev/demo/demo.sqlite from seed-sqlite.sql (Python's stdlib, no sqlite3 CLI needed)."""
import pathlib
import sqlite3

here = pathlib.Path(__file__).parent
target = here / "demo.sqlite"
target.unlink(missing_ok=True)
with sqlite3.connect(target) as db:
    db.executescript((here / "seed-sqlite.sql").read_text())
print(f"created {target}")
