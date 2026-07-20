import { loadConfig, validateConfig } from "./config.js";
import { createHttpApp } from "./http-app.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
validateConfig(config);
const runtime = await createRuntime(config);
const app = createHttpApp(runtime);
const server = app.listen(config.port, () => {
  console.log(`Researcher AI MCP server listening at ${config.baseUrl}/mcp`);
  console.log(`Runner: ${config.runnerMode}; auth: ${config.authMode}; data: ${config.dataDir}`);
});

const shutdown = (signal: string) => {
  console.log(`Received ${signal}; stopping HTTP server.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
