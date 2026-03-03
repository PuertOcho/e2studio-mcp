"""Parser for CCRX rlink .map files — section sizes, ROM/RAM occupancy."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ─── Section table regex ──────────────────────────────────────
# Format:
# SECTION_NAME
#                                   START      END         SIZE   ALIGN
RE_SECTION_HEADER = re.compile(r'^(\S+)\s*$')
RE_SECTION_DATA = re.compile(
    r'^\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+(\d+)\s*(?:\S+)?\s*$'
)


@dataclass
class MapSection:
    name: str = ""
    start: int = 0
    end: int = 0
    size: int = 0
    align: int = 0
    region: str = ""  # "ROM" | "RAM" | "DATA_FLASH" | "OTHER"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "start": f"0x{self.start:08X}",
            "end": f"0x{self.end:08X}",
            "size": self.size,
            "align": self.align,
            "region": self.region,
        }


@dataclass
class MapSummary:
    sections: list[MapSection] = field(default_factory=list)
    total_rom: int = 0
    total_ram: int = 0
    total_data_flash: int = 0
    rom_capacity: int = 0
    ram_capacity: int = 0
    data_flash_capacity: int = 0

    @property
    def rom_percent(self) -> float:
        if self.rom_capacity == 0:
            return 0.0
        return (self.total_rom / self.rom_capacity) * 100

    @property
    def ram_percent(self) -> float:
        if self.ram_capacity == 0:
            return 0.0
        return (self.total_ram / self.ram_capacity) * 100

    @property
    def data_flash_percent(self) -> float:
        if self.data_flash_capacity == 0:
            return 0.0
        return (self.total_data_flash / self.data_flash_capacity) * 100

    def to_dict(self) -> dict[str, Any]:
        return {
            "totalRom": self.total_rom,
            "totalRam": self.total_ram,
            "totalDataFlash": self.total_data_flash,
            "romCapacity": self.rom_capacity,
            "ramCapacity": self.ram_capacity,
            "dataFlashCapacity": self.data_flash_capacity,
            "romPercent": round(self.rom_percent, 2),
            "ramPercent": round(self.ram_percent, 2),
            "dataFlashPercent": round(self.data_flash_percent, 2),
            "sections": [s.to_dict() for s in self.sections if s.size > 0],
        }

    def to_text(self) -> str:
        """Formatted text summary for MCP resources."""
        lines = [
            "=== Memory Summary ===",
            f"ROM:        {self.total_rom:>8d} bytes ({self.rom_percent:.1f}% of {self.rom_capacity} bytes)",
            f"RAM:        {self.total_ram:>8d} bytes ({self.ram_percent:.1f}% of {self.ram_capacity} bytes)",
            f"Data Flash: {self.total_data_flash:>8d} bytes ({self.data_flash_percent:.1f}% of {self.data_flash_capacity} bytes)",
            "",
            f"{'Section':<30s} {'Start':>10s} {'End':>10s} {'Size':>8s} {'Region':<10s}",
            "-" * 75,
        ]
        for s in self.sections:
            if s.size > 0:
                lines.append(
                    f"{s.name:<30s} 0x{s.start:08X} 0x{s.end:08X} {s.size:>8d} {s.region:<10s}"
                )
        return "\n".join(lines)


def classify_region(address: int) -> str:
    """Classify a memory address into ROM, RAM, or DATA_FLASH region.

    RX651/RX65N memory map:
    - RAM:        0x00000000 - 0x0009FFFF  (640 KB)
    - DATA_FLASH: 0x00100000 - 0x00107FFF  (32 KB)
    - ROM:        0xFFF00000 - 0xFFFFFFFF  (can also be 0xFFC00000+)
    - Extended RAM: 0x00800000+ (some devices)
    """
    if address < 0x000A0000:
        return "RAM"
    elif 0x00100000 <= address <= 0x00107FFF:
        return "DATA_FLASH"
    elif address >= 0xFE000000:
        # OFS, option-setting memory area or ROM
        if address >= 0xFFC00000:
            return "ROM"
        else:
            return "OTHER"
    elif 0x00800000 <= address < 0x00900000:
        return "RAM"  # Extended RAM
    else:
        return "OTHER"


def _is_rom_content_section(name: str) -> bool:
    """Identify sections that consume ROM space.

    In CCRX:
    - P, P_* = Program code (ROM)
    - C, C_* = Constants (ROM)
    - D, D_* = Initialized data (ROM image, copied to RAM at startup)
    - W, W_* = Writable constants variant
    - L = Literal pool (ROM)
    - PFRAM, RPFRAM = Program in RAM (ROM image)
    - EXCEPTVECT, RESETVECT = Vectors (ROM)
    - PResetPRG = Reset program (ROM)
    - $ADDR_C_* = Fixed-address constants (ROM)
    - C$DSEC/C$BSEC/C$VECT/C$INIT = Startup tables (ROM)
    """
    upper = name.upper()
    if upper.startswith(("P", "C", "C$", "D", "W", "L")):
        return True
    if upper in ("EXCEPTVECT", "RESETVECT", "PRESETPRG"):
        return True
    if upper.startswith("PFRAM") or upper.startswith("RPFRAM"):
        return True
    if upper.startswith("$ADDR_C_"):
        return True
    return False


def _is_ram_content_section(name: str) -> bool:
    """Identify sections that consume RAM space.

    In CCRX:
    - SU = Stack (user)
    - SI = Stack (interrupt)
    - B, B_* = BSS (zeroed RAM)
    - R, R_* = Initialized data (RAM resident)
    - BFRAM, BFRAM_* = RAM for flash operations
    - BEXRAM, REXRAM = Extended RAM
    - NO_INIT_* = Uninitialized RAM
    """
    upper = name.upper()
    if upper in ("SU", "SI"):
        return True
    if upper.startswith(("B", "R")):
        # B, B_1, B_2, B_8, BFRAM, etc.
        # R, R_1, R_2, R_8, RPFRAM etc.
        # But NOT RESETVECT, not ROM sections
        if upper in ("RESETVECT",) or upper.startswith("RPFRAM"):
            return False
        return True
    if upper.startswith("NO_INIT"):
        return True
    return False


def parse_map_file(map_path: Path | str) -> MapSummary:
    """Parse a CCRX rlink .map file and extract section information."""
    path = Path(map_path)
    if not path.exists():
        raise FileNotFoundError(f"Map file not found: {path}")

    text = path.read_text(encoding="utf-8", errors="replace")
    sections = _parse_sections(text)

    summary = MapSummary(sections=sections)

    for s in sections:
        if s.size == 0:
            continue
        if s.region == "ROM":
            summary.total_rom += s.size
        elif s.region == "RAM":
            summary.total_ram += s.size
        elif s.region == "DATA_FLASH":
            summary.total_data_flash += s.size

    return summary


def _parse_sections(text: str) -> list[MapSection]:
    """Parse the Mapping List section of a .map file."""
    sections: list[MapSection] = []
    lines = text.splitlines()

    in_mapping = False
    current_section_name: str | None = None

    for i, line in enumerate(lines):
        # Detect start of mapping list
        if "*** Mapping List ***" in line:
            in_mapping = True
            continue

        if not in_mapping:
            continue

        # Stop at next *** section
        if line.startswith("***") and "Mapping" not in line:
            break

        # Skip the header line
        if "SECTION" in line and "START" in line:
            continue
        if "ATTRIBUTE" in line:
            continue

        stripped = line.strip()
        if not stripped:
            continue

        # Try to match section data line (indented hex values)
        data_match = RE_SECTION_DATA.match(line)
        if data_match and current_section_name:
            start = int(data_match.group(1), 16)
            end = int(data_match.group(2), 16)
            size = int(data_match.group(3), 16)
            align = int(data_match.group(4))

            region = classify_region(start)

            sections.append(MapSection(
                name=current_section_name,
                start=start,
                end=end,
                size=size,
                align=align,
                region=region,
            ))
            current_section_name = None
            continue

        # Try to match section name line (not indented, single word)
        name_match = RE_SECTION_HEADER.match(stripped)
        if name_match and not stripped.startswith("-"):
            current_section_name = stripped

    return sections


def get_map_summary(
    map_path: Path | str,
    rom_capacity: int = 0,
    ram_capacity: int = 0,
    data_flash_capacity: int = 0,
) -> dict[str, Any]:
    """Parse map file and return summary with capacity info."""
    summary = parse_map_file(map_path)
    summary.rom_capacity = rom_capacity
    summary.ram_capacity = ram_capacity
    summary.data_flash_capacity = data_flash_capacity
    return summary.to_dict()


def get_linker_sections(map_path: Path | str) -> list[dict[str, Any]]:
    """Parse map file and return individual section details."""
    summary = parse_map_file(map_path)
    return [s.to_dict() for s in summary.sections if s.size > 0]


def get_build_size(
    map_path: Path | str,
    rom_capacity: int = 2097152,  # 2MB default
    ram_capacity: int = 655360,   # 640KB default
    data_flash_capacity: int = 32768,  # 32KB default
) -> dict[str, Any]:
    """Get ROM/RAM/DataFlash usage summary suitable for build_size tool."""
    try:
        summary = parse_map_file(map_path)
        summary.rom_capacity = rom_capacity
        summary.ram_capacity = ram_capacity
        summary.data_flash_capacity = data_flash_capacity
        return {
            "rom": summary.total_rom,
            "ram": summary.total_ram,
            "dataFlash": summary.total_data_flash,
            "romCapacity": rom_capacity,
            "ramCapacity": ram_capacity,
            "dataFlashCapacity": data_flash_capacity,
            "romPercent": round(summary.rom_percent, 2),
            "ramPercent": round(summary.ram_percent, 2),
            "dataFlashPercent": round(summary.data_flash_percent, 2),
        }
    except FileNotFoundError:
        return {"error": f"Map file not found: {map_path}"}
    except Exception as e:
        return {"error": f"Failed to parse map file: {e}"}
