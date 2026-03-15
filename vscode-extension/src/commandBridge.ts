/**
 * HTTP command bridge — allows external processes (Python MCP server) to
 * trigger VS Code extension commands and get results back.
 *
 * The bridge listens on a random localhost port and writes the port number
 * to a well-known file so the Python MCP server can discover it.
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BuildRunner } from "./buildRunner";
import { DebugProvider } from "./debugProvider";
import { E2McpViewProvider } from "./webviewProvider";
import { ADMConsole } from "./admConsole";

export class CommandBridge implements vscode.Disposable {
  private server: http.Server | undefined;
  private port = 0;
  private portFilePath: string;

  constructor(
    private workspace: string,
    private buildRunner: BuildRunner,
    private debugProvider: DebugProvider,
    private viewProvider: E2McpViewProvider,
    private admConsole?: ADMConsole,
  ) {
    this.portFilePath = path.join(workspace, "e2studio-mcp", ".bridge-port");
  }

  async start(): Promise<number> {
    if (this.server) {
      return this.port;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/command") {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        // Only accept connections from localhost
        const remoteAddr = req.socket.remoteAddress;
        if (remoteAddr !== "127.0.0.1" && remoteAddr !== "::1" && remoteAddr !== "::ffff:127.0.0.1") {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "Forbidden" }));
          return;
        }

        let body = "";
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          this.handleCommand(body)
            .then((result) => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            })
            .catch((err: Error) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
            });
        });
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr !== "string") {
          this.port = addr.port;
          this.writePortFile();
          resolve(this.port);
        } else {
          reject(new Error("Failed to get bridge port"));
        }
      });

      this.server.on("error", (err) => reject(err));
    });
  }

  private async handleCommand(body: string): Promise<Record<string, unknown>> {
    let parsed: { command: string; args?: Record<string, unknown> };
    try {
      parsed = JSON.parse(body);
    } catch {
      return { error: "Invalid JSON" };
    }

    const { command, args } = parsed;
    const project = (args?.project as string) || this.viewProvider.currentProject;
    const buildConfig = (args?.config as string) || this.viewProvider.currentBuildConfig;

    // If caller specified a project explicitly, update the sidebar selector
    if (args?.project && typeof args.project === "string" && args.project !== this.viewProvider.currentProject) {
      this.viewProvider.setSelectedProject(args.project as string);
      this.viewProvider.updateWebview();
    }

    switch (command) {
      case "build":
      case "clean":
      case "rebuild": {
        if (!project) {
          return { error: "No project selected" };
        }
        const result = await this.buildRunner.build(project, buildConfig, command);
        return {
          success: result.success,
          errors: result.errors,
          warnings: result.warnings,
        };
      }

      case "debug": {
        if (!project) {
          return { error: "No project selected" };
        }
        if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
          return { error: "Debug session already active" };
        }

        const buildResult = await this.buildRunner.build(project, buildConfig, "build");
        this.viewProvider.updateWebview();
        if (!buildResult.success) {
          return {
            success: false,
            error: "Build failed. Debug session was not started.",
            errors: buildResult.errors,
            warnings: buildResult.warnings,
          };
        }

        const fullConfig = this.debugProvider.buildConfig(project, true);
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          return { success: false, error: "No workspace folder available for debug session." };
        }

        // If args.dryRun is set, return the config without starting debug
        if (args?.dryRun) {
          return { success: true, dryRun: true, config: fullConfig };
        }

        const started = await vscode.debug.startDebugging(folder, fullConfig, {
          suppressDebugView: true,
        });
        if (!started) {
          return { success: false, error: "Renesas debug adapter rejected the session start.", config: fullConfig };
        }

        return { success: true };
      }

      case "stopDebug": {
        const session = vscode.debug.activeDebugSession;
        if (session?.type === "renesas-hardware") {
          await vscode.debug.stopDebugging(session);
          return { success: true };
        }
        return { error: "No active debug session" };
      }

      case "debugStatus": {
        const session = vscode.debug.activeDebugSession;
        return {
          active: session?.type === "renesas-hardware",
          name: session?.name ?? null,
        };
      }

      case "evaluate": {
        const session = vscode.debug.activeDebugSession;
        if (!session || session.type !== "renesas-hardware") {
          return { error: "No active Renesas debug session" };
        }
        const expression = args?.expression as string;
        if (!expression) {
          return { error: "No expression provided" };
        }
        try {
          const result = await session.customRequest("evaluate", {
            expression,
            context: "repl",
          });
          return { success: true, result: result?.result ?? result };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: msg };
        }
      }

      case "getState": {
        return {
          project: this.viewProvider.currentProject,
          buildConfig: this.viewProvider.currentBuildConfig,
          debugger: this.viewProvider.currentDebugger,
          launchFile: this.viewProvider.currentLaunchFile,
        };
      }

      case "inspectDebugConfig": {
        if (!project) {
          return { error: "No project selected" };
        }
        return this.debugProvider.buildConfig(project, true);
      }

      case "getAdmLog": {
        const log = this.admConsole?.getLog() ?? "";
        return {
          success: true,
          text: log,
          bytesRead: log.length,
          running: this.admConsole?.isRunning ?? false,
        };
      }

      default:
        return { error: `Unknown command: ${command}` };
    }
  }

  private writePortFile(): void {
    try {
      const dir = path.dirname(this.portFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.portFilePath, String(this.port), "utf-8");
    } catch {
      // Non-fatal — MCP will fall back to independent execution
    }
  }

  dispose(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    try {
      if (fs.existsSync(this.portFilePath)) {
        fs.unlinkSync(this.portFilePath);
      }
    } catch { /* ignore */ }
  }
}
