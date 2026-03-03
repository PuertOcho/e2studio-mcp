"""Flash/Debug management via e2-server-gdb + rx-elf-gdb (E2 Lite)."""

from __future__ import annotations

import os
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Config


@dataclass
class DebugSession:
    """Tracks a running e2-server-gdb + rx-elf-gdb session."""
    server_process: subprocess.Popen | None = None
    gdb_port: int = 61234
    device: str = ""
    connected: bool = False

    @property
    def server_running(self) -> bool:
        if self.server_process is None:
            return False
        return self.server_process.poll() is None


# Module-level session tracker
_session: DebugSession | None = None


def _find_e2_server_gdb(cfg: Config) -> Path | None:
    """Locate e2-server-gdb executable within e2 Studio installation."""
    e2_root = Path(cfg.toolchain.e2studio_path)

    # Common locations
    candidates = [
        e2_root.parent / "DebugComp" / "e2-server-gdb.exe",
        e2_root / "e2-server-gdb.exe",
    ]

    # Also search recursively in e2 Studio install for rx-debug
    renesas_root = e2_root.parent
    if renesas_root.exists():
        for root, dirs, files in os.walk(str(renesas_root)):
            if "e2-server-gdb.exe" in files:
                return Path(root) / "e2-server-gdb.exe"

    for c in candidates:
        if c.exists():
            return c

    return None


def _find_gdb(cfg: Config) -> Path | None:
    """Locate rx-elf-gdb executable."""
    # Try in CCRX toolchain directory
    ccrx_dir = Path(cfg.toolchain.ccrx_path)
    candidates = [
        ccrx_dir / "rx-elf-gdb.exe",
        ccrx_dir.parent / "rx-elf-gdb.exe",
    ]

    # Also check e2 Studio's GDB
    e2_root = Path(cfg.toolchain.e2studio_path)
    renesas_root = e2_root.parent
    if renesas_root.exists():
        for root, dirs, files in os.walk(str(renesas_root)):
            if "rx-elf-gdb.exe" in files:
                return Path(root) / "rx-elf-gdb.exe"

    for c in candidates:
        if c.exists():
            return c

    return None


def _find_mot_file(cfg: Config, project: str | None = None, file: str | None = None) -> Path | None:
    """Find .mot firmware file to flash."""
    if file:
        p = Path(file)
        if p.exists():
            return p

    proj_path = cfg.get_project_path(project)
    build_dir = proj_path / cfg.build_config
    if build_dir.exists():
        mots = list(build_dir.glob("*.mot"))
        if mots:
            return mots[0]

    return None


