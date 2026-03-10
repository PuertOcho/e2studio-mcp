"""Flash/Debug management via e2-server-gdb + direct RSP (E2 Lite).

Parses .launch files from e2 Studio projects for per-project debug config.
Uses direct GDB Remote Serial Protocol (RSP) for flash programming,
bypassing rx-elf-gdb register-read limitation with Renesas servers.
"""

from __future__ import annotations

import codecs
import os
import re
import socket
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from .config import Config
from .project import parse_cproject


# --- Data models -------------------------------------------------

@dataclass
class LaunchConfig:
    """Debug parameters parsed from an e2 Studio .launch XML file."""
    server_params: str = ""
    device: str = ""
    gdb_name: str = "rx-elf-gdb"
    gdb_flags: str = ""
    port: int = 61234
    init_commands: list[str] = field(default_factory=list)
    source_file: str = ""


@dataclass
class DebugSession:
    """Tracks a running e2-server-gdb session."""
    server_process: subprocess.Popen | None = None
    rsp_socket: socket.socket | None = None
    gdb_port: int = 61234
    device: str = ""
    project: str = ""
    connected: bool = False
    launch_cfg: LaunchConfig | None = None

    @property
    def server_running(self) -> bool:
        if self.server_process is None:
            return False
        return self.server_process.poll() is None


_session: DebugSession | None = None


# --- .launch file parsing ----------------------------------------

def parse_launch_file(launch_path: Path) -> LaunchConfig:
    """Parse an e2 Studio .launch XML file to extract debug parameters."""
    tree = ElementTree.parse(launch_path)
    root = tree.getroot()
    cfg = LaunchConfig(source_file=str(launch_path))

    for elem in root:
        key = elem.get("key", "")
        value = elem.get("value", "")
        if key == "com.renesas.cdt.core.serverParam":
            cfg.server_params = value
        elif key == "com.renesas.cdt.core.targetDevice":
            cfg.device = value
        elif key == "com.renesas.cdt.core.portNumber":
            try:
                cfg.port = int(value)
            except ValueError:
                pass
        elif key == "com.renesas.cdt.core.optionInitCommands":
            # ElementTree decodes &#10; to \n automatically
            cmds = [c.strip() for c in value.split("\n") if c.strip()]
            cfg.init_commands = cmds
        elif key == "org.eclipse.cdt.dsf.gdb.DEBUG_NAME":
            # e.g. "rx-elf-gdb -rx-force-v2"
            parts = value.split(maxsplit=1)
            cfg.gdb_name = parts[0] if parts else "rx-elf-gdb"
            cfg.gdb_flags = parts[1] if len(parts) > 1 else ""

    if not cfg.device and cfg.server_params:
        m = re.search(r"-t\s+(\S+)", cfg.server_params)
        if m:
            cfg.device = m.group(1)

    return cfg


def find_launch_file(
    project_path: Path, prefer_name: str | None = None,
) -> Path | None:
    """Find a .launch file in a project directory.

    Priority: prefer_name > *HardwareDebug* > *NO BORRA* > first found.
    """
    launch_files = sorted(project_path.glob("*.launch"))
    if not launch_files:
        return None

    if prefer_name:
        for f in launch_files:
            if f.name == prefer_name:
                return f

    for f in launch_files:
        if "HardwareDebug" in f.name:
            return f

    for f in launch_files:
        if "NO BORRA" in f.name:
            return f

    return launch_files[0]


# --- Path resolution ---------------------------------------------

def _get_debug_tools_dir(cfg: Config) -> Path | None:
    """Locate DebugComp/RX directory with e2-server-gdb and rx-elf-gdb.

    Search order:
    1. flash.debugToolsPath from JSON config
    2. ~/.eclipse/com.renesas.platform_*/DebugComp/RX/
    3. e2studioPath/../DebugComp/RX/
    """
    if cfg.flash.debug_tools_path:
        p = Path(cfg.flash.debug_tools_path)
        if (p / "e2-server-gdb.exe").exists():
            return p

    eclipse_dir = Path.home() / ".eclipse"
    if eclipse_dir.exists():
        for d in sorted(eclipse_dir.iterdir(), reverse=True):
            if d.name.startswith("com.renesas.platform_") and d.is_dir():
                candidate = d / "DebugComp" / "RX"
                if (candidate / "e2-server-gdb.exe").exists():
                    return candidate

    e2_root = Path(cfg.toolchain.e2studio_path)
    candidate = e2_root.parent / "DebugComp" / "RX"
    if (candidate / "e2-server-gdb.exe").exists():
        return candidate

    return None


