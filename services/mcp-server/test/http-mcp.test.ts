import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http-app.js";
import { createRuntime } from "../src/runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("streamable HTTP MCP", () => {
  it("initializes, lists tools, and calls the service over the ChatGPT transport", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "researcher-ai-http-mcp-"));
    temporaryDirectories.push(root);
    const runtime = await createRuntime(loadConfig({
      RESEARCHER_DATA_DIR: root,
      RESEARCHER_RUNNER: "mock",
      AUTH_MODE: "none",
    }));
    const httpServer = createHttpApp(runtime).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      httpServer.once("listening", resolve);
      httpServer.once("error", reject);
    });
    const { port } = httpServer.address() as AddressInfo;
    const client = new Client({ name: "researcher-ai-http-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { "x-researcher-tenant": "http-test-tenant" } },
    });

    try {
      await client.connect(transport as unknown as Transport);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(10);
      const result = await client.callTool({ name: "get_service_status", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ service: { runnerMode: "mock" } });
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("isolates anonymous public-review sessions and removes their data when they close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "researcher-ai-session-mcp-"));
    temporaryDirectories.push(root);
    const runtime = await createRuntime(loadConfig({
      RESEARCHER_DATA_DIR: root,
      RESEARCHER_RUNNER: "mock",
      AUTH_MODE: "session",
    }));
    const app = createHttpApp(runtime);
    const httpServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      httpServer.once("listening", resolve);
      httpServer.once("error", reject);
    });
    const { port } = httpServer.address() as AddressInfo;
    const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
    const firstClient = new Client({ name: "researcher-ai-session-a", version: "0.1.0" });
    const secondClient = new Client({ name: "researcher-ai-session-b", version: "0.1.0" });
    const firstTransport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { "x-researcher-tenant": "attempted-shared-tenant" } },
    });
    const secondTransport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { "x-researcher-tenant": "attempted-shared-tenant" } },
    });

    try {
      await firstClient.connect(firstTransport as unknown as Transport);
      await secondClient.connect(secondTransport as unknown as Transport);
      const created = await firstClient.callTool({
        name: "create_research_project",
        arguments: {
          title: "Session-isolated project",
          keywords: ["sessions", "isolation"],
          tldr: "Verify that anonymous MCP sessions cannot read each other's projects.",
          abstract: "Create a project in one anonymous review session and verify that a second session receives an empty project list.",
        },
      });
      expect(created.isError).not.toBe(true);

      const firstProjects = await firstClient.callTool({ name: "list_research_projects", arguments: {} });
      const secondProjects = await secondClient.callTool({ name: "list_research_projects", arguments: {} });
      expect(firstProjects.structuredContent).toMatchObject({ projects: [{ title: "Session-isolated project" }] });
      expect(secondProjects.structuredContent).toMatchObject({ projects: [] });
    } finally {
      await firstTransport.terminateSession();
      await secondTransport.terminateSession();
      await firstClient.close();
      await secondClient.close();
      await expect.poll(async () => (await readdir(path.join(root, "tenants"))).length).toBe(0);
      await app.locals.closeMcpSessions();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    }
  });
});
