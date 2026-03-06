import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ExtensionConfig } from "./config";
import { parseLaunchFile, findLaunchFile } from "./launchParser";
import { E2StudioRxViewProvider } from "./webviewProvider";

/** Map debugger dropdown values to serverParam flag values. */
const DEBUGGER_MAP: Record<string, string> = {
  E2LITE: "E2Lite",
  E1: "E1",
  E2: "E2",
  JLINK: "JLink",
  SIMULATOR: "Sim",
};

/**
 * Provides dynamic debug configurations for `renesas-hardware` sessions.
 *
 * When the user presses F5 with no launch.json (or picks a dynamic config),
 * this provider generates a complete Renesas debug config from:
 *   1. The current project/debugger/buildConfig selections in the sidebar
 *   2. An e2 Studio .launch file (if found in the project directory)
 *   3. Fallback values from e2studio-mcp.json
 */
export class DebugProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private config: ExtensionConfig,
    private viewProvider: E2StudioRxViewProvider,
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
  private buildConfig(projectName: string, stopOnEntry: boolean): vscode.DebugConfiguration {
    const workspace = this.config.workspace;
    const buildConfig = this.viewProvider.currentBuildConfig || this.config.buildConfig;
    const debuggerType = this.viewProvider.currentDebugger || "E2LITE";
    const flash = this.config.flash;

    const projectRoot = path.join(workspace, projectName);
    const programPath = path.join(projectRoot, buildConfig, `${projectName}.x`);

    // GDB executable: search common locations
    const gdbPath = this.findGdbExecutable(flash.gdbExecutable);

    // pythonHome: parent of python3BinPath
    const pythonHome = flash.python3BinPath
      ? path.dirname(flash.python3BinPath)
      : "";

    // e2-server-gdb path
    const serverPath = flash.debugToolsPath
      ? path.join(flash.debugToolsPath, "e2-server-gdb.exe")
      : "e2-server-gdb.exe";

    // Try to parse .launch file for detailed serverParameters and initCommands
    const launchFile = findLaunchFile(projectRoot);
    let serverParameters: Record<string, string | number> = {};
    let initCommands: string[] = [
      "monitor set_internal_mem_overwrite 0-581",
      "monitor force_rtos_off",
      "monitor start_interface,ADM,main",
    ];
    let gdbArguments: string[] = [];
    let port = String(flash.gdbPort);

    if (launchFile) {
      const parsed = parseLaunchFile(launchFile);
      if (Object.keys(parsed.serverParametersMap).length > 0) {
        serverParameters = parsed.serverParametersMap;
      }
      if (parsed.initCommands.length > 0) {
        initCommands = parsed.initCommands;
      }
      if (parsed.gdbFlags) {
        gdbArguments = parsed.gdbFlags.split(/\s+/).filter(Boolean);
      }
      if (parsed.port) {
        port = String(parsed.port);
      }
    }

    // If no serverParameters from .launch, build minimal set from config
    if (Object.keys(serverParameters).length === 0) {
      serverParameters = {
        "-w": 0,
        "-uUseFine=": 0,
        "-uInputClock=": flash.inputClock,
        "-uClockSrcHoco=": 0,
        "-z": "0",
        "-uhookWorkRamAddr=": "0x3fdd0",
        "-uhookWorkRamSize=": "0x230",
      };
    }

    // Override debugger type from sidebar selection
    serverParameters["-g"] = DEBUGGER_MAP[debuggerType] || debuggerType;
    serverParameters["-t"] = flash.device;

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
        debuggerType: debuggerType,
        device: flash.device,
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
    // 1. Check in debugToolsPath
    const inTools = path.join(this.config.flash.debugToolsPath, `${baseName}.exe`);
    if (fs.existsSync(inTools)) return inTools;

    // 2. Search common GCC for Renesas RX install locations
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

    // 3. Fallback to bare name (hope it's on PATH)
    return baseName;
  }
}
