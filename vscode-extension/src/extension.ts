import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ADMConsole } from "./admConsole";
import { loadConfig, ExtensionConfig } from "./config";
import { E2McpViewProvider } from "./webviewProvider";
import { BuildRunner } from "./buildRunner";
import { FlashRunner } from "./flashRunner";
import { DebugProvider } from "./debugProvider";

let admConsole: ADMConsole | undefined;
let config: ExtensionConfig | undefined;
let viewProvider: E2McpViewProvider | undefined;
let buildRunner: BuildRunner | undefined;
let flashRunner: FlashRunner | undefined;
let debugProvider: DebugProvider | undefined;

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

  // Build & Flash runners
  buildRunner = new BuildRunner(config);
  context.subscriptions.push(buildRunner);
  flashRunner = new FlashRunner(config);
  context.subscriptions.push(flashRunner);

  // Webview sidebar panel
  viewProvider = new E2McpViewProvider(
    context.extensionUri,
    config,
    (cmd, args) => {
      switch (cmd) {
        case "selectProject":
          if (args?.project) {
            context.workspaceState.update("e2mcp.project", args.project);
            outputChannel.appendLine(
              `[e2mcp] Project: ${args.project}`
            );
            if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
              disableMcpAndHardware(outputChannel);
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
              disableMcpAndHardware(outputChannel);
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
              disableMcpAndHardware(outputChannel);
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
            disableMcpAndHardware(outputChannel);
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
          if (debugProvider && config) {
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

            viewProvider?.setBusy(true);
            const project = viewProvider?.currentProject || config.defaultProject;
            const fullConfig = debugProvider.buildConfig(project, true);
            const folder = vscode.workspace.workspaceFolders?.[0];
            vscode.debug.startDebugging(folder, fullConfig, { suppressDebugView: true });
            // setBusy(false) is handled by onDidStartDebugSession / onDidTerminateDebugSession
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
          toggleMcpServer(outputChannel);
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
      if (result.success && mode !== "clean") {
        viewProvider.refreshMemory();
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

  // Flash command
  context.subscriptions.push(
    vscode.commands.registerCommand("e2mcp.flash", async () => {
      if (!viewProvider || !flashRunner) return;
      const project = viewProvider.currentProject;
      const buildConfig = viewProvider.currentBuildConfig;
      const launchFile = viewProvider.currentLaunchFile;
      if (!project) {
        vscode.window.showWarningMessage("No project selected.");
        return;
      }
      viewProvider.setBusy(true);
      try {
        await flashRunner.flash(project, buildConfig, launchFile || undefined);
      } finally {
        viewProvider.setBusy(false);
      }
    })
  );

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

/**
 * Toggle MCP server state and manage hardware connection.
 * Disable: terminates debug session + stops ADM console + disables MCP server.
 * Enable: enables MCP server in mcp.json (VS Code restarts it, which reconnects HW).
 */
function toggleMcpServer(outputChannel: vscode.OutputChannel): void {
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
      delete server.disabled;
    } else {
      server.disabled = true;
    }
    fs.writeFileSync(mcpJson, JSON.stringify(data, null, 2) + "\n", "utf-8");
    const nowEnabled = wasDisabled;
    viewProvider?.setMcpEnabled(nowEnabled);

    if (nowEnabled) {
      outputChannel.appendLine("[e2mcp] MCP server enabled");
    } else {
      outputChannel.appendLine("[e2mcp] MCP server disabled \u2014 disconnecting hardware...");
      admConsole?.stop();
      if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
        vscode.debug.stopDebugging();
      }
    }

    const newState = nowEnabled ? "enabled" : "disabled";
    vscode.window.showInformationMessage(`MCP server ${newState}.`);
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to toggle MCP: ${e.message}`);
  }
}

/** Force-disable MCP and disconnect hardware (used on config changes). */
function disableMcpAndHardware(outputChannel: vscode.OutputChannel): void {
  const mcpJson = findMcpJson();
  if (!mcpJson) return;
  try {
    const text = fs.readFileSync(mcpJson, "utf-8");
    const data = JSON.parse(text);
    const server = data?.servers?.["e2studio-mcp"];
    if (!server || server.disabled) return;
    server.disabled = true;
    fs.writeFileSync(mcpJson, JSON.stringify(data, null, 2) + "\n", "utf-8");
    viewProvider?.setMcpEnabled(false);
    outputChannel.appendLine("[e2mcp] MCP disabled \u2014 hardware disconnected for config change");
    admConsole?.stop();
    if (vscode.debug.activeDebugSession?.type === "renesas-hardware") {
      vscode.debug.stopDebugging();
    }
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
