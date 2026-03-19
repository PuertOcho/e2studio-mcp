# E2 MCP — Renesas RX Tools for MCP

Stable release: 1.0.0

E2 MCP is a **Model Context Protocol companion extension** for Renesas RX development in VS Code.

It exposes **build, flash, debug and virtual console workflows** to MCP clients and AI assistants, while keeping project selection, debugger selection and Renesas toolchain state anchored inside the editor.

Works with **E2 Lite**, **E1** and **J-Link** probes using the Renesas CC-RX toolchain and `e2-server-gdb`.

## At a Glance

- **MCP-first design** for build, flash, debug and console operations
- **Workspace-aware state**: project, build config, debugger and launch file
- **Renesas RX focused**: e2 Studio, CCRX, `e2-server-gdb`, ADM virtual console
- **Manual sidebar available** for inspection and direct control when needed

## MCP-First Workflow

This extension is designed first as an **execution layer for MCP-driven development**, not as a generic standalone GUI.

- MCP clients can trigger **build**, **clean**, **rebuild**, **flash**, **debug** and **virtual console** actions through VS Code
- The extension keeps the Renesas toolchain, selected project, debugger and build configuration aligned with the current workspace
- The sidebar acts as a **control surface and state view** for the MCP server: selected project, debugger, launch file, hardware state and available actions
- Manual buttons are still available, but the main value is that an MCP client can use the exact same environment and tooling that the user sees in VS Code

## Sidebar Role

The sidebar is not the product by itself. Its role is to make MCP execution reliable.

- It shows which Renesas project is currently selected
- It makes the active debugger and build configuration explicit
- It exposes the same actions that MCP clients can trigger
- It gives the user a quick way to validate the environment before letting an MCP client operate on hardware

## What It Provides

- **Project-aware sidebar** for selecting Renesas projects, debugger, build configuration and launch file
- **Build / Clean / Rebuild** using CC-RX and GNU Make from the current workspace
- **Flash firmware** through `e2-server-gdb` using the Renesas debug stack
- **Debug sessions** with launch-file-aware startup, reusing an existing build when available
- **Virtual Console (ADM)** for target output in a VS Code Output channel
- **Automatic toolchain discovery** for e2 Studio, CCRX, debug tools and Python
- **MCP integration** so AI assistants can operate Renesas RX projects through VS Code instead of shell scripts or ad-hoc commands

## Why Use It With MCP

Without this extension, an MCP client would need to guess or reconstruct:

- which project is active
- which build folder should be used
- which Renesas debugger is selected
- where e2 Studio and CCRX are installed
- how to flash and start a hardware debug session correctly

E2 MCP centralizes that state inside VS Code and makes it available through a consistent MCP-backed workflow.

That reduces the gap between:

- what the user sees in the editor
- what the Renesas toolchain is configured to do
- what the MCP client is allowed to execute

## Requirements

- **Renesas e2 Studio** installed. This provides CC-RX, GNU Make and `e2-server-gdb`
- **Renesas Debug** VS Code extension: `renesaselectronicscorporation.renesas-debug`
- **Python 3** available as `py`, `python3` or `python`
- A supported debug probe: **E2 Lite**, **E1** or **J-Link**
- A workspace containing one or more Renesas e2 Studio projects with `.cproject` files

## Getting Started

1. Open a workspace that contains Renesas e2 Studio projects
2. Open the **E2 MCP** view from the Activity Bar
3. Turn on **MCP Server** if you want MCP clients to use the extension
4. Select the projects folder, project, debugger, build configuration and launch file
5. Use the sidebar manually or let an MCP client drive the workflow through the extension

## Typical Use Cases

- Ask an MCP client to build the active Renesas RX project using the selected configuration
- Flash the current firmware without leaving VS Code
- Start a hardware debug session using the selected launch file and debugger
- Read target output through the ADM virtual console while the MCP client analyzes the run
- Keep manual and MCP-triggered actions aligned in the same workspace state

## Typical MCP Usage

1. The user opens VS Code in a Renesas workspace
2. The extension auto-detects or loads the Renesas toolchain paths
3. The user selects the project and debugger once in the sidebar
4. An MCP client requests a build, flash, debug start or console read
5. The extension executes the action in the same configured VS Code environment

## Manual Actions Available In The Sidebar

- **Build**
- **Clean**
- **Rebuild**
- **Flash**
- **Debug**
- **Stop**
- **Select Folder** for the Renesas projects root

These actions are available manually, but they are also the actions that make the extension useful as an MCP execution backend.

## Extension Settings

- `e2mcp.projectsPath`: override the folder that contains Renesas projects
- `e2mcp.e2studioPath`: path to the e2 Studio `eclipse` folder
- `e2mcp.ccrxPath`: path to the CC-RX compiler `bin` folder
- `e2mcp.debugToolsPath`: path to `DebugComp/RX` containing `e2-server-gdb`
- `e2mcp.pythonPath`: Python executable name or path, default `py`
- `e2mcp.consolePollMs`: virtual console polling interval in milliseconds

## Command Palette Commands

All commands are available under the **E2 MCP** category:

- **Build Project**
- **Clean Project**
- **Rebuild Project**
- **Flash Firmware**
- **Stop Debug Session**
- **Open Virtual Console Output**
- **Select Project**
- **Select Debugger**
- **Select Launch File**
- **Select Projects Folder**

## License

Proprietary — see [LICENSE.txt](LICENSE.txt) for details.
