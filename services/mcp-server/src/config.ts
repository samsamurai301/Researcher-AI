import os from "node:os";
import path from "node:path";
import type { AuthMode, RunnerMode } from "./types.js";

export interface ServiceConfig {
  port: number;
  baseUrl: string;
  dataDir: string;
  runnerMode: RunnerMode;
  maxConcurrency: number;
  mockDelayMs: number;
  aiScientistRoot: string;
  pythonBin: string;
  dockerImage: string;
  dockerPythonBin: string;
  dockerGpus: string;
  dockerCpus: string;
  dockerMemory: string;
  dockerPids: string;
  dockerNetwork: string;
  authMode: AuthMode;
  publicReviewMode: "off" | "stateless";
  sessionTtlMs: number;
  apiToken?: string;
  oidcIssuer?: string;
  oidcAudience?: string;
  oidcJwksUri?: string;
  openaiAppsChallenge?: string;
  corsOrigins: string[] | "*";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function runnerMode(value: string | undefined): RunnerMode {
  if (value === "native" || value === "docker" || value === "mock") return value;
  return "mock";
}

function authMode(value: string | undefined): AuthMode {
  if (value === "session" || value === "static" || value === "oidc" || value === "none") return value;
  return "none";
}

function publicReviewMode(value: string | undefined): "off" | "stateless" {
  return value === "stateless" ? "stateless" : "off";
}

function defaultDataDir(): string {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return path.resolve(process.env.CLAUDE_PROJECT_DIR, ".researcher-ai");
  }
  return path.join(os.homedir(), ".researcher-ai");
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const port = positiveInteger(environment.PORT, 8000);
  const origins = environment.CORS_ORIGINS?.trim();
  const config: ServiceConfig = {
    port,
    baseUrl: (environment.BASE_URL ?? environment.RENDER_EXTERNAL_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
    dataDir: path.resolve(environment.RESEARCHER_DATA_DIR ?? defaultDataDir()),
    runnerMode: runnerMode(environment.RESEARCHER_RUNNER),
    maxConcurrency: positiveInteger(environment.RESEARCHER_MAX_CONCURRENCY, 1),
    mockDelayMs: positiveInteger(environment.RESEARCHER_MOCK_DELAY_MS, 40),
    aiScientistRoot: path.resolve(environment.AI_SCIENTIST_ROOT ?? "vendor/ai-scientist-v2"),
    pythonBin: environment.PYTHON_BIN ?? "python3",
    dockerImage: environment.RESEARCHER_DOCKER_IMAGE ?? "researcher-ai-scientist:0.1.0",
    dockerPythonBin: environment.RESEARCHER_DOCKER_PYTHON_BIN ?? "python3",
    dockerGpus: environment.RESEARCHER_DOCKER_GPUS ?? "all",
    dockerCpus: environment.RESEARCHER_DOCKER_CPUS ?? "8",
    dockerMemory: environment.RESEARCHER_DOCKER_MEMORY ?? "32g",
    dockerPids: environment.RESEARCHER_DOCKER_PIDS ?? "512",
    dockerNetwork: environment.RESEARCHER_DOCKER_NETWORK ?? "bridge",
    authMode: authMode(environment.AUTH_MODE),
    publicReviewMode: publicReviewMode(environment.PUBLIC_REVIEW_MODE),
    sessionTtlMs: positiveInteger(environment.RESEARCHER_SESSION_TTL_SECONDS, 86_400) * 1_000,
    corsOrigins: !origins || origins === "*" ? "*" : origins.split(",").map((origin) => origin.trim()),
  };

  if (environment.RESEARCHER_API_TOKEN) config.apiToken = environment.RESEARCHER_API_TOKEN;
  if (environment.OIDC_ISSUER) config.oidcIssuer = environment.OIDC_ISSUER;
  if (environment.OIDC_AUDIENCE) config.oidcAudience = environment.OIDC_AUDIENCE;
  if (environment.OIDC_JWKS_URI) config.oidcJwksUri = environment.OIDC_JWKS_URI;
  if (environment.OPENAI_APPS_CHALLENGE) config.openaiAppsChallenge = environment.OPENAI_APPS_CHALLENGE;
  return config;
}

export function validateConfig(config: ServiceConfig): void {
  if (config.authMode === "static" && (!config.apiToken || config.apiToken.length < 24)) {
    throw new Error("AUTH_MODE=static requires RESEARCHER_API_TOKEN with at least 24 characters.");
  }
  if (config.authMode === "oidc" && (!config.oidcIssuer || !config.oidcAudience || !config.oidcJwksUri)) {
    throw new Error("AUTH_MODE=oidc requires OIDC_ISSUER, OIDC_AUDIENCE, and OIDC_JWKS_URI.");
  }
  if (config.authMode === "session" && config.runnerMode !== "mock") {
    throw new Error("AUTH_MODE=session is restricted to RESEARCHER_RUNNER=mock.");
  }
  if (config.publicReviewMode === "stateless" && config.runnerMode !== "mock") {
    throw new Error("PUBLIC_REVIEW_MODE=stateless is restricted to RESEARCHER_RUNNER=mock.");
  }
}
