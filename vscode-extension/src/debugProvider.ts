import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ExtensionConfig, detectDebugToolsPath, detectPython3BinPath } from "./config";
import { parseLaunchFile, findLaunchFile, findRunLaunchFile } from "./launchParser";
import { E2McpViewProvider } from "./webviewProvider";

/**
 * Provides dynamic debug configurations for `renesas-hardware` sessions.
 *
 * When the user presses F5 with no launch.json (or picks a dynamic config),
 * this provider generates a complete Renesas debug config from:
 *   1. The current project/debugger/buildConfig selections in the sidebar
 *   2. An e2 Studio .launch file (if found in the project directory)
 *   3. Hardcoded defaults for RX targets
 */
export class DebugProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private config: ExtensionConfig,
    private viewProvider: E2McpViewProvider,
  ) {}

  /** Show dynamic configs in the debug dropdown even without launch.json. */
  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    const projectName = this.viewProvider.currentProject || this.config.defaultProject;
    return [
      this.buildConfig(projectName, true),
      this.buildConfig(projectName, false),
    ];
  }

  /**
   * Fill in / fix a debug configuration before launch.
   * Called for both launch.json configs and dynamic ones.
   */
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration | undefined {
    // Fill in if config is empty (F5 with no launch.json) or partial (webview button)
    if (!config.target) {
      const projectName = this.viewProvider.currentProject || this.config.defaultProject;
      return this.buildConfig(projectName, true);
    }
    return config;
  }

  /** Build a complete Renesas debug configuration. */
  buildConfig(projectName: string, stopOnEntry: boolean): vscode.DebugConfiguration {
    const workspace = this.config.projectRootPath;
    const buildConfig = this.viewProvider.currentBuildConfig || this.config.buildConfig;
    const sidebarDebuggerType = this.viewProvider.currentDebugger || "E2LITE";
    const launchSelection = this.viewProvider.currentLaunchFile || undefined;

    const projectRoot = path.join(workspace, projectName);
    const programPath = path.join(projectRoot, buildConfig, `${projectName}.x`);

    // Auto-detect tool paths
    const debugToolsPath = detectDebugToolsPath();
    const python3BinPath = detectPython3BinPath(this.config.toolchain.e2studioPath);

    // GDB executable: search common locations
    const gdbPath = this.findGdbExecutable("rx-elf-gdb");

    // pythonHome: parent of python3BinPath
    const pythonHome = python3BinPath
      ? path.dirname(python3BinPath)
      : "";

    // e2-server-gdb path
    const serverPath = debugToolsPath
      ? path.join(debugToolsPath, "e2-server-gdb.exe")
      : "e2-server-gdb.exe";

    // Try to parse .launch file for detailed serverParameters and initCommands
    const launchFile = stopOnEntry
      ? findLaunchFile(projectRoot, launchSelection)
      : findRunLaunchFile(projectRoot, launchSelection);
    let serverParameters: Record<string, string | number> = {};
    let initCommands: string[] = [
      "monitor set_internal_mem_overwrite 0-581",
      "monitor force_rtos_off",
      "monitor start_interface,ADM,main",
    ];
    let gdbArguments: string[] = [];
    let port = "61234";
    let effectiveDevice = "R5F5651E";
    let effectiveDebuggerType = sidebarDebuggerType;

    if (launchFile) {
      const parsed = parseLaunchFile(launchFile);
      if (Object.keys(parsed.serverParametersMap).length > 0) {
        serverParameters = parsed.serverParametersMap;
        const parsedDebugger = parsed.serverParametersMap["-g"];
        if (typeof parsedDebugger === "string" && parsedDebugger) {
          effectiveDebuggerType = parsedDebugger;
        }
      }
      if (parsed.initCommands.length > 0) {
        initCommands = parsed.initCommands;
        // Ensure required monitor commands are always present
        if (!initCommands.some((c) => c.includes("set_internal_mem_overwrite"))) {
          initCommands.unshift("monitor set_internal_mem_overwrite 0-581");
        }
        if (!initCommands.some((c) => c.includes("start_interface,ADM"))) {
          initCommands.push("monitor start_interface,ADM,main");
        }
      }
      if (parsed.gdbFlags) {
        gdbArguments = parsed.gdbFlags.split(/\s+/).filter(Boolean);
      }
      if (parsed.port) {
        port = String(parsed.port);
      }
      if (parsed.device) {
        effectiveDevice = parsed.device;
      }
    }

    // If no serverParameters from .launch, build minimal set from config
    if (Object.keys(serverParameters).length === 0) {
      serverParameters = {
        "-w": 0,
        "-uUseFine=": 0,
        "-uInputClock=": "24.0",
        "-uClockSrcHoco=": 0,
        "-z": "0",
        "-uhookWorkRamAddr=": "0x3fdd0",
        "-uhookWorkRamSize=": "0x230",
      };
    }

    // Remove -g and -t from serverParameters: the Renesas adapter generates
    // these from target.debuggerType and target.device, plus device XML.
    // Having them in serverParameters too causes duplicates and conflicting
    // values (e.g., "-g E2LITE" from adapter + "-g E2Lite" from params).
    delete serverParameters["-g"];
    delete serverParameters["-t"];

    const suffix = stopOnEntry ? "" : " (No startup break)";

    return {
      name: `Debug ${projectName} (RX)${suffix}`,
      type: "renesas-hardware",
      request: "launch",
      program: programPath.replace(/\\/g, "/"),
      projectRoot: projectRoot.replace(/\\/g, "/"),
      gdb: gdbPath.replace(/\\/g, "/"),
      pythonHome: pythonHome.replace(/\\/g, "/"),
      target: {
        server: serverPath.replace(/\\/g, "/"),
        deviceFamily: "RX",
        debuggerType: effectiveDebuggerType,
        device: effectiveDevice,
        serverParameters,
        port,
        serverPort: port,
        initialBreakpointAt: stopOnEntry ? "PowerON_Reset_PC" : "",
      },
      gdbArguments: gdbArguments.length > 0 ? gdbArguments : ["-rx-force-isa=v2"],
      initCommands,
    };
  }

  /** Find the rx-elf-gdb executable. */
  private findGdbExecutable(baseName: string): string {
    // 1. Search GCC for Renesas RX install in ProgramData (the real GDB)
    const programData = process.env.ProgramData || "C:/ProgramData";
    try {
      const entries = fs.readdirSync(programData).filter(
        (d) => d.startsWith("GCC for Renesas RX") && d.includes("GNURX"),
      );
      // Sort descending to prefer newest version
      entries.sort().reverse();
      for (const dir of entries) {
        const candidate = path.join(programData, dir, "rx-elf/rx-elf/bin", `${baseName}.exe`);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {
      // ProgramData not readable, fall through
    }

    // 2. Fallback to bare name (hope it's on PATH)
    // Note: DebugComp/RX also has rx-elf-gdb.exe but it's a stub that fails --version
    return baseName;
  }
}
