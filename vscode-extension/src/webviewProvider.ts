import * as vscode from "vscode";
import * as cp from "child_process";
import {
  ProjectInfo,
  scanProjects,
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
  private mcpEnabled = true;
  private debugActive = false;
  private probeStatus: "ok" | "warning" | "disconnected" | "unknown" = "unknown";
  private probeStatusText = "";
  private probeCheckTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly config: ExtensionConfig,
    private readonly onCommand: (
      cmd: string,
      args?: Record<string, string>
    ) => void | Promise<void>
  ) {
    this.selectedProject = config.defaultProject;
    this.selectedBuildConfig = config.buildConfig;
    this.selectedDebugger = "E2LITE";
    this.refreshProjects();
  }

  /** Public getters for extension.ts to read current selections. */
  get currentProject(): string { return this.selectedProject; }
  get currentBuildConfig(): string { return this.selectedBuildConfig; }
  get currentDebugger(): string { return this.selectedDebugger; }
  get currentLaunchFile(): string { return this.selectedLaunchFile; }
  get currentProjectRootPath(): string { return this.config.projectRootPath; }

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

  /** Set busy state — disables action buttons in the webview until the
   *  running action clears it explicitly. */
  setBusy(busy: boolean): void {
    this.view?.webview.postMessage({ command: "setBusy", busy });
  }

  setDebugActive(debugActive: boolean): void {
    this.debugActive = debugActive;
    this.view?.webview.postMessage({ command: "setDebugState", debugActive });
  }

  async refreshProjectsAndRender(): Promise<void> {
    this.setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      this.refreshProjects();
      this.updateWebview();
    } finally {
      this.setBusy(false);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    this.checkProbeStatus();
    // Check probe status every 5 seconds
    this.probeCheckTimer = setInterval(() => this.checkProbeStatus(), 5000);
    webviewView.onDidDispose(() => {
      if (this.probeCheckTimer) clearInterval(this.probeCheckTimer);
    });
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "selectProject":
          this.setSelectedProject(msg.value);
          await this.onCommand("selectProject", { project: msg.value });
          this.updateWebview();
          break;
        case "selectDebugger":
          this.setSelectedDebugger(msg.value);
          await this.onCommand("selectDebugger", { debugger: msg.value });
          break;
        case "selectBuildConfig":
          this.setSelectedBuildConfig(msg.value);
          await this.onCommand("selectBuildConfig", { config: msg.value });
          break;
        case "selectProjectsFolder":
          await this.onCommand("selectProjectsFolder");
          break;
        case "selectLaunchFile":
          this.setSelectedLaunchFile(msg.value);
          await this.onCommand("selectLaunchFile", { launchFile: msg.value });
          break;
        case "build":
        case "clean":
        case "rebuild":
        case "flash":
        case "debug":
        case "stopDebug":
          await this.onCommand(msg.command);
          break;
        case "toggleMcp":
          await this.onCommand("toggleMcp");
          break;
        case "refresh":
          await this.refreshProjectsAndRender();
          break;
      }
    });

    // Push initial state
    this.updateWebview();
  }

  /** Check E2 Lite probe USB status via PowerShell Get-PnpDevice. */
  checkProbeStatus(): void {
    const debugger_ = this.selectedDebugger;
    if (debugger_ === "SIMULATOR") {
      this.probeStatus = "ok";
      this.probeStatusText = "";
      this.pushProbeStatus();
      return;
    }

    const probeName = debugger_ === "JLINK" ? "J-Link" : "Renesas";
    // Filter by Present to exclude ghost/phantom devices from previous connections.
    // Also check for zombie e2-server-gdb processes that block the probe.
    // Use execFile to avoid cmd.exe double-quote interpretation of $variables.
    // @() forces $d to always be an array (empty [] when no devices, [obj] for single).
    const cmd = `$d = @(Get-PnpDevice -FriendlyName '*${probeName}*' -PresentOnly -ErrorAction SilentlyContinue | Select-Object Status, FriendlyName); $z = !!(Get-Process -Name 'e2-server-gdb' -ErrorAction SilentlyContinue); ConvertTo-Json -Compress -Depth 3 @{devices=$d;zombie=$z}`;

    cp.execFile('powershell', ['-NoProfile', '-Command', cmd], { timeout: 5000 }, (_err, stdout) => {
      const prev = this.probeStatus;
      const prevText = this.probeStatusText;
      if (!stdout || !stdout.trim()) {
        // During active debug the probe disconnects/reconnects normally — suppress banner
        if (!this.debugActive) {
          this.probeStatus = "disconnected";
          this.probeStatusText = `${debugger_} not detected — check USB connection`;
        }
      } else {
        try {
          const raw = JSON.parse(stdout.trim());
          const devArr: { Status: string; FriendlyName: string }[] = Array.isArray(raw.devices) ? raw.devices : [];
          const hasZombie = !!raw.zombie && !this.debugActive;

          if (devArr.length === 0) {
            if (!this.debugActive) {
              this.probeStatus = "disconnected";
              this.probeStatusText = `${debugger_} not detected — check USB connection`;
            }
          } else {
            const allOk = devArr.every((d: { Status: string }) => d.Status === "OK");
            if (allOk && !hasZombie) {
              this.probeStatus = "ok";
              this.probeStatusText = "";
            } else if (hasZombie) {
              this.probeStatus = "warning";
              this.probeStatusText = "Stale e2-server-gdb process blocking probe — restart VS Code or kill process";
            } else {
              const badDevices = devArr.filter((d: { Status: string }) => d.Status !== "OK");
              this.probeStatus = "warning";
              this.probeStatusText = `${debugger_} error: ${badDevices.map((d: { Status: string }) => d.Status).join(", ")} — reconnect USB`;
            }
          }
        } catch {
          this.probeStatus = "unknown";
          this.probeStatusText = "";
        }
      }
      if (this.probeStatus !== prev || this.probeStatusText !== prevText) {
        this.pushProbeStatus();
      }
    });
  }

  private pushProbeStatus(): void {
    this.view?.webview.postMessage({
      command: "setProbeStatus",
      status: this.probeStatus,
      text: this.probeStatusText,
    });
  }

  /** Refresh the project list from disk. */
  refreshProjects(): void {
    this.projects = scanProjects(this.config.projectRootPath);
    // Validate selection
    if (this.projects.length === 0) {
      this.selectedProject = "";
      this.selectedLaunchFile = "";
      return;
    }

    if (!this.projects.find((p) => p.name === this.selectedProject)) {
      this.setSelectedProject(this.projects[0].name);
    }
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
    const projectRootPath = this.config.projectRootPath || "(not configured)";

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

    .placeholder {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 4px 0;
    }
    .path-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: var(--inner-gap);
    }
    .path-value {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      word-break: break-all;
      padding: 6px 8px;
      border-radius: 4px;
      background: var(--vscode-editorWidget-background, rgba(127, 127, 127, 0.08));
      border: 1px solid var(--vscode-widget-border, transparent);
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

    /* Probe status alert */
    .probe-alert {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      margin-bottom: var(--section-gap);
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.3;
    }
    .probe-alert.disconnected {
      display: flex;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      color: var(--vscode-errorForeground, #f48771);
    }
    .probe-alert.warning {
      display: flex;
      background: var(--vscode-inputValidation-warningBackground, #352a05);
      border: 1px solid var(--vscode-inputValidation-warningBorder, #9d8500);
      color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .probe-alert .probe-icon { font-size: 16px; flex-shrink: 0; }
  </style>
</head>
<body>
  <!-- PROBE STATUS ALERT -->
  <div id="probeAlert" class="probe-alert ${this.probeStatus === "ok" || this.probeStatus === "unknown" ? "" : this.probeStatus}">
    <span class="probe-icon">${this.probeStatus === "disconnected" ? "&#x26D4;" : "&#x26A0;"}</span>
    <span id="probeText">${this.esc(this.probeStatusText)}</span>
  </div>

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
    <div class="path-row">
      <div class="path-value" title="${this.esc(projectRootPath)}">${this.esc(projectRootPath)}</div>
      <div class="actions-row">
        <button class="action-btn" onclick="postMsg('selectProjectsFolder')">Select Folder</button>
      </div>
    </div>
    ${this.projects.length > 0 ? projectRadios : `<div class="placeholder">No projects found in the selected folder.</div>`}
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
      <button class="action-btn" onclick="postMsg('flash')" title="Flash firmware (no debug)">Flash</button>
      <button id="debugBtn" class="action-btn" onclick="postMsg('debug')" ${this.debugActive ? "disabled" : ""}>&#x25B6; Debug</button>
      <button id="stopBtn" class="action-btn secondary" onclick="postMsg('stopDebug')" ${this.debugActive ? "" : "disabled"}>&#x25A0; Stop</button>
    </div>
    <div id="loading-bar" class="loading-bar"></div>
  </div>

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
        case 'setProbeStatus': {
          const alert = document.getElementById('probeAlert');
          const text = document.getElementById('probeText');
          if (alert && text) {
            alert.className = 'probe-alert ' + (msg.status === 'ok' || msg.status === 'unknown' ? '' : msg.status);
            text.textContent = msg.text || '';
            const icon = alert.querySelector('.probe-icon');
            if (icon) icon.textContent = msg.status === 'disconnected' ? '\\u26D4' : '\\u26A0';
          }
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

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
