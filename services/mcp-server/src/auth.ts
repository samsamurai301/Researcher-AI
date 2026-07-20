import { createRemoteJWKSet, jwtVerify } from "jose";
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ServiceConfig } from "./config.js";

export interface AuthContext {
  tenantId: string;
  subject: string;
  scopes: string[];
}

export interface Authenticator {
  authenticate(request: Request): Promise<AuthContext>;
  challenge: string;
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAuthenticator(config: ServiceConfig): Authenticator {
  const resourceMetadata = `${config.baseUrl}/.well-known/oauth-protected-resource`;
  const challenge = `Bearer resource_metadata="${resourceMetadata}"`;

  if (config.authMode === "none") {
    return {
      challenge,
      async authenticate(request) {
        const requestedTenant = request.header("x-researcher-tenant")?.trim();
        const tenantId = requestedTenant && /^[A-Za-z0-9._:@/-]{1,160}$/.test(requestedTenant)
          ? requestedTenant
          : "local";
        return { tenantId, subject: tenantId, scopes: ["research:read", "research:write"] };
      },
    };
  }

  if (config.authMode === "static") {
    const expected = config.apiToken!;
    return {
      challenge,
      async authenticate(request) {
        const token = bearerToken(request);
        if (!token || !secureEqual(token, expected)) throw new Error("Invalid bearer token.");
        return { tenantId: "static-token", subject: "static-token", scopes: ["research:read", "research:write"] };
      },
    };
  }

  const issuer = config.oidcIssuer!;
  const audience = config.oidcAudience!;
  const jwks = createRemoteJWKSet(new URL(config.oidcJwksUri!));
  return {
    challenge,
    async authenticate(request) {
      const token = bearerToken(request);
      if (!token) throw new Error("Bearer token is required.");
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
      });
      if (!payload.sub) throw new Error("OIDC token does not contain a subject.");
      const scopeClaim = payload.scope ?? payload.scp;
      const scopes = typeof scopeClaim === "string"
        ? scopeClaim.split(/\s+/).filter(Boolean)
        : Array.isArray(scopeClaim) ? scopeClaim.filter((scope): scope is string => typeof scope === "string") : [];
      return { tenantId: payload.sub, subject: payload.sub, scopes };
    },
  };
}

export function authenticationMiddleware(authenticator: Authenticator): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    void authenticator.authenticate(request).then((context) => {
      response.locals.auth = context;
      next();
    }).catch(() => {
      response.setHeader("WWW-Authenticate", authenticator.challenge);
      response.status(401).json({ error: "unauthorized", message: "Valid authentication is required." });
    });
  };
}

export function authContext(response: Response): AuthContext {
  const context = response.locals.auth as AuthContext | undefined;
  if (!context) throw new Error("Authentication context is unavailable.");
  return context;
}
