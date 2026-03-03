"""Build management for e2 Studio projects — make and e2studioc backends."""

from __future__ import annotations

import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Config


# ─── Error/Warning parsing ────────────────────────────────────

# CCRX compiler: "file.c", line 42: E0520: ...
RE_COMPILER_ERROR = re.compile(r'"(.+?)",\s*line\s+(\d+):\s+(E\d+):\s+(.+)')
RE_COMPILER_WARNING = re.compile(r'"(.+?)",\s*line\s+(\d+):\s+(W\d+):\s+(.+)')
# Linker fatal: F0553: ...
RE_LINKER_ERROR = re.compile(r'^\s*(F\d+):\s+(.+)', re.MULTILINE)
# Linker warning: W0561: ...
RE_LINKER_WARNING = re.compile(r'^\s*(W\d+):\s+(.+)', re.MULTILINE)
# Summary line: "3 Error(s), 1 Warning(s)"
RE_SUMMARY = re.compile(r'(\d+)\s+Error\(s\),\s+(\d+)\s+Warning\(s\)')


@dataclass
class BuildDiagnostic:
    file: str = ""
    line: int = 0
    code: str = ""
    message: str = ""
    severity: str = "error"  # "error" | "warning"

    def to_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "line": self.line,
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
        }


@dataclass
class BuildResult:
    success: bool = False
    exit_code: int = -1
    duration_ms: int = 0
    errors: list[BuildDiagnostic] = field(default_factory=list)
    warnings: list[BuildDiagnostic] = field(default_factory=list)
    output: str = ""
    output_file: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "exitCode": self.exit_code,
            "durationMs": self.duration_ms,
            "totalErrors": len(self.errors),
            "totalWarnings": len(self.warnings),
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [w.to_dict() for w in self.warnings],
            "outputFile": self.output_file,
            "output": self.output[-4000:] if len(self.output) > 4000 else self.output,
        }


def parse_build_output(output: str) -> tuple[list[BuildDiagnostic], list[BuildDiagnostic]]:
    """Parse CCRX compiler/linker output for errors and warnings."""
    errors: list[BuildDiagnostic] = []
    warnings: list[BuildDiagnostic] = []

    for m in RE_COMPILER_ERROR.finditer(output):
        errors.append(BuildDiagnostic(
            file=m.group(1), line=int(m.group(2)),
            code=m.group(3), message=m.group(4), severity="error",
        ))

    for m in RE_COMPILER_WARNING.finditer(output):
        warnings.append(BuildDiagnostic(
            file=m.group(1), line=int(m.group(2)),
            code=m.group(3), message=m.group(4), severity="warning",
        ))

    for m in RE_LINKER_ERROR.finditer(output):
        errors.append(BuildDiagnostic(
            code=m.group(1), message=m.group(2), severity="error",
        ))

    for m in RE_LINKER_WARNING.finditer(output):
        # Avoid double-matching compiler warnings that also match W\d+
        code = m.group(1)
        msg = m.group(2)
        if not any(w.code == code and w.message == msg for w in warnings):
            warnings.append(BuildDiagnostic(
                code=code, message=msg, severity="warning",
            ))

    return errors, warnings


def _find_output_file(project_path: Path, config: str) -> str:
    """Find .mot output file in build directory."""
    build_dir = project_path / config
    if build_dir.exists():
        for f in build_dir.glob("*.mot"):
            return str(f)
    return ""


def _run_make(project_path: Path, config: str, target: str, make_cmd: str) -> BuildResult:
    """Run build via make."""
    build_dir = project_path / config
    if not build_dir.exists():
        return BuildResult(
            success=False, output=f"Build directory not found: {build_dir}",
        )

    cmd = [make_cmd, "-C", str(build_dir), target]
    t0 = time.monotonic()

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=str(project_path),
        )
        duration = int((time.monotonic() - t0) * 1000)
        combined = proc.stdout + "\n" + proc.stderr
        errors, warnings = parse_build_output(combined)

        return BuildResult(
            success=proc.returncode == 0,
            exit_code=proc.returncode,
            duration_ms=duration,
            errors=errors,
            warnings=warnings,
            output=combined,
            output_file=_find_output_file(project_path, config) if proc.returncode == 0 else "",
        )
    except subprocess.TimeoutExpired:
        duration = int((time.monotonic() - t0) * 1000)
        return BuildResult(
            success=False, duration_ms=duration,
            output="Build timed out after 300 seconds",
        )
    except FileNotFoundError:
        return BuildResult(
            success=False,
            output=f"make not found. Tried: {make_cmd}. Set toolchain.makePath in config.",
        )


