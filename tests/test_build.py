"""Tests for build module — CCRX error/warning parsing."""

from e2studio_mcp.build import parse_build_output


def test_parse_compiler_error():
    output = '"src/main.c", line 42: E0520: identifier "foo" is undefined'
    errors, warnings = parse_build_output(output)
    assert len(errors) == 1
    assert errors[0].file == "src/main.c"
    assert errors[0].line == 42
    assert errors[0].code == "E0520"
    assert "foo" in errors[0].message


def test_parse_compiler_warning():
    output = '"src/main.c", line 10: W0520: variable "x" is set but never used'
    errors, warnings = parse_build_output(output)
    assert len(warnings) == 1
    assert warnings[0].code == "W0520"


def test_parse_linker_error():
    output = "F0553: Cannot open input file 'missing.obj'"
    errors, warnings = parse_build_output(output)
    assert len(errors) == 1
    assert errors[0].code == "F0553"


def test_parse_mixed_output():
    output = """
"src/a.c", line 1: E0100: syntax error
"src/b.c", line 5: W0200: unused variable
F0553: link error
"""
    errors, warnings = parse_build_output(output)
    assert len(errors) == 2  # E0100 + F0553
    assert len(warnings) == 1  # W0200


def test_parse_clean_output():
    output = "rm -f *.obj\nDone."
    errors, warnings = parse_build_output(output)
    assert len(errors) == 0
    assert len(warnings) == 0
