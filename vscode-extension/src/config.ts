import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

export interface ExtensionConfig {
  workspace: string;
  projectRootPath: string;
  defaultProject: string;
  buildConfig: string;
  buildMode: string;
  buildJobs: number;
  toolchain: {
    ccrxPath: string;
    e2studioPath: string;
    makePath: string;
  };
  flash: {
    debugger: string;
    device: string;
    gdbPort: number;
    debugToolsPath: string;
    python3BinPath: string;
    gdbExecutable: string;
    inputClock: string;
    idCode: string;
  };
}

function resolveBuildJobs(rawValue: unknown): number {
  const configured = Number(rawValue ?? 0);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  const availableParallelism = typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.max(1, Math.min(16, availableParallelism || 1));
}

/**
 * Load e2studio-mcp.json config.
 *
 * Resolution order:
 * 1. `e2mcp.configPath` setting
 * 2. `E2STUDIO_MCP_CONFIG` env var
 * 3. Auto-detect: walk up from workspace folders looking for e2studio-mcp.json
 */
export function loadConfig(): ExtensionConfig {
  let configPath: string | undefined;

  // 1. VS Code setting
  const settingPath = vscode.workspace
    .getConfiguration("e2mcp")
    .get<string>("configPath");
  if (settingPath && fs.existsSync(settingPath)) {
    configPath = settingPath;
  }

  // 2. Environment variable
  if (!configPath) {
    const envPath = process.env.E2STUDIO_MCP_CONFIG;
    if (envPath && fs.existsSync(envPath)) {
      configPath = envPath;
    }
  }

  // 3. Auto-detect in workspace
  if (!configPath) {
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        // Check in the folder itself
        const candidate1 = path.join(folder.uri.fsPath, "e2studio-mcp.json");
        if (fs.existsSync(candidate1)) {
          configPath = candidate1;
          break;
        }
        // Check common subfolder patterns
        for (const sub of [
          "e2Studio_2024_workspace/e2studio-mcp",
          "e2studio-mcp",
        ]) {
          const candidate2 = path.join(
            folder.uri.fsPath,
            sub,
            "e2studio-mcp.json"
          );
          if (fs.existsSync(candidate2)) {
            configPath = candidate2;
            break;
          }
        }
        if (configPath) break;
      }
    }
  }

  if (!configPath) {
    throw new Error(
      "e2studio-mcp.json not found. Set e2mcp.configPath in settings."
    );
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const configuredProjectsPath = vscode.workspace
    .getConfiguration("e2mcp")
    .get<string>("projectsPath", "")
    .trim();
  const defaultProjectRootPath = raw.workspace ?? "";
  const projectRootPath = configuredProjectsPath || defaultProjectRootPath;

  return {
    workspace: raw.workspace ?? "",
    projectRootPath,
    defaultProject: raw.defaultProject ?? "headc-fw",
    buildConfig: raw.buildConfig ?? "HardwareDebug",
    buildMode: raw.buildMode ?? "make",
    buildJobs: resolveBuildJobs(raw.buildJobs),
    toolchain: {
      ccrxPath: raw.toolchain?.ccrxPath ?? "",
      e2studioPath: raw.toolchain?.e2studioPath ?? "",
      makePath: raw.toolchain?.makePath ?? "",
    },
    flash: {
      debugger: raw.flash?.debugger ?? "E2Lite",
      device: raw.flash?.device ?? "R5F5651E",
      gdbPort: raw.flash?.gdbPort ?? 61234,
      debugToolsPath: raw.flash?.debugToolsPath ?? "",
      python3BinPath: raw.flash?.python3BinPath ?? "",
      gdbExecutable: raw.flash?.gdbExecutable ?? "rx-elf-gdb",
      inputClock: raw.flash?.inputClock ?? "24.0",
      idCode: raw.flash?.idCode ?? "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    },
  };
}
