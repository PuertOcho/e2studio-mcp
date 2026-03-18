# E2 MCP for Renesas RX

E2 MCP is an MCP server and VS Code integration layer for Renesas RX development with e2 Studio.

It is built for a practical workflow:

- an MCP client or AI assistant can build, inspect, flash, debug and read target output
- VS Code keeps the selected project, build configuration, launch file and debugger grounded in the real workspace
- the optional sidebar gives the user manual control over the exact same operations

The result is a single execution path for both human-driven and MCP-driven firmware work.

## What This Repository Contains

This repository is split into two cooperating parts:

- `src/e2studio_mcp/`: the Python MCP server that exposes tools and resources
- `vscode-extension/`: the VS Code extension that anchors Renesas project state and hardware actions inside the editor

If you only look at the extension, you miss the MCP server.

If you only look at the MCP server, you miss the editor-side state that makes build, flash and debug reliable.

## MCP-First Workflow

E2 MCP is not designed as a generic build helper with an AI layer added later.

The intended flow is:

1. Open a Renesas workspace in VS Code
2. Let the extension detect or load the toolchain and available projects
3. Select the active project, build configuration, launch file and debugger once
4. Use MCP tools to build, inspect memory, flash firmware, start debug or read the ADM console
5. Fall back to the sidebar whenever you want direct manual control

That keeps the MCP client aligned with the same project state the user sees in the editor.

## Core Capabilities

- Build e2 Studio projects through `make` or `e2studioc`
- Discover projects and parse `.cproject` metadata
- Read linker `.map` files and compute ROM, RAM and DataFlash usage
- Start or stop Renesas debug sessions through the VS Code extension
- Flash `.mot` output using the Renesas debug stack
- Capture ADM virtual console output from the target
- Expose all of the above as MCP tools and resources

## Architecture

```text
VS Code / MCP Client / AI Assistant
               |
               | MCP
               v
       e2studio_mcp.server
               |
               +-- build.py      -> make / e2studioc backends
               +-- project.py    -> .cproject parsing and project discovery
               +-- mapfile.py    -> linker map parsing and memory summaries
               +-- flash.py      -> e2-server-gdb / flash / session control
               +-- adm.py        -> virtual console capture
               |
               v
   VS Code extension state + Renesas toolchain + target hardware
```

## MCP Tools

### Build

- `build_project(project?, config?, mode?)`
- `clean_project(project?, config?, mode?)`
- `rebuild_project(project?, config?, mode?)`
- `get_build_status(project?)`

### Project And Memory

- `list_projects()`
- `get_project_config(project?, config?)`
- `get_build_size(project?, config?)`
- `get_map_summary(project?, config?)`
- `get_linker_sections(project?, config?)`

### Flash And Debug

- `debug_start(project?)`
- `debug_stop()`
- `debug_status()`
- `get_adm_log(port?, wait_seconds?, duration_ms?, poll_ms?, max_bytes?)`

## MCP Resources

- `e2studio://build/log`
- `e2studio://debug/adm/log`
- `e2studio://project/memory`
- `e2studio://project/config`
- `e2studio://activity/log`

## VS Code Extension

The extension in `vscode-extension/` is the editor-side control plane for the MCP workflow.

It provides:

- project selection
- build configuration selection
- launch file selection
- debugger selection
- manual Build, Clean, Rebuild, Flash, Debug and Stop actions
- virtual console output access
- workspace-aware state that MCP clients can reuse safely

The current Marketplace-facing README for the extension lives in `vscode-extension/README.md`.

## Requirements

- Windows
- Python `>= 3.10`
- Renesas e2 Studio installed
- Renesas RX toolchain available: `CCRX`, `make`, `e2-server-gdb`, `rx-elf-gdb`
- A workspace containing Renesas e2 Studio projects with `.cproject` files
- For VS Code debug integration: `renesaselectronicscorporation.renesas-debug`

## Repository Layout

```text
e2studio-mcp/
  src/e2studio_mcp/
    server.py
    build.py
    project.py
    mapfile.py
    flash.py
    adm.py
    config.py
  tests/
  scripts/
  vscode-extension/
  e2studio-mcp.json
```