def debug_connect(cfg: Config) -> dict[str, Any]:
    """Start e2-server-gdb and prepare for debugging/flashing."""
    global _session

    if _session and _session.server_running:
        return {
            "connected": True,
            "port": _session.gdb_port,
            "device": _session.device,
            "message": "Already connected",
        }

    server_path = _find_e2_server_gdb(cfg)
    if server_path is None:
        return {
            "connected": False,
            "error": "e2-server-gdb not found. Check e2 Studio installation path.",
        }

    flash_cfg = cfg.flash
    cmd = [
        str(server_path),
        "-g", flash_cfg.debugger,
        "-t", flash_cfg.device,
        f"-uConnectionTimeout=30",
        f'-uInputClock="{flash_cfg.input_clock}"',
        f'-uIdCode="{flash_cfg.id_code}"',
        f'-uWorkRamAddress="0x3fdd0"',
        f'-uhookWorkRamSize="0x230"',
        "-p", str(flash_cfg.gdb_port),
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

        # Wait a bit for server to start
        time.sleep(3)

        if proc.poll() is not None:
            stderr = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
            return {
                "connected": False,
                "error": f"e2-server-gdb exited immediately. stderr: {stderr}",
            }

        _session = DebugSession(
            server_process=proc,
            gdb_port=flash_cfg.gdb_port,
            device=flash_cfg.device,
            connected=True,
        )

        return {
            "connected": True,
            "port": flash_cfg.gdb_port,
            "device": flash_cfg.device,
            "pid": proc.pid,
        }

    except FileNotFoundError:
        return {
            "connected": False,
            "error": f"e2-server-gdb not found at: {server_path}",
        }
    except Exception as e:
        return {
            "connected": False,
            "error": f"Failed to start e2-server-gdb: {e}",
        }


def debug_disconnect(cfg: Config) -> dict[str, Any]:
    """Stop e2-server-gdb session."""
    global _session

    if _session is None or not _session.server_running:
        _session = None
        return {"disconnected": True, "message": "No active session"}

    try:
        _session.server_process.terminate()
        _session.server_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _session.server_process.kill()
    except Exception:
        pass

    _session = None
    return {"disconnected": True}


def debug_status(cfg: Config) -> dict[str, Any]:
    """Check status of debug session."""
    if _session is None:
        return {
            "serverRunning": False,
            "gdbConnected": False,
        }

    return {
        "serverRunning": _session.server_running,
        "gdbConnected": _session.connected,
        "device": _session.device,
        "port": _session.gdb_port,
    }


def flash_firmware(
    cfg: Config,
    project: str | None = None,
    file: str | None = None,
    erase_data_flash: bool = False,
) -> dict[str, Any]:
    """Flash firmware to target via e2-server-gdb + rx-elf-gdb.

    Sequence:
    1. Start e2-server-gdb if not running
    2. Connect rx-elf-gdb
    3. Load firmware
    4. Disconnect
    """
    mot_path = _find_mot_file(cfg, project, file)
    if mot_path is None:
        return {
            "success": False,
            "error": "No .mot file found. Build the project first.",
        }

    gdb_path = _find_gdb(cfg)
    if gdb_path is None:
        return {
            "success": False,
            "error": "rx-elf-gdb not found. Check toolchain installation.",
        }

    # Ensure debug server is running
    connect_result = debug_connect(cfg)
    if not connect_result.get("connected"):
        return {
            "success": False,
            "error": f"Failed to connect: {connect_result.get('error', 'unknown')}",
        }

    # Build GDB command script
    gdb_commands = [
        f"target remote localhost:{cfg.flash.gdb_port}",
        "monitor reset",
    ]

    if erase_data_flash:
        gdb_commands.append("monitor erase_data_flash")

    # Use the .mot file path with forward slashes for GDB
    mot_str = str(mot_path).replace("\\", "/")
    gdb_commands.extend([
        f'load "{mot_str}"',
        "monitor verify",
        "disconnect",
        "quit",
    ])

    gdb_script = "\n".join(gdb_commands) + "\n"

    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            [str(gdb_path), "-rx-force-v2", "-batch", "-x", "/dev/stdin"],
            input=gdb_script,
            capture_output=True,
            text=True,
            timeout=120,
        )

        # On Windows, -x /dev/stdin doesn't work. Use a temp file instead.
        if proc.returncode != 0 and os.name == "nt":
            import tempfile
            with tempfile.NamedTemporaryFile(mode="w", suffix=".gdb", delete=False) as f:
                f.write(gdb_script)
                script_path = f.name

            try:
                proc = subprocess.run(
                    [str(gdb_path), "-rx-force-v2", "-batch", "-x", script_path],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
            finally:
                os.unlink(script_path)

        duration = int((time.monotonic() - t0) * 1000)

        success = proc.returncode == 0
        return {
            "success": success,
            "durationMs": duration,
            "flashedFile": str(mot_path),
            "device": cfg.flash.device,
            "output": (proc.stdout + "\n" + proc.stderr)[-2000:],
            "exitCode": proc.returncode,
        }

    except subprocess.TimeoutExpired:
        duration = int((time.monotonic() - t0) * 1000)
        return {
            "success": False,
            "durationMs": duration,
            "error": "Flash operation timed out after 120 seconds",
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Flash failed: {e}",
        }
    finally:
        # Disconnect after flash
        debug_disconnect(cfg)
