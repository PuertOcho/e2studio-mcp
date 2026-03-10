import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

/**
 * Parsed debug configuration from an e2 Studio .launch XML file.
 */
export interface ParsedLaunchConfig {
  serverParams: string;
  device: string;
  gdbName: string;
  gdbFlags: string;
  port: number;
  initCommands: string[];
  sourceFile: string;
  /** Parsed key-value pairs from serverParams string. */
  serverParametersMap: Record<string, string | number>;
}

export function listLaunchFiles(projectPath: string): string[] {
  if (!fs.existsSync(projectPath)) return [];

  try {
    return fs
      .readdirSync(projectPath)
      .filter((f) => f.endsWith(".launch"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Parse an e2 Studio .launch XML file to extract debug parameters.
 * Mirrors the Python flash.py parse_launch_file().
 */
export function parseLaunchFile(launchPath: string): ParsedLaunchConfig {
  const xml = fs.readFileSync(launchPath, "utf-8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const doc = parser.parse(xml);
  const root = doc.launchConfiguration;

  const cfg: ParsedLaunchConfig = {
    serverParams: "",
    device: "",
    gdbName: "rx-elf-gdb",
    gdbFlags: "",
    port: 61234,
    initCommands: [],
    sourceFile: launchPath,
    serverParametersMap: {},
  };

  if (!root) return cfg;

  // The XML has mixed attribute types: stringAttribute, intAttribute, booleanAttribute, listAttribute
  const attrs = [
    ...(Array.isArray(root.stringAttribute)
      ? root.stringAttribute
      : root.stringAttribute
        ? [root.stringAttribute]
        : []),
    ...(Array.isArray(root.intAttribute)
      ? root.intAttribute
      : root.intAttribute
        ? [root.intAttribute]
        : []),
    ...(Array.isArray(root.booleanAttribute)
      ? root.booleanAttribute
      : root.booleanAttribute
        ? [root.booleanAttribute]
        : []),
  ];

  for (const attr of attrs) {
    const key = attr["@_key"] ?? "";
    const value = String(attr["@_value"] ?? "");

    if (key === "com.renesas.cdt.core.serverParam") {
      cfg.serverParams = value;
      cfg.serverParametersMap = parseServerParams(value);
    } else if (key === "com.renesas.cdt.core.targetDevice") {
      cfg.device = value;
    } else if (key === "com.renesas.cdt.core.portNumber") {
      const n = parseInt(value, 10);
      if (!isNaN(n)) cfg.port = n;
    } else if (key === "com.renesas.cdt.core.optionInitCommands") {
      // &#10; is decoded to \n by parser
      cfg.initCommands = value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // GDB name from listAttribute
  const lists = Array.isArray(root.listAttribute)
    ? root.listAttribute
    : root.listAttribute
      ? [root.listAttribute]
      : [];
  for (const list of lists) {
    const key = list["@_key"] ?? "";
    if (key === "com.renesas.cdt.core.listGDBExe") {
      const entry = list.listEntry;
      const val = entry?.["@_value"] ?? (Array.isArray(entry) ? entry[0]?.["@_value"] : "");
      if (val) {
        const parts = String(val).split(/\s+/);
        cfg.gdbName = parts[0] || "rx-elf-gdb";
        cfg.gdbFlags = parts.slice(1).join(" ");
      }
    }
  }

  // Extract device from serverParams if not found directly
  if (!cfg.device && cfg.serverParams) {
    const m = cfg.serverParams.match(/-t\s+(\S+)/);
    if (m) cfg.device = m[1];
  }

  return cfg;
}

/**
 * Parse the serverParam string into a key-value map.
 * Input format: `-g E2LITE -t R5F5651E -uInputClock= "27.0" -w 0 -z "0"`
 * Output: { "-g": "E2LITE", "-t": "R5F5651E", "-uInputClock=": "27.0", "-w": 0, "-z": "0" }
 */
function parseServerParams(params: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  // Match: -flag[=] ["]value["]
  const re = /(-\w[\w=]*)\s+(?:"([^"]*)"|([\w.]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(params)) !== null) {
    const key = m[1];
    const value = m[2] ?? m[3];
    // Try numeric conversion for simple integers
    const num = Number(value);
    result[key] = !isNaN(num) && /^\d+$/.test(value) ? num : value;
  }
  return result;
}

/**
 * Find a .launch file in a project directory.
 * Priority: *HardwareDebug* > *NO BORRA* > first found.
 */
export function findLaunchFile(projectPath: string, preferredLaunchFile?: string): string | undefined {
  const launchFiles = listLaunchFiles(projectPath);

  if (launchFiles.length === 0) return undefined;

  if (preferredLaunchFile && launchFiles.includes(preferredLaunchFile)) {
    return path.join(projectPath, preferredLaunchFile);
  }

  // Prefer HardwareDebug
  const hwDebug = launchFiles.find((f) => f.includes("HardwareDebug"));
  if (hwDebug) return path.join(projectPath, hwDebug);

  // Then NO BORRA
  const noBorra = launchFiles.find((f) => f.includes("NO BORRA"));
  if (noBorra) return path.join(projectPath, noBorra);

  return path.join(projectPath, launchFiles[0]);
}
