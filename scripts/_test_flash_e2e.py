"""End-to-end flash test: connect E2 Lite → flash headc-fw.mot via RSP.

Requires:
  - E2 Lite physically connected via USB
  - headc-fw project built (HardwareDebug/headc-fw.mot exists)
"""

import json
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from e2studio_mcp.config import load_config
from e2studio_mcp.flash import (
    debug_connect,
    debug_disconnect,
    debug_status,
    flash_firmware,
)


def main():
    cfg = load_config()
    project = "headc-fw"

    print("=" * 60)
    print("E2STUDIO-MCP: Real Flash Test")
    print("=" * 60)

    # 1. Check status — should be idle
    status = debug_status(cfg)
    print(f"\n1. Status: {json.dumps(status, indent=2)}")

    # 2. Flash firmware
    print(f"\n2. Flashing {project}...")
    result = flash_firmware(cfg, project=project)
    print(f"   Result: {json.dumps(result, indent=2)}")

    # 3. Status after flash — should be disconnected (flash_firmware auto-disconnects)
    status = debug_status(cfg)
    print(f"\n3. Post-flash status: {json.dumps(status, indent=2)}")

    # Summary
    print("\n" + "=" * 60)
    if result.get("success"):
        print(f"FLASH OK — {result.get('bytesWritten', 0)} bytes in {result.get('durationMs', 0)}ms")
        print(f"  File: {result.get('flashedFile')}")
        print(f"  Chunks: {result.get('chunksWritten')}/{result.get('chunksTotal')}")
        print(f"  Verified: {result.get('verified')}")
    else:
        print(f"FLASH FAILED — {result.get('error', 'unknown')}")
        if "log" in result:
            print("  Log:")
            for line in result["log"]:
                print(f"    {line}")
    print("=" * 60)

    return 0 if result.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
