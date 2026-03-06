import * as vscode from "vscode";
import { ExtensionConfig } from "./config";

/**
 * Status bar items showing active project and debugger.
 */
export class StatusBar implements vscode.Disposable {
  private projectItem: vscode.StatusBarItem;
  private debuggerItem: vscode.StatusBarItem;

  constructor(config: ExtensionConfig) {
    // Project selector — left side, high priority
    this.projectItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.projectItem.command = "e2mcp.selectProject";
    this.projectItem.tooltip = "Select e2 Studio project";
    this.setProject(config.defaultProject);
    this.projectItem.show();

    // Debugger selector — left side, slightly lower priority
    this.debuggerItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.debuggerItem.command = "e2mcp.selectDebugger";
    this.debuggerItem.tooltip = "Select debug probe";
    this.setDebugger(config.flash.debugger === "E2Lite" ? "E2 Lite" : config.flash.debugger);
    this.debuggerItem.show();
  }

  setProject(name: string): void {
    this.projectItem.text = `$(circuit-board) ${name}`;
  }

  setDebugger(name: string): void {
    this.debuggerItem.text = `$(plug) ${name}`;
  }

  dispose(): void {
    this.projectItem.dispose();
    this.debuggerItem.dispose();
  }
}
