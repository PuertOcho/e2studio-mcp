# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project uses Semantic Versioning as a working convention.

## [Unreleased]

## [0.2.2] - 2026-03-18

### Added

- VS Code packaging now bundles the Python backend and `adm_console.py` inside the `.vsix` for self-contained installs.

### Changed

- Extension runtime files now live under `.e2mcp/` in the configured projects root instead of assuming an `e2studio-mcp/` checkout exists there.
- `findMcpJson()` now checks the configured projects root directly before falling back to the legacy repo layout.

### Fixed

- Installed `.vsix` deployments no longer depend on a sibling `e2studio-mcp` repository for bridge discovery or ADM log fallback.

## [0.2.1] - 2026-03-18

### Added

- ADM console raw mode now tees output to `.adm-log`, allowing MCP log reads without opening a second TCP connection.
- `get_adm_log` now supports `tail_lines` and `filter` for focused snapshots.

### Changed

- Extension workspace resolution now falls back from `e2mcp.workspace` to `e2mcp.projectsPath`.

### Fixed

- MCP `get_adm_log` now reads ADM output reliably from the bridge, the `.adm-log` tee file, or direct TCP fallback.
- Local bridge runtime files `.bridge-port` and `.adm-log` are ignored by git.

## [0.2.0] - 2026-03-18

### Changed

- **Breaking**: eliminated `e2studio-mcp.json` configuration file entirely.
- All configuration now comes from VS Code settings (`e2mcp.*`) and `E2MCP_*` environment variables.
- Python `config.py` rewritten: reads env vars + auto-detect, no JSON parsing.
- Extension `config.ts` rewritten: reads VS Code settings + auto-detect, no file I/O.
- `flashRunner.ts`: removed `findConfigPath()`, added `buildMcpEnv()` to pass settings as env vars to the Python subprocess.
- Architecture diagram in README replaced with Mermaid.

### Added

- New VS Code settings: `e2mcp.workspace`, `e2mcp.defaultProject`, `e2mcp.buildConfig`.
- New env vars for standalone MCP server: `E2MCP_WORKSPACE`, `E2MCP_PROJECT`, `E2MCP_BUILD_CONFIG`, etc.

### Removed

- `e2studio-mcp.json` file deleted.
- `e2mcp.configPath` VS Code setting removed.
- `E2STUDIO_MCP_CONFIG` environment variable removed.
- `FlashConfig` section removed (flash params come from `.launch` files only).
- `devices` field removed from config (known devices are built-in).

### Fixed

- Extension no longer throws/shows error popups when config file is missing.
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