"""Shared test helpers.

LIBERO tests build `LiberoRunner` / `create_app` with in-test fake operators
(see `test_libero_commands.FakeOperator`); integration against the real sim in
fake mode (`server.py --backend fake`) is step 6 of the communication plan.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def load_contract(name: str) -> dict[str, Any]:
    return json.loads((ROOT / "contracts" / name).read_text(encoding="utf-8"))
