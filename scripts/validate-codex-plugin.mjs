import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const candidates = [
  process.env.CODEX_PLUGIN_VALIDATOR,
  path.join(os.homedir(), ".codex/skills/.system/plugin-creator/scripts/validate_plugin.py"),
].filter(Boolean);
const validator = candidates.find((candidate) => {
  try {
    accessSync(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
});

if (!validator) {
  console.warn("Codex plugin validator is not installed; internal manifest validation already passed.");
  process.exit(0);
}

const result = spawnSync("python3", [validator, "plugins/researcher-ai"], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
