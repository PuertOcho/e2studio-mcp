/**
 * bundle.js — Copy the Python backend into the extension before packaging.
 *
 * Creates:
 *   vscode-extension/bundled/
 *     src/e2studio_mcp/   (Python package — flash, config, project, etc.)
 *     scripts/            (adm_console.py)
 *
 * Run manually:        node scripts/bundle.js
 * Run via npm:         npm run bundle
 * Runs automatically:  npm run package  (via prepackage hook)
 */

const fs = require("fs");
const path = require("path");

const EXT_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(EXT_ROOT, "..");

const BUNDLED = path.join(EXT_ROOT, "bundled");

/** Remove dir recursively if it exists, then recreate it. */
function resetDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

/** Copy all matching files from src to dst (non-recursive by default). */
function copyFiles(srcDir, dstDir, filter = () => true) {
  if (!fs.existsSync(srcDir)) {
    console.error(`  ERROR: source not found: ${srcDir}`);
    process.exit(1);
  }
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && filter(entry.name)) {
      fs.copyFileSync(
        path.join(srcDir, entry.name),
        path.join(dstDir, entry.name)
      );
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────

console.log("[bundle] Preparing bundled Python backend...");

resetDir(BUNDLED);

// 1. Python package: src/e2studio_mcp/*.py
const pySrc = path.join(REPO_ROOT, "src", "e2studio_mcp");
const pyDst = path.join(BUNDLED, "src", "e2studio_mcp");
copyFiles(pySrc, pyDst, (name) => name.endsWith(".py"));

const pyCount = fs.readdirSync(pyDst).length;
console.log(`[bundle] Copied ${pyCount} Python modules → bundled/src/e2studio_mcp/`);

// 2. Scripts: scripts/adm_console.py
const scriptsSrc = path.join(REPO_ROOT, "scripts");
const scriptsDst = path.join(BUNDLED, "scripts");
copyFiles(scriptsSrc, scriptsDst, (name) => name === "adm_console.py");
console.log("[bundle] Copied adm_console.py → bundled/scripts/");

console.log("[bundle] Done.");
