import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "services/mcp-server/dist/stdio.mjs");
const destinationDirectory = path.join(root, "plugins/researcher-ai/bin");
const destination = path.join(destinationDirectory, "researcher-ai-mcp.mjs");

await mkdir(destinationDirectory, { recursive: true });
const bundle = (await readFile(source, "utf8")).replace(/\n\/\/# sourceMappingURL=stdio\.mjs\.map\s*$/, "\n");
await writeFile(destination, bundle, { encoding: "utf8", mode: 0o755 });
await chmod(destination, 0o755);
const licenseDirectory = path.join(root, "plugins/researcher-ai/licenses");
await mkdir(licenseDirectory, { recursive: true });
await copyFile(
  path.join(root, "licenses/AI-SCIENTIST-SOURCE-CODE-LICENSE"),
  path.join(licenseDirectory, "AI-SCIENTIST-SOURCE-CODE-LICENSE"),
);
await copyFile(path.join(root, "LICENSE"), path.join(licenseDirectory, "APACHE-2.0"));
await copyFile(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  path.join(root, "plugins/researcher-ai/THIRD_PARTY_NOTICES.md"),
);
console.log(`Packaged ${path.relative(root, destination)}`);