## Install The Python Server

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 -m pip install -e .
```

Optional development dependencies:

```powershell
py -3 -m pip install -e .[dev]
```

## Configuration

The server resolves configuration in this order:

1. explicit path passed programmatically
2. `E2STUDIO_MCP_CONFIG` environment variable
3. local `e2studio-mcp.json` in the repository root

### Minimal Example

```json
{
  "workspace": "C:/Users/anton/Desktop/Proyectos/e2Studio_2024_workspace",
  "defaultProject": "headc-fw",
  "buildConfig": "HardwareDebug",
  "buildMode": "make",
  "buildJobs": 0,
  "toolchain": {
    "ccrxPath": "C:/Program Files (x86)/Renesas/RX/3_7_0/bin",
    "e2studioPath": "C:/Renesas/e2_studio/eclipse",
    "makePath": "C:/Renesas/e2_studio/eclipse/plugins/.../mk"
  },
  "flash": {
    "debugger": "E2Lite",
    "device": "R5F5651E",
    "gdbExecutable": "rx-elf-gdb",
    "gdbPort": 61234,
    "inputClock": "24.0",
    "idCode": "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    "debugToolsPath": "C:/Users/.../.eclipse/com.renesas.platform_xxx/DebugComp/RX",
    "python3BinPath": "C:/Renesas/e2_studio/eclipse/plugins/.../bin"
  },
  "devices": {
    "R5F5651E": {
      "family": "RX651",
      "romSize": 2097152,
      "ramSize": 655360,
      "dataFlashSize": 32768
    }
  }
}
```

Notes:

- `buildMode` supports `make` and `e2studioc`
- `buildJobs: 0` enables CPU-based auto-detection with a cap of `16`
- `devices` is used to calculate ROM, RAM and DataFlash percentages in `get_build_size` and `get_map_summary`
- `flash` values are **fallback defaults**. When a project contains an e2 Studio `.launch` file, the device, debugger, port and server parameters are read from there instead. The `.launch` file always takes priority
- `python3BinPath` points to the embedded Renesas Python required by `e2-server-gdb`
- if `debugToolsPath` is omitted, the server tries known auto-detection paths
- toolchain paths (`ccrxPath`, `e2studioPath`, `makePath`, `debugToolsPath`, `python3BinPath`) are auto-detected if omitted

## Run The MCP Server

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 -m e2studio_mcp.server
```

Or:

```powershell
py -3 -m e2studio_mcp
```

## Extension Build

```powershell
cd e2Studio_2024_workspace/e2studio-mcp/vscode-extension
npm install
npm run compile
```

## Testing

Run unit tests:

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 -m pytest -q
```

## License

Proprietary. See `LICENSE.txt`.

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 tests/smoke_test.py
```

## Troubleshooting

- `Config file not found`: definir `E2STUDIO_MCP_CONFIG` o crear `e2studio-mcp.json` en la raíz.
- `make not found`: revisar `toolchain.makePath`.
- `sed`, `ccrx` o `renesas_cc_converter` no encontrados durante `make`: comprobar `toolchain.e2studioPath` y `toolchain.ccrxPath`. La extensión y el backend añaden automáticamente BusyBox de Renesas, CCRX y las utilidades `Utilities/ccrx` de `.eclipse` al `PATH` del build.
- `e2studioc not found`: comprobar `toolchain.e2studioPath` apuntando a `.../eclipse`.
- `Cannot find e2-server-gdb`: definir `flash.debugToolsPath` explícitamente.
- `No .mot file found`: compilar antes de grabar.
- `Cannot connect to e2-server-gdb`: verificar sonda, dispositivo configurado y puerto GDB.

## Licencia

Software propietario. Todos los derechos reservados.

El código fuente de este repositorio no concede permiso de redistribución, sublicencia ni explotación comercial.
La metadata del paquete de extensión referencia la licencia incluida en [vscode-extension/LICENSE.txt](vscode-extension/LICENSE.txt).
