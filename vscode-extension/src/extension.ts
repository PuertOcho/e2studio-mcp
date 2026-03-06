import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ADMConsole } from "./admConsole";
import { StatusBar } from "./statusBar";
import { loadConfig, ExtensionConfig } from "./config";
import { E2McpViewProvider } from "./webviewProvider";
import { BuildRunner } from "./buildRunner";
import { FlashRunner } from "./flashRunner";
import { DebugProvider } from "./debugProvider";

let admConsole: ADMConsole | undefined;
let statusBar: StatusBar | undefined;
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

  // Status bar
  statusBar = new StatusBar(config);
  context.subscriptions.push(statusBar);

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
            statusBar?.setProject(args.project);
            context.workspaceState.update("e2mcp.project", args.project);
            outputChannel.appendLine(
              `[e2mcp] Project: ${args.project}`
            );
          }
          break;
        case "selectDebugger":
          if (args?.debugger) {
            const label =
              args.debugger === "E2LITE"
                ? "E2 Lite"
                : args.debugger === "JLINK"
                  ? "J-Link"
                  : args.debugger;
            statusBar?.setDebugger(label);
            context.workspaceState.update("e2mcp.debugger", args.debugger);
            outputChannel.appendLine(
              `[e2mcp] Debugger: ${label}`
            );
          }
          break;
        case "selectBuildConfig":
          if (args?.config) {
            context.workspaceState.update("e2mcp.buildConfig", args.config);
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
        case "toggleMcp":
          toggleMcpServer(outputChannel);
          break;
        case "openConsole":
          admConsole?.startManual();
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
  viewProvider.restoreState(savedProject, savedDebugger, savedBuildConfig);
  if (savedProject) statusBar?.setProject(savedProject);
  if (savedDebugger) {
    const label = savedDebugger === "E2LITE" ? "E2 Lite" : savedDebugger === "JLINK" ? "J-Link" : savedDebugger;
    statusBar?.setDebugger(label);
  }

  // Pipe console output to webview
  admConsole.onOutput((text) => {
    viewProvider?.appendConsole(text);
  });

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
        statusBar?.setProject(pick);
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
          statusBar?.setDebugger(pick.label);
          context.workspaceState.update("e2mcp.debugger", pick.value);
          outputChannel.appendLine(
            `[e2mcp] Debugger: ${pick.label} (${pick.value})`
          );
        }
      }
    )
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
      if (!project) {
        vscode.window.showWarningMessage("No project selected.");
        return;
      }
      viewProvider.setBusy(true);
      try {
        await flashRunner.flash(project, buildConfig);
      } finally {
        viewProvider.setBusy(false);
      }
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

/** Toggle the "disabled" flag in .vscode/mcp.json for e2studio-mcp server. */
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
    const newState = wasDisabled ? "enabled" : "disabled";
    viewProvider?.setMcpEnabled(wasDisabled);
    outputChannel.appendLine(`[e2mcp] MCP server ${newState}`);
    vscode.window.showInformationMessage(`MCP server ${newState}.`);
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to toggle MCP: ${e.message}`);
  }
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
