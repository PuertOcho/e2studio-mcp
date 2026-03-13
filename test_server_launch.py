"""Quick test: launch e2-server-gdb via subprocess and connect via RSP socket."""
import subprocess, time, socket, os, tempfile
from pathlib import Path

SERVER = Path(r"C:\Users\anton\.eclipse\com.renesas.platform_1435879475\DebugComp\RX\e2-server-gdb.exe")
PARAMS = (
    '-g E2LITE -t R5F572NN_DUAL -uConnectionTimeout= 30 -uClockSrcHoco= 0 '
    '-uInputClock= "24" -uPTimerClock= "240000000" -uAllowClockSourceInternal= 1 '
    '-uUseFine= 0 -uJTagClockFreq= "6.00" -w 0 -z "0" -uRegisterSetting= "0" '
    '-uModePin= "0" -uChangeStartupBank= 0 -uStartupBank= "0" -uDebugMode= "0" '
    '-uExecuteProgram= 0 -uIdCode= "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF" '
    '-uresetOnReload= 1 -n 0 -uWorkRamAddress= "1000" -uverifyOnWritingMemory= 0 '
    '-uProgReWriteIRom= 0 -uProgReWriteDFlash= 0 -uhookWorkRamAddr= "0x3fdd0" '
    '-uhookWorkRamSize= "0x230" -uOSRestriction= 0 -p 61234'
)
PORT = 61234

tmp = Path(tempfile.gettempdir())
fout = open(tmp / "e2_test_out.txt", "w")
ferr = open(tmp / "e2_test_err.txt", "w")

cmd = f'"{SERVER}" {PARAMS}'
print(f"Launching: {cmd[:60]}...")
proc = subprocess.Popen(cmd, stdout=fout, stderr=ferr, cwd=str(SERVER.parent))
print(f"PID={proc.pid}")

print("Waiting 10s for probe init...")
time.sleep(10)

alive = proc.poll() is None
print(f"Server alive: {alive}")
if not alive:
    fout.close(); ferr.close()
    print("STDOUT:", (tmp / "e2_test_out.txt").read_text(errors="replace")[-500:])
    print("STDERR:", (tmp / "e2_test_err.txt").read_text(errors="replace")[-500:])
    exit(1)

# Try socket
print(f"Connecting socket to 127.0.0.1:{PORT}...")
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(5)
try:
    s.connect(("127.0.0.1", PORT))
    print("SOCKET CONNECTED OK!")
    # Read welcome
    s.settimeout(1)
    try:
        data = s.recv(256)
        print(f"Received {len(data)} bytes: {data[:50]}")
    except socket.timeout:
        print("No welcome data (normal)")
    s.close()
except Exception as e:
    print(f"SOCKET FAILED: {e}")

# Cleanup
print("Terminating server...")
proc.terminate()
try:
    proc.wait(timeout=5)
except:
    proc.kill()
fout.close(); ferr.close()

print("\nServer output:")
print((tmp / "e2_test_out.txt").read_text(errors="replace")[-300:])
print("DONE")
