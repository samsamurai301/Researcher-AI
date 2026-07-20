import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, validateConfig } from "./config.js";
import { createResearcherMcpServer } from "./mcp.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig({ ...process.env, AUTH_MODE: "none" });
validateConfig(config);
const runtime = await createRuntime(config);
const tenantId = process.env.RESEARCHER_TENANT_ID ?? "local";
const server = createResearcherMcpServer(runtime, {
  tenantId,
  subject: tenantId,
  scopes: ["research:read", "research:write"],
});
const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = () => {
  void server.close().finally(() => process.exit());
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
