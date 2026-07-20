import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const appId = process.argv[2];
if (!appId || !/^(?:plugin_)?asdk_app_[a-zA-Z0-9]+$/.test(appId)) {
  console.error("Usage: node scripts/link-chatgpt-app.mjs <asdk_app_id>");
  process.exitCode = 1;
} else {
  const pluginRoot = path.join(process.cwd(), "plugins/researcher-ai");
  const appPath = path.join(pluginRoot, ".app.json");
  const manifestPath = path.join(pluginRoot, ".codex-plugin/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  await writeFile(
    appPath,
    `${JSON.stringify({ apps: { "researcher-ai": { id: appId, category: "Research & Analysis" } } }, null, 2)}\n`,
  );
  manifest.apps = "./.app.json";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Linked ${appId} in ${path.relative(process.cwd(), appPath)}`);
}
