# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project uses Semantic Versioning as a working convention.

## [Unreleased]

### Changed

- Removed the duplicated Virtual Console section from the sidebar webview; ADM output remains in the VS Code `Output` channel.
- Added explicit `.launch` selection in the extension, with `Auto-detect` fallback when the user does not choose one.
- Fixed extension state so project/debugger/launch selections are shared consistently across sidebar, status bar, build, flash, and debug.
- Aligned flash execution with the selected build configuration instead of always using the config default.
- Improved memory totals to use project-specific device metadata when available.

## [0.1.0] - 2026-03-10

Initial MVP baseline tagged in Git as `v0.1.0`.

### Added

- MCP tool for ADM virtual console snapshots: `get_adm_log`.
- MCP resource `e2studio://debug/adm/log`.
- Dedicated ADM client module in `src/e2studio_mcp/adm.py`.
- ADM-focused automated tests.

### Changed

- Stabilized debug and ADM console integration around `e2-server-gdb`.
- Synchronized `README.md` and `PROJECT_TRACKER.md` with the actual MCP tools, resources, and configuration schema.
- Clarified the Python module entry point in `src/e2studio_mcp/__main__.py`.

### Notes

- This tag marks a functional MVP baseline.
- Further refinement, cleanup, and stabilization continue on top of `v0.1.0`.