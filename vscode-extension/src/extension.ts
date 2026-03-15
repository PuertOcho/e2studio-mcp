import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { ADMConsole } from "./admConsole";
import { loadConfig, ExtensionConfig } from "./config";
import { E2McpViewProvider } from "./webviewProvider";
import { BuildRunner } from "./buildRunner";
import { DebugProvider } from "./debugProvider";
import { FlashRunner } from "./flashRunner";
import { CommandBridge } from "./commandBridge";

let admConsole: ADMConsole | undefined;
let config: ExtensionConfig | undefined;
let viewProvider: E2McpViewProvider | undefined;
let buildRunner: BuildRunner | undefined;
let debugProvider: DebugProvider | undefined;
let flashRunner: FlashRunner | undefined;
let commandBridge: CommandBridge | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("E2 MCP");
  outputChannel.appendLine("[e2mcp] Activating...");

  // Load config
  try {
    config = loadConfig();
    outputChannel.appendLine(
      `[e2mcp] Config loaded: workspace=${config.workspace}, project=${config.defaultProject}`
    );
  } catch (e: any) {
    outputChannel.appendLine(
      `[e2mcp] Warning: config not found (${e.message}). Using defaults.`
    );
    config = {
      workspace: "",
      defaultProject: "headc-fw",
      buildConfig: "HardwareDebug",
      buildMode: "make",
      buildJobs: 16,
      toolchain: { ccrxPath: "", e2studioPath: "", makePath: "" },
      flash: {
        debugger: "E2Lite",
        device: "R5F5651E",
        gdbPort: 61234,
        debugToolsPath: "",
        python3BinPath: "",
        gdbExecutable: "rx-elf-gdb",
        inputClock: "24.0",
        idCode: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      },
      devices: {},
    };
  }

  // ADM Virtual Console
  admConsole = new ADMConsole(context);
  context.subscriptions.push(admConsole);

  // Build runner
  buildRunner = new BuildRunner(config);
  context.subscriptions.push(buildRunner);

  // Flash runner
  flashRunner = new FlashRunner(config);
  context.subscriptions.push(flashRunner);

  // Webview sidebar panel
  viewProvider = new E2McpViewProvider(
    context.extensionUri,
    config,
    async (cmd, args) => {
      switch (cmd) {
        case "selectProject":
          if (args?.project) {
            context.workspaceState.update("e2mcp.project", args.project);
            outputChannel.appendLine(
              `[e2mcp] Project: ${args.project}`
            );
            if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
              await disableMcpAndHardware(outputChannel);
              vscode.window.showInformationMessage(
                "Configuration changed \u2014 hardware disconnected. Re-enable MCP to reconnect."
              );
            }
          }
          break;
        case "selectDebugger":
          if (args?.debugger) {
            viewProvider?.setSelectedDebugger(args.debugger);
            const label =
              args.debugger === "E2LITE"
                ? "E2 Lite"
                : args.debugger === "JLINK"
                  ? "J-Link"
                  : args.debugger;
            context.workspaceState.update("e2mcp.debugger", args.debugger);
            outputChannel.appendLine(
              `[e2mcp] Debugger: ${label}`
            );
            if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
              await disableMcpAndHardware(outputChannel);
              vscode.window.showInformationMessage(
                "Configuration changed \u2014 hardware disconnected. Re-enable MCP to reconnect."
              );
            }
          }
          break;
        case "selectBuildConfig":
          if (args?.config) {
            viewProvider?.setSelectedBuildConfig(args.config);
            context.workspaceState.update("e2mcp.buildConfig", args.config);
            if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
              await disableMcpAndHardware(outputChannel);
              vscode.window.showInformationMessage(
                "Configuration changed \u2014 hardware disconnected. Re-enable MCP to reconnect."
              );
            }
          }
          break;
        case "selectLaunchFile":
          viewProvider?.setSelectedLaunchFile(args?.launchFile ?? "");
          context.workspaceState.update("e2mcp.launchFile", args?.launchFile ?? "");
          if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
            await disableMcpAndHardware(outputChannel);
            vscode.window.showInformationMessage(
              "Configuration changed \u2014 hardware disconnected. Re-enable MCP to reconnect."
            );
          }
          break;
        case "build":
          vscode.commands.executeCommand("e2mcp.build");
          break;
        case "clean":
          vscode.commands.executeCommand("e2mcp.clean");
          break;
        case "rebuild":
          vscode.commands.executeCommand("e2mcp.rebuild");
          break;
        case "flash":
          vscode.commands.executeCommand("e2mcp.flash");
          break;
        case "debug": {
          if (debugProvider && config && buildRunner) {
            // Prevent attempting to start a new session while one is active
            if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
              vscode.window.showInformationMessage(
                "A debug session is already active.",
                "Restart Session", "Cancel"
              ).then((resp) => {
                if (resp === "Restart Session") {
                  vscode.commands.executeCommand("workbench.action.debug.restart");
                }
              });
              break;
            }

            // Best-effort: warn if e2 Studio IDE is open
            if (!await warnIfE2StudioOpen()) break;

            viewProvider?.setBusy(true);
            const project = viewProvider?.currentProject || config.defaultProject;
            const buildConfig = viewProvider?.currentBuildConfig || config.buildConfig;

            try {
              const buildResult = await buildRunner.build(project, buildConfig, "build");
              viewProvider?.refreshMemory();
              viewProvider?.updateWebview();

              if (!buildResult.success) {
                vscode.window.showWarningMessage(
                  "Build failed. Debug session was not started."
                );
                viewProvider?.setBusy(false);
                break;
              }

              const fullConfig = debugProvider.buildConfig(project, true);
              const folder = vscode.workspace.workspaceFolders?.[0];
              const started = await vscode.debug.startDebugging(folder, fullConfig, { suppressDebugView: true });
              if (!started) {
                viewProvider?.setBusy(false);
                vscode.window.showErrorMessage(
                  "Failed to start Renesas debug session."
                );
              }
              // setBusy(false) is handled by onDidStartDebugSession / onDidTerminateDebugSession
            } catch (e: any) {
              viewProvider?.setBusy(false);
              vscode.window.showErrorMessage(
                `Debug startup failed: ${e.message}`
              );
            }
          }
          break;
        }
        case "stopDebug": {
          const session = vscode.debug.activeDebugSession;
          if (session?.type === "renesas-hardware") {
            vscode.debug.stopDebugging(session);
          } else {
            vscode.window.showInformationMessage(
              "No active Renesas debug session to stop."
            );
          }
          break;
        }
        case "toggleMcp":
          await toggleMcpServer(outputChannel);
          break;
      }
    }
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      E2McpViewProvider.viewType,
      viewProvider
    )
  );

  // Dynamic debug configuration provider (F5 without launch.json)
  debugProvider = new DebugProvider(config, viewProvider);
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("renesas-hardware", debugProvider)
  );

  // Command bridge for Python MCP server
  commandBridge = new CommandBridge(config.workspace, buildRunner, debugProvider, viewProvider, admConsole);
  commandBridge.start().then((port) => {
    outputChannel.appendLine(`[e2mcp] Command bridge listening on port ${port}`);
  }).catch((err: Error) => {
    outputChannel.appendLine(`[e2mcp] Command bridge failed: ${err.message}`);
  });
  context.subscriptions.push(commandBridge);

  // Restore persisted selections
  const savedProject = context.workspaceState.get<string>("e2mcp.project");
  const savedDebugger = context.workspaceState.get<string>("e2mcp.debugger");
  const savedBuildConfig = context.workspaceState.get<string>("e2mcp.buildConfig");
  const savedLaunchFile = context.workspaceState.get<string>("e2mcp.launchFile");
  viewProvider.restoreState(savedProject, savedDebugger, savedBuildConfig, savedLaunchFile);
  viewProvider.setDebugActive(
    vscode.debug.activeDebugSession?.type === "renesas-hardware"
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.openConsole", () => {
      admConsole?.startManual();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.selectProject", async () => {
      const projects = viewProvider
        ? viewProvider.projects.map((p) => p.name)
        : ["headc-fw", "headc_v2_fw", "headc-v2-bloader"];
      const pick = await vscode.window.showQuickPick(projects, {
        placeHolder: "Select e2 Studio project",
      });
      if (pick) {
        viewProvider?.setSelectedProject(pick);
        viewProvider?.refreshMemory();
        viewProvider?.updateWebview();
        context.workspaceState.update("e2mcp.project", pick);
        outputChannel.appendLine(`[e2mcp] Project: ${pick}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "e2mcp.selectDebugger",
      async () => {
        const debuggers = [
          { label: "E2 Lite", value: "E2LITE" },
          { label: "E1", value: "E1" },
          { label: "E2", value: "E2" },
          { label: "J-Link", value: "JLINK" },
          { label: "Simulator", value: "SIMULATOR" },
        ];
        const pick = await vscode.window.showQuickPick(debuggers, {
          placeHolder: "Select debug probe",
        });
        if (pick) {
          viewProvider?.setSelectedDebugger(pick.value);
          viewProvider?.updateWebview();
          context.workspaceState.update("e2mcp.debugger", pick.value);
          outputChannel.appendLine(
            `[e2mcp] Debugger: ${pick.label} (${pick.value})`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.selectLaunch", async () => {
      const project = viewProvider?.currentProject;
      const projectInfo = viewProvider?.projects.find((p) => p.name === project);
      const launchFiles = projectInfo?.launchFiles ?? [];
      const picks = [
        { label: "Auto Launch", value: "" },
        ...launchFiles.map((launchFile) => ({ label: launchFile, value: launchFile })),
      ];
      const pick = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select .launch file for debug/flash",
      });
      if (pick) {
        viewProvider?.setSelectedLaunchFile(pick.value);
        viewProvider?.updateWebview();
        context.workspaceState.update("e2mcp.launchFile", pick.value);
        outputChannel.appendLine(`[e2mcp] Launch file: ${pick.label}`);
      }
    })
  );

  // Build commands
  const runBuild = async (mode: "build" | "clean" | "rebuild") => {
    if (!viewProvider || !buildRunner) return;
    const project = viewProvider.currentProject;
    const buildConfig = viewProvider.currentBuildConfig;
    if (!project) {
      vscode.window.showWarningMessage("No project selected.");
      return;
    }
    viewProvider.setBusy(true);
    try {
      const result = await buildRunner.build(project, buildConfig, mode);
      const hint = mode === "clean" ? "cleaned" as const
        : result.success ? "none" as const : "build-failed" as const;
      viewProvider.refreshMemory(hint);
      if (result.success) {
        viewProvider.updateWebview();
      }
    } finally {
      viewProvider.setBusy(false);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.build", () => runBuild("build"))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.clean", () => runBuild("clean"))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.rebuild", () => runBuild("rebuild"))
  );

  // Flash command (flash only, no debug session)
  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.flash", async () => {
      if (!viewProvider || !buildRunner || !flashRunner || !config) return;

      if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
        vscode.window.showWarningMessage("Cannot flash while a debug session is active. Stop the session first.");
        return;
      }

      if (!await warnIfE2StudioOpen()) return;

      const project = viewProvider.currentProject || config.defaultProject;
      const buildConfig = viewProvider.currentBuildConfig || config.buildConfig;
      const launchFile = viewProvider.currentLaunchFile || undefined;

      viewProvider.setBusy(true);
      try {
        // Build first
        const buildResult = await buildRunner.build(project, buildConfig, "build");
        viewProvider.refreshMemory();
        viewProvider.updateWebview();

        if (!buildResult.success) {
          vscode.window.showWarningMessage("Build failed. Flash was not started.");
          return;
        }

        // Flash
        const result = await flashRunner.flash(project, buildConfig, launchFile, { runAfterFlash: true });
        if (result.success) {
          const summary = `${result.bytesWritten ?? 0} bytes, verified=${result.verified ? "true" : "false"}`;
          vscode.window.showInformationMessage(`Flash complete. ${summary}`);
        } else {
          vscode.window.showErrorMessage(`Flash failed: ${result.error ?? "unknown error"}`);
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Flash failed: ${e.message}`);
      } finally {
        viewProvider.setBusy(false);
      }
    })
  );

  // Stop debug command
  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.stopDebug", () => {
      const session = vscode.debug.activeDebugSession;
      if (session?.type === "renesas-hardware") {
        vscode.debug.stopDebugging(session);
        return;
      }
      vscode.window.showInformationMessage(
        "No active Renesas debug session to stop."
      );
    })
  );

  // Auto-start console on Renesas debug session
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((session) => {
      if (session.type === "renesas-hardware") {
        outputChannel.appendLine(
          `[e2mcp] Debug session started: ${session.name}`
        );
        viewProvider?.setBusy(false);
        viewProvider?.setDebugActive(true);
        admConsole?.startOnDebug();
      }
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.type === "renesas-hardware") {
        outputChannel.appendLine(
          `[e2mcp] Debug session ended: ${session.name}`
        );
        viewProvider?.setBusy(false);
        viewProvider?.setDebugActive(false);
        admConsole?.stop();
      }
    })
  );

  // Sync initial MCP toggle state
  syncMcpToggleState();

  outputChannel.appendLine("[e2mcp] Activated successfully.");
}

