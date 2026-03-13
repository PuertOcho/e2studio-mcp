"""ADM SimulatedIO helpers for Renesas e2-server-gdb sessions."""

from __future__ import annotations

import csv
import io
import re
import socket
import subprocess
import time

INTERFACE = "ISimulatedIO"
CORE_NAME = "main"
DEFAULT_GDB_PORT = 61234


def adm_checksum(payload: str) -> str:
    """GDB RSP-style checksum: sum of bytes mod 256, as 2-digit lowercase hex."""
    total = 0
    for byte in payload.encode("ascii"):
        total = (total + byte) & 0xFF
    return f"{total:02x}"


def adm_build_message(function_name: str, params: str = "") -> str:
    """Build a complete ADM message: $qrenesas.ISimulatedIO:func,params#XX."""
    payload = f"qrenesas.{INTERFACE}:{function_name}"
    if params:
        payload += f",{params}"
    return f"${payload}#{adm_checksum(payload)}"


def adm_parse_response(raw: str) -> tuple[str | None, str | None]:
    """Parse an ADM response and return ``(function_name, params)``."""
    data = raw.lstrip("+")
    match = re.match(
        r"^\$([a-zA-Z0-9_.]+):([a-zA-Z0-9_]+)(?:,([^#]*?))?#([0-9a-fA-F]{2})$",
        data,
    )
    if not match:
        return None, None
    return match.group(2), match.group(3) or ""


class ADMClient:
    """Minimal ADM socket client for ISimulatedIO."""

    def __init__(
        self,
        port: int,
        host: str = "127.0.0.1",
        timeout: float = 3.0,
    ):
        self.port = port
        self.host = host
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(timeout)

    def connect(self) -> None:
        self.sock.connect((self.host, self.port))

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()

    def send_and_receive(self, message: str, timeout: float = 2.0) -> str:
        self.sock.sendall(message.encode("ascii"))
        self.sock.settimeout(timeout)
        buf = b""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk
            text = buf.decode("ascii", errors="replace")
            stripped = text.lstrip("+")
            start = stripped.find("$")
            if start >= 0:
                end = stripped.find("#", start)
                if end >= 0 and len(stripped) >= end + 3:
                    break
        return buf.decode("ascii", errors="replace")

    def call(
        self,
        function_name: str,
        params: str = "",
        timeout: float = 2.0,
    ) -> tuple[str | None, str | None]:
        raw = self.send_and_receive(
            adm_build_message(function_name, params),
            timeout=timeout,
        )
        return adm_parse_response(raw)

    def is_supported(self) -> bool:
        func, params = self.call("isSimulatedIOSupported")
        return bool(func) and params == "true"

    def enable(self) -> tuple[str | None, str | None]:
        return self.call("simulatedIOEnable")

    def disable(self) -> tuple[str | None, str | None]:
        return self.call("simulatedIODisable")

    def clear_buffer(self) -> tuple[str | None, str | None]:
        return self.call("simulatedIOClearBuffer")

    def poll_output(self, core_name: str = CORE_NAME) -> bytes:
        func, params = self.call("simulatedIOGetOutputData", core_name, timeout=1.5)
        if not func or not params:
            return b""
        parts = params.split(",", 1)
        if len(parts) != 2:
            return b""
        try:
            n_bytes = int(parts[0])
        except ValueError:
            return b""
        if n_bytes <= 0:
            return b""
        try:
            return bytes.fromhex(parts[1])
        except ValueError:
            return b""


def run_command(args: list[str]) -> str:
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        errors="ignore",
        check=False,
    )
    return result.stdout


def find_e2_server_pids() -> list[int]:
    output = run_command([
        "tasklist",
        "/FI",
        "IMAGENAME eq e2-server-gdb.exe",
        "/FO",
        "CSV",
        "/NH",
    ])
    pids: list[int] = []
    reader = csv.reader(io.StringIO(output))
    for row in reader:
        if len(row) < 2:
            continue
        if row[0].strip().lower() != "e2-server-gdb.exe":
            continue
        try:
            pids.append(int(row[1]))
        except ValueError:
            continue
    return pids


def find_listening_ports_for_pid(pid: int) -> list[int]:
    output = run_command(["netstat", "-ano", "-p", "tcp"])
    ports: set[int] = set()
    pattern = re.compile(r"^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$")
    for line in output.splitlines():
        match = pattern.match(line)
        if not match:
            continue
        local_addr = match.group(1)
        line_pid = int(match.group(2))
        if line_pid != pid:
            continue
        port_match = re.search(r":(\d+)$", local_addr)
        if port_match:
            ports.add(int(port_match.group(1)))
    return sorted(ports)


def find_adm_port_for_pid(
    pid: int,
    gdb_port: int = DEFAULT_GDB_PORT,
) -> int | None:
    candidates = [port for port in find_listening_ports_for_pid(pid) if port != gdb_port]
    return max(candidates) if candidates else None


def resolve_adm_port(
    port: int | None = None,
    pid: int | None = None,
    wait_seconds: int = 15,
    gdb_port: int = DEFAULT_GDB_PORT,
) -> tuple[int | None, int | None]:
    if port is not None:
        return pid, port

    deadline = time.time() + wait_seconds
    while time.time() <= deadline:
        candidate_pids = [pid] if pid is not None else find_e2_server_pids()
        for candidate_pid in candidate_pids:
            if candidate_pid is None:
                continue
            candidate_port = find_adm_port_for_pid(candidate_pid, gdb_port=gdb_port)
            if candidate_port is not None:
                return candidate_pid, candidate_port
        time.sleep(1)
    return pid, None


def read_adm_log(
    port: int | None = None,
    pid: int | None = None,
    wait_seconds: int = 5,
    poll_ms: int = 250,
    duration_ms: int = 1000,
    max_bytes: int = 8192,
    core_name: str = CORE_NAME,
    gdb_port: int = DEFAULT_GDB_PORT,
) -> dict[str, object]:
    """Capture a snapshot of ADM output from the active e2-server-gdb session."""
    session_pid, adm_port = resolve_adm_port(
        port=port,
        pid=pid,
        wait_seconds=wait_seconds,
        gdb_port=gdb_port,
    )
    if adm_port is None:
        return {
            "success": False,
            "error": "ADM port not found. Start a Renesas debug session first.",
            "serverPid": session_pid,
        }

    started = time.monotonic()
    poll_interval = max(poll_ms, 1) / 1000.0
    deadline = started + max(duration_ms, 0) / 1000.0
    polls = 0
    collected = bytearray()
    truncated = False

    client = ADMClient(adm_port)
    try:
        client.connect()
        supported = client.is_supported()
        client.enable()

        while True:
            chunk = client.poll_output(core_name)
            polls += 1
            if chunk:
                remaining = max_bytes - len(collected)
                if remaining > 0:
                    collected.extend(chunk[:remaining])
                if len(chunk) > remaining:
                    truncated = True
                    break
            if time.monotonic() >= deadline:
                break
            time.sleep(poll_interval)

        text = collected.decode("utf-8", errors="replace")
        return {
            "success": True,
            "supported": supported,
            "port": adm_port,
            "serverPid": session_pid,
            "text": text,
            "bytesRead": len(collected),
            "polls": polls,
            "durationMs": int((time.monotonic() - started) * 1000),
            "truncated": truncated,
        }
    except (ConnectionRefusedError, socket.timeout, OSError) as exc:
        return {
            "success": False,
            "error": f"ADM connection failed on port {adm_port}: {exc}",
            "port": adm_port,
            "serverPid": session_pid,
        }
    finally:
        try:
            client.disable()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass