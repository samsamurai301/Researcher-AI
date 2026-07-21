import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const pluginRoot = path.join(root, "plugins/researcher-ai");
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));

const codex = await readJson("plugins/researcher-ai/.codex-plugin/plugin.json");
const claude = await readJson("plugins/researcher-ai/.claude-plugin/plugin.json");
const codexMarket = await readJson(".agents/plugins/marketplace.json");
const claudeMarket = await readJson(".claude-plugin/marketplace.json");
const mcp = await readJson("plugins/researcher-ai/.mcp.json");
const rootPackage = await readJson("package.json");
const widgetPackage = await readJson("apps/widget/package.json");
const serverPackage = await readJson("services/mcp-server/package.json");

const errors = [];
const expectedName = path.basename(pluginRoot);
for (const [label, manifest] of [["Codex", codex], ["Claude", claude]]) {
  if (manifest.name !== expectedName) errors.push(`${label} manifest name must be ${expectedName}`);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) {
    errors.push(`${label} manifest version must be strict semver`);
  }
}
for (const [label, version] of [
  ["Codex manifest", codex.version],
  ["Claude manifest", claude.version],
  ["widget package", widgetPackage.version],
  ["MCP server package", serverPackage.version],
]) {
  if (version !== rootPackage.version) errors.push(`${label} version ${version} must match root version ${rootPackage.version}`);
}
if (!codexMarket.plugins?.some((entry) => entry.name === expectedName && entry.source?.path === "./plugins/researcher-ai")) {
  errors.push("Codex marketplace does not point to the plugin");
}
if (!claudeMarket.plugins?.some((entry) => entry.name === expectedName && entry.source === "./plugins/researcher-ai")) {
  errors.push("Claude marketplace does not point to the plugin");
}
if (!mcp["researcher-ai"]?.args?.some((value) => value.includes("researcher-ai-mcp.mjs"))) {
  errors.push("Claude MCP configuration does not launch the bundled server");
}

for (const relative of [
  "plugins/researcher-ai/bin/researcher-ai-mcp.mjs",
  "plugins/researcher-ai/assets/icon.png",
  "plugins/researcher-ai/assets/logo.png",
  "plugins/researcher-ai/skills/autonomous-research/SKILL.md",
  "plugins/researcher-ai/licenses/AI-SCIENTIST-SOURCE-CODE-LICENSE",
  "plugins/researcher-ai/licenses/APACHE-2.0",
  "plugins/researcher-ai/THIRD_PARTY_NOTICES.md",
  "licenses/AI-SCIENTIST-SOURCE-CODE-LICENSE",
]) {
  try {
    await access(path.join(root, relative));
  } catch {
    errors.push(`Missing required file: ${relative}`);
  }
}

const allManifestText = [codex, claude, codexMarket, claudeMarket, mcp]
  .map((value) => JSON.stringify(value))
  .join("\n");
if (/\[TODO:|YOUR[_ -]|example\.com/i.test(allManifestText)) {
  errors.push("A distributable manifest contains a placeholder");
}

const UPSTREAM_COMMIT = "96bd51617cfdbb494a9fc283af00fe090edfae48";
const actualCommit = execFileSync("git", ["-C", "vendor/ai-scientist-v2", "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (actualCommit !== UPSTREAM_COMMIT) {
  errors.push(`Upstream commit is ${actualCommit}; expected ${UPSTREAM_COMMIT}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("All marketplace and plugin manifests are internally consistent.");
}
