# e2studio-mcp

MCP server for controlling **e2 Studio / Renesas RX** from VS Code.

## Features

- **Build Management** — Compile, clean, rebuild projects headless via `make` or `e2studioc`
- **Project Info** — Read `.cproject` config, parse `.map` files for memory analysis
- **Flash/Debug** — Flash firmware via E2 Lite using `e2-server-gdb` + `rx-elf-gdb`
- **Resources** — Expose build logs, memory maps, and config as MCP resources

## Quick Start

```powershell
# Install dependencies
cd e2Studio_2024_workspace/e2studio-mcp
pip install -e .

# Run the server
py -3 -m e2studio_mcp.server
```

## Configuration

Edit `e2studio-mcp.json` with your local paths. The server reads its config from the
`E2STUDIO_MCP_CONFIG` environment variable, or defaults to `e2studio-mcp.json` in the
project directory.

## MCP Tools

| Category | Tool | Description |
|----------|------|-------------|
| Build | `build_project` | Compile a project |
| Build | `clean_project` | Clean build artifacts |
| Build | `rebuild_project` | Clean + build |
| Build | `get_build_status` | Parse errors/warnings from last build |
| Build | `get_build_size` | ROM/RAM usage from .map |
| Project | `list_projects` | Find all e2 Studio projects in workspace |
| Project | `get_project_config` | Read .cproject XML configuration |
| Project | `get_map_summary` | Parse .map file sections |
| Project | `get_linker_sections` | Detailed linker section occupancy |
| Flash | `flash_firmware` | Flash .mot via E2 Lite |
| Flash | `debug_connect` | Start GDB server |
| Flash | `debug_disconnect` | Stop GDB server |
| Flash | `debug_status` | Check E2 Lite connection |
