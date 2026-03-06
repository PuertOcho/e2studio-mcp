import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  ProjectInfo,
  MemoryInfo,
  scanProjects,
  getMemoryInfo,
} from "./projectManager";
import { ExtensionConfig } from "./config";

export class E2StudioRxViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "e2studio-rx.panel";

  private view?: vscode.WebviewView;
  public projects: ProjectInfo[] = [];
  private selectedProject = "";
  private selectedDebugger = "E2LITE";
  private selectedBuildConfig = "HardwareDebug";
  private memory?: MemoryInfo;
  private consoleBuffer: string[] = [];
  private busy = false;
  private static readonly MAX_CONSOLE_LINES = 500;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly config: ExtensionConfig,
    private readonly onCommand: (
      cmd: string,
      args?: Record<string, string>
    ) => void
  ) {
    this.selectedProject = config.defaultProject;
    this.selectedBuildConfig = config.buildConfig;
    this.selectedDebugger =
      config.flash.debugger === "E2Lite" ? "E2LITE" : config.flash.debugger;
    this.refreshProjects();
  }

  /** Public getters for extension.ts to read current selections. */
  get currentProject(): string { return this.selectedProject; }
  get currentBuildConfig(): string { return this.selectedBuildConfig; }
  get currentDebugger(): string { return this.selectedDebugger; }

  /** Restore selections from persisted state. */
  restoreState(project?: string, debugger_?: string, buildConfig?: string): void {
    if (project && this.projects.find(p => p.name === project)) this.selectedProject = project;
    if (debugger_) this.selectedDebugger = debugger_;
    if (buildConfig) this.selectedBuildConfig = buildConfig;
  }

  /** Set busy state — disables action buttons in the webview. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.view?.webview.postMessage({ command: "setBusy", busy });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case "selectProject":
          this.selectedProject = msg.value;
          this.onCommand("selectProject", { project: msg.value });
          this.refreshMemory();
          break;
        case "selectDebugger":
          this.selectedDebugger = msg.value;
          this.onCommand("selectDebugger", { debugger: msg.value });
          break;
        case "selectBuildConfig":
          this.selectedBuildConfig = msg.value;
          this.onCommand("selectBuildConfig", { config: msg.value });
          this.refreshMemory();
          break;
        case "build":
        case "clean":
        case "rebuild":
        case "flash":
        case "debug":
        case "openConsole":
          this.onCommand(msg.command);
          break;
        case "toggleMcp":
          this.toggleMcp(msg.value);
          break;
        case "refresh":
          this.refreshProjects();
          this.refreshMemory();
          this.updateWebview();
          break;
      }
    });

    // Push initial state
    this.updateWebview();
  }

  /** Called by admConsole to push console output into the webview. */
  appendConsole(text: string): void {
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.length > 0) {
        this.consoleBuffer.push(line);
      }
    }
    // Trim buffer
    while (
      this.consoleBuffer.length > E2StudioRxViewProvider.MAX_CONSOLE_LINES
    ) {
      this.consoleBuffer.shift();
    }
    this.view?.webview.postMessage({
      command: "consoleAppend",
      text: text,
    });
  }

  /** Refresh the project list from disk. */
  refreshProjects(): void {
    this.projects = scanProjects(this.config.workspace);
    // Validate selection
    if (
      this.projects.length > 0 &&
      !this.projects.find((p) => p.name === this.selectedProject)
    ) {
      this.selectedProject = this.projects[0].name;
    }
  }

  /** Refresh memory usage from .map file. */
  refreshMemory(): void {
    const proj = this.projects.find((p) => p.name === this.selectedProject);
    if (proj) {
      // Look up device capacities from config
      const deviceKey = this.config.flash.device;
      const deviceInfo = this.config.devices[deviceKey];
      this.memory = getMemoryInfo(
        proj.path,
        this.selectedBuildConfig,
        deviceInfo
      );
    } else {
      this.memory = undefined;
    }
    this.view?.webview.postMessage({
      command: "setMemory",
      memory: this.memory ?? null,
    });
  }

  /** Re-render the entire webview with current state. */
  updateWebview(): void {
    if (!this.view) return;
    this.view.webview.html = this.getHtml();
  }

  private getMcpPaths() {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsPath) return null;
    return {
      enabled: path.join(wsPath, ".vscode", "mcp.json"),
      disabled: path.join(wsPath, ".vscode", "mcp.json.disabled")
    };
  }

  private isMcpEnabled(): boolean {
    const paths = this.getMcpPaths();
    if (!paths) return false;
    return fs.existsSync(paths.enabled);
  }

  private toggleMcp(enable: boolean) {
    const paths = this.getMcpPaths();
    if (!paths) return;
    try {
      if (enable) {
        if (fs.existsSync(paths.disabled)) {
          fs.renameSync(paths.disabled, paths.enabled);
        }
      } else {
        if (fs.existsSync(paths.enabled)) {
          fs.renameSync(paths.enabled, paths.disabled);
        }
      }
      // Re-render to update toggle UI state
      this.updateWebview();
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to toggle MCP: ${e.message}`);
    }
  }

  private getHtml(): string {
    const proj = this.projects.find((p) => p.name === this.selectedProject);
    const buildConfigs = proj?.buildConfigs ?? ["HardwareDebug"];

    const projectRadios = this.projects
      .map(
        (p) =>
          `<label class="radio-item">
            <input type="radio" name="project" value="${this.esc(p.name)}"
              ${p.name === this.selectedProject ? "checked" : ""}/>
            <span class="radio-label">${this.esc(p.name)}</span>
            ${p.device ? `<span class="badge">${this.esc(p.device)}</span>` : ""}
          </label>`
      )
      .join("\n");

    const debuggerOptions = [
      { label: "E2 Lite", value: "E2LITE" },
      { label: "E1", value: "E1" },
      { label: "E2", value: "E2" },
      { label: "J-Link", value: "JLINK" },
      { label: "Simulator", value: "SIMULATOR" },
    ]
      .map(
        (d) =>
          `<option value="${d.value}" ${d.value === this.selectedDebugger ? "selected" : ""}>${d.label}</option>`
      )
      .join("\n");

    const buildConfigOptions = buildConfigs
      .map(
        (c) =>
          `<option value="${this.esc(c)}" ${c === this.selectedBuildConfig ? "selected" : ""}>${this.esc(c)}</option>`
      )
      .join("\n");

    const memoryBars = this.memory
      ? this.renderMemoryBars(this.memory)
      : `<div class="placeholder">Build project to see memory usage</div>`;

    const consoleContent = this.consoleBuffer.length > 0
      ? this.esc(this.consoleBuffer.join("\n"))
      : "";

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --section-gap: 12px;
      --inner-gap: 6px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, transparent);
      padding: 8px 12px;
      line-height: 1.4;
    }

    /* Sections */
    .section {
      margin-bottom: var(--section-gap);
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      margin-bottom: var(--inner-gap);
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
    }
    .section-header .codicon {
      font-size: 14px;
    }

    /* Radio items */
    .radio-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 4px;
      border-radius: 3px;
      cursor: pointer;
    }
    .radio-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .radio-item input[type="radio"] {
      accent-color: var(--vscode-focusBorder);
    }
    .radio-label {
      flex: 1;
      font-size: 13px;
    }
    .badge {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }

    /* Selects */
    .config-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: var(--inner-gap);
    }
    .config-row label {
      font-size: 12px;
      min-width: 65px;
      color: var(--vscode-descriptionForeground);
    }
    select {
      flex: 1;
      padding: 3px 6px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 3px;
      outline: none;
    }
    select:focus {
      border-color: var(--vscode-focusBorder);
    }

    /* Buttons */
    .actions-row {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    /* Loading Bar */
    .loading-bar {
      height: 2px;
      width: 100%;
      background: var(--vscode-dropdown-background, transparent);
      margin-top: 8px;
      border-radius: 1px;
      overflow: hidden;
      position: relative;
      display: none;
    }
    .loading-bar::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 30%;
      background: var(--vscode-progressBar-background, var(--vscode-button-background));
      animation: indeterminate 1.5s infinite ease-in-out;
    }
    @keyframes indeterminate {
      0% { left: -30%; }
      100% { left: 100%; }
    }

    /* Memory bars */
    .mem-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      font-size: 12px;
    }
    .mem-label {
      min-width: 32px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
    .mem-bar-bg {
      flex: 1;
      height: 14px;
      background: var(--vscode-editorWidget-background, #2d2d2d);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }
    .mem-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .mem-bar-fill.rom { background: var(--vscode-charts-blue, #3794ff); }
    .mem-bar-fill.ram { background: var(--vscode-charts-green, #89d185); }
    .mem-bar-fill.df  { background: var(--vscode-charts-orange, #cca700); }
    .mem-pct {
      min-width: 32px;
      text-align: right;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .mem-size {
      min-width: 65px;
      text-align: right;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    /* Console */
    .console-area {
      background: var(--vscode-terminal-background, var(--vscode-editor-background));
      color: var(--vscode-terminal-foreground, var(--vscode-editor-foreground));
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 12px);
      padding: 6px 8px;
      border-radius: 3px;
      min-height: 80px;
      max-height: 200px;
      overflow-y: auto;
      overflow-x: auto;
      white-space: pre;
      border: 1px solid var(--vscode-widget-border, transparent);
    }
    .console-area:empty::before {
      content: "Virtual console output will appear here...";
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    .placeholder {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 4px 0;
    }

    /* Refresh link */
    .section-actions {
      margin-left: auto;
      cursor: pointer;
      opacity: 0.6;
    }
    .section-actions:hover {
      opacity: 1;
    }
  </style>
</head>
<body>
  <!-- PROJECT -->
  <div class="section">
    <div class="section-header">
      <span>&#x25CB;</span> Project
      <label class="section-actions" title="Enable/Disable AI MCP Server" style="display:flex; align-items:center; gap:4px; opacity:1;">
        <span style="font-size:10px; opacity:0.8;">MCP</span>
        <input type="checkbox" ${this.isMcpEnabled() ? "checked" : ""} onchange="postMsg('toggleMcp', this.checked)" />
      </label>
    </div>
    ${this.projects.length > 0 ? projectRadios : `<div class="placeholder">No projects found in workspace</div>`}
  </div>

  <!-- CONFIGURATION -->
  <div class="section">
    <div class="section-header"><span>&#x2699;</span> Configuration</div>
    <div class="config-row">
      <label>Debugger</label>
      <select id="debugger">${debuggerOptions}</select>
    </div>
    <div class="config-row">
      <label>Build</label>
      <select id="buildConfig">${buildConfigOptions}</select>
    </div>
  </div>

  <!-- ACTIONS -->
  <div class="section">
    <div class="section-header"><span>&#x25B6;</span> Actions</div>
    <div class="actions-row">
      <button class="action-btn" onclick="postMsg('build')">Build</button>
      <button class="action-btn secondary" onclick="postMsg('clean')">Clean</button>
      <button class="action-btn secondary" onclick="postMsg('rebuild')">Rebuild</button>
      <button class="action-btn" onclick="postMsg('flash')">Flash</button>
      <button class="action-btn" onclick="postMsg('debug')">&#x25B6; Debug</button>
    </div>
    <div id="loading-bar" class="loading-bar"></div>
  </div>

  <!-- MEMORY -->
  <div class="section">
    <div class="section-header"><span>&#x2593;</span> Memory</div>
    <div id="memoryContent">${memoryBars}</div>
  </div>

  <!-- CONSOLE -->
  <div class="section">
    <div class="section-header"><span>&#x25A4;</span> Virtual Console</div>
    <div class="console-area" id="console">${consoleContent}</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function postMsg(command, value) {
      vscode.postMessage({ command, value });
    }

    // Project radio buttons
    document.querySelectorAll('input[name="project"]').forEach(radio => {
      radio.addEventListener('change', e => {
        postMsg('selectProject', e.target.value);
      });
    });

    // Debugger select
    document.getElementById('debugger')?.addEventListener('change', e => {
      postMsg('selectDebugger', e.target.value);
    });

    // Build config select
    document.getElementById('buildConfig')?.addEventListener('change', e => {
      postMsg('selectBuildConfig', e.target.value);
    });

    // Handle messages from extension
    const consoleEl = document.getElementById('console');
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.command) {
        case 'consoleAppend':
          if (consoleEl) {
            consoleEl.textContent += msg.text;
            consoleEl.scrollTop = consoleEl.scrollHeight;
          }
          break;
        case 'setMemory':
          // Full re-render handled by extension updating HTML
          break;
        case 'setBusy': {
          const btns = document.querySelectorAll('.action-btn');
          btns.forEach(btn => {
            btn.disabled = msg.busy;
            btn.style.opacity = msg.busy ? '0.5' : '1';
            btn.style.pointerEvents = msg.busy ? 'none' : 'auto';
          });
          const loading = document.getElementById('loading-bar');
          if (loading) loading.style.display = msg.busy ? 'block' : 'none';
          break;
        }
      }
    });

    // Auto-scroll console to bottom on load
    if (consoleEl) {
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  </script>
</body>
</html>`;
  }

  private renderMemoryBars(mem: MemoryInfo): string {
    const bar = (
      label: string,
      cls: string,
      used: number,
      total: number
    ): string => {
      const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
      const sizeStr = this.formatSize(used);
      const totalStr = this.formatSize(total);
      return `<div class="mem-row">
        <span class="mem-label">${label}</span>
        <div class="mem-bar-bg">
          <div class="mem-bar-fill ${cls}" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="mem-pct">${pct.toFixed(0)}%</span>
        <span class="mem-size">${sizeStr}/${totalStr}</span>
      </div>`;
    };

    return [
      bar("ROM", "rom", mem.rom.used, mem.rom.total),
      bar("RAM", "ram", mem.ram.used, mem.ram.total),
      bar("Data", "df", mem.dataFlash.used, mem.dataFlash.total),
    ].join("\n");
  }

  private formatSize(bytes: number): string {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + "M";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + "K";
    return bytes + "B";
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
