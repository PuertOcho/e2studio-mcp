import * as vscode from "vscode";
import * as path from "path";
import { ADMConsole } from "./admConsole";
import { StatusBar } from "./statusBar";
import { loadConfig, ExtensionConfig } from "./config";
import { E2StudioRxViewProvider } from "./webviewProvider";

let admConsole: ADMConsole | undefined;
let statusBar: StatusBar | undefined;
let config: ExtensionConfig | undefined;
let viewProvider: E2StudioRxViewProvider | undefined;

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
      },
    };
  }

  // Status bar
  statusBar = new StatusBar(config);
  context.subscriptions.push(statusBar);

  // ADM Virtual Console
  admConsole = new ADMConsole(context);
  context.subscriptions.push(admConsole);

  // Webview sidebar panel
  viewProvider = new E2StudioRxViewProvider(
    context.extensionUri,
    config,
    (cmd, args) => {
      switch (cmd) {
        case "selectProject":
          if (args?.project) {
            statusBar?.setProject(args.project);
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
            outputChannel.appendLine(
              `[e2studio-rx] Debugger: ${label}`
            );
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
        case "debug":
          vscode.debug.startDebugging(undefined, "headc-fw RX651 (E2 Lite)");
          break;
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
        ? (viewProvider as any).projects.map((p: any) => p.name)
        : ["headc-fw", "headc_v2_fw", "headc-v2-bloader"];
      const pick = await vscode.window.showQuickPick(projects, {
        placeHolder: "Select e2 Studio project",
      });
      if (pick) {
        statusBar?.setProject(pick);
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
          outputChannel.appendLine(
            `[e2studio-rx] Debugger: ${pick.label} (${pick.value})`
          );
        }
      }
    )
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
