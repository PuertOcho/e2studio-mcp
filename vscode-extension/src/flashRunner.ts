import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import { ExtensionConfig } from "./config";

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
  private config: ExtensionConfig;
  private flashing = false;

  constructor(config: ExtensionConfig) {
    this.config = config;
    this.flashChannel = vscode.window.createOutputChannel("E2 MCP Flash");
  }

  /**
   * Flash firmware for the given project.
   * Uses the Python MCP server's flash_firmware tool via CLI invocation.
   */
  async flash(project: string, buildConfig: string, launchFile?: string): Promise<boolean> {
    if (this.flashing) {
      vscode.window.showWarningMessage("Flash already in progress.");
      return false;
    }

    this.flashing = true;
    this.flashChannel.show(true);
    this.flashChannel.appendLine(
      `[flash] Flashing ${project}/${buildConfig}...`
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
      return false;
    }

    // Invoke Python: py -c "from e2studio_mcp.flash import flash_firmware; ..."
    const script = [
      "import json",
      "from e2studio_mcp.config import load_config",
      "from e2studio_mcp.flash import flash_firmware",
      "cfg = load_config()",
      `result = flash_firmware(cfg, project=\"${this.escPy(project)}\", build_config=\"${this.escPy(buildConfig)}\", launch_file=${launchFile ? `\"${this.escPy(launchFile)}\"` : "None"})`,
      "print(json.dumps(result))",
    ].join("; ");

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, ["-c", script], {
        cwd: mcpSrcDir,
        env: {
          ...process.env,
          E2STUDIO_MCP_CONFIG: this.findConfigPath() ?? "",
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
        if (code === 0) {
          this.flashChannel.appendLine("\n[flash] ✓ Flash complete.");
          resolve(true);
        } else {
          this.flashChannel.appendLine(
            `\n[flash] ✗ Flash failed (exit code ${code}).`
          );
          if (stderr.trim()) {
            this.flashChannel.appendLine(`[flash] ${stderr.trim()}`);
          }
          resolve(false);
        }
      });

      proc.on("error", (err) => {
        this.flashing = false;
        this.flashChannel.appendLine(`[flash] Process error: ${err.message}`);
        resolve(false);
      });
    });
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

  private findConfigPath(): string | undefined {
    if (process.env.E2STUDIO_MCP_CONFIG) return process.env.E2STUDIO_MCP_CONFIG;

    const settingPath = vscode.workspace
      .getConfiguration("e2mcp")
      .get<string>("configPath");
    if (settingPath && require("fs").existsSync(settingPath)) return settingPath;

    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        for (const sub of [
          "e2Studio_2024_workspace/e2studio-mcp/e2studio-mcp.json",
          "e2studio-mcp/e2studio-mcp.json",
          "e2studio-mcp.json",
        ]) {
          const candidate = path.join(folder.uri.fsPath, sub);
          if (require("fs").existsSync(candidate)) return candidate;
        }
      }
    }
    return undefined;
  }

  private escPy(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  dispose(): void {
    this.flashChannel.dispose();
  }
}
