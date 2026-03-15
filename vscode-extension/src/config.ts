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

/** Resolve a path from: VS Code setting > JSON value > auto-detect. */
function resolvePath(settingKey: string, jsonValue: string | undefined, autoDetect: () => string): string {
  const fromSetting = vscode.workspace
    .getConfiguration("e2mcp")
    .get<string>(settingKey, "")
    .trim();
  if (fromSetting) return fromSetting;
  if (jsonValue) return jsonValue;
  return autoDetect();
}

/** Auto-detect DebugComp/RX under ~/.eclipse/com.renesas.platform_{id}/DebugComp/RX */
function detectDebugToolsPath(): string {
  const eclipseDir = path.join(os.homedir(), ".eclipse");
  try {
    const platforms = fs.readdirSync(eclipseDir)
      .filter(d => d.startsWith("com.renesas.platform_"))
      .sort().reverse();
    for (const dir of platforms) {
      const candidate = path.join(eclipseDir, dir, "DebugComp", "RX");
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* not installed */ }
  return "";
}

/** Auto-detect Renesas embedded Python3 under e2 Studio plugins. */
function detectPython3BinPath(e2studioPath: string): string {
  if (!e2studioPath) return "";
  const pluginsDir = path.join(e2studioPath, "plugins");
  try {
    const dirs = fs.readdirSync(pluginsDir)
      .filter(d => d.startsWith("com.renesas.python3.win32"))
      .sort().reverse();
    for (const dir of dirs) {
      const bin = path.join(pluginsDir, dir, "bin");
      if (fs.existsSync(bin)) return bin;
    }
  } catch { /* not installed */ }
  return "";
}

/** Auto-detect CCRX compiler: newest version under Program Files (x86)\Renesas\RX. */
function detectCcrxPath(): string {
  const base = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Renesas", "RX");
  try {
    const versions = fs.readdirSync(base).sort().reverse();
    for (const ver of versions) {
      const bin = path.join(base, ver, "bin");
      if (fs.existsSync(path.join(bin, "ccrx.exe"))) return bin;
    }
  } catch { /* not installed */ }
  return "";
}

/** Auto-detect e2 Studio eclipse folder. */
function detectE2studioPath(): string {
  const candidates = [
    "C:\\Renesas\\e2_studio\\eclipse",
    "C:\\Renesas\\e2studio\\eclipse",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "";
}

/** Auto-detect GNU make bundled with e2 Studio plugins. */
function detectMakePath(e2studioPath: string): string {
  if (!e2studioPath) return "";
  const pluginsDir = path.join(e2studioPath, "plugins");
  try {
    const dirs = fs.readdirSync(pluginsDir)
      .filter(d => d.startsWith("com.renesas.ide.exttools.gnumake"))
      .sort().reverse();
    for (const dir of dirs) {
      const mkDir = path.join(pluginsDir, dir, "mk");
      if (fs.existsSync(path.join(mkDir, "make.exe"))) return mkDir;
    }
  } catch { /* not installed */ }
  return "";
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

  // Resolve toolchain paths: VS Code setting > e2studio-mcp.json > auto-detect
  const e2studioPath = resolvePath("e2studioPath", raw.toolchain?.e2studioPath, detectE2studioPath);
  const ccrxPath = resolvePath("ccrxPath", raw.toolchain?.ccrxPath, detectCcrxPath);
  const makePath = resolvePath("makePath", raw.toolchain?.makePath, () => detectMakePath(e2studioPath));
  const debugToolsPath = resolvePath("debugToolsPath", raw.flash?.debugToolsPath, detectDebugToolsPath);
  const python3BinPath = resolvePath("python3BinPath", raw.flash?.python3BinPath, () => detectPython3BinPath(e2studioPath));

  return {
    workspace: raw.workspace ?? "",
    projectRootPath,
    defaultProject: raw.defaultProject ?? "headc-fw",
    buildConfig: raw.buildConfig ?? "HardwareDebug",
    buildMode: raw.buildMode ?? "make",
    buildJobs: resolveBuildJobs(raw.buildJobs),
    toolchain: {
      ccrxPath,
      e2studioPath,
      makePath,
    },
    flash: {
      debugger: raw.flash?.debugger ?? "E2Lite",
      device: raw.flash?.device ?? "R5F5651E",
      gdbPort: raw.flash?.gdbPort ?? 61234,
      debugToolsPath,
      python3BinPath,
      gdbExecutable: raw.flash?.gdbExecutable ?? "rx-elf-gdb",
      inputClock: raw.flash?.inputClock ?? "24.0",
      idCode: raw.flash?.idCode ?? "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    },
  };
}
