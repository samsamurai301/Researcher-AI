import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { authContext, authenticationMiddleware, createAuthenticator, type AuthContext } from "./auth.js";
import { PRIVACY_HTML, TERMS_HTML } from "./legal.js";
import { createResearcherMcpServer } from "./mcp.js";
import type { ServiceRuntime } from "./runtime.js";

type ResearcherServer = ReturnType<typeof createResearcherMcpServer>;

interface ActiveSession {
  transport: StreamableHTTPServerTransport;
  server: ResearcherServer;
  auth: AuthContext;
  lastSeenAt: number;
  ephemeral: boolean;
}

export function createHttpApp(runtime: ServiceRuntime): Express {
  const app = express();
  const authenticator = createAuthenticator(runtime.config);
  const sessions = new Map<string, ActiveSession>();

  const closeSession = async (sessionId: string, closeTransport: boolean): Promise<void> => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    if (closeTransport) await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
    if (session.ephemeral) await runtime.store.deleteTenant(session.auth.tenantId);
  };

  const sweepExpiredSessions = (): void => {
    const cutoff = Date.now() - runtime.config.sessionTtlMs;
    for (const [sessionId, session] of sessions) {
      if (session.ephemeral && session.lastSeenAt < cutoff) void closeSession(sessionId, true);
    }
  };

  const sweepInterval = setInterval(sweepExpiredSessions, Math.min(runtime.config.sessionTtlMs, 60_000));
  sweepInterval.unref();
  app.locals.closeMcpSessions = async () => {
    clearInterval(sweepInterval);
    await Promise.all([...sessions.keys()].map((sessionId) => closeSession(sessionId, true)));
  };

  app.disable("x-powered-by");
  app.use(cors({
    origin: runtime.config.corsOrigins === "*" ? true : runtime.config.corsOrigins,
    allowedHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "x-researcher-tenant"],
    exposedHeaders: ["mcp-session-id", "www-authenticate"],
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_request, response) => {
    response.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Researcher AI</title></head><body><main><h1>Researcher AI</h1><p>Auditable AI Scientist v2 workflows. The public review service runs deterministic mock jobs only.</p><ul><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms of Service</a></li><li><a href="https://github.com/samsamurai301/Researcher-AI">Source and documentation</a></li></ul></main></body></html>`);
  });
  app.get("/privacy", (_request, response) => response.type("html").send(PRIVACY_HTML));
  app.get("/terms", (_request, response) => response.type("html").send(TERMS_HTML));

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

  const sessionIdFrom = (request: Request): string | undefined => {
    const value = request.header("mcp-session-id")?.trim();
    return value && /^[A-Za-z0-9-]{1,128}$/.test(value) ? value : undefined;
  };

  const sessionMatchesAuth = (session: ActiveSession, requestAuth: AuthContext): boolean =>
    session.ephemeral || (session.auth.subject === requestAuth.subject && session.auth.tenantId === requestAuth.tenantId);

  const handleMcpPost = async (request: Request, response: Response) => {
    sweepExpiredSessions();
    const requestAuth = authContext(response);
    const requestedSessionId = sessionIdFrom(request);
    try {
      if (requestedSessionId) {
        const session = sessions.get(requestedSessionId);
        if (!session || !sessionMatchesAuth(session, requestAuth)) {
          response.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "MCP session was not found." }, id: null });
          return;
        }
        session.lastSeenAt = Date.now();
        await session.transport.handleRequest(request, response, request.body);
        return;
      }

      if (!isInitializeRequest(request.body)) {
        response.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "An initialize request is required." }, id: null });
        return;
      }

      const sessionId = randomUUID();
      const ephemeral = runtime.config.authMode === "session";
      const sessionAuth: AuthContext = ephemeral ? {
        tenantId: `anonymous-session:${sessionId}`,
        subject: `anonymous-session:${sessionId}`,
        scopes: ["research:read", "research:write"],
      } : requestAuth;
      let transport!: StreamableHTTPServerTransport;
      const server = createResearcherMcpServer(runtime, sessionAuth);
      const transportOptions: StreamableHTTPServerTransportOptions = {
        sessionIdGenerator: () => sessionId,
        enableJsonResponse: true,
        onsessioninitialized: () => {
          sessions.set(sessionId, { transport, server, auth: sessionAuth, lastSeenAt: Date.now(), ephemeral });
        },
      };
      transport = new StreamableHTTPServerTransport(transportOptions);
      transport.onclose = () => void closeSession(sessionId, false);
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

  const handleExistingSession = async (request: Request, response: Response) => {
    sweepExpiredSessions();
    const requestAuth = authContext(response);
    const sessionId = sessionIdFrom(request);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || !sessionMatchesAuth(session, requestAuth)) {
      response.status(404).send("MCP session was not found.");
      return;
    }
    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(request, response);
  };

  app.post("/mcp", authenticationMiddleware(authenticator), (request, response) => void handleMcpPost(request, response));
  app.get("/mcp", authenticationMiddleware(authenticator), (request, response) => void handleExistingSession(request, response));
  app.delete("/mcp", authenticationMiddleware(authenticator), (request, response) => void handleExistingSession(request, response));
  return app;
}
