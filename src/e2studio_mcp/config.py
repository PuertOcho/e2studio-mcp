"""Configuration loader for e2studio-mcp.

All settings come from environment variables and auto-detection.
No JSON config file is used.

Environment variables (set by the VS Code extension from its settings):
  E2MCP_WORKSPACE      — Root folder containing Renesas e2 Studio projects
  E2MCP_PROJECT        — Default project name
  E2MCP_BUILD_CONFIG   — Build configuration (default: HardwareDebug)
  E2MCP_BUILD_MODE     — Build backend: make or e2studioc (default: make)
  E2MCP_BUILD_JOBS     — Parallel build jobs, 0 = auto (default: 0)
  E2MCP_E2STUDIO_PATH  — Path to e2 Studio eclipse folder
  E2MCP_CCRX_PATH      — Path to CCRX compiler bin folder
  E2MCP_MAKE_PATH      — Path to GNU Make folder
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ─── Known Renesas RX devices ────────────────────────────────

_KNOWN_DEVICES: dict[str, dict[str, Any]] = {
    "R5F5651E": {"family": "RX651", "romSize": 2097152, "ramSize": 655360, "dataFlashSize": 32768},
    "R5F565NE": {"family": "RX65N", "romSize": 2097152, "ramSize": 655360, "dataFlashSize": 32768},
    "R5F572NNDxBD": {"family": "RX72N", "romSize": 4194304, "ramSize": 1048576, "dataFlashSize": 32768},
}


@dataclass
class ToolchainConfig:
    ccrx_path: str = ""
    e2studio_path: str = ""
    make_path: str | None = None


@dataclass
class DeviceInfo:
    family: str = ""
    rom_size: int = 0
    ram_size: int = 0
    data_flash_size: int = 0


@dataclass
class Config:
    workspace: str = ""
    default_project: str = ""
    build_config: str = "HardwareDebug"
    build_mode: str = "make"
    build_jobs: int = 0
    toolchain: ToolchainConfig = field(default_factory=ToolchainConfig)

    @property
    def workspace_path(self) -> Path:
        return Path(self.workspace)

    def get_project_path(self, project: str | None = None) -> Path:
        name = project or self.default_project
        return self.workspace_path / name

    def get_device_info(self, device: str | None = None) -> DeviceInfo | None:
        """Look up device info from the built-in table."""
        dev = device or ""
        if dev and dev in _KNOWN_DEVICES:
            return _parse_device_entry(_KNOWN_DEVICES[dev])
        # Return first known device as last resort
        for info in _KNOWN_DEVICES.values():
            return _parse_device_entry(info)
        return None

    def get_ccrx_bin(self, tool: str) -> Path:
        """Get full path to a CCRX tool binary (e.g. 'ccrx', 'rlink')."""
        return Path(self.toolchain.ccrx_path) / tool

    def get_e2studioc(self) -> Path:
        return Path(self.toolchain.e2studio_path) / "e2studioc.exe"

    def get_make(self) -> str:
        if self.toolchain.make_path:
            return str(Path(self.toolchain.make_path) / "make")
        return "make"


# ─── Auto-detection ──────────────────────────────────────────

def _detect_e2studio_path() -> str:
    """Auto-detect e2 Studio eclipse folder."""
    for candidate in [
        Path("C:/Renesas/e2_studio/eclipse"),
        Path("C:/Renesas/e2studio/eclipse"),
    ]:
        if candidate.exists():
            return str(candidate)
    return ""


def _detect_ccrx_path() -> str:
    """Auto-detect CCRX compiler: newest version under Program Files (x86)/Renesas/RX."""
    base = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Renesas" / "RX"
    try:
        for ver in sorted(base.iterdir(), reverse=True):
            bin_dir = ver / "bin"
            if (bin_dir / "ccrx.exe").exists():
                return str(bin_dir)
    except (FileNotFoundError, PermissionError):
        pass
    return ""


def _detect_make_path(e2studio_path: str) -> str:
    """Auto-detect GNU make bundled with e2 Studio plugins."""
    if not e2studio_path:
        return ""
    plugins = Path(e2studio_path) / "plugins"
    try:
        for d in sorted(plugins.iterdir(), reverse=True):
            if d.name.startswith("com.renesas.ide.exttools.gnumake") and d.is_dir():
                mk = d / "mk"
                if (mk / "make.exe").exists():
                    return str(mk)
    except (FileNotFoundError, PermissionError):
        pass
    return ""


def _auto_detect_toolchain(tc: ToolchainConfig) -> ToolchainConfig:
    """Fill in missing toolchain paths via auto-detection."""
    e2 = tc.e2studio_path or _detect_e2studio_path()
    ccrx = tc.ccrx_path or _detect_ccrx_path()
    make = tc.make_path or _detect_make_path(e2) or None
    return ToolchainConfig(ccrx_path=ccrx, e2studio_path=e2, make_path=make)


# ─── Parsing helpers ─────────────────────────────────────────

def _parse_device_entry(info: dict[str, Any]) -> DeviceInfo:
    return DeviceInfo(
        family=info.get("family", ""),
        rom_size=info.get("romSize", 0),
        ram_size=info.get("ramSize", 0),
        data_flash_size=info.get("dataFlashSize", 0),
    )


def load_config() -> Config:
    """Load configuration from environment variables + auto-detection."""
    e2 = os.environ.get("E2MCP_E2STUDIO_PATH", "")
    ccrx = os.environ.get("E2MCP_CCRX_PATH", "")
    make = os.environ.get("E2MCP_MAKE_PATH", "")

    tc = _auto_detect_toolchain(ToolchainConfig(
        ccrx_path=ccrx,
        e2studio_path=e2,
        make_path=make or None,
    ))

    return Config(
        workspace=os.environ.get("E2MCP_WORKSPACE", ""),
        default_project=os.environ.get("E2MCP_PROJECT", ""),
        build_config=os.environ.get("E2MCP_BUILD_CONFIG", "HardwareDebug"),
        build_mode=os.environ.get("E2MCP_BUILD_MODE", "make"),
        build_jobs=max(0, int(os.environ.get("E2MCP_BUILD_JOBS", "0"))),
        toolchain=tc,
    )
