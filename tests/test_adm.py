"""Tests for ADM helper module."""

from __future__ import annotations

from e2studio_mcp import adm


def test_find_adm_port_for_pid_excludes_gdb_port(monkeypatch):
    monkeypatch.setattr(
        adm,
        "find_listening_ports_for_pid",
        lambda pid: [61234, 51439, 51441],
    )

    assert adm.find_adm_port_for_pid(1234) == 51441


def test_read_adm_log_returns_error_when_port_missing(monkeypatch):
    monkeypatch.setattr(adm, "resolve_adm_port", lambda **kwargs: (None, None))

    result = adm.read_adm_log(wait_seconds=0)

    assert result["success"] is False
    assert "ADM port not found" in result["error"]


def test_read_adm_log_collects_text(monkeypatch):
    class FakeClient:
        def __init__(self, port):
            self.port = port
            self.chunks = [b"hello ", b"world", b""]

        def connect(self):
            return None

        def close(self):
            return None

        def is_supported(self):
            return True

        def enable(self):
            return ("simulatedIOEnable", "true")

        def disable(self):
            return ("simulatedIODisable", "true")

        def poll_output(self, core_name="main"):
            return self.chunks.pop(0) if self.chunks else b""

    monkeypatch.setattr(adm, "resolve_adm_port", lambda **kwargs: (2222, 51439))
    monkeypatch.setattr(adm, "ADMClient", FakeClient)
    monkeypatch.setattr(adm.time, "sleep", lambda _: None)

    result = adm.read_adm_log(duration_ms=2, poll_ms=1, max_bytes=32)

    assert result["success"] is True
    assert result["port"] == 51439
    assert result["serverPid"] == 2222
    assert result["text"] == "hello world"
    assert result["truncated"] is False


def test_read_adm_log_truncates(monkeypatch):
    class FakeClient:
        def __init__(self, port):
            self.port = port
            self.chunks = [b"abcdefghijk"]

        def connect(self):
            return None

        def close(self):
            return None

        def is_supported(self):
            return False

        def enable(self):
            return ("simulatedIOEnable", "false")

        def disable(self):
            return ("simulatedIODisable", "true")

        def poll_output(self, core_name="main"):
            return self.chunks.pop(0) if self.chunks else b""

    monkeypatch.setattr(adm, "resolve_adm_port", lambda **kwargs: (3333, 51440))
    monkeypatch.setattr(adm, "ADMClient", FakeClient)
    monkeypatch.setattr(adm.time, "sleep", lambda _: None)

    result = adm.read_adm_log(duration_ms=1, poll_ms=1, max_bytes=5)

    assert result["success"] is True
    assert result["text"] == "abcde"
    assert result["truncated"] is True