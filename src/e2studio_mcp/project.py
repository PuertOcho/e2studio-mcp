"""Parser for .cproject XML and project scanner for e2 Studio projects."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from lxml import etree


@dataclass
class ProjectInfo:
    name: str = ""
    path: str = ""
    device: str = ""
    device_family: str = ""
    toolchain: str = ""
    toolchain_version: str = ""
    configs: list[str] = field(default_factory=list)
    has_map_file: bool = False
    last_build_time: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "path": self.path,
            "device": self.device,
            "deviceFamily": self.device_family,
            "toolchain": self.toolchain,
            "toolchainVersion": self.toolchain_version,
            "configs": self.configs,
            "hasMapFile": self.has_map_file,
            "lastBuildTime": self.last_build_time,
        }


@dataclass
class ProjectConfig:
    name: str = ""
    device: str = ""
    device_family: str = ""
    isa: str = ""
    toolchain_id: str = ""
    toolchain_version: str = ""
    has_fpu: bool = False
    endian: str = ""
    build_config: str = ""
    artifact_name: str = ""
    artifact_extension: str = ""
    include_paths: list[str] = field(default_factory=list)
    defines: list[str] = field(default_factory=list)
    compiler_options: dict[str, str] = field(default_factory=dict)
    linker_options: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "device": self.device,
            "deviceFamily": self.device_family,
            "isa": self.isa,
            "toolchainId": self.toolchain_id,
            "toolchainVersion": self.toolchain_version,
            "hasFpu": self.has_fpu,
            "endian": self.endian,
            "buildConfig": self.build_config,
            "artifactName": self.artifact_name,
            "artifactExtension": self.artifact_extension,
            "includePaths": self.include_paths,
            "defines": self.defines,
            "compilerOptions": self.compiler_options,
            "linkerOptions": self.linker_options,
        }


def _get_last_build_time(project_path: Path, config: str = "HardwareDebug") -> str:
    """Get timestamp of last build by checking .mot file modification time."""
    build_dir = project_path / config
    if not build_dir.exists():
        return ""
    mot_files = list(build_dir.glob("*.mot"))
    if not mot_files:
        return ""
    mtime = max(f.stat().st_mtime for f in mot_files)
    return datetime.fromtimestamp(mtime).isoformat()


def _has_map_file(project_path: Path, config: str = "HardwareDebug") -> bool:
    build_dir = project_path / config
    if not build_dir.exists():
        return False
    return any(build_dir.glob("*.map"))


def _find_map_file(project_path: Path, config: str = "HardwareDebug") -> Path | None:
    build_dir = project_path / config
    if not build_dir.exists():
        return None
    maps = list(build_dir.glob("*.map"))
    return maps[0] if maps else None


def list_projects(workspace_path: Path) -> list[dict[str, Any]]:
    """Scan workspace for e2 Studio projects (directories with .cproject)."""
    projects: list[ProjectInfo] = []

    if not workspace_path.exists():
        return []

    for entry in sorted(workspace_path.iterdir()):
        if not entry.is_dir():
            continue
        cproject = entry / ".cproject"
        if not cproject.exists():
            continue

        info = ProjectInfo(name=entry.name, path=str(entry))

        # Parse .cproject for basic info
        try:
            cfg = parse_cproject(cproject)
            info.device = cfg.device
            info.device_family = cfg.device_family
            info.toolchain = cfg.toolchain_id
            info.toolchain_version = cfg.toolchain_version
            info.configs = cfg.configs if hasattr(cfg, "configs") else [cfg.build_config]
        except Exception:
            pass

        info.has_map_file = _has_map_file(entry)
        info.last_build_time = _get_last_build_time(entry)
        projects.append(info)

    return [p.to_dict() for p in projects]


def parse_cproject(cproject_path: Path | str) -> ProjectConfig:
    """Parse .cproject XML file and extract project configuration."""
    path = Path(cproject_path)
    tree = etree.parse(str(path))
    root = tree.getroot()

    config = ProjectConfig()
    config.name = path.parent.name

    # Find the first cconfiguration (HardwareDebug)
    cconfig = root.find(".//cconfiguration")
    if cconfig is None:
        return config

    config_id = cconfig.get("id", "")
    storage = cconfig.find("storageModule[@moduleId='cdtBuildSystem']")
    if storage is not None:
        cfg_elem = storage.find("configuration")
        if cfg_elem is not None:
            config.build_config = cfg_elem.get("name", "")
            config.artifact_name = cfg_elem.get("artifactName", "")
            config.artifact_extension = cfg_elem.get("artifactExtension", "")

    # Toolchain info
    tc_storage = cconfig.find("storageModule[@moduleId='com.renesas.cdt.managedbuild.core.toolchainInfo']")
    if tc_storage is not None:
        for opt in tc_storage.findall("option"):
            opt_id = opt.get("id", "")
            val = opt.get("value", "")
            if opt_id == "toolchain.id":
                config.toolchain_id = val
            elif opt_id == "toolchain.version":
                config.toolchain_version = val

    # Device info, ISA, FPU — from Common tool options
    _parse_common_options(root, config)

    # Include paths
    _parse_include_paths(root, config)

    # Preprocessor defines
    _parse_defines(root, config)

    return config


def _parse_common_options(root: etree._Element, config: ProjectConfig) -> None:
    """Extract device, ISA, FPU, endian from Common tool options."""
    for opt in root.iter("option"):
        super_class = opt.get("superClass", "")
        val = opt.get("value", "")

        if "deviceCommand" in super_class or "deviceName" in super_class:
            if val and not config.device:
                # deviceCommand has the short name (R5F5651E)
                if "deviceCommand" in super_class:
                    config.device = val
                elif "deviceName" in super_class and not config.device:
                    config.device = val

        elif "deviceFamily" in super_class:
            if val:
                config.device_family = val

        elif "common.option.isa" in super_class and "History" not in super_class:
            if "rxv2" in val.lower():
                config.isa = "RXv2"
            elif "rxv3" in val.lower():
                config.isa = "RXv3"
            elif "rxv1" in val.lower():
                config.isa = "RXv1"
            else:
                config.isa = val

        elif "hasFpu" in super_class:
            config.has_fpu = val.upper() == "TRUE"

        elif "dsp.option.endian" in super_class:
            if "big" in val:
                config.endian = "big"
            elif "little" in val:
                config.endian = "little"


def _parse_include_paths(root: etree._Element, config: ProjectConfig) -> None:
    """Extract include paths from compiler options."""
    for opt in root.iter("option"):
        super_class = opt.get("superClass", "")
        if "compiler.option.include" in super_class:
            for item in opt.findall("listOptionValue"):
                path_val = item.get("value", "")
                # Clean up e2 Studio variable references
                path_val = path_val.strip('"')
                config.include_paths.append(path_val)
            break  # Only need the first match


def _parse_defines(root: etree._Element, config: ProjectConfig) -> None:
    """Extract preprocessor defines from compiler options."""
    for opt in root.iter("option"):
        super_class = opt.get("superClass", "")
        if "compiler.option.define" in super_class:
            for item in opt.findall("listOptionValue"):
                define = item.get("value", "")
                config.defines.append(define)
            break


def get_project_config(
    workspace_path: Path, project: str, build_config: str = "HardwareDebug",
) -> dict[str, Any]:
    """Get full project configuration from .cproject."""
    project_path = workspace_path / project
    cproject_path = project_path / ".cproject"

    if not cproject_path.exists():
        return {"error": f".cproject not found at {cproject_path}"}

    try:
        cfg = parse_cproject(cproject_path)
        result = cfg.to_dict()
        result["mapFile"] = str(_find_map_file(project_path, build_config) or "")
        result["hasMapFile"] = _has_map_file(project_path, build_config)
        return result
    except Exception as e:
        return {"error": f"Failed to parse .cproject: {e}"}
