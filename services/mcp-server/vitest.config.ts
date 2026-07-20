import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [{
    name: "researcher-ai-raw-assets",
    enforce: "pre",
    load(id) {
      const filePath = id.split("?", 1)[0];
      if (filePath && (filePath.endsWith(".html") || filePath.endsWith(".py"))) {
        return `export default ${JSON.stringify(readFileSync(filePath, "utf8"))};`;
      }
      return null;
    },
  }],
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
