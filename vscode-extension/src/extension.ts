import * as vscode from "vscode";
import * as path from "path";
import { ADMConsole } from "./admConsole";
import { StatusBar } from "./statusBar";
import { loadConfig, ExtensionConfig } from "./config";
import { E2StudioRxViewProvider } from "./webviewProvider";
import { BuildRunner } from "./buildRunner";
import { FlashRunner } from "./flashRunner";
import { DebugProvider } from "./debugProvider";

let admConsole: ADMConsole | undefined;
let statusBar: StatusBar | undefined;
let config: ExtensionConfig | undefined;
let viewProvider: E2StudioRxViewProvider | undefined;
let buildRunner: BuildRunner | undefined;
let flashRunner: FlashRunner | undefined;
let debugProvider: DebugProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("e2 Studio RX");
  outputChannel.appendLine("[e2studio-rx] Activating...");

  // Load config
  try {
    config = loadConfig();
    outputChannel.appendLine(
      `[e2studio-rx] Config loaded: workspace=${config.workspace}, project=${config.defaultProject}`
    );
  } catch (e: any) {
    outputChannel.appendLine(
      `[e2studio-rx] Warning: config not found (${e.message}). Using defaults.`
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
  viewProvider = new E2StudioRxViewProvider(
    context.extensionUri,
    config,
    (cmd, args) => {
      switch (cmd) {
        case "selectProject":
          if (args?.project) {
            statusBar?.setProject(args.project);
            context.workspaceState.update("e2studio-rx.project", args.project);
            outputChannel.appendLine(
              `[e2studio-rx] Project: ${args.project}`
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
            context.workspaceState.update("e2studio-rx.debugger", args.debugger);
            outputChannel.appendLine(
              `[e2studio-rx] Debugger: ${label}`
            );
          }
          break;
        case "selectBuildConfig":
          if (args?.config) {
            context.workspaceState.update("e2studio-rx.buildConfig", args.config);
          }
          break;
        case "build":
          vscode.commands.executeCommand("e2studio-rx.build");
          break;
        case "clean":
          vscode.commands.executeCommand("e2studio-rx.clean");
          break;
        case "rebuild":
          vscode.commands.executeCommand("e2studio-rx.rebuild");
          break;
        case "flash":
          vscode.commands.executeCommand("e2studio-rx.flash");
          break;
        case "debug": {
          // Use the dynamic debug provider — starts F5 with an empty config
          // which resolveDebugConfiguration() fills in
          const folder = vscode.workspace.workspaceFolders?.[0];
          vscode.debug.startDebugging(folder, {
            type: "renesas-hardware",
            request: "launch",
            name: "Debug (dynamic)",
          });
          break;
        }
        case "openConsole":
          admConsole?.startManual();
          break;
      }
    }
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      E2StudioRxViewProvider.viewType,
      viewProvider
    )
  );

  // Dynamic debug configuration provider (F5 without launch.json)
  debugProvider = new DebugProvider(config, viewProvider);
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("renesas-hardware", debugProvider)
  );

  // Restore persisted selections
  const savedProject = context.workspaceState.get<string>("e2studio-rx.project");
  const savedDebugger = context.workspaceState.get<string>("e2studio-rx.debugger");
  const savedBuildConfig = context.workspaceState.get<string>("e2studio-rx.buildConfig");
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
    vscode.commands.registerCommand("e2studio-rx.openConsole", () => {
      admConsole?.startManual();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("e2studio-rx.selectProject", async () => {
      const projects = viewProvider
        ? viewProvider.projects.map((p) => p.name)
        : ["headc-fw", "headc_v2_fw", "headc-v2-bloader"];
      const pick = await vscode.window.showQuickPick(projects, {
        placeHolder: "Select e2 Studio project",
      });
      if (pick) {
        statusBar?.setProject(pick);
        context.workspaceState.update("e2studio-rx.project", pick);
        outputChannel.appendLine(`[e2studio-rx] Project: ${pick}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "e2studio-rx.selectDebugger",
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
          context.workspaceState.update("e2studio-rx.debugger", pick.value);
          outputChannel.appendLine(
            `[e2studio-rx] Debugger: ${pick.label} (${pick.value})`
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
    const result = await buildRunner.build(project, buildConfig, mode);
    if (result.success && mode !== "clean") {
      viewProvider.refreshMemory();
      viewProvider.updateWebview();
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("e2studio-rx.build", () => runBuild("build"))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("e2studio-rx.clean", () => runBuild("clean"))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("e2studio-rx.rebuild", () => runBuild("rebuild"))
  );

  // Flash command
  context.subscriptions.push(
    vscode.commands.registerCommand("e2studio-rx.flash", async () => {
      if (!viewProvider || !flashRunner) return;
      const project = viewProvider.currentProject;
      const buildConfig = viewProvider.currentBuildConfig;
      if (!project) {
        vscode.window.showWarningMessage("No project selected.");
        return;
      }
      await flashRunner.flash(project, buildConfig);
    })
  );

  // Auto-start console on Renesas debug session
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((session) => {
      if (session.type === "renesas-hardware") {
        outputChannel.appendLine(
          `[e2studio-rx] Debug session started: ${session.name}`
        );
        admConsole?.startOnDebug();
      }
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.type === "renesas-hardware") {
        outputChannel.appendLine(
          `[e2studio-rx] Debug session ended: ${session.name}`
        );
        admConsole?.stop();
      }
    })
  );

  outputChannel.appendLine("[e2studio-rx] Activated successfully.");
}

export function deactivate(): void {
  admConsole?.stop();
}