def _get_python3_bin_dir(cfg: Config) -> Path | None:
    """Find Python3 DLLs directory needed by rx-elf-gdb."""
    if cfg.flash.python3_bin_path:
        p = Path(cfg.flash.python3_bin_path)
        if p.exists():
            return p

    plugins_dir = Path(cfg.toolchain.e2studio_path) / "plugins"
    if plugins_dir.exists():
        for d in sorted(plugins_dir.iterdir(), reverse=True):
            if d.name.startswith("com.renesas.python3.") and d.is_dir():
                bin_dir = d / "bin"
                if bin_dir.exists():
                    return bin_dir

    return None


def _build_gdb_env(cfg: Config, tools_dir: Path) -> dict[str, str]:
    """Build environment for rx-elf-gdb with required DLL paths."""
    env = os.environ.copy()
    extra = [str(tools_dir)]
    py3 = _get_python3_bin_dir(cfg)
    if py3:
        extra.append(str(py3))
    env["PATH"] = ";".join(extra) + ";" + env.get("PATH", "")
    return env


def _fallback_launch_config(cfg: Config) -> LaunchConfig:
    """Build LaunchConfig from global flash config (no .launch file)."""
    fc = cfg.flash
    params = (
        f"-g {fc.debugger} -t {fc.device}"
        f" -uConnectionTimeout= 30"
        f' -uInputClock= "{fc.input_clock}"'
        f' -uIdCode= "{fc.id_code}"'
        f' -uWorkRamAddress= "1000"'
        f' -uhookWorkRamAddr= "0x3fdd0"'
        f' -uhookWorkRamSize= "0x230"'
    )
    return LaunchConfig(
        server_params=params,
        device=fc.device,
        gdb_name=fc.gdb_executable,
        port=fc.gdb_port,
    )


def _normalize_device_name(device: str) -> str:
    """Normalize device names for compatibility checks."""
    return re.sub(r"[^A-Z0-9]", "", device.upper())


def _devices_compatible(configured_device: str, project_device: str) -> bool:
    """Treat package suffixes and markers like _DUAL as compatible variants."""
    if not configured_device or not project_device:
        return True

    configured = _normalize_device_name(configured_device)
    project = _normalize_device_name(project_device)
    return configured.startswith(project) or project.startswith(configured)


def _get_project_device(project_path: Path) -> str:
    """Read the device declared by the project's .cproject file."""
    cproject_path = project_path / ".cproject"
    if not cproject_path.exists():
        return ""

    try:
        return parse_cproject(cproject_path).device
    except Exception:
        return ""


def _resolve_launch_config(
    cfg: Config,
    project_path: Path,
    project_name: str,
    launch_file: str | None = None,
) -> tuple[LaunchConfig | None, str | None]:
    """Resolve launch configuration, rejecting unsafe cross-target fallbacks."""
    launch_path = find_launch_file(project_path, launch_file)
    if launch_path:
        return parse_launch_file(launch_path), None

    project_device = _get_project_device(project_path)
    if project_device and not _devices_compatible(cfg.flash.device, project_device):
        return None, (
            f"No .launch file found for project '{project_name}'. "
            f"Fallback flash config targets '{cfg.flash.device}', "
            f"but the project device is '{project_device}'. "
            "Add/select a project .launch file or update flash.device to match before debug/flash."
        )

    return _fallback_launch_config(cfg), None


# --- RSP (GDB Remote Serial Protocol) client --------------------

_RSP_MAX_DATA = 1024  # Max data bytes per M-packet (hex = 2x this)
_ADM_START_COMMAND = "start_interface,ADM,main"
_ADM_START_RESPONSE_RE = re.compile(r"^main,(\d+)\s*$")


def _rsp_checksum(data: str) -> int:
    """Compute GDB RSP packet checksum (sum of chars mod 256)."""
    return sum(ord(c) for c in data) & 0xFF


def _rsp_send(sock: socket.socket, payload: str, timeout: float = 5.0) -> str:
    """Send an RSP packet ``$payload#xx`` and return the raw response."""
    packet = f"${payload}#{_rsp_checksum(payload):02x}"
    sock.sendall(packet.encode("ascii"))
    sock.settimeout(timeout)
    buf = b""
    try:
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
            text = buf.decode("ascii", errors="replace").lstrip("+-")
            if "#" in text:
                idx = text.rfind("#")
                if len(text) >= idx + 3:  # checksum is 2 hex digits
                    break
    except socket.timeout:
        pass
    return buf.decode("ascii", errors="replace")


