"""Configuration loader for e2studio-mcp."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ToolchainConfig:
    ccrx_path: str = ""
    e2studio_path: str = ""
    make_path: str | None = None


@dataclass
class FlashConfig:
    debugger: str = "E2Lite"
    device: str = "R5F5651E"
    gdb_executable: str = "rx-elf-gdb"
    gdb_port: int = 61234
    input_clock: str = "24.0"
    id_code: str = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
    debug_tools_path: str = ""
    python3_bin_path: str = ""


@dataclass
class DeviceInfo:
    family: str = ""
    rom_size: int = 0
    ram_size: int = 0
    data_flash_size: int = 0
    rom_range: str = ""
    ram_range: str = ""
    data_flash_range: str = ""


@dataclass
class Config:
    workspace: str = ""
    default_project: str = "headc-fw"
    build_config: str = "HardwareDebug"
    build_mode: str = "make"
    toolchain: ToolchainConfig = field(default_factory=ToolchainConfig)
    flash: FlashConfig = field(default_factory=FlashConfig)
    devices: dict[str, DeviceInfo] = field(default_factory=dict)

    @property
    def workspace_path(self) -> Path:
        return Path(self.workspace)

    def get_project_path(self, project: str | None = None) -> Path:
        name = project or self.default_project
        return self.workspace_path / name

    def get_device_info(self, device: str | None = None) -> DeviceInfo | None:
        dev = device or self.flash.device
        return self.devices.get(dev)

    def get_ccrx_bin(self, tool: str) -> Path:
        """Get full path to a CCRX tool binary (e.g. 'ccrx', 'rlink')."""
        return Path(self.toolchain.ccrx_path) / tool

    def get_e2studioc(self) -> Path:
        return Path(self.toolchain.e2studio_path) / "e2studioc.exe"

    def get_make(self) -> str:
        if self.toolchain.make_path:
            return str(Path(self.toolchain.make_path) / "make")
        return "make"


def _load_raw(config_path: str | Path) -> dict[str, Any]:
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _parse_toolchain(data: dict[str, Any]) -> ToolchainConfig:
    return ToolchainConfig(
        ccrx_path=data.get("ccrxPath", ""),
        e2studio_path=data.get("e2studioPath", ""),
        make_path=data.get("makePath"),
    )


def _parse_flash(data: dict[str, Any]) -> FlashConfig:
    return FlashConfig(
        debugger=data.get("debugger", "E2Lite"),
        device=data.get("device", "R5F5651E"),
        gdb_executable=data.get("gdbExecutable", "rx-elf-gdb"),
        gdb_port=data.get("gdbPort", 61234),
        input_clock=data.get("inputClock", "24.0"),
        id_code=data.get("idCode", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
        debug_tools_path=data.get("debugToolsPath", ""),
        python3_bin_path=data.get("python3BinPath", ""),
    )


def _parse_devices(data: dict[str, Any]) -> dict[str, DeviceInfo]:
    devices: dict[str, DeviceInfo] = {}
    for name, info in data.items():
        devices[name] = DeviceInfo(
            family=info.get("family", ""),
            rom_size=info.get("romSize", 0),
            ram_size=info.get("ramSize", 0),
            data_flash_size=info.get("dataFlashSize", 0),
            rom_range=info.get("romRange", ""),
            ram_range=info.get("ramRange", ""),
            data_flash_range=info.get("dataFlashRange", ""),
        )
    return devices


def load_config(config_path: str | Path | None = None) -> Config:
    """Load configuration from JSON file.

    Resolution order:
    1. Explicit path argument
    2. E2STUDIO_MCP_CONFIG environment variable
    3. e2studio-mcp.json in the package's parent directory
    """
    if config_path is None:
        config_path = os.environ.get("E2STUDIO_MCP_CONFIG")
    if config_path is None:
        # Default: look relative to this file's grandparent (project root)
        config_path = Path(__file__).parent.parent.parent / "e2studio-mcp.json"

    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")

    raw = _load_raw(path)

    return Config(
        workspace=raw.get("workspace", ""),
        default_project=raw.get("defaultProject", "headc-fw"),
        build_config=raw.get("buildConfig", "HardwareDebug"),
        build_mode=raw.get("buildMode", "make"),
        toolchain=_parse_toolchain(raw.get("toolchain", {})),
        flash=_parse_flash(raw.get("flash", {})),
        devices=_parse_devices(raw.get("devices", {})),
    )
