"""Tests for flash module: RSP protocol helpers and .mot parser."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from e2studio_mcp.flash import (
    LaunchConfig,
    _parse_mot_file,
    _rsp_checksum,
    _rsp_extract,
)


# --- RSP checksum ------------------------------------------------

class TestRspChecksum:
    def test_empty(self):
        assert _rsp_checksum("") == 0

    def test_simple(self):
        # "QStartNoAckMode" → known checksum
        cs = _rsp_checksum("QStartNoAckMode")
        assert 0 <= cs <= 255
        assert cs == sum(ord(c) for c in "QStartNoAckMode") % 256

    def test_monitor_reset(self):
        payload = "qRcmd,7265736574"  # "reset" hex-encoded
        cs = _rsp_checksum(payload)
        assert isinstance(cs, int)
        assert 0 <= cs <= 255

    def test_m_packet(self):
        payload = "MFFF00000,4:deadbeef"
        cs = _rsp_checksum(payload)
        assert cs == sum(ord(c) for c in payload) % 256


# --- RSP extract -------------------------------------------------

class TestRspExtract:
    def test_normal_packet(self):
        assert _rsp_extract("$OK#9a") == "OK"

    def test_with_ack(self):
        assert _rsp_extract("+$OK#9a") == "OK"

    def test_with_multiple_acks(self):
        assert _rsp_extract("+-+$E01#ff") == "E01"

    def test_error_response(self):
        assert _rsp_extract("$E05#9a") == "E05"

    def test_data_response(self):
        assert _rsp_extract("$deadbeef#ab") == "deadbeef"

    def test_raw_fallback(self):
        # No $ prefix → return as-is (stripped of ack)
        assert _rsp_extract("+OK") == "OK"

    def test_empty(self):
        assert _rsp_extract("") == ""


# --- .mot parser -------------------------------------------------

@pytest.fixture
def mot_file(tmp_path: Path) -> Path:
    """Create a minimal .mot file with known content."""
    content = textwrap.dedent("""\
        S00E000068656164632D76326D6F74D7
        S315FFF0000000112233445566778899AABBCCDDEEFF7B
        S315FFF00010FFEEDDCCBBAA99887766554433221100FB
        S309FFF00020DEADBEEF42
        S705FFC000003B
    """)
    p = tmp_path / "test.mot"
    p.write_text(content)
    return p


@pytest.fixture
def mot_file_contiguous(tmp_path: Path) -> Path:
    """Create a .mot file where first two records are contiguous."""
    # First record: 16 bytes at FFF00000
    # Second record: 16 bytes at FFF00010 (contiguous)
    # Third record: 4 bytes at FFF10000 (gap → new chunk)
    content = textwrap.dedent("""\
        S00E000068656164632D76326D6F74D7
        S315FFF0000000112233445566778899AABBCCDDEEFF7B
        S315FFF00010FFEEDDCCBBAA99887766554433221100FB
        S309FFF10000DEADBEEF32
        S705FFC000003B
    """)
    p = tmp_path / "contiguous.mot"
    p.write_text(content)
    return p


class TestParseMot:
    def test_basic_parsing(self, mot_file: Path):
        records = _parse_mot_file(mot_file)
        assert len(records) > 0

    def test_addresses(self, mot_file: Path):
        records = _parse_mot_file(mot_file)
        # First record address
        assert records[0][0] == 0xFFF00000

    def test_data_content(self, mot_file: Path):
        records = _parse_mot_file(mot_file)
        # All records together should contain our known bytes
        all_data = b""
        for _, data in records:
            all_data += data
        assert b"\x00\x11\x22\x33" in all_data
        assert b"\xDE\xAD\xBE\xEF" in all_data

    def test_coalescing_contiguous(self, mot_file_contiguous: Path):
        records = _parse_mot_file(mot_file_contiguous)
        # First two S3 records are contiguous → should merge into one chunk
        # Third record has a gap → separate chunk
        assert len(records) == 2
        # First chunk: 32 bytes (16 + 16)
        assert records[0][0] == 0xFFF00000
        assert len(records[0][1]) == 32
        # Second chunk: 4 bytes at different address
        assert records[1][0] == 0xFFF10000
        assert len(records[1][1]) == 4

    def test_empty_file(self, tmp_path: Path):
        p = tmp_path / "empty.mot"
        p.write_text("S00E000068656164632D76326D6F74D7\nS705FFC000003B\n")
        records = _parse_mot_file(p)
        assert records == []

    def test_s1_records(self, tmp_path: Path):
        """S1 records have 16-bit addresses."""
        content = "S1130000001122334455667788990011223344EB\n"
        p = tmp_path / "s1.mot"
        p.write_text(content)
        records = _parse_mot_file(p)
        assert len(records) == 1
        assert records[0][0] == 0x0000
        assert len(records[0][1]) == 16


# --- LaunchConfig -------------------------------------------------

class TestLaunchConfig:
    def test_defaults(self):
        cfg = LaunchConfig()
        assert cfg.device == ""
        assert cfg.port == 61234
        assert cfg.init_commands == []
        assert cfg.gdb_name == "rx-elf-gdb"

    def test_custom(self):
        cfg = LaunchConfig(
            device="R5F565NE",
            port=12345,
            init_commands=["monitor reset", "monitor set_internal_mem_overwrite 0-581"],
        )
        assert cfg.device == "R5F565NE"
        assert cfg.port == 12345
        assert len(cfg.init_commands) == 2
