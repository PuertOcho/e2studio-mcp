"""Quick smoke test — verify real project parsing works."""
import sys
sys.path.insert(0, ".")

from e2studio_mcp.config import load_config
from e2studio_mcp.project import list_projects, get_project_config

cfg = load_config()

print("=== Projects ===")
projs = list_projects(cfg.workspace_path)
for p in projs:
    print(f"  {p['name']}: device={p['device']}, toolchain={p['toolchain']} {p['toolchainVersion']}, map={p['hasMapFile']}")

print()
print("=== headc-fw config ===")
c = get_project_config(cfg.workspace_path, "headc-fw")
print(f"  device={c.get('device')}, family={c.get('deviceFamily')}, isa={c.get('isa')}, fpu={c.get('hasFpu')}")
print(f"  toolchain={c.get('toolchainId')} {c.get('toolchainVersion')}")
print(f"  endian={c.get('endian')}, config={c.get('buildConfig')}, artifact={c.get('artifactName')}.{c.get('artifactExtension')}")
inc = c.get('includePaths', [])
defs = c.get('defines', [])
print(f"  includes={len(inc)}, defines={len(defs)}")
print(f"  hasMap={c.get('hasMapFile')}")

# Test mapfile on bloader (only project with a .map file)
from e2studio_mcp.mapfile import parse_map_file
from pathlib import Path

bloader_map = Path(cfg.workspace) / "headc-v2-bloader" / ".mots_bin" / "Bloader_RX72N_HDC2_50_00.map"
if bloader_map.exists():
    print()
    print("=== Bloader .map summary ===")
    summary = parse_map_file(bloader_map)
    summary.rom_capacity = 2097152
    summary.ram_capacity = 655360
    summary.data_flash_capacity = 32768
    print(f"  ROM: {summary.total_rom} bytes ({summary.rom_percent:.1f}%)")
    print(f"  RAM: {summary.total_ram} bytes ({summary.ram_percent:.1f}%)")
    print(f"  Sections: {len(summary.sections)} total, {len([s for s in summary.sections if s.size > 0])} non-empty")
else:
    print(f"  (no bloader map at {bloader_map})")

# Check resources
from e2studio_mcp.server import mcp
resources = mcp._resource_manager._resources
print(f"\n=== Resources: {len(resources)} ===")
for uri in resources:
    print(f"  {uri}")

print("\n--- ALL OK ---")