def _rsp_extract(response: str) -> str:
    """Extract payload from ``$payload#xx``. Returns raw text on failure."""
    text = response.lstrip("+-")
    if text.startswith("$"):
        end = text.find("#")
        if end > 0:
            return text[1:end]
    return text


def _rsp_monitor(sock: socket.socket, cmd: str, timeout: float = 5.0) -> str:
    """Execute ``monitor <cmd>`` via RSP ``qRcmd`` and return result."""
    hex_cmd = codecs.encode(cmd.encode("ascii"), "hex").decode("ascii")
    resp = _rsp_send(sock, f"qRcmd,{hex_cmd}", timeout)
    return _rsp_extract(resp)


def _prepare_debug_init_commands(launch_cfg: LaunchConfig) -> list[str]:
    """Return monitor commands needed to initialize a debug session.

    e2 Studio's VS Code flow enables the ADM virtual console explicitly.
    The .launch files used by this MCP backend do not currently include that
    command, so append it here when absent.
    """
    commands = [
        cmd.removeprefix("monitor ").strip()
        for cmd in launch_cfg.init_commands
        if cmd.strip()
    ]
    if _ADM_START_COMMAND not in commands:
        commands.append(_ADM_START_COMMAND)
    return commands


def _decode_monitor_hex_text(response: str) -> str:
    """Decode hex-encoded monitor output returned by qRcmd."""
    if not response:
        return ""
    try:
        return bytes.fromhex(response).decode("utf-8", errors="replace")
    except ValueError:
        return response


def _extract_adm_port(response: str) -> int | None:
    """Extract the ADM port from a ``start_interface,ADM,main`` response."""
    text = _decode_monitor_hex_text(response)
    match = _ADM_START_RESPONSE_RE.match(text)
    if not match:
        return None
    return int(match.group(1))


def _open_rsp_socket(
    port: int,
    timeout: float = 10.0,
    attempts: int = 10,
    retry_delay: float = 0.5,
) -> socket.socket:
    """Open an RSP TCP socket with a short retry window for server startup."""
    last_error: OSError | None = None
    for _ in range(max(attempts, 1)):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect(("localhost", port))
            try:
                sock.settimeout(1.0)
                sock.recv(256)
            except socket.timeout:
                pass
            finally:
                sock.settimeout(timeout)
            return sock
        except OSError as exc:
            sock.close()
            last_error = exc
            time.sleep(retry_delay)
    if last_error is None:
        last_error = ConnectionRefusedError(f"Cannot connect to e2-server-gdb on port {port}")
    raise last_error


def _initialize_debug_session(
    port: int,
    launch_cfg: LaunchConfig,
) -> tuple[socket.socket, list[str]]:
    """Connect to e2-server-gdb, run init commands, and keep the socket alive."""
    log: list[str] = []
    sock = _open_rsp_socket(port)
    try:
        for cmd in _prepare_debug_init_commands(launch_cfg):
            result = _rsp_monitor(sock, cmd)
            log.append(f"monitor {cmd}: {result}")
    except Exception:
        sock.close()
        raise
    return sock, log


def ensure_adm_interface(session: DebugSession) -> int | None:
    """Ensure the ADM interface is open for the active debug session."""
    if session.rsp_socket is None:
        return None
    response = _rsp_monitor(session.rsp_socket, _ADM_START_COMMAND)
    return _extract_adm_port(response)


def _parse_mot_file(mot_path: Path) -> list[tuple[int, bytes]]:
    """Parse Motorola S-Record (.mot) file into ``(address, data)`` list.

    Supports S1 (16-bit), S2 (24-bit), and S3 (32-bit) records.
    Contiguous records are coalesced into larger chunks for efficiency.
    """
    raw: list[tuple[int, bytes]] = []
    addr_bytes = {"S1": 2, "S2": 3, "S3": 4}

    with open(mot_path, "r") as f:
        for line in f:
            line = line.strip()
            rtype = line[:2]
            if rtype not in addr_bytes:
                continue
            ab = addr_bytes[rtype]
            byte_count = int(line[2:4], 16)
            addr_end = 4 + ab * 2
            address = int(line[4:addr_end], 16)
            data_len = byte_count - ab - 1  # minus addr and checksum
            data_hex = line[addr_end : addr_end + data_len * 2]
            raw.append((address, bytes.fromhex(data_hex)))

    if not raw:
        return []

    # Coalesce contiguous records (up to _RSP_MAX_DATA bytes per chunk)
    raw.sort(key=lambda r: r[0])
    merged: list[tuple[int, bytearray]] = []
    for addr, data in raw:
        if merged:
            prev_addr, prev_data = merged[-1]
            if addr == prev_addr + len(prev_data) and len(prev_data) + len(data) <= _RSP_MAX_DATA:
                prev_data.extend(data)
                continue
        merged.append((addr, bytearray(data)))

    return [(a, bytes(d)) for a, d in merged]


def _flash_via_rsp(
    sock: socket.socket,
    mot_path: Path,
    init_commands: list[str],
    erase_data_flash: bool = False,
) -> dict[str, Any]:
    """Flash firmware via direct RSP protocol over TCP to e2-server-gdb.

    Sequence: NoAckMode → init commands → reset → M-packet writes → verify.
    """
    log: list[str] = []

    # 1. NoAckMode — disables +/- ack for speed
    payload = _rsp_extract(_rsp_send(sock, "QStartNoAckMode"))
    log.append(f"NoAckMode: {payload}")

    # 2. Init commands from .launch (set_internal_mem_overwrite, force_rtos_off, …)
    for cmd in init_commands:
        bare = cmd.removeprefix("monitor ").strip()
        result = _rsp_monitor(sock, bare)
        log.append(f"monitor {bare}: {result}")

    # 3. Reset
    log.append(f"monitor reset: {_rsp_monitor(sock, 'reset')}")

    if erase_data_flash:
        log.append(f"monitor erase_data_flash: {_rsp_monitor(sock, 'erase_data_flash')}")

    # 4. Parse .mot
    records = _parse_mot_file(mot_path)
    if not records:
        return {"success": False, "error": "No data records in .mot file", "log": log}

    total_bytes = sum(len(d) for _, d in records)
    log.append(f"Parsed {len(records)} chunks ({total_bytes} bytes) from {mot_path.name}")

    # 5. Write via M packets
    written = 0
    errors = 0
    for addr, data in records:
        hex_data = data.hex()
        resp = _rsp_extract(_rsp_send(sock, f"M{addr:x},{len(data):x}:{hex_data}", timeout=10.0))
        if resp == "OK":
            written += len(data)
        else:
            errors += 1
            if errors <= 5:
                log.append(f"Write error at 0x{addr:08X}: {resp}")
            if errors > 50:
                log.append("Too many write errors, aborting")
                break

    # 6. Verify first and last chunk via read-back
    verify_ok = True
    for idx in (0, len(records) - 1):
        addr, expected = records[idx]
        # Verify first 32 bytes of each chunk (speed vs thoroughness)
        vlen = min(len(expected), 32)
        actual = _rsp_extract(_rsp_send(sock, f"m{addr:x},{vlen:x}"))
        if actual != expected[:vlen].hex():
            verify_ok = False
            log.append(f"Verify FAIL at 0x{addr:08X}: got {actual[:32]}…")

    if verify_ok:
        log.append("Verification OK (first + last chunk)")

    return {
        "success": errors == 0 and verify_ok,
        "chunksWritten": len(records) - errors,
        "chunksTotal": len(records),
        "bytesWritten": written,
        "bytesTotal": total_bytes,
        "writeErrors": errors,
        "verified": verify_ok,
        "log": log,
    }


# --- Debug session management ------------------------------------

def debug_connect(
    cfg: Config,
    project: str | None = None,
    launch_file: str | None = None,
) -> dict[str, Any]:
    """Start e2-server-gdb for a project.

    Parses the project's .launch file for device-specific parameters.
    Falls back to global flash config if no .launch file exists.
    """
    global _session

    if _session and _session.server_running:
        return {
            "connected": True,
            "port": _session.gdb_port,
            "device": _session.device,
            "project": _session.project,
            "message": "Already connected. Call debug_disconnect first.",
        }

    tools_dir = _get_debug_tools_dir(cfg)
    if tools_dir is None:
        return {
            "connected": False,
            "error": "Cannot find e2-server-gdb. Set flash.debugToolsPath in config.",
        }

    server_exe = tools_dir / "e2-server-gdb.exe"
    proj_name = project or cfg.default_project
    proj_path = cfg.get_project_path(proj_name)

    launch_cfg, launch_error = _resolve_launch_config(
        cfg,
        proj_path,
        proj_name,
        launch_file,
    )
    if launch_error:
        return {
            "connected": False,
            "error": launch_error,
        }

    assert launch_cfg is not None
    port = launch_cfg.port

    # On Windows pass as string for correct argument quoting (matches e2 Studio)
    cmd_str = f'"{server_exe}" {launch_cfg.server_params} -p {port}'

    try:
        proc = subprocess.Popen(
            cmd_str,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(tools_dir),  # needed for rxv2v3-regset
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

        time.sleep(3)

        if proc.poll() is not None:
            stdout = (
                proc.stdout.read().decode(errors="replace") if proc.stdout else ""
            )
            stderr = (
                proc.stderr.read().decode(errors="replace") if proc.stderr else ""
            )
            return {
                "connected": False,
                "error": f"e2-server-gdb exited (rc={proc.returncode})",
                "output": (stdout + stderr).strip()[-1500:],
            }

        _session = DebugSession(
            server_process=proc,
            gdb_port=port,
            device=launch_cfg.device,
            project=proj_name,
            connected=True,
            launch_cfg=launch_cfg,
        )

        try:
            rsp_socket, init_log = _initialize_debug_session(port, launch_cfg)
            _session.rsp_socket = rsp_socket
        except Exception as e:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                pass
            _session = None
            return {
                "connected": False,
                "error": f"Failed to initialize debug session: {e}",
            }

        return {
            "connected": True,
            "port": port,
            "device": launch_cfg.device,
            "project": proj_name,
            "pid": proc.pid,
            "launchFile": launch_cfg.source_file or None,
            "initLog": init_log,
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
        if _session and _session.rsp_socket:
            try:
                _session.rsp_socket.close()
            except OSError:
                pass
        _session = None
        return {"disconnected": True, "message": "No active session"}

    try:
        if _session.rsp_socket:
            try:
                _session.rsp_socket.close()
            except OSError:
                pass
        _session.server_process.terminate()
        _session.server_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _session.server_process.kill()
    except Exception:
        pass

    result = {"disconnected": True, "project": _session.project}
    _session = None
    return result


def debug_status(cfg: Config) -> dict[str, Any]:
    """Check status of debug session."""
    if _session is None:
        return {"serverRunning": False, "gdbConnected": False}

    return {
        "serverRunning": _session.server_running,
        "gdbConnected": _session.connected,
        "device": _session.device,
        "port": _session.gdb_port,
        "project": _session.project,
    }


# --- Flash firmware ----------------------------------------------

def flash_firmware(
    cfg: Config,
    project: str | None = None,
    file: str | None = None,
    erase_data_flash: bool = False,
    build_config: str | None = None,
    launch_file: str | None = None,
) -> dict[str, Any]:
    """Flash firmware (.mot) to target via e2-server-gdb + direct RSP.

    1. Start e2-server-gdb (with project-specific params from .launch)
    2. Connect via TCP socket using GDB Remote Serial Protocol
    3. Send init commands + M (memory write) packets from parsed .mot
    4. Verify via read-back and disconnect
    """
    mot_path = _find_firmware_file(cfg, project, file, build_config)
    if mot_path is None:
        return {
            "success": False,
            "error": "No .mot file found. Build the project first.",
        }

    connect_result = debug_connect(cfg, project=project, launch_file=launch_file)
    if not connect_result.get("connected"):
        return {
            "success": False,
            "error": f"Connect failed: {connect_result.get('error')}",
        }

    port = _session.gdb_port if _session else cfg.flash.gdb_port
    launch_cfg = _session.launch_cfg if _session else None
    init_commands = (launch_cfg.init_commands if launch_cfg else []) or []

    t0 = time.monotonic()
    sock = None
    uses_session_socket = False
    try:
        if _session and _session.rsp_socket is not None:
            sock = _session.rsp_socket
            uses_session_socket = True
        else:
            sock = _open_rsp_socket(port)

        result = _flash_via_rsp(sock, mot_path, init_commands, erase_data_flash)
        result["durationMs"] = int((time.monotonic() - t0) * 1000)
        result["flashedFile"] = str(mot_path)
        result["device"] = _session.device if _session else ""
        result["project"] = _session.project if _session else ""
        return result

    except socket.timeout:
        return {
            "success": False,
            "durationMs": int((time.monotonic() - t0) * 1000),
            "error": "RSP connection timed out",
        }
    except ConnectionRefusedError:
        return {
            "success": False,
            "error": f"Cannot connect to e2-server-gdb on port {port}",
        }
    except Exception as e:
        return {"success": False, "error": f"Flash failed: {e}"}
    finally:
        if sock and not uses_session_socket:
            try:
                sock.close()
            except OSError:
                pass
        debug_disconnect(cfg)


def _find_firmware_file(
    cfg: Config,
    project: str | None = None,
    file: str | None = None,
    build_config: str | None = None,
) -> Path | None:
    """Find .mot firmware file to flash."""
    if file:
        p = Path(file)
        if p.exists():
            return p

    proj_path = cfg.get_project_path(project)
    build_dir = proj_path / (build_config or cfg.build_config)
    if build_dir.exists():
        mots = list(build_dir.glob("*.mot"))
        if mots:
            return mots[0]

    return None
