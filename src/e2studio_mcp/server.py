"""e2studio-mcp — MCP server for controlling e2 Studio / Renesas RX from VS Code.

Usage:
    py -3 -m e2studio_mcp.server
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .config import load_config, Config
from . import adm as adm_mod
from . import build as build_mod
from . import project as project_mod
from . import mapfile as mapfile_mod
from . import bridge as bridge_mod

# ─── Bootstrap ────────────────────────────────────────────────

cfg = load_config()

mcp = FastMCP(
    "e2studio-mcp",
    instructions=(
        "MCP server for e2 Studio / Renesas RX. "
        "Provides build, project info, flash/debug, and memory analysis tools "
        f"for workspace: {cfg.workspace}"
    ),
)


# ─── Activity Log ─────────────────────────────────────────────

@dataclass
class ActivityEntry:
    """One logged MCP operation."""
    timestamp: str
    tool: str
    args: dict
    ok: bool
    summary: str
    duration_ms: int = 0


_activity_log: deque[ActivityEntry] = deque(maxlen=200)


def _log_activity(
    tool: str,
    args: dict,
    ok: bool,
    summary: str,
    duration_ms: int = 0,
) -> None:
    _activity_log.append(ActivityEntry(
        timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
        tool=tool,
        args=args,
        ok=ok,
        summary=summary,
        duration_ms=duration_ms,
    ))


# ─── Helpers ──────────────────────────────────────────────────

def _resolve_device_capacities(proj_path: Path) -> tuple[int, int, int]:
    """Resolve ROM/RAM/DataFlash capacities for a project.

    Reads the project's .cproject to get the actual device name,
    then looks it up in the built-in device table (also tries stripping _DUAL suffix).
    """
    device_name = None
    cproject = proj_path / ".cproject"
    if cproject.exists():
        try:
            pcfg = project_mod.parse_cproject(cproject)
            device_name = pcfg.device
        except Exception:
            pass

    # Try exact match, then strip _DUAL suffix
    device_info = None
    if device_name:
        device_info = cfg.get_device_info(device_name)
        if not device_info and device_name.endswith("_DUAL"):
            device_info = cfg.get_device_info(device_name.removesuffix("_DUAL"))
    if not device_info:
        device_info = cfg.get_device_info()  # fallback to first known device

    rom_cap = device_info.rom_size if device_info else 2097152
    ram_cap = device_info.ram_size if device_info else 655360
    df_cap = device_info.data_flash_size if device_info else 32768
    return rom_cap, ram_cap, df_cap


# ═══════════════════════════════════════════════════════════════
# BUILD TOOLS
# ═══════════════════════════════════════════════════════════════

def _build_via_bridge_or_standalone(
    command: str,
    project: str,
    config: str,
    mode: str,
) -> dict:
    """Try the VS Code extension bridge first, fall back to standalone make."""
    t0 = time.monotonic()

    # Try bridge (extension UI buttons)
    bridge_result = bridge_mod.call_bridge(
        cfg.workspace_path,
        command,
        {"project": project or cfg.default_project, "config": config or cfg.build_config},
    )
    if bridge_result is not None:
        ms = int((time.monotonic() - t0) * 1000)
        bridge_result["via"] = "extension"
        _log_activity(
            command,
            {"project": project or cfg.default_project, "config": config or cfg.build_config},
            bridge_result.get("success", False),
            f"via extension bridge, {bridge_result.get('errors', 0)} errors",
            ms,
        )
        return bridge_result

    # Fallback to standalone Python
    if command == "rebuild":
        result = build_mod.rebuild_project(cfg, project=project or None, config=config or None, mode=mode or None)
    elif command == "clean":
        result = build_mod.clean_project(cfg, project=project or None, config=config or None, mode=mode or None)
    else:
        result = build_mod.build_project(cfg, project=project or None, config=config or None, mode=mode or None)

    ms = int((time.monotonic() - t0) * 1000)
    result["via"] = "standalone"
    _log_activity(
        command,
        {"project": project or cfg.default_project, "config": config or cfg.build_config},
        result.get("success", False),
        f"standalone, {result.get('totalErrors', 0)} errors",
        ms,
    )
    return result


@mcp.tool()
def build_project(
    project: str = "",
    config: str = "",
    mode: str = "",
) -> dict:
    """Build an e2 Studio project.

    Routes through the VS Code extension when available (same as clicking
    the Build button), otherwise falls back to spawning make directly.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)
        mode: Build backend - "make" or "e2studioc" (default: from config)

    Returns:
        Build result with success status, errors, warnings.
    """
    return _build_via_bridge_or_standalone("build", project, config, mode)


@mcp.tool()
def clean_project(
    project: str = "",
    config: str = "",
    mode: str = "",
) -> dict:
    """Clean build artifacts for an e2 Studio project.

    Routes through the VS Code extension when available, otherwise
    falls back to spawning make directly.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)
        mode: Build backend - "make" or "e2studioc" (default: from config)

    Returns:
        Clean result with success status.
    """
    return _build_via_bridge_or_standalone("clean", project, config, mode)


@mcp.tool()
def rebuild_project(
    project: str = "",
    config: str = "",
    mode: str = "",
) -> dict:
    """Clean and rebuild an e2 Studio project (clean + build).

    Routes through the VS Code extension when available, otherwise
    falls back to spawning make directly.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)
        mode: Build backend - "make" or "e2studioc" (default: from config)

    Returns:
        Combined clean + build result.
    """
    return _build_via_bridge_or_standalone("rebuild", project, config, mode)


@mcp.tool()
def get_build_status(project: str = "") -> dict:
    """Get errors and warnings from the last build of a project.

    Args:
        project: Project name (default: headc-fw)

    Returns:
        Last build status with parsed errors and warnings from CCRX output.
    """
    return build_mod.get_build_status(cfg, project=project or None)


@mcp.tool()
def get_build_size(project: str = "", config: str = "") -> dict:
    """Get ROM/RAM/DataFlash usage from the project's .map file.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration to find .map in (default: HardwareDebug)

    Returns:
        Memory usage summary with ROM, RAM, DataFlash sizes and percentages.
    """
    proj_name = project or cfg.default_project
    build_cfg = config or cfg.build_config
    proj_path = cfg.get_project_path(proj_name)
    build_dir = proj_path / build_cfg

    # Find .map file
    map_files = list(build_dir.glob("*.map")) if build_dir.exists() else []
    if not map_files:
        return {"error": f"No .map file found in {build_dir}"}

    rom_cap, ram_cap, df_cap = _resolve_device_capacities(proj_path)

    return mapfile_mod.get_build_size(
        map_files[0],
        rom_capacity=rom_cap,
        ram_capacity=ram_cap,
        data_flash_capacity=df_cap,
    )


# ═══════════════════════════════════════════════════════════════
# PROJECT INFO TOOLS
# ═══════════════════════════════════════════════════════════════

@mcp.tool()
def list_projects() -> list[dict]:
    """List all e2 Studio projects found in the workspace.

    Scans for directories containing .cproject files and extracts
    device, toolchain, and build configuration info.

    Returns:
        List of projects with name, device, toolchain, and build status.
    """
    return project_mod.list_projects(cfg.workspace_path)


@mcp.tool()
def get_project_config(project: str = "", config: str = "") -> dict:
    """Get detailed project configuration from .cproject XML.

    Extracts device info, toolchain settings, include paths,
    preprocessor defines, compiler/linker options.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)

    Returns:
        Full project configuration parsed from .cproject XML.
    """
    proj_name = project or cfg.default_project
    build_cfg = config or cfg.build_config
    return project_mod.get_project_config(
        cfg.workspace_path, proj_name, build_cfg,
    )


@mcp.tool()
def get_map_summary(project: str = "", config: str = "") -> dict:
    """Parse the .map file and return memory section summary.

    Shows all linker sections with addresses, sizes, and ROM/RAM classification.
    Includes total ROM/RAM/DataFlash usage with percentage of capacity.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)

    Returns:
        Memory summary with sections, totals, and capacity percentages.
    """
    proj_name = project or cfg.default_project
    build_cfg = config or cfg.build_config
    proj_path = cfg.get_project_path(proj_name)
    build_dir = proj_path / build_cfg

    map_files = list(build_dir.glob("*.map")) if build_dir.exists() else []
    if not map_files:
        return {"error": f"No .map file found in {build_dir}"}

    rom_cap, ram_cap, df_cap = _resolve_device_capacities(proj_path)

    return mapfile_mod.get_map_summary(
        map_files[0],
        rom_capacity=rom_cap,
        ram_capacity=ram_cap,
        data_flash_capacity=df_cap,
    )


@mcp.tool()
def get_linker_sections(project: str = "", config: str = "") -> list[dict]:
    """Get individual linker section details from the .map file.

    Returns each section with name, start/end address, size, alignment,
    and memory region classification (ROM/RAM/DATA_FLASH/OTHER).

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)

    Returns:
        List of sections with address and size details.
    """
    proj_name = project or cfg.default_project
    build_cfg = config or cfg.build_config
    proj_path = cfg.get_project_path(proj_name)
    build_dir = proj_path / build_cfg

    map_files = list(build_dir.glob("*.map")) if build_dir.exists() else []
    if not map_files:
        return [{"error": f"No .map file found in {build_dir}"}]

    return mapfile_mod.get_linker_sections(map_files[0])


# ═══════════════════════════════════════════════════════════════
# FLASH / DEBUG TOOLS
# ═══════════════════════════════════════════════════════════════

@mcp.tool()
def debug_start(project: str = "") -> dict:
    """Start a debug session (build + flash + debug).

    Routes through the VS Code extension's debug adapter, which handles
    e2-server-gdb, flash programming, and GDB session setup — the same
    flow as clicking the Debug button in the sidebar.

    Args:
        project: Project name (default: from extension selection)

    Returns:
        Result with success status.
    """
    t0 = time.monotonic()
    args = {}
    if project:
        args["project"] = project
    result = bridge_mod.call_bridge(
        cfg.workspace_path, "debug",
        args,
        timeout=120,
    )
    ms = int((time.monotonic() - t0) * 1000)
    if result is None:
        _log_activity("debug_start", {"project": project}, False, "bridge unavailable", ms)
        return {"error": "Extension bridge not available. Open VS Code with the e2mcp extension."}
    _log_activity("debug_start", {"project": project}, result.get("success", False), "via extension", ms)
    return result


@mcp.tool()
def debug_stop() -> dict:
    """Stop the active debug session.

    Stops the Renesas hardware debug session through the VS Code extension.

    Returns:
        Result with success status.
    """
    result = bridge_mod.call_bridge(cfg.workspace_path, "stopDebug", timeout=10)
    if result is None:
        return {"error": "Extension bridge not available."}
    _log_activity("debug_stop", {}, result.get("success", False), "via extension")
    return result


@mcp.tool()
def debug_status() -> dict:
    """Check whether a debug session is currently active.

    Queries the VS Code extension for the current debug session state.

    Returns:
        Debug session status (active, session name).
    """
    result = bridge_mod.call_bridge(cfg.workspace_path, "debugStatus", timeout=5)
    if result is None:
        return {"active": False, "error": "Extension bridge not available."}
    return result


@mcp.tool()
def get_adm_log(
    port: int = 0,
    wait_seconds: int = 5,
    duration_ms: int = 1000,
    poll_ms: int = 250,
    max_bytes: int = 8192,
    tail_lines: int = 0,
    filter: str = "",
) -> dict:
    """Capture a snapshot of the ADM virtual console output.

    Reads the target's SimulatedIO/ADM buffer exposed by e2-server-gdb.
    Auto-detects any running e2-server-gdb to find the ADM port.

    Args:
        port: Explicit ADM port (default: auto-detect)
        wait_seconds: Time to wait for ADM port detection (default: 5)
        duration_ms: How long to poll for new output (default: 1000)
        poll_ms: Poll interval in milliseconds (default: 250)
        max_bytes: Maximum bytes to return before truncating (default: 8192)
        tail_lines: Return only the last N lines (0 = all)
        filter: Return only lines containing this substring (case-insensitive)

    Returns:
        Snapshot with text, port, bytesRead, durationMs, and truncation state.
    """
    def _apply_tail_filter(text: str) -> str:
        """Apply tail_lines and filter to text."""
        if not text:
            return text
        lines = text.splitlines(keepends=True)
        if filter:
            needle = filter.lower()
            lines = [l for l in lines if needle in l.lower()]
        if tail_lines > 0:
            lines = lines[-tail_lines:]
        return "".join(lines)

    # Try bridge first — the extension's ADMConsole already holds the TCP
    # connection and accumulates output in a ring buffer.
    result = bridge_mod.call_bridge(cfg.workspace_path, "getAdmLog", timeout=5)
    if result and result.get("success") and result.get("text"):
        result["text"] = _apply_tail_filter(result["text"])
        result["source"] = "bridge"
        return result

    # Try the logfile left by adm_console.py (auto-tee in --raw mode)
    logfile = cfg.workspace_path / "e2studio-mcp" / ".adm-log"
    if logfile.is_file():
        try:
            text = logfile.read_text(encoding="utf-8", errors="replace")
            text = _apply_tail_filter(text)
            return {
                "supported": True,
                "text": text,
                "source": "logfile",
                "bytesRead": len(text),
                "path": str(logfile),
            }
        except OSError:
            pass

    # Fallback to direct TCP connection
    result = adm_mod.read_adm_log(
        port=port or None,
        pid=None,
        wait_seconds=wait_seconds,
        duration_ms=duration_ms,
        poll_ms=poll_ms,
        max_bytes=max_bytes,
        gdb_port=61234,
    )
    if result.get("text"):
        result["text"] = _apply_tail_filter(result["text"])
        result["source"] = "direct"
    return result


# ═══════════════════════════════════════════════════════════════
# MCP RESOURCES
# ═══════════════════════════════════════════════════════════════

@mcp.resource("e2studio://build/log")
def resource_build_log() -> str:
    """Last build output log.

    Returns the captured stdout+stderr from the most recent build operation.
    """
    proj_name = cfg.default_project
    result = build_mod._last_build_output.get(proj_name)
    if result is None:
        return "No build has been run yet."
    return result.output


@mcp.resource("e2studio://debug/adm/log")
def resource_debug_adm_log() -> str:
    """Current ADM virtual console snapshot.

    Returns a short text snapshot from the active Renesas virtual console.
    """
    snapshot = get_adm_log(wait_seconds=2, duration_ms=750, poll_ms=250, max_bytes=8192)
    if not snapshot.get("success"):
        return f"ADM log unavailable: {snapshot.get('error', 'Unknown error')}"

    text = str(snapshot.get("text", ""))
    if not text:
        return (
            f"No ADM output captured on port {snapshot.get('port')} "
            f"after {snapshot.get('durationMs')} ms."
        )

    lines = [
        f"ADM port: {snapshot.get('port')}",
        f"Bytes: {snapshot.get('bytesRead')}",
        f"Duration: {snapshot.get('durationMs')} ms",
        "",
        text,
    ]
    if snapshot.get("truncated"):
        lines.insert(3, "Output truncated to max_bytes.")
    return "\n".join(lines)


@mcp.resource("e2studio://project/memory")
def resource_project_memory() -> str:
    """Memory usage summary from the .map file.

    Shows ROM/RAM/DataFlash usage with section breakdown table.
    """
    proj_name = cfg.default_project
    proj_path = cfg.get_project_path(proj_name)
    build_dir = proj_path / cfg.build_config

    map_files = list(build_dir.glob("*.map")) if build_dir.exists() else []
    if not map_files:
        return f"No .map file found in {build_dir}"

    try:
        summary = mapfile_mod.parse_map_file(map_files[0])
        device_info = cfg.get_device_info()
        if device_info:
            summary.rom_capacity = device_info.rom_size
            summary.ram_capacity = device_info.ram_size
            summary.data_flash_capacity = device_info.data_flash_size
        return summary.to_text()
    except Exception as e:
        return f"Error parsing map file: {e}"


@mcp.resource("e2studio://project/config")
def resource_project_config() -> str:
    """Active project configuration summary.

    Shows device, toolchain, build configuration, and include paths.
    """
    proj_name = cfg.default_project
    result = project_mod.get_project_config(
        cfg.workspace_path, proj_name, cfg.build_config,
    )
    if "error" in result:
        return f"Error: {result['error']}"

    lines = [
        f"=== Project: {result.get('name', proj_name)} ===",
        f"Device:     {result.get('device', 'N/A')}",
        f"Family:     {result.get('deviceFamily', 'N/A')}",
        f"ISA:        {result.get('isa', 'N/A')}",
        f"FPU:        {'Yes' if result.get('hasFpu') else 'No'}",
        f"Endian:     {result.get('endian', 'N/A')}",
        f"Toolchain:  {result.get('toolchainId', 'N/A')} {result.get('toolchainVersion', '')}",
        f"Config:     {result.get('buildConfig', 'N/A')}",
        f"Artifact:   {result.get('artifactName', '')}.{result.get('artifactExtension', '')}",
        f"Map File:   {result.get('mapFile', 'N/A')}",
        "",
        f"Include Paths ({len(result.get('includePaths', []))}):",
    ]
    for p in result.get("includePaths", []):
        lines.append(f"  {p}")

    if result.get("defines"):
        lines.append(f"\nDefines ({len(result['defines'])}):")
        for d in result["defines"]:
            lines.append(f"  {d}")

    return "\n".join(lines)


@mcp.resource("e2studio://activity/log")
def resource_activity_log() -> str:
    """Recent MCP operations history.

    Shows the last operations with timestamps, tool names, parameters,
    success/failure status, and duration. Useful for diagnosing issues
    and understanding what the MCP server has been doing.
    """
    if not _activity_log:
        return "No operations recorded yet."

    lines: list[str] = []
    for entry in reversed(_activity_log):
        status = "OK" if entry.ok else "FAIL"
        dur = f" ({entry.duration_ms}ms)" if entry.duration_ms else ""
        args_str = ", ".join(f"{k}={v}" for k, v in entry.args.items() if v) if entry.args else ""
        lines.append(
            f"[{entry.timestamp}] {entry.tool}({args_str}) -> {status}{dur}: {entry.summary}"
        )
    return "\n".join(lines)


# ─── Entry point ──────────────────────────────────────────────

def main():
    """Run the MCP server."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
