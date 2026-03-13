"""Send 'monitor start_interface,ADM,main' to e2-server-gdb via GDB RSP."""
import socket
import time
import sys

GDB_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 61234
ADM_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 53550


def gdb_send(sock, cmd):
    checksum = sum(ord(c) for c in cmd) % 256
    packet = "${0}#{1:02x}".format(cmd, checksum)
    print("  TX:", packet[:120])
    sock.sendall(packet.encode())
    time.sleep(0.5)
    resp = b""
    while True:
        try:
            chunk = sock.recv(4096)
            if not chunk:
                break
            resp += chunk
        except socket.timeout:
            break
    decoded = resp.decode("ascii", errors="replace")
    print("  RX:", decoded[:200])
    return decoded


def test_adm(port):
    """Try connecting to ADM port."""
    print(f"\n[*] Testing ADM port {port}...")
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    try:
        s.connect(("127.0.0.1", port))
        print(f"[+] ADM port {port} connected!")
        # Try reading
        try:
            data = s.recv(4096)
            print(f"  ADM data: {data}")
        except socket.timeout:
            print("  ADM: no data (timeout) - but connection succeeded")
        return True
    except Exception as e:
        print(f"[-] ADM port {port} failed: {e}")
        return False
    finally:
        s.close()


def main():
    # First test ADM before sending command
    print("=== BEFORE monitor command ===")
    test_adm(ADM_PORT)

    # Connect to GDB
    print(f"\n[*] Connecting to GDB port {GDB_PORT}...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3)
    try:
        sock.connect(("127.0.0.1", GDB_PORT))
        print(f"[+] Connected to GDB port {GDB_PORT}")
    except Exception as e:
        print(f"[-] GDB connection failed: {e}")
        return

    # Read initial response
    try:
        initial = sock.recv(4096)
        print(f"  Initial: {initial}")
    except socket.timeout:
        print("  No initial data")

    # Send monitor start_interface,ADM,main
    # GDB RSP: monitor commands -> qRcmd,<hex-encoded command>
    monitor_cmd = "start_interface,ADM,main"
    hex_cmd = monitor_cmd.encode().hex()
    print(f"\n[*] Sending: monitor {monitor_cmd}")
    gdb_send(sock, "qRcmd," + hex_cmd)

    # Also try just querying what interfaces are available
    print("\n[*] Sending: monitor help")
    help_cmd = "help"
    hex_help = help_cmd.encode().hex()
    gdb_send(sock, "qRcmd," + hex_help)

    sock.close()
    print("\n[*] GDB connection closed")

    # Test ADM again after sending command
    time.sleep(1)
    print("\n=== AFTER monitor command ===")
    test_adm(ADM_PORT)


if __name__ == "__main__":
    main()
