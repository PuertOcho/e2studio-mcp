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

export interface MemoryInfo {
  rom: { used: number; total: number };
  ram: { used: number; total: number };
  dataFlash: { used: number; total: number };
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

/**
 * Parse a CCRX .map file and return ROM/RAM/DataFlash usage.
 * Returns undefined if .map file not found.
 */
export function getMemoryInfo(
  projectPath: string,
  buildConfig: string,
  deviceCapacities?: {
    romSize: number;
    ramSize: number;
    dataFlashSize: number;
  }
): MemoryInfo | undefined {
  // Find .map file in build output directory
  const buildDir = path.join(projectPath, buildConfig);
  if (!fs.existsSync(buildDir)) return undefined;

  let mapFile: string | undefined;
  try {
    for (const f of fs.readdirSync(buildDir)) {
      if (f.endsWith(".map")) {
        mapFile = path.join(buildDir, f);
        break;
      }
    }
  } catch {
    return undefined;
  }
  if (!mapFile) return undefined;

  let text: string;
  try {
    text = fs.readFileSync(mapFile, "utf-8");
  } catch {
    return undefined;
  }

  const sections = parseMappingList(text);

  let romUsed = 0;
  let ramUsed = 0;
  let dfUsed = 0;

  for (const s of sections) {
    if (s.size === 0) continue;
    const region = classifyRegion(s.start);
    if (region === "ROM") romUsed += s.size;
    else if (region === "RAM") ramUsed += s.size;
    else if (region === "DATA_FLASH") dfUsed += s.size;
  }

  // Default capacities for RX651
  const romTotal = deviceCapacities?.romSize ?? 2097152;
  const ramTotal = deviceCapacities?.ramSize ?? 655360;
  const dfTotal = deviceCapacities?.dataFlashSize ?? 32768;

  return {
    rom: { used: romUsed, total: romTotal },
    ram: { used: ramUsed, total: ramTotal },
    dataFlash: { used: dfUsed, total: dfTotal },
  };
}

interface MapSection {
  name: string;
  start: number;
  size: number;
}

function classifyRegion(
  address: number
): "ROM" | "RAM" | "DATA_FLASH" | "OTHER" {
  if (address < 0x000a0000) return "RAM";
  if (address >= 0x00100000 && address <= 0x00107fff) return "DATA_FLASH";
  if (address >= 0xffc00000) return "ROM";
  if (address >= 0x00800000 && address < 0x00900000) return "RAM";
  return "OTHER";
}

function parseMappingList(text: string): MapSection[] {
  const sections: MapSection[] = [];
  const lines = text.split("\n");
  let inMapping = false;
  let currentSectionName: string | undefined;

  for (const line of lines) {
    if (line.includes("*** Mapping List ***")) {
      inMapping = true;
      continue;
    }
    if (!inMapping) continue;
    if (line.startsWith("***") && !line.includes("Mapping")) break;

    // Skip headers
    if (line.includes("SECTION") && line.includes("START")) continue;
    if (line.includes("ATTRIBUTE")) continue;

    const stripped = line.trim();
    if (!stripped) continue;

    const dataMatch = line.match(
      /^\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+(\d+)\s*(?:\S+)?\s*$/
    );

    if (dataMatch && currentSectionName) {
      sections.push({
        name: currentSectionName,
        start: parseInt(dataMatch[1], 16),
        size: parseInt(dataMatch[3], 16),
      });
      currentSectionName = undefined;
      continue;
    }

    const headerMatch = stripped.match(/^(\S+)$/);
    if (headerMatch && !line.startsWith(" ")) {
      // Sometimes it has spaces before, let's just assume if it's strictly just one word with some leading spaces
    }
    // Let's use a better header match: if it's not a data match and has text, it's the section name
    if (!dataMatch) {
      currentSectionName = stripped;
    }
  }

  return sections;
}
