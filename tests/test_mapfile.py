"""Tests for mapfile parser — CCRX rlink .map format."""

import textwrap
from e2studio_mcp.mapfile import _parse_sections, classify_region, parse_map_file


SAMPLE_MAP = textwrap.dedent("""\
    Renesas Optimizing Linker (W3.07.00)

    *** Options ***

    -subcommand=test.tmp

    *** Error information ***

    *** Mapping List ***

    SECTION                            START      END         SIZE   ALIGN
    SU
                                      00000004  00001003      1000   4
    SI
                                      00001004  00001403       400   4
    B_1
                                      00001404  000152b6     13eb3   1
    B
                                      00015da0  0001b7ef      5a50   4
    PResetPRG
                                      ffc00000  ffc0006c        6d   1
    C_1
                                      ffc0006d  ffc002d8       26c   1
    C
                                      ffc0eed0  ffc0f32f       460   4
    P
                                      ffc10aa1  ffc24217     13777   1
    EXCEPTVECT
                                      ffffff80  fffffffb        7c   4
    RESETVECT
                                      fffffffc  ffffffff         4   4

    *** Symbol List ***
""")


def test_parse_sections():
    sections = _parse_sections(SAMPLE_MAP)
    names = [s.name for s in sections]
    assert "SU" in names
    assert "SI" in names
    assert "PResetPRG" in names
    assert "P" in names
    assert "EXCEPTVECT" in names


def test_section_sizes():
    sections = _parse_sections(SAMPLE_MAP)
    su = next(s for s in sections if s.name == "SU")
    assert su.size == 0x1000
    assert su.start == 0x00000004
    assert su.align == 4


def test_classify_ram():
    assert classify_region(0x00000004) == "RAM"
    assert classify_region(0x00050000) == "RAM"
    assert classify_region(0x00800000) == "RAM"


def test_classify_rom():
    assert classify_region(0xFFC00000) == "ROM"
    assert classify_region(0xFFFFFFFF) == "ROM"


def test_classify_data_flash():
    assert classify_region(0x00100000) == "DATA_FLASH"
    assert classify_region(0x00107FFF) == "DATA_FLASH"


def test_region_classification_in_sections():
    sections = _parse_sections(SAMPLE_MAP)
    su = next(s for s in sections if s.name == "SU")
    assert su.region == "RAM"
    p = next(s for s in sections if s.name == "P")
    assert p.region == "ROM"
