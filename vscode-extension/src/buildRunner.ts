import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { ExtensionConfig } from "./config";

/**
 * CCRX compiler/linker output regex patterns.
 * Mirrors the Python build.py parse_build_output().
 */
const RE_COMPILER_DIAG =
  /"(.+?)",\s*line\s+(\d+):\s+([EW]\d+):\s+(.+)/g;
const RE_LINKER_DIAG = /^\s*([FW]\d+):\s+(.+)/gm;

export interface BuildDiagnostic {
  file: string;
  line: number;
  code: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Runs make-based builds for e2 Studio CCRX projects and publishes
 * diagnostics (compiler errors/warnings) to VS Code's Problems panel.
 */
export class BuildRunner implements vscode.Disposable {
  private diagnostics: vscode.DiagnosticCollection;
  private buildChannel: vscode.OutputChannel;
  private activeProc: ChildProcess | undefined;
  private config: ExtensionConfig;

  constructor(config: ExtensionConfig) {
    this.config = config;
    this.diagnostics = vscode.languages.createDiagnosticCollection("ccrx");
    this.buildChannel = vscode.window.createOutputChannel("e2 Studio Build");
  }

  /** Get the project path from workspace + project name. */
  private projectPath(project: string): string {
    return path.join(this.config.projectRootPath, project);
  }

  /** Resolve the make executable path. */
  private getMakeCmd(): string {
    if (this.config.toolchain.makePath) {
      const candidate = path.join(this.config.toolchain.makePath, "make.exe");
      if (fs.existsSync(candidate)) return candidate;
      const candidate2 = path.join(this.config.toolchain.makePath, "make");
      if (fs.existsSync(candidate2)) return candidate2;
      return this.config.toolchain.makePath;
    }
    return "make";
  }

  /** Find the Renesas busybox bin directory that provides sed/sh for generated makefiles. */
  private getBusyboxBin(): string | undefined {
    if (!this.config.toolchain.e2studioPath) {
      return undefined;
    }

    const pluginsDir = path.join(this.config.toolchain.e2studioPath, "plugins");
    if (!fs.existsSync(pluginsDir)) {
      return undefined;
    }

    const entries = fs
      .readdirSync(pluginsDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith("com.renesas.ide.exttools.busybox.win32")
      )
      .map((entry) => path.join(pluginsDir, entry.name, "bin"));

    return entries.find((binDir) => {
      const sedExe = path.join(binDir, "sed.exe");
      const shExe = path.join(binDir, "sh.exe");
      return fs.existsSync(sedExe) && fs.existsSync(shExe);
    });
  }

  /** Find the user-scoped Renesas utility directory that provides renesas_cc_converter. */
  private getCcrxUtilitiesDir(): string | undefined {
    const homeDir = process.env.USERPROFILE ?? process.env.HOME;
    if (!homeDir) {
      return undefined;
    }

    const eclipseDir = path.join(homeDir, ".eclipse");
    if (!fs.existsSync(eclipseDir)) {
      return undefined;
    }

    const entries = fs
      .readdirSync(eclipseDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith("com.renesas.platform_")
      )
      .map((entry) => path.join(eclipseDir, entry.name, "Utilities", "ccrx"));

    return entries.find((dir) => fs.existsSync(path.join(dir, "renesas_cc_converter.exe")));
  }

  /** Compose the PATH expected by e2 Studio generated makefiles. */
  private getBuildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    const currentPath = env[pathKey] ?? "";
    const nextEntries: string[] = [];

    const prependIfExists = (dir: string | undefined) => {
      if (!dir || !fs.existsSync(dir)) {
        return;
      }
      nextEntries.push(dir);
    };

    prependIfExists(this.config.toolchain.ccrxPath);
    prependIfExists(this.config.toolchain.makePath);
    prependIfExists(this.getBusyboxBin());
    prependIfExists(this.getCcrxUtilitiesDir());

    const merged = [...nextEntries, ...currentPath.split(path.delimiter).filter(Boolean)];
    env[pathKey] = Array.from(new Set(merged)).join(path.delimiter);
    return env;
  }

  /** Build make arguments, enabling parallel compilation when configured. */
  private getMakeArgs(buildDir: string, target: string): string[] {
    const args = ["-C", buildDir];
    if (target === "all" && this.config.buildJobs > 1) {
      args.push(`-j${this.config.buildJobs}`, "--output-sync=target");
    }
    args.push(target);
    return args;
  }

