"""Renesas Debug Virtual Console (ADM SimulatedIO Protocol)."""

from __future__ import annotations

import argparse
import socket
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from e2studio_mcp.adm import ADMClient, CORE_NAME, resolve_adm_port


def run_console(
    port: int,
    verbose: bool = False,
    poll_ms: int = 500,
    raw: bool = False,
    connect_retries: int = 10,
    logfile: str | None = None,
):
    if not raw:
        print(f"[*] Connecting to ADM SimulatedIO on localhost:{port}...")
    client = ADMClient(port)

    last_err = None
    attempts = connect_retries if raw else 1
    for _ in range(attempts):
        try:
            client.connect()
            last_err = None
            break
        except (ConnectionRefusedError, socket.timeout, OSError) as exc:
            last_err = exc
            if not raw:
                print(f"[!] Connection failed: {exc}")
                print("    Make sure debug session is running and 'monitor start_interface,ADM,main' was sent.")
                sys.exit(1)
            time.sleep(2)

    if last_err is not None:
        print(f"Connection failed after {attempts} attempts: {last_err}", file=sys.stderr)
        sys.exit(1)

    if not raw:
        print("[*] Connected. Probing ADM capabilities...")

    func, params = client.call("isSimulatedIOSupported")
    if not raw:
        print(f"  isSimulatedIOSupported -> func={func!r} params={params!r}")
    supported = bool(func) and params == "true"

    func2, params2 = client.call("isAvailableForCoreAndSessionSimulatedIO", CORE_NAME)
    if not raw:
        print(f"  isAvailableForCoreAndSession -> func={func2!r} params={params2!r}")

    func3, params3 = client.enable()
    if not raw:
        print(f"  simulatedIOEnable -> func={func3!r} params={params3!r}")

    func4, params4 = client.call("simulatedIOGetOutputData", CORE_NAME)
    if not raw:
        print(f"  simulatedIOGetOutputData -> func={func4!r} params={params4!r}")

    if not supported and not raw:
        print(f"\n[!] isSimulatedIOSupported={supported}, but trying to poll anyway...")

    if not raw:
        print(f"[*] Polling for output every {poll_ms}ms (Ctrl+C to stop)\n")

    # In --raw mode, auto-tee to a well-known logfile so the MCP server
    # can read the ADM output without holding its own TCP connection.
    log_path = Path(logfile) if logfile else (ROOT / ".e2mcp" / ".adm-log" if raw else None)
    log_fh = None
    LOG_MAX = 128 * 1024
    LOG_KEEP = 64 * 1024
    if log_path:
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_fh = open(log_path, "a", encoding="utf-8", errors="replace")
        except OSError as exc:
            print(f"Cannot open logfile {log_path}: {exc}", file=sys.stderr)

    def _tee_log(text: str) -> None:
        """Write text to the logfile with size-capped rotation."""
        nonlocal log_fh
        if log_fh is None:
            return
        try:
            log_fh.write(text)
            log_fh.flush()
            # Rotate when file exceeds LOG_MAX
            if log_path and log_path.stat().st_size > LOG_MAX:
                log_fh.close()
                content = log_path.read_text(encoding="utf-8", errors="replace")
                log_path.write_text(content[-LOG_KEEP:], encoding="utf-8")
                log_fh = open(log_path, "a", encoding="utf-8", errors="replace")
        except OSError:
            pass

    poll_interval = poll_ms / 1000.0
    idle_count = 0
    try:
        while True:
            data = client.poll_output()
            if data:
                idle_count = 0
                try:
                    text = data.decode("ascii", errors="replace")
                    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
                    sys.stdout.buffer.flush()
                    _tee_log(text)
                except Exception:
                    print(f"[binary {len(data)}B] {data.hex(' ')}")
            else:
                idle_count += 1
                if idle_count == 30 and not raw:
                    print("[*] No output yet (target may be halted)...", file=sys.stderr)
                    idle_count = 0

            time.sleep(poll_interval)
    except KeyboardInterrupt:
        if not raw:
            print("\n[*] Stopping...")
    finally:
        if log_fh:
            try:
                log_fh.close()
            except OSError:
                pass
        try:
            client.disable()
        except Exception:
            pass
        client.close()
        if not raw:
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
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Raw mode: only output target text, no diagnostics. For VS Code extension.",
    )
    parser.add_argument(
        "--logfile",
        type=str,
        default=None,
        help="Path to tee output to (default: auto in --raw mode -> .e2mcp/.adm-log).",
    )
    args = parser.parse_args()

    selected_port = args.port
    if selected_port is None:
        if not args.raw:
            print("[*] Auto-detecting ADM port from e2-server-gdb...")
        pid, selected_port = resolve_adm_port(wait_seconds=args.wait)
        if selected_port is None:
            if not args.raw:
                print("[!] Could not auto-detect ADM port.")
                print("    Ensure debug session is running and 'monitor start_interface,ADM,main' was executed.")
            else:
                print("ADM port not found", file=sys.stderr)
            sys.exit(1)
        if not args.raw:
            print(f"[*] Found e2-server-gdb PID {pid}, ADM port {selected_port}")

    run_console(selected_port, verbose=args.verbose, poll_ms=args.poll,
                raw=args.raw, logfile=args.logfile)