/** Read mcp.json and sync toggle state to webview. */
function syncMcpToggleState(): void {
  const mcpJson = findMcpJson();
  if (!mcpJson) return;
  try {
    const data = JSON.parse(fs.readFileSync(mcpJson, "utf-8"));
    const server = data?.servers?.["e2studio-mcp"];
    const enabled = server ? !server.disabled : true;
    viewProvider?.setMcpEnabled(enabled);
  } catch { /* ignore */ }
}

/** Wait for the active Renesas debug session to actually terminate. */
function waitForDebugSessionEnd(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const session = vscode.debug.activeDebugSession;
    if (!session || session.type !== "renesas-hardware") {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => { disposable.dispose(); resolve(false); }, timeoutMs);
    const disposable = vscode.debug.onDidTerminateDebugSession((ended) => {
      if (ended.type === "renesas-hardware") {
        clearTimeout(timer);
        disposable.dispose();
        resolve(true);
      }
    });
  });
}

/** Best-effort detection: is the e2 Studio IDE running? */
function isE2StudioRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    cp.execFile("powershell", [
      "-NoProfile", "-Command",
      "!!(Get-Process -Name 'e2studio' -ErrorAction SilentlyContinue)",
    ], { timeout: 3000 }, (_err, stdout) => {
      resolve(stdout?.trim() === "True");
    });
  });
}