  /**
   * Run a build operation. Returns a promise that resolves when the build completes.
   * @param project Project name
   * @param buildConfig Build configuration (e.g. "HardwareDebug")
   * @param target Make target: "all", "clean", or "all" after clean for rebuild
   */
  async build(
    project: string,
    buildConfig: string,
    mode: "build" | "clean" | "rebuild"
  ): Promise<{ success: boolean; errors: number; warnings: number }> {
    if (this.activeProc) {
      vscode.window.showWarningMessage(
        "A build is already in progress. Wait for it to finish."
      );
      return { success: false, errors: 0, warnings: 0 };
    }

    const projPath = this.projectPath(project);
    const buildDir = path.join(projPath, buildConfig);

    if (!fs.existsSync(buildDir)) {
      vscode.window.showErrorMessage(
        `Build directory not found: ${buildDir}`
      );
      return { success: false, errors: 0, warnings: 0 };
    }

    this.buildChannel.show(true);
    this.diagnostics.clear();

    if (mode === "rebuild") {
      this.buildChannel.appendLine(`[build] === CLEAN ${project}/${buildConfig} ===`);
      const cleanResult = await this.runMake(projPath, buildDir, "clean");
      if (!cleanResult.success) return cleanResult;
      this.buildChannel.appendLine(`[build] === BUILD ${project}/${buildConfig} ===`);
      return this.runMake(projPath, buildDir, "all");
    }

    const target = mode === "clean" ? "clean" : "all";
    this.buildChannel.appendLine(
      `[build] === ${mode.toUpperCase()} ${project}/${buildConfig} ===`
    );
    return this.runMake(projPath, buildDir, target);
  }

  private runMake(
    projPath: string,
    buildDir: string,
    target: string
  ): Promise<{ success: boolean; errors: number; warnings: number }> {
    return new Promise((resolve) => {
      const makeCmd = this.getMakeCmd();
      const args = this.getMakeArgs(buildDir, target);
      const t0 = Date.now();

      this.buildChannel.appendLine(`[build] ${makeCmd} ${args.join(" ")}`);
      if (target === "all" && this.config.buildJobs > 1) {
        this.buildChannel.appendLine(`[build] Parallel jobs: ${this.config.buildJobs}`);
      }

      let output = "";

      try {
        this.activeProc = spawn(makeCmd, args, {
          cwd: projPath,
          env: this.getBuildEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (e: any) {
        this.buildChannel.appendLine(`[build] Failed to spawn make: ${e.message}`);
        this.activeProc = undefined;
        resolve({ success: false, errors: 0, warnings: 0 });
        return;
      }

      this.activeProc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        output += text;
        this.buildChannel.append(text);
      });

      this.activeProc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        output += text;
        this.buildChannel.append(text);
      });

      this.activeProc.on("exit", (code) => {
        const duration = Date.now() - t0;
        const success = code === 0;
        const diags = this.parseDiagnostics(output, projPath);
        this.publishDiagnostics(diags);

        const errors = diags.filter((d) => d.severity === "error").length;
        const warnings = diags.filter((d) => d.severity === "warning").length;

        if (success) {
          this.buildChannel.appendLine(
            `\n[build] ✓ Success (${duration}ms) — ${warnings} warning(s)`
          );
        } else {
          this.buildChannel.appendLine(
            `\n[build] ✗ Failed (${duration}ms) — ${errors} error(s), ${warnings} warning(s)`
          );
        }

        this.activeProc = undefined;
        resolve({ success, errors, warnings });
      });

      this.activeProc.on("error", (err) => {
        this.buildChannel.appendLine(`[build] Process error: ${err.message}`);
        this.activeProc = undefined;
        resolve({ success: false, errors: 0, warnings: 0 });
      });
    });
  }

  /** Parse CCRX compiler/linker output for errors and warnings. */
  private parseDiagnostics(output: string, _projPath: string): BuildDiagnostic[] {
    const result: BuildDiagnostic[] = [];

    // Compiler: "file.c", line 42: E0520: message
    let m: RegExpExecArray | null;
    const reCompiler = new RegExp(RE_COMPILER_DIAG.source, "g");
    while ((m = reCompiler.exec(output)) !== null) {
      const code = m[3];
      result.push({
        file: m[1],
        line: parseInt(m[2], 10),
        code,
        message: m[4],
        severity: code.startsWith("E") ? "error" : "warning",
      });
    }

    // Linker: F0553: message or W0561: message
    const reLinker = new RegExp(RE_LINKER_DIAG.source, "gm");
    while ((m = reLinker.exec(output)) !== null) {
      const code = m[1];
      const msg = m[2];
      // Avoid double-matching compiler warnings
      if (!result.some((d) => d.code === code && d.message === msg)) {
        result.push({
          file: "",
          line: 0,
          code,
          message: msg,
          severity: code.startsWith("F") ? "error" : "warning",
        });
      }
    }

    return result;
  }

  /** Publish parsed diagnostics to VS Code's Problems panel. */
  private publishDiagnostics(diags: BuildDiagnostic[]): void {
    const map = new Map<string, vscode.Diagnostic[]>();

    for (const d of diags) {
      if (!d.file) continue;
      const fileUri = vscode.Uri.file(d.file);
      const key = fileUri.toString();

      if (!map.has(key)) {
        map.set(key, []);
      }

      const line = Math.max(0, d.line - 1);
      const range = new vscode.Range(line, 0, line, 1000);
      const severity =
        d.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;

      const diag = new vscode.Diagnostic(range, `${d.code}: ${d.message}`, severity);
      diag.source = "CCRX";
      map.get(key)!.push(diag);
    }

    for (const [uriStr, diagnostics] of map) {
      this.diagnostics.set(vscode.Uri.parse(uriStr), diagnostics);
    }
  }

  dispose(): void {
    if (this.activeProc) {
      this.activeProc.kill();
    }
    this.diagnostics.dispose();
    this.buildChannel.dispose();
  }
}
