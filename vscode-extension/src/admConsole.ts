import * as vscode from "vscode";
import * as path from "path";
import { ChildProcess, spawn } from "child_process";

/**
 * Manages the ADM Virtual Console OutputChannel.
 *
 * Spawns `adm_console.py --raw` as a child process and pipes its stdout
 * into a VS Code OutputChannel. Auto-starts on Renesas debug sessions,
 * auto-stops when the session ends.
 */
export class ADMConsole implements vscode.Disposable {
  private channel: vscode.OutputChannel;
  private proc: ChildProcess | undefined;
  private context: vscode.ExtensionContext;
  private starting = false;
  private outputListeners: Array<(text: string) => void> = [];
  private logBuffer = "";
  private static readonly MAX_LOG_BYTES = 64 * 1024;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.channel = vscode.window.createOutputChannel(
      "Renesas Virtual Console"
    );
  }

  /** Get the accumulated console log (ring buffer, last 64KB). */
  getLog(): string {
    return this.logBuffer;
  }

  /** Whether the ADM console process is alive. */
  get isRunning(): boolean {
    return !!this.proc;
  }

  /** Register a listener that receives console output (used by webview). */
  onOutput(listener: (text: string) => void): void {
    this.outputListeners.push(listener);
  }

  /**
   * Start console automatically when a debug session begins.
   * Waits a short delay for e2-server-gdb to open the ADM port.
   */
  startOnDebug(): void {
    if (this.proc || this.starting) {
      return;
    }
    this.starting = true;
    this.channel.show(true); // show but don't steal focus
    this.channel.appendLine(
      "[console] Debug session detected — waiting for ADM port..."
    );

    // Give e2-server-gdb 5s to open the ADM port before spawning the script
    setTimeout(() => {
      this.starting = false;
      this.spawnConsole();
    }, 5000);
  }

  /** Manually start the console (from command palette). */
  startManual(): void {
    if (this.proc) {
      this.channel.show(true);
      return;
    }
    this.channel.show(true);
    this.channel.appendLine("[console] Starting virtual console...");
    this.spawnConsole();
  }

  /** Stop the console process. */
  stop(): void {
    this.starting = false;
    if (this.proc) {
      this.channel.appendLine("[console] Stopping...");
      this.proc.kill();
      this.proc = undefined;
    }
  }

  dispose(): void {
    this.stop();
    this.channel.dispose();
  }

  private spawnConsole(): void {
    if (this.proc) {
      return;
    }

    const pythonPath = vscode.workspace
      .getConfiguration("e2mcp")
      .get<string>("pythonPath", "py");

    const pollMs = vscode.workspace
      .getConfiguration("e2mcp")
      .get<number>("consolePollMs", 500);

    const scriptPath = this.findAdmScript();
    if (!scriptPath) {
      this.channel.appendLine(
        "[console] ERROR: adm_console.py not found."
      );
      return;
    }

    const logfilePath = this.getRuntimeLogPath();
    const args = [scriptPath, "--raw", "--poll", String(pollMs), "--logfile", logfilePath];

    this.channel.appendLine(
      `[console] Spawning: ${pythonPath} ${args.join(" ")}`
    );

    try {
      this.proc = spawn(pythonPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e: any) {
      this.channel.appendLine(`[console] Failed to spawn: ${e.message}`);
      this.proc = undefined;
      return;
    }

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      this.channel.append(text);
      this.logBuffer += text;
      if (this.logBuffer.length > ADMConsole.MAX_LOG_BYTES) {
        this.logBuffer = this.logBuffer.slice(-ADMConsole.MAX_LOG_BYTES);
      }
      for (const listener of this.outputListeners) {
        listener(text);
      }
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (text) {
        this.channel.appendLine(`[console:err] ${text}`);
      }
    });

    this.proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        this.channel.appendLine(`[console] Process exited with code ${code}`);
      }
      this.proc = undefined;
    });

    this.proc.on("error", (err) => {
      this.channel.appendLine(`[console] Process error: ${err.message}`);
      this.proc = undefined;
    });
  }

  private getRuntimeLogPath(): string {
    const configuredWorkspace = vscode.workspace
      .getConfiguration("e2mcp")
      .get<string>("workspace", "")
      .trim();
    const configuredProjectsPath = vscode.workspace
      .getConfiguration("e2mcp")
      .get<string>("projectsPath", "")
      .trim();
    const workspaceRoot = configuredWorkspace
      || configuredProjectsPath
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      || this.context.extensionPath;
    return path.join(workspaceRoot, ".e2mcp", ".adm-log");
  }

  /**
   * Find adm_console.py relative to the extension.
   *
   * Search order:
   * 1. Bundled inside extension (installed via .vsix)
   * 2. Sibling scripts/ folder (dev layout)
   */
  private findAdmScript(): string | undefined {
    const extDir = this.context.extensionPath;

    // 1. Bundled inside the extension (installed via .vsix)
    const bundled = path.join(extDir, "bundled", "scripts", "adm_console.py");
    if (require("fs").existsSync(bundled)) {
      return bundled;
    }

    // 2. Relative to the extension's install location (dev layout)
    const relativeFromExt = path.join(
      extDir,
      "..",
      "scripts",
      "adm_console.py"
    );
    if (require("fs").existsSync(relativeFromExt)) {
      return relativeFromExt;
    }

    return undefined;
  }
}
