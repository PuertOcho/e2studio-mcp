import * as vscode from "vscode";
import * as path from "path";
import { ADMConsole } from "./admConsole";
import { StatusBar } from "./statusBar";
import { loadConfig, ExtensionConfig } from "./config";

let admConsole: ADMConsole | undefined;
let statusBar: StatusBar | undefined;
let config: ExtensionConfig | undefined;

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

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("e2studio-rx.openConsole", () => {
      admConsole?.startManual();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("e2studio-rx.selectProject", async () => {
      // Sprint 2 — full implementation with .cproject scanning
      const projects = ["headc-fw", "headc_v2_fw", "headc-v2-bloader"];
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
