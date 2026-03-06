"""
Renesas Debug Virtual Console (ADM SimulatedIO Protocol)

Connects to the ADM interface of e2-server-gdb and reads printf output
from the RX target using the ISimulatedIO protocol.

Protocol reverse-engineered from:
  - e2 Studio plugin: com.renesas.cdt.debug.adm (SimulatedIO.class)
  - VS Code extension: renesas-debug (ADMSocketClient)

Usage:
  py Scripts/adm_console.py              # auto-detect port
  py Scripts/adm_console.py 51439        # explicit port
  py Scripts/adm_console.py --verbose    # show protocol messages
"""

import socket
import sys
import argparse
import time
import subprocess
import csv
import io
import re

# ---------------------------------------------------------------------------
# ADM protocol helpers
# ---------------------------------------------------------------------------

INTERFACE = "ISimulatedIO"
CORE_NAME = "main"


def adm_checksum(payload: str) -> str:
    """GDB RSP-style checksum: sum of bytes mod 256, as 2-digit lowercase hex."""
    total = 0
    for b in payload.encode("ascii"):
        total = (total + b) & 0xFF
    return f"{total:02x}"


def adm_build_message(function_name: str, params: str = "") -> str:
    """Build a complete ADM message: $qrenesas.ISimulatedIO:func,params#XX"""
    payload = f"qrenesas.{INTERFACE}:{function_name}"
    if params:
        payload += f",{params}"
    cs = adm_checksum(payload)
    return f"${payload}#{cs}"


def adm_parse_response(raw: str, verbose: bool = False):
    """Parse an ADM response, return (function_name, params_str) or None."""
    # Strip leading +
    data = raw.lstrip("+")
    # Server responds WITHOUT qrenesas. prefix: $ISimulatedIO:function,params#XX
    m = re.match(
        r'^\$([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)(?:,([^#]*?))?#([0-9a-fA-F]{2})$',
        data,
    )
    if not m:
        if verbose:
            print(f"  [adm] unparsable response: {data!r}", file=sys.stderr)
        return None, None
    interface = m.group(1)
    func = m.group(2)
    params = m.group(3) or ""
    return func, params


class ADMClient:
    """Minimal ADM socket client for ISimulatedIO."""

    def __init__(self, port: int, host: str = "127.0.0.1", verbose: bool = False):
        self.port = port
        self.host = host
        self.verbose = verbose
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(3.0)

    def connect(self):
        self.sock.connect((self.host, self.port))

    def close(self):
        self.sock.close()

    def send_and_receive(self, message: str, timeout: float = 2.0) -> str:
        """Send an ADM message and return the raw response string."""
        if self.verbose:
            print(f"  >>> {message}", file=sys.stderr)
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
            # Check if we have a complete response: +$...#XX
            text = buf.decode("ascii", errors="replace")
            stripped = text.lstrip("+")
            start = stripped.find("$")
            if start >= 0:
                end = stripped.find("#", start)
                if end >= 0 and len(stripped) >= end + 3:
                    # Complete response received
                    break

        response = buf.decode("ascii", errors="replace")
        if self.verbose:
            print(f"  <<< {response!r}", file=sys.stderr)
        return response

    def call(self, function_name: str, params: str = "", timeout: float = 2.0):
        """Send a SimulatedIO command and return parsed (func, response_params)."""
        msg = adm_build_message(function_name, params)
        raw = self.send_and_receive(msg, timeout=timeout)
        return adm_parse_response(raw, self.verbose)

    def is_supported(self) -> bool:
        func, params = self.call("isSimulatedIOSupported")
        return params == "true" if func else False

    def enable(self):
        return self.call("simulatedIOEnable")

    def disable(self):
        return self.call("simulatedIODisable")

    def clear_buffer(self):
        return self.call("simulatedIOClearBuffer")

    def poll_output(self, core_name: str = CORE_NAME) -> bytes:
        """Poll for output data. Returns decoded bytes or empty bytes."""
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


# ---------------------------------------------------------------------------
# Auto-detection (reused from previous version)
# ---------------------------------------------------------------------------

def run_command(args):
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        errors="ignore",
        check=False,
    )
    return result.stdout


def find_e2_server_pids():
    output = run_command([
        "tasklist",
        "/FI",
        "IMAGENAME eq e2-server-gdb.exe",
        "/FO",
        "CSV",
        "/NH",
    ])
    pids = []
    reader = csv.reader(io.StringIO(output))
    for row in reader:
        if len(row) < 2:
            continue
        name = row[0].strip().lower()
        if name != "e2-server-gdb.exe":
            continue
        try:
            pids.append(int(row[1]))
        except ValueError:
            continue
    return pids