def _run_e2studioc(
    project_path: Path,
    project_name: str,
    config: str,
    e2studioc: Path,
    workspace: Path,
    clean_build: bool = False,
) -> BuildResult:
    """Run build via e2studioc headless CLI."""
    if not e2studioc.exists():
        return BuildResult(
            success=False,
            output=f"e2studioc not found at: {e2studioc}",
        )

    action = "-cleanBuild" if clean_build else "-build"
    cmd = [
        str(e2studioc),
        "--launcher.suppressErrors",
        "-nosplash",
        "-application", "org.eclipse.cdt.managedbuilder.core.headlessbuild",
        "-data", str(workspace),
        action, f"{project_name}/{config}",
    ]

    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
        duration = int((time.monotonic() - t0) * 1000)
        combined = proc.stdout + "\n" + proc.stderr
        errors, warnings = parse_build_output(combined)

        return BuildResult(
            success=proc.returncode == 0,
            exit_code=proc.returncode,
            duration_ms=duration,
            errors=errors,
            warnings=warnings,
            output=combined,
            output_file=_find_output_file(project_path, config) if proc.returncode == 0 else "",
        )
    except subprocess.TimeoutExpired:
        duration = int((time.monotonic() - t0) * 1000)
        return BuildResult(
            success=False, duration_ms=duration,
            output="e2studioc build timed out after 600 seconds",
        )


# ─── Public API ───────────────────────────────────────────────

# Store last build output for get_build_status
_last_build_output: dict[str, BuildResult] = {}


def build_project(
    cfg: Config,
    project: str | None = None,
    config: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """Build a project. Returns JSON-serializable result."""
    proj_name = project or cfg.default_project
    build_cfg = config or cfg.build_config
    build_mode = mode or cfg.build_mode
    proj_path = cfg.get_project_path(proj_name)

    if build_mode == "e2studioc":
        result = _run_e2studioc(
            proj_path, proj_name, build_cfg,
            cfg.get_e2studioc(), cfg.workspace_path,
        )
    else:
        result = _run_make(proj_path, build_cfg, "all", cfg.get_make())

    _last_build_output[proj_name] = result
    return result.to_dict()


def clean_project(
    cfg: Config,
    project: str | None = None,
    config: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """Clean a project build directory."""
    proj_name = project or cfg.default_project
    build_cfg = config or cfg.build_config
    build_mode = mode or cfg.build_mode
    proj_path = cfg.get_project_path(proj_name)

    if build_mode == "e2studioc":
        result = _run_e2studioc(
            proj_path, proj_name, build_cfg,
            cfg.get_e2studioc(), cfg.workspace_path,
            clean_build=True,
        )
    else:
        result = _run_make(proj_path, build_cfg, "clean", cfg.get_make())

    return result.to_dict()


def rebuild_project(
    cfg: Config,
    project: str | None = None,
    config: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """Clean and rebuild a project."""
    clean_result = clean_project(cfg, project, config, mode)
    build_result = build_project(cfg, project, config, mode)

    # Merge: keep build result, prepend clean output
    build_result["cleanOutput"] = clean_result.get("output", "")
    build_result["cleanSuccess"] = clean_result.get("success", False)
    return build_result


def get_build_status(cfg: Config, project: str | None = None) -> dict[str, Any]:
    """Get status of last build (errors/warnings parsed from output)."""
    proj_name = project or cfg.default_project
    result = _last_build_output.get(proj_name)

    if result is None:
        return {
            "project": proj_name,
            "hasBuild": False,
            "message": "No build has been run yet for this project.",
        }

    return {
        "project": proj_name,
        "hasBuild": True,
        "success": result.success,
        "totalErrors": len(result.errors),
        "totalWarnings": len(result.warnings),
        "errors": [e.to_dict() for e in result.errors],
        "warnings": [w.to_dict() for w in result.warnings],
        "durationMs": result.duration_ms,
    }
