import * as vscode from "vscode";
import {
  ProjectInfo,
  MemoryInfo,
  scanProjects,
  getMemoryInfo,
} from "./projectManager";
import { ExtensionConfig } from "./config";

export class E2McpViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "e2mcp.panel";

  private view?: vscode.WebviewView;
  public projects: ProjectInfo[] = [];
  private selectedProject = "";
  private selectedDebugger = "E2LITE";
  private selectedBuildConfig = "HardwareDebug";
  private selectedLaunchFile = "";
  private memory?: MemoryInfo;
  private busy = false;
  private mcpEnabled = true;
  private debugActive = false;

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
  get currentLaunchFile(): string { return this.selectedLaunchFile; }

  /** Restore selections from persisted state. */
  restoreState(project?: string, debugger_?: string, buildConfig?: string, launchFile?: string): void {
    if (project) this.setSelectedProject(project);
    if (debugger_) this.setSelectedDebugger(debugger_);
    if (buildConfig) this.setSelectedBuildConfig(buildConfig);
    if (launchFile) this.setSelectedLaunchFile(launchFile);
  }

  setSelectedProject(project: string): void {
    const proj = this.projects.find((p) => p.name === project);
    if (!proj) return;
    this.selectedProject = project;

    if (!proj.buildConfigs.includes(this.selectedBuildConfig)) {
      this.selectedBuildConfig = proj.buildConfigs[0] ?? this.config.buildConfig;
    }
    if (this.selectedLaunchFile && !proj.launchFiles.includes(this.selectedLaunchFile)) {
      this.selectedLaunchFile = "";
    }
  }

  setSelectedDebugger(debuggerValue: string): void {
    this.selectedDebugger = debuggerValue;
  }

  setSelectedBuildConfig(buildConfig: string): void {
    this.selectedBuildConfig = buildConfig;
  }

  setSelectedLaunchFile(launchFile: string): void {
    const proj = this.projects.find((p) => p.name === this.selectedProject);
    if (!proj) return;
    if (launchFile === "" || proj.launchFiles.includes(launchFile)) {
      this.selectedLaunchFile = launchFile;
    }
  }

  /** Set busy state — disables action buttons in the webview. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.view?.webview.postMessage({ command: "setBusy", busy });
  }

  setDebugActive(debugActive: boolean): void {
    this.debugActive = debugActive;
    this.view?.webview.postMessage({ command: "setDebugState", debugActive });
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
          this.setSelectedProject(msg.value);
          this.onCommand("selectProject", { project: msg.value });
          this.refreshMemory();
          this.updateWebview();
          break;
        case "selectDebugger":
          this.setSelectedDebugger(msg.value);
          this.onCommand("selectDebugger", { debugger: msg.value });
          break;
        case "selectBuildConfig":
          this.setSelectedBuildConfig(msg.value);
          this.onCommand("selectBuildConfig", { config: msg.value });
          this.refreshMemory();
          break;
        case "selectLaunchFile":
          this.setSelectedLaunchFile(msg.value);
          this.onCommand("selectLaunchFile", { launchFile: msg.value });
          break;
        case "build":
        case "clean":
        case "rebuild":
        case "flash":
        case "debug":
        case "stopDebug":
          this.onCommand(msg.command);
          break;
        case "toggleMcp":
          this.onCommand("toggleMcp");
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

  /** Refresh the project list from disk. */
  refreshProjects(): void {
    this.projects = scanProjects(this.config.workspace);
    // Validate selection
    if (
      this.projects.length > 0 &&
      !this.projects.find((p) => p.name === this.selectedProject)
    ) {
      this.setSelectedProject(this.projects[0].name);
    }
  }

  /** Refresh memory usage from .map file. */
  refreshMemory(): void {
    const proj = this.projects.find((p) => p.name === this.selectedProject);
    if (proj) {
      const deviceKey = this.resolveDeviceKey(proj);
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

  /** Update the MCP enabled state and refresh the toggle in the webview. */
  setMcpEnabled(enabled: boolean): void {
    this.mcpEnabled = enabled;
    this.view?.webview.postMessage({ command: "setMcpState", enabled });
  }

  /** Re-render the entire webview with current state. */
  updateWebview(): void {
    if (!this.view) return;
    this.view.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const proj = this.projects.find((p) => p.name === this.selectedProject);
    const buildConfigs = proj?.buildConfigs ?? ["HardwareDebug"];
    const launchFiles = proj?.launchFiles ?? [];

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

    const launchFileOptions = [
      `<option value="" ${this.selectedLaunchFile === "" ? "selected" : ""}>Auto-detect (prefer HardwareDebug)</option>`,
      ...launchFiles.map(
        (launchFile) =>
          `<option value="${this.esc(launchFile)}" ${launchFile === this.selectedLaunchFile ? "selected" : ""}>${this.esc(launchFile)}</option>`
      ),
    ].join("\n");

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

    /* Collapsible sections */
    details.section {
      margin-bottom: var(--section-gap);
    }
    details.section > summary {
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
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    details.section > summary::-webkit-details-marker { display: none; }
    details.section > summary .chevron {
      display: inline-block;
      transition: transform 0.15s;
      font-size: 10px;
    }
    details.section[open] > summary .chevron {
      transform: rotate(90deg);
    }

    /* MCP Toggle */
    .mcp-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      margin-bottom: var(--section-gap);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
    }
    .mcp-toggle-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    }
    .toggle-switch {
      position: relative;
      width: 36px;
      height: 18px;
      cursor: pointer;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--vscode-input-background, #3c3c3c);
      border-radius: 9px;
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      left: 2px;
      bottom: 2px;
      background: var(--vscode-descriptionForeground, #aaa);
      border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }
    .toggle-switch input:checked + .toggle-slider {
      background: var(--vscode-button-background);
    }
    .toggle-switch input:checked + .toggle-slider::before {
      transform: translateX(18px);
      background: var(--vscode-button-foreground, #fff);
    }
  </style>
</head>
<body>
  <!-- MCP TOGGLE -->
  <div class="mcp-toggle-row">
    <span class="mcp-toggle-label">MCP Server</span>
    <label class="toggle-switch">
      <input type="checkbox" id="mcpToggle" ${this.mcpEnabled ? "checked" : ""} />
      <span class="toggle-slider"></span>
    </label>
  </div>

  <!-- PROJECT -->
  <div class="section">
    <div class="section-header">
      Project
      <span class="section-actions" onclick="postMsg('refresh')" title="Refresh projects">&#x21bb;</span>
    </div>
    ${this.projects.length > 0 ? projectRadios : `<div class="placeholder">No projects found in workspace</div>`}
  </div>

  <!-- CONFIGURATION -->
  <div class="section">
    <div class="section-header">Configuration</div>
    <div class="config-row">
      <label>Debugger</label>
      <select id="debugger">${debuggerOptions}</select>
    </div>
    <div class="config-row">
      <label>Build</label>
      <select id="buildConfig">${buildConfigOptions}</select>
    </div>
    <div class="config-row">
      <label>Launch</label>
      <select id="launchFile">${launchFileOptions}</select>
    </div>
  </div>

  <!-- ACTIONS -->
  <div class="section">
    <div class="section-header">Actions</div>
    <div class="actions-row">
      <button class="action-btn" onclick="postMsg('build')">Build</button>
      <button class="action-btn secondary" onclick="postMsg('clean')">Clean</button>
      <button class="action-btn secondary" onclick="postMsg('rebuild')">Rebuild</button>
      <button class="action-btn" onclick="postMsg('flash')">Flash</button>
      <button id="debugBtn" class="action-btn" onclick="postMsg('debug')" ${this.debugActive ? "disabled" : ""}>&#x25B6; Debug</button>
      <button id="stopBtn" class="action-btn secondary" onclick="postMsg('stopDebug')" ${this.debugActive ? "" : "disabled"}>&#x25A0; Stop</button>
    </div>
    <div id="loading-bar" class="loading-bar"></div>
  </div>

  <!-- MEMORY -->
  <details class="section" open>
    <summary><span class="chevron">&#x25B6;</span> Memory</summary>
    <div id="memoryContent">${memoryBars}</div>
  </details>

  <script>
    const vscode = acquireVsCodeApi();
    let debugActive = ${this.debugActive ? "true" : "false"};

    function postMsg(command, value) {
      vscode.postMessage({ command, value });
    }

    function setButtonState(button, disabled) {
      if (!button) return;
      button.disabled = disabled;
      button.style.opacity = disabled ? '0.5' : '1';
      button.style.pointerEvents = disabled ? 'none' : 'auto';
    }

    function syncDebugButtons() {
      setButtonState(document.getElementById('debugBtn'), debugActive);
      setButtonState(document.getElementById('stopBtn'), !debugActive);
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

    document.getElementById('launchFile')?.addEventListener('change', e => {
      postMsg('selectLaunchFile', e.target.value);
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.command) {
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
          if (!msg.busy) syncDebugButtons();
          const loading = document.getElementById('loading-bar');
          if (loading) loading.style.display = msg.busy ? 'block' : 'none';
          break;
        }
        case 'setDebugState': {
          debugActive = !!msg.debugActive;
          syncDebugButtons();
          break;
        }
        case 'setMcpState': {
          const toggle = document.getElementById('mcpToggle');
          if (toggle) toggle.checked = msg.enabled;
          break;
        }
      }
    });

    // MCP toggle
    document.getElementById('mcpToggle')?.addEventListener('change', () => {
      postMsg('toggleMcp');
    });

    syncDebugButtons();

    // Handle MCP state update from extension
    // (already handled in message listener below via setMcpState)
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

  private resolveDeviceKey(project: ProjectInfo): string {
    const candidates = [
      project.deviceCommand,
      project.deviceName,
      project.device,
      this.config.flash.device,
    ].filter((value): value is string => !!value);

    for (const candidate of candidates) {
      if (this.config.devices[candidate]) return candidate;
      const withoutDual = candidate.replace(/_DUAL$/, "");
      if (this.config.devices[withoutDual]) return withoutDual;
      const packageMatch = candidate.match(/^([A-Z0-9]+)(Dx[A-Z0-9]+)$/i);
      if (packageMatch && this.config.devices[packageMatch[1]]) return packageMatch[1];
    }

    return this.config.flash.device;
  }
}
