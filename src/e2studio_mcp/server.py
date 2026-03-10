"""e2studio-mcp — MCP server for controlling e2 Studio / Renesas RX from VS Code.

Usage:
    py -3 -m e2studio_mcp.server
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .config import load_config, Config
from . import adm as adm_mod
from . import build as build_mod
from . import project as project_mod
from . import mapfile as mapfile_mod
from . import flash as flash_mod

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


# ─── Helpers ──────────────────────────────────────────────────

def _resolve_device_capacities(proj_path: Path) -> tuple[int, int, int]:
    """Resolve ROM/RAM/DataFlash capacities for a project.

    Reads the project's .cproject to get the actual device name,
    then looks it up in cfg.devices (also tries stripping _DUAL suffix).
    Falls back to global flash.device config.
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
        device_info = cfg.get_device_info()  # fallback to global flash.device

    rom_cap = device_info.rom_size if device_info else 2097152
    ram_cap = device_info.ram_size if device_info else 655360
    df_cap = device_info.data_flash_size if device_info else 32768
    return rom_cap, ram_cap, df_cap


# ═══════════════════════════════════════════════════════════════
# BUILD TOOLS
# ═══════════════════════════════════════════════════════════════

@mcp.tool()
def build_project(
    project: str = "",
    config: str = "",
    mode: str = "",
) -> dict:
    """Build an e2 Studio project using make or e2studioc.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)
        mode: Build backend - "make" or "e2studioc" (default: from config)

    Returns:
        Build result with success status, errors, warnings, duration, and output file path.
    """
    return build_mod.build_project(
        cfg,
        project=project or None,
        config=config or None,
        mode=mode or None,
    )


@mcp.tool()
def clean_project(
    project: str = "",
    config: str = "",
    mode: str = "",
) -> dict:
    """Clean build artifacts for an e2 Studio project.

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)
        mode: Build backend - "make" or "e2studioc" (default: from config)

    Returns:
        Clean result with success status and output.
    """
    return build_mod.clean_project(
        cfg,
        project=project or None,
        config=config or None,
        mode=mode or None,
    )


@mcp.tool()
def rebuild_project(
    project: str = "",
    config: str = "",
    mode: str = "",
) -> dict:
    """Clean and rebuild an e2 Studio project (clean + build).

    Args:
        project: Project name (default: headc-fw)
        config: Build configuration (default: HardwareDebug)
        mode: Build backend - "make" or "e2studioc" (default: from config)

    Returns:
        Combined clean + build result.
    """
    return build_mod.rebuild_project(
        cfg,
        project=project or None,
        config=config or None,
        mode=mode or None,
    )


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
def flash_firmware(
    project: str = "",
    file: str = "",
    erase_data_flash: bool = False,
) -> dict:
    """Flash firmware (.mot) to target via E2 Lite debugger.

    Starts e2-server-gdb, connects via direct RSP (GDB Remote Serial Protocol),
    writes flash memory using M-packets from the parsed .mot S-Record file,
    verifies via read-back, and disconnects.

    Args:
        project: Project name (default: headc-fw)
        file: Path to .mot file (default: auto-detect in HardwareDebug/)
        erase_data_flash: Whether to erase data flash before programming

    Returns:
        Flash result with success, bytesWritten, chunksWritten, verified, durationMs.
    """
    return flash_mod.flash_firmware(
        cfg,
        project=project or None,
        file=file or None,
        erase_data_flash=erase_data_flash,
    )


@mcp.tool()
def debug_connect(project: str = "", launch_file: str = "") -> dict:
    """Start e2-server-gdb and prepare for debugging/flashing.

    Parses the project's .launch file for device-specific parameters.
    The server stays running until debug_disconnect is called.

    Args:
        project: Project name (default: headc-fw). Determines .launch file and device config.
        launch_file: Specific .launch file name (default: auto-detect *HardwareDebug*)

    Returns:
        Connection status with port, device, project, and server PID.
    """
    return flash_mod.debug_connect(
        cfg, project=project or None, launch_file=launch_file or None,
    )


@mcp.tool()
def debug_disconnect() -> dict:
    """Stop the e2-server-gdb debug session.

    Terminates the GDB server process started by debug_connect.

    Returns:
        Disconnection confirmation.
    """
    return flash_mod.debug_disconnect(cfg)


@mcp.tool()
def debug_status() -> dict:
    """Check the status of the E2 Lite debug session.

    Reports whether e2-server-gdb is running and connected.

    Returns:
        Debug session status with server/GDB state, device, and port.
    """
    return flash_mod.debug_status(cfg)


@mcp.tool()
def get_adm_log(
    port: int = 0,
    wait_seconds: int = 5,
    duration_ms: int = 1000,
    poll_ms: int = 250,
    max_bytes: int = 8192,
) -> dict:
    """Capture a snapshot of the ADM virtual console output.

    Reads the target's SimulatedIO/ADM buffer exposed by e2-server-gdb.
    If there is an active MCP-managed debug session, it reuses that PID to
    locate the ADM port. Otherwise it auto-detects any running e2-server-gdb.

    Args:
        port: Explicit ADM port (default: auto-detect)
        wait_seconds: Time to wait for ADM port detection (default: 5)
        duration_ms: How long to poll for new output (default: 1000)
        poll_ms: Poll interval in milliseconds (default: 250)
        max_bytes: Maximum bytes to return before truncating (default: 8192)

    Returns:
        Snapshot with text, port, bytesRead, durationMs, and truncation state.
    """
    session = getattr(flash_mod, "_session", None)
    session_pid = None
    gdb_port = cfg.flash.gdb_port
    resolved_port = port or None
    if session and session.server_running and session.server_process:
        session_pid = session.server_process.pid
        gdb_port = session.gdb_port
        if resolved_port is None:
            resolved_port = flash_mod.ensure_adm_interface(session)

    return adm_mod.read_adm_log(
        port=resolved_port,
        pid=session_pid,
        wait_seconds=wait_seconds,
        duration_ms=duration_ms,
        poll_ms=poll_ms,
        max_bytes=max_bytes,
        gdb_port=gdb_port,
    )


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


# ─── Entry point ──────────────────────────────────────────────

def main():
    """Run the MCP server."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
