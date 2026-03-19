# Changelog

## 0.2.6 — 2026-03-19

- Skip build before debug when the binary (.x) already exists — launch directly with the existing build

## 0.2.5 — 2026-03-19

- Suppress probe-disconnected banner during active debug sessions (E2 Lite normally disconnects/reconnects during debugging)

## 0.1.9 — 2026-03-18

- Rewrite the Marketplace README to present the extension as MCP-first instead of a standalone utility

## 0.1.8 — 2026-03-18

- Make the `Select Folder` button use the same primary blue style as `Build`, `Flash` and `Debug`

## 0.1.7 — 2026-03-17

- Test the new transparent artwork as the Activity Bar icon to isolate whether the rendering issue is asset-specific

## 0.1.6 — 2026-03-17

- Restore a monochrome Activity Bar icon based on the original E2 MCP logo silhouette

## 0.1.5 — 2026-03-17

- Restore the original E2 MCP artwork for the Activity Bar icon

## 0.1.4 — 2026-03-17

- Replace the Activity Bar icon with a dedicated VS Code-sized monochrome SVG

## 0.1.3 — 2026-03-17

- Remove legacy icon assets from the packaged extension
- Remove redundant `onView` activation event from the manifest

## 0.1.2 — 2026-03-17

- Fix Activity Bar SVG icon to use VS Code monochrome `currentColor` rendering

## 0.1.1 — 2026-03-17

- Fix Marketplace icon asset to use the correct 128x128 image

## 0.1.0 — 2026-03-17

Initial release.

- Sidebar panel for project, debugger and build configuration selection
- Build, clean, rebuild via CC-RX + GNU Make
- Flash firmware via e2-server-gdb (RSP protocol)
- Hardware debug sessions with automatic build and flash
- ADM Virtual Console output channel
- MCP server integration (Model Context Protocol)
- Auto-detection of Renesas toolchain paths
- Support for E2 Lite, E1 and J-Link probes
