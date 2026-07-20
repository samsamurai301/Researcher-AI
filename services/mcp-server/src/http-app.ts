import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { authContext, authenticationMiddleware, createAuthenticator } from "./auth.js";
import { createResearcherMcpServer } from "./mcp.js";
import type { ServiceRuntime } from "./runtime.js";

export function createHttpApp(runtime: ServiceRuntime): Express {
  const app = express();
  const authenticator = createAuthenticator(runtime.config);
  app.disable("x-powered-by");
  app.use(cors({
    origin: runtime.config.corsOrigins === "*" ? true : runtime.config.corsOrigins,
    allowedHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "x-researcher-tenant"],
    exposedHeaders: ["mcp-session-id", "www-authenticate"],
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", version: "0.1.0" });
  });
  app.get("/ready", (_request, response) => {
    response.json({
      status: "ready",
      runnerMode: runtime.config.runnerMode,
      authMode: runtime.config.authMode,
      upstreamCommit: "96bd51617cfdbb494a9fc283af00fe090edfae48",
    });
  });
  app.get("/.well-known/oauth-protected-resource", (_request, response) => {
    response.json({
      resource: runtime.config.baseUrl,
      authorization_servers: runtime.config.oidcIssuer ? [runtime.config.oidcIssuer] : [],
      bearer_methods_supported: ["header"],
      scopes_supported: ["research:read", "research:write"],
    });
  });
  app.get("/.well-known/openai-apps-challenge", (_request, response) => {
    if (!runtime.config.openaiAppsChallenge) {
      response.status(404).type("text/plain").send("Domain verification challenge is not configured.");
      return;
    }
    response.type("text/plain").send(runtime.config.openaiAppsChallenge);
  });

  const handleMcp = async (request: Request, response: Response) => {
    const context = authContext(response);
    const server = createResearcherMcpServer(runtime, context);
    const transportOptions = {
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    } as unknown as StreamableHTTPServerTransportOptions;
    const transport = new StreamableHTTPServerTransport(transportOptions);
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      // SDK 1.29's accessor-based transport is runtime compatible with Transport;
      // exactOptionalPropertyTypes makes its published declaration structurally narrower.
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  app.post("/mcp", authenticationMiddleware(authenticator), (request, response) => void handleMcp(request, response));
  app.get("/mcp", authenticationMiddleware(authenticator), (request, response) => void handleMcp(request, response));
  app.delete("/mcp", authenticationMiddleware(authenticator), (_request, response) => response.status(405).end());
  return app;
}
