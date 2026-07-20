import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  loader: { ".html": "text", ".py": "text" },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
};

await Promise.all([
  build({ ...shared, entryPoints: ["src/http.ts"], outfile: "dist/http.mjs" }),
  build({ ...shared, entryPoints: ["src/stdio.ts"], outfile: "dist/stdio.mjs" }),
]);

console.log("Built HTTP and stdio MCP server bundles.");
