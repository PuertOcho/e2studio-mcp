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

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.channel = vscode.window.createOutputChannel(
      "Renesas Virtual Console"
    );
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
      .getConfiguration("e2studio-rx")
      .get<string>("pythonPath", "py");

    const pollMs = vscode.workspace
      .getConfiguration("e2studio-rx")
      .get<number>("consolePollMs", 500);

    const scriptPath = this.findAdmScript();
    if (!scriptPath) {
      this.channel.appendLine(
        "[console] ERROR: adm_console.py not found. " +
          "Expected in e2studio-mcp/scripts/adm_console.py"
      );
      return;
    }

    const args = [scriptPath, "--raw", "--poll", String(pollMs)];

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

  /**
   * Find adm_console.py relative to the extension or workspace.
   *
   * Search order:
   * 1. Same repo: ../scripts/adm_console.py (relative to extension)
   * 2. Workspace folders containing e2studio-mcp/scripts/adm_console.py
   */
  private findAdmScript(): string | undefined {
    // 1. Relative to the extension's install location
    //    Extension is in vscode-extension/, script is in scripts/
    const extDir = this.context.extensionPath;
    const relativeFromExt = path.join(
      extDir,
      "..",
      "scripts",
      "adm_console.py"
    );
    if (require("fs").existsSync(relativeFromExt)) {
      return relativeFromExt;
    }

    // 2. Search workspace folders
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        for (const sub of [
          "e2Studio_2024_workspace/e2studio-mcp/scripts/adm_console.py",
          "e2studio-mcp/scripts/adm_console.py",
          "scripts/adm_console.py",
          "Scripts/adm_console.py",
        ]) {
          const candidate = path.join(folder.uri.fsPath, sub);
          if (require("fs").existsSync(candidate)) {
            return candidate;
          }
        }
      }
    }

    return undefined;
  }
}