/** Warn user if e2 Studio appears open. Returns true to proceed, false to cancel. */
async function warnIfE2StudioOpen(): Promise<boolean> {
  const running = await isE2StudioRunning();
  if (!running) return true;
  const choice = await vscode.window.showWarningMessage(
    "e2 Studio appears to be running. Using the debug probe from VS Code may cause conflicts.",
    "Continue Anyway", "Cancel"
  );
  return choice === "Continue Anyway";
}

/**
 * Toggle MCP server state and manage hardware connection.
 * Disable: terminates debug session + stops ADM console + disables MCP server.
 * Enable: enables MCP server in mcp.json (VS Code restarts it, which reconnects HW).
 */
async function toggleMcpServer(outputChannel: vscode.OutputChannel): Promise<void> {
  const mcpJson = findMcpJson();
  if (!mcpJson) {
    vscode.window.showWarningMessage("Could not find .vscode/mcp.json");
    return;
  }
  try {
    const text = fs.readFileSync(mcpJson, "utf-8");
    const data = JSON.parse(text);
    const server = data?.servers?.["e2studio-mcp"];
    if (!server) {
      vscode.window.showWarningMessage("e2studio-mcp server not found in mcp.json");
      return;
    }
    const wasDisabled = !!server.disabled;
    if (wasDisabled) {
      // Enable path — straightforward
      delete server.disabled;
      fs.writeFileSync(mcpJson, JSON.stringify(data, null, 2) + "\n", "utf-8");
      viewProvider?.setMcpEnabled(true);
      outputChannel.appendLine("[e2mcp] MCP server enabled");
      vscode.window.showInformationMessage("MCP server enabled.");
    } else {
      // Disable path — release hardware first, then update config
      outputChannel.appendLine("[e2mcp] MCP server disabling \u2014 releasing hardware...");
      admConsole?.stop();

      let hwReleased = true;
      if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
        await vscode.debug.stopDebugging();
        hwReleased = await waitForDebugSessionEnd(5000);
      }

      server.disabled = true;
      fs.writeFileSync(mcpJson, JSON.stringify(data, null, 2) + "\n", "utf-8");
      viewProvider?.setMcpEnabled(false);

      if (hwReleased) {
        outputChannel.appendLine("[e2mcp] MCP server disabled \u2014 hardware released");
        vscode.window.showInformationMessage("MCP server disabled \u2014 hardware released.");
      } else {
        outputChannel.appendLine("[e2mcp] MCP server disabled \u2014 WARNING: debug session did not terminate within 5 s");
        vscode.window.showWarningMessage(
          "MCP server disabled, but the debug session did not terminate in time. " +
          "The hardware probe may still be locked \u2014 check the Debug panel or restart VS Code."
        );
      }
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to toggle MCP: ${e.message}`);
  }
}

/** Force-disable MCP and disconnect hardware (used on config changes). */
async function disableMcpAndHardware(outputChannel: vscode.OutputChannel): Promise<void> {
  const mcpJson = findMcpJson();
  if (!mcpJson) return;
  try {
    const text = fs.readFileSync(mcpJson, "utf-8");
    const data = JSON.parse(text);
    const server = data?.servers?.["e2studio-mcp"];
    if (!server || server.disabled) return;

    admConsole?.stop();
    if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
      await vscode.debug.stopDebugging();
      await waitForDebugSessionEnd(5000);
    }

    server.disabled = true;
    fs.writeFileSync(mcpJson, JSON.stringify(data, null, 2) + "\n", "utf-8");
    viewProvider?.setMcpEnabled(false);
    outputChannel.appendLine("[e2mcp] MCP disabled \u2014 hardware released for config change");
  } catch { /* ignore */ }
}

/** Locate .vscode/mcp.json in any workspace folder. */
function findMcpJson(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidate = path.join(folder.uri.fsPath, ".vscode", "mcp.json");
    if (fs.existsSync(candidate)) return candidate;
  }
  // Also try inside e2studio-mcp itself
  if (config) {
    const candidate = path.join(config.workspace, "e2studio-mcp", ".vscode", "mcp.json");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function deactivate(): void {
  admConsole?.stop();
}