def find_listening_ports_for_pid(pid):
    output = run_command(["netstat", "-ano", "-p", "tcp"])
    ports = set()
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
        if not port_match:
            continue
        ports.add(int(port_match.group(1)))
    return sorted(ports)


def auto_detect_adm_port(wait_seconds=15):
    deadline = time.time() + wait_seconds
    while time.time() <= deadline:
        pids = find_e2_server_pids()
        for pid in pids:
            ports = find_listening_ports_for_pid(pid)
            candidates = [p for p in ports if p != 61234]
            if candidates:
                return pid, max(candidates)
        time.sleep(1)
    return None, None


# ---------------------------------------------------------------------------
# Main console loop
# ---------------------------------------------------------------------------

def run_console(port: int, verbose: bool = False, poll_ms: int = 500):
    print(f"[*] Connecting to ADM SimulatedIO on localhost:{port}...")
    client = ADMClient(port, verbose=verbose)
    try:
        client.connect()
    except (ConnectionRefusedError, socket.timeout, OSError) as e:
        print(f"[!] Connection failed: {e}")
        print("    Make sure debug session is running and 'monitor start_interface,ADM,main' was sent.")
        sys.exit(1)

    print("[*] Connected. Probing ADM capabilities...")

    # Probe 1: isSimulatedIOSupported (ISimulatedIO interface)
    func, params = client.call("isSimulatedIOSupported")
    print(f"  isSimulatedIOSupported -> func={func!r} params={params!r}")
    supported = (params == "true") if func else False

    # Probe 2: isAvailableForCoreAndSessionSimulatedIO (ISimulatedIO interface)
    func2, params2 = client.call("isAvailableForCoreAndSessionSimulatedIO", CORE_NAME)
    print(f"  isAvailableForCoreAndSession -> func={func2!r} params={params2!r}")

    # Probe 3: Try enable directly (some servers accept enable even if isSupported returns false)
    func3, params3 = client.call("simulatedIOEnable")
    print(f"  simulatedIOEnable -> func={func3!r} params={params3!r}")

    # Probe 4: Try polling directly to see if data comes in anyway
    func4, params4 = client.call("simulatedIOGetOutputData", CORE_NAME)
    print(f"  simulatedIOGetOutputData -> func={func4!r} params={params4!r}")

    if not supported:
        print(f"\n[!] isSimulatedIOSupported={supported}, but trying to poll anyway...")

    print(f"[*] Polling for output every {poll_ms}ms (Ctrl+C to stop)\n")

    poll_interval = poll_ms / 1000.0
    idle_count = 0
    try:
        while True:
            data = client.poll_output()
            if data:
                idle_count = 0
                try:
                    text = data.decode("ascii", errors="replace")
                    sys.stdout.write(text)
                    sys.stdout.flush()
                except Exception:
                    print(f"[binary {len(data)}B] {data.hex(' ')}")
            else:
                idle_count += 1
                if idle_count == 30:  # ~15s at 500ms interval
                    print("[*] No output yet (target may be halted)...",
                          file=sys.stderr)
                    idle_count = 0

            time.sleep(poll_interval)
    except KeyboardInterrupt:
        print("\n[*] Stopping...")
    finally:
        try:
            client.disable()
        except Exception:
            pass
        client.close()
        print("[*] Disconnected.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Renesas Debug Virtual Console — ADM SimulatedIO protocol reader"
    )
    parser.add_argument(
        "port",
        nargs="?",
        type=int,
        help="ADM port. If omitted, auto-detect from e2-server-gdb.",
    )
    parser.add_argument(
        "--wait",
        type=int,
        default=15,
        help="Seconds to wait when auto-detecting ADM port (default: 15).",
    )
    parser.add_argument(
        "--poll",
        type=int,
        default=500,
        help="Poll interval in ms (default: 500).",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show ADM protocol messages (sent/received).",
    )
    args = parser.parse_args()

    selected_port = args.port
    if selected_port is None:
        print("[*] Auto-detecting ADM port from e2-server-gdb...")
        pid, selected_port = auto_detect_adm_port(wait_seconds=args.wait)
        if selected_port is None:
            print("[!] Could not auto-detect ADM port.")
            print("    Ensure debug session is running and 'monitor start_interface,ADM,main' was executed.")
            sys.exit(1)
        print(f"[*] Found e2-server-gdb PID {pid}, ADM port {selected_port}")

    run_console(selected_port, verbose=args.verbose, poll_ms=args.poll)
