import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import { ExtensionConfig } from "./config";

export interface FlashResult {
  success: boolean;
  error?: string;
  durationMs?: number;
  bytesWritten?: number;
  verified?: boolean;
  running?: boolean;
  device?: string;
  project?: string;
  flashedFile?: string;
}

/**
 * Flash firmware to target via the Python MCP flash module.
 *
 * Spawns: py -m e2studio_mcp.server_flash <project> <config>
 * Or directly calls e2-server-gdb + GDB RSP sequence.
 *
 * For simplicity, we delegate to the Python flash.py via a one-shot subprocess.
 */
export class FlashRunner implements vscode.Disposable {
  private flashChannel: vscode.OutputChannel;
  private flashing = false;

  constructor(private _config: ExtensionConfig) {
    this.flashChannel = vscode.window.createOutputChannel("E2 MCP Flash");
  }

  /**
   * Flash firmware for the given project.
   * Uses the Python MCP server's flash_firmware tool via CLI invocation.
   */
  async flash(
    project: string,
    buildConfig: string,
    launchFile?: string,
    options?: { runAfterFlash?: boolean }
  ): Promise<FlashResult> {
    if (this.flashing) {
      vscode.window.showWarningMessage("Flash already in progress.");
      return { success: false, error: "Flash already in progress." };
    }

    const runAfterFlash = options?.runAfterFlash ?? false;

    this.flashing = true;
    this.flashChannel.show(true);
    this.flashChannel.appendLine(
      `[flash] ${runAfterFlash ? "Flash+Run" : "Flash"} ${project}/${buildConfig}...`
    );

    const pythonPath = vscode.workspace
      .getConfiguration("e2mcp")
      .get<string>("pythonPath", "py");

    // Find the MCP server source directory
    const mcpSrcDir = this.findMcpSrc();
    if (!mcpSrcDir) {
      this.flashChannel.appendLine(
        "[flash] ERROR: e2studio_mcp source not found."
      );
      this.flashing = false;
      return { success: false, error: "e2studio_mcp source not found." };
    }

    // Invoke Python: py -c "from e2studio_mcp.flash import flash_firmware; ..."
    const script = [
      "import json",
      "from e2studio_mcp.config import load_config",
      "from e2studio_mcp.flash import flash_firmware",
      "cfg = load_config()",
      `result = flash_firmware(cfg, project=\"${this.escPy(project)}\", build_config=\"${this.escPy(buildConfig)}\", launch_file=${launchFile ? `\"${this.escPy(launchFile)}\"` : "None"}, run_after_flash=${runAfterFlash ? "True" : "False"})`,
      "print(json.dumps(result))",
    ].join("; ");

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, ["-c", script], {
        cwd: mcpSrcDir,
        env: {
          ...process.env,
          ...this.buildMcpEnv(),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stdout += text;
        this.flashChannel.append(text);
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderr += text;
        this.flashChannel.append(text);
      });

      proc.on("exit", (code) => {
        this.flashing = false;
        const result = this.parseResult(stdout);

        if (code === 0 && result?.success) {
          const verb = runAfterFlash ? "Flash+Run" : "Flash";
          const summary = [
            `${result.bytesWritten ?? 0} bytes`,
            `verified=${result.verified ? "true" : "false"}`,
            runAfterFlash ? `running=${result.running ? "true" : "false"}` : undefined,
          ].filter(Boolean).join(", ");
          this.flashChannel.appendLine(`\n[flash] ✓ ${verb} complete. ${summary}`);
          resolve(result);
          return;
        }

        const error = result?.error || stderr.trim() || `Flash failed (exit code ${code}).`;
        this.flashChannel.appendLine(`\n[flash] ✗ ${error}`);
        resolve(result ?? { success: false, error });
      });

      proc.on("error", (err) => {
        this.flashing = false;
        this.flashChannel.appendLine(`[flash] Process error: ${err.message}`);
        resolve({ success: false, error: err.message });
      });
    });
  }

  private parseResult(stdout: string): FlashResult | undefined {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]) as FlashResult;
      } catch {
        // Keep scanning backwards until we find the JSON result line.
      }
    }
    return undefined;
  }

  private findMcpSrc(): string | undefined {
    // Search for the MCP src directory relative to extension
    const candidates: string[] = [];
    const extDir = path.dirname(path.dirname(__dirname));
    candidates.push(path.join(extDir, "src"));
    candidates.push(path.join(extDir, "..", "e2studio-mcp", "src"));

    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        candidates.push(
          path.join(
            folder.uri.fsPath,
            "e2Studio_2024_workspace",
            "e2studio-mcp",
            "src"
          )
        );
        candidates.push(
          path.join(folder.uri.fsPath, "e2studio-mcp", "src")
        );
      }
    }

    for (const c of candidates) {
      if (
        require("fs").existsSync(
          path.join(c, "e2studio_mcp", "flash.py")
        )
      ) {
        return c;
      }
    }
    return undefined;
  }

  /** Build E2MCP_* env vars from the current VS Code configuration. */
  private buildMcpEnv(): Record<string, string> {
    const c = this._config;
    return {
      E2MCP_WORKSPACE: c.workspace,
      E2MCP_PROJECT: c.defaultProject,
      E2MCP_BUILD_CONFIG: c.buildConfig,
      E2MCP_BUILD_MODE: c.buildMode,
      E2MCP_BUILD_JOBS: String(c.buildJobs),
      E2MCP_E2STUDIO_PATH: c.toolchain.e2studioPath,
      E2MCP_CCRX_PATH: c.toolchain.ccrxPath,
      E2MCP_MAKE_PATH: c.toolchain.makePath,
    };
  }

  private escPy(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  dispose(): void {
    this.flashChannel.dispose();
  }
}
