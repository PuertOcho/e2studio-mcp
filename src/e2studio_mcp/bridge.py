"""Client for the VS Code extension command bridge.

When the extension is running, its HTTP bridge port is written to
``<workspace>/.e2mcp/.bridge-port``. Action tools (build, clean,
rebuild) POST commands to this bridge so they reuse the exact same
``make`` invocation and environment as the extension UI buttons.

If the bridge is not available (extension not running, file missing, etc.)
the caller should fall back to the standalone Python implementation.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any


def _read_bridge_port(workspace: Path) -> int | None:
    """Read the bridge port from the well-known file."""
    port_file = workspace / ".e2mcp" / ".bridge-port"
    try:
        text = port_file.read_text().strip()
        return int(text)
    except (FileNotFoundError, ValueError, OSError):
        return None


def bridge_available(workspace: Path) -> bool:
    """Check if the command bridge port file exists."""
    return _read_bridge_port(workspace) is not None


def call_bridge(
    workspace: Path,
    command: str,
    args: dict[str, Any] | None = None,
    timeout: float = 300,
) -> dict[str, Any] | None:
    """POST a command to the extension bridge.

    Returns the JSON response dict, or None if the bridge is unreachable
    (caller should fall back to standalone execution).
    """
    port = _read_bridge_port(workspace)
    if port is None:
        return None

    payload = json.dumps({"command": command, "args": args or {}}).encode()
    url = f"http://127.0.0.1:{port}/command"

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None
