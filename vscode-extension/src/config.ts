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
}

/** Auto-detect DebugComp/RX under ~/.eclipse/com.renesas.platform_{id}/DebugComp/RX */
export function detectDebugToolsPath(): string {
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
export function detectPython3BinPath(e2studioPath: string): string {
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
 * Load config from VS Code settings + auto-detection.
 * No JSON config file is used.
 */
export function loadConfig(): ExtensionConfig {
  const s = vscode.workspace.getConfiguration("e2mcp");

  const e2studioPath = s.get<string>("e2studioPath", "").trim() || detectE2studioPath();
  const ccrxPath = s.get<string>("ccrxPath", "").trim() || detectCcrxPath();
  const makePath = s.get<string>("makePath", "").trim() || detectMakePath(e2studioPath);

  const workspace = s.get<string>("workspace", "").trim();
  const projectsPath = s.get<string>("projectsPath", "").trim();

  return {
    workspace,
    projectRootPath: projectsPath || workspace,
    defaultProject: s.get<string>("defaultProject", "").trim(),
    buildConfig: s.get<string>("buildConfig", "HardwareDebug").trim(),
    buildMode: s.get<string>("buildMode", "make"),
    buildJobs: resolveBuildJobs(s.get<number>("buildJobs", 0)),
    toolchain: {
      ccrxPath,
      e2studioPath,
      makePath,
    },
  };
}
