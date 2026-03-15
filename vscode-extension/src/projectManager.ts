import * as fs from "fs";
import * as path from "path";

export interface ProjectInfo {
  name: string;
  path: string;
  device?: string;
  deviceCommand?: string;
  deviceName?: string;
  family?: string;
  buildConfigs: string[];
  launchFiles: string[];
}

/**
 * Scan an e2 Studio workspace directory for projects (directories with .cproject).
 */
export function scanProjects(workspacePath: string): ProjectInfo[] {
  const projects: ProjectInfo[] = [];
  if (!workspacePath || !fs.existsSync(workspacePath)) return projects;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  } catch {
    return projects;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projPath = path.join(workspacePath, entry.name);
    if (!fs.existsSync(path.join(projPath, ".cproject"))) continue;

    const metadata = parseProjectMetadata(path.join(projPath, ".cproject"));

    const buildConfigs: string[] = [];
    try {
      for (const sub of fs.readdirSync(projPath, { withFileTypes: true })) {
        if (
          sub.isDirectory() &&
          fs.existsSync(path.join(projPath, sub.name, "Makefile"))
        ) {
          buildConfigs.push(sub.name);
        }
      }
    } catch {
      /* ignore */
    }

    projects.push({
      name: entry.name,
      path: projPath,
      device: metadata.deviceCommand ?? metadata.deviceName,
      deviceCommand: metadata.deviceCommand,
      deviceName: metadata.deviceName,
      family: metadata.family,
      buildConfigs:
        buildConfigs.length > 0 ? buildConfigs : ["HardwareDebug"],
      launchFiles: listProjectLaunchFiles(projPath),
    });
  }

  return projects;
}

function parseProjectMetadata(cprojectPath: string): {
  deviceCommand?: string;
  deviceName?: string;
  family?: string;
} {
  try {
    const text = fs.readFileSync(cprojectPath, "utf-8");
    return {
      deviceCommand: matchOptionValue(text, "deviceCommand") ?? matchDeviceConfiguration(text),
      deviceName: matchOptionValue(text, "deviceName"),
      family: matchOptionValue(text, "deviceFamily"),
    };
  } catch {
    return {};
  }
}

function matchOptionValue(text: string, optionName: string): string | undefined {
  const re = new RegExp(
    `<option[^>]+superClass="com\\.renesas\\.cdt\\.managedbuild\\.renesas\\.ccrx\\.common\\.option\\.${optionName}"[^>]+value="([^"]+)"`,
    "i"
  );
  return text.match(re)?.[1];
}

function matchDeviceConfiguration(text: string): string | undefined {
  return text.match(/<deviceConfiguration[^>]+device="([^"]+)"/i)?.[1];
}

function listProjectLaunchFiles(projectPath: string): string[] {
  try {
    return fs.readdirSync(projectPath).filter((f) => f.endsWith(".launch")).sort();
  } catch {
    return [];
  }
}
