import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import widgetHtml from "../../../apps/widget/dist/index.html";
import type { AuthContext } from "./auth.js";
import type { ServiceRuntime } from "./runtime.js";
import type { ResearchJob } from "./types.js";
import { DISCLOSURE_TEXT } from "./types.js";

const WIDGET_URI = "ui://researcher-ai/dashboard.html";
const TOOL_META = { ui: { resourceUri: WIDGET_URI } };
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/;

function publicJob(job: ResearchJob): Omit<ResearchJob, "tenantKey"> {
  const { tenantKey: _tenantKey, ...publicValue } = job;
  return publicValue;
}

function result(message: string, structured: Record<string, unknown>) {
  return {
    _meta: TOOL_META,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { message, ...structured },
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Researcher AI error.";
  return {
    _meta: TOOL_META,
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { view: "service", message, error: true },
  };
}

function assertScope(auth: AuthContext, required: "research:read" | "research:write"): void {
  if (auth.scopes.includes(required) || auth.scopes.includes("research:*") || auth.scopes.includes("*")) return;
  throw new Error(`The authenticated identity is missing the ${required} scope.`);
}

async function runStatelessMockWorkflow(
  runtime: ServiceRuntime,
  input: {
    title: string;
    keywords: string[];
    tldr: string;
    abstract: string;
    maxGenerations: number;
    reflections: number;
  },
) {
  const tenantId = `public-review:${randomUUID()}`;
  try {
    const project = await runtime.store.createProject(tenantId, input);
    const job = await runtime.store.createJob(tenantId, project.id, "ideation", {
      model: "mock-review",
      maxGenerations: input.maxGenerations,
      reflections: input.reflections,
    });
    const output = await runtime.runner.execute(
      tenantId,
      job,
      project,
      new AbortController().signal,
      () => undefined,
    );
    const [updatedProject, ideas, artifacts] = await Promise.all([
      runtime.store.getProject(tenantId, project.id),
      runtime.store.readIdeas(tenantId, project.id),
      runtime.store.listArtifacts(tenantId, project.id),
    ]);
    const disclosureDescriptor = artifacts.find((artifact) =>
      artifact.readable && (artifact.path.endsWith("ideation-summary.md") || artifact.path === "topic.md")
    );
    const disclosureArtifact = disclosureDescriptor
      ? await runtime.store.readArtifact(tenantId, project.id, disclosureDescriptor.path)
      : undefined;
    return {
      project: updatedProject,
      job: publicJob({ ...job, status: "succeeded", output }),
      ideas,
      artifacts,
      disclosureArtifact,
    };
  } finally {
    await runtime.store.deleteTenant(tenantId);
  }
}

export function createResearcherMcpServer(runtime: ServiceRuntime, auth: AuthContext): McpServer {
  const tenantId = auth.tenantId;
  const server = new McpServer({ name: "researcher-ai", version: "0.1.0" });

  registerAppResource(
    server,
    "Researcher AI dashboard",
    WIDGET_URI,
    { description: "Interactive research project, job, and artifact dashboard.", mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [{
        uri: WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
        _meta: {
          ui: {
            csp: { connectDomains: [], resourceDomains: [] },
            domain: "https://researcher-ai-mcp.onrender.com",
          },
          "openai/widgetDescription": "Shows the active Researcher AI project, mock jobs, progress, and auditable artifacts.",
        },
      }],
    }),
  );

  registerAppTool(
    server,
    "get_service_status",
    {
      title: "Get Researcher AI service status",
      description: "Check whether the research control plane is ready and see which execution and authentication modes are configured.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: TOOL_META,
    },
    async () => result("The Researcher AI control plane is ready.", {
      view: "service",
      service: {
        status: "ready",
        runnerMode: runtime.config.runnerMode,
        authMode: runtime.config.authMode,
        maxConcurrency: runtime.config.maxConcurrency,
        upstreamCommit: "96bd516",
        publicReviewMode: runtime.config.publicReviewMode,
      },
    }),
  );

  if (runtime.config.publicReviewMode === "stateless") {
    registerAppTool(
      server,
      "run_mock_research_workflow",
      {
        title: "Run a mock research workflow",
        description: "Generate deterministic mock AI Scientist v2 ideas and auditable disclosure artifacts in one isolated, stateless operation. It makes no model calls, executes no generated code, accesses no external data, persists no user project, and does not scientifically validate the hypothesis.",
        inputSchema: {
          title: z.string().trim().min(3).max(160).describe("Clear mock research project title."),
          keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(12).describe("Research keywords."),
          tldr: z.string().trim().min(10).max(600).describe("One concise, testable mock research question or hypothesis."),
          abstract: z.string().trim().min(40).max(5_000).describe("Scope, motivation, expected method, and evaluation criteria."),
          maxGenerations: z.number().int().min(1).max(3).default(2).describe("Number of deterministic mock proposals to generate."),
          reflections: z.number().int().min(1).max(8).default(2).describe("Recorded mock refinement setting; no model reflection is performed."),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: TOOL_META,
      },
      async (input) => {
        try {
          const workflow = await runStatelessMockWorkflow(runtime, input);
          return result(`Generated ${workflow.ideas.length} deterministic mock research ideas and deleted the isolated working state.`, {
            view: "workflow",
            ...workflow,
            disclosure: DISCLOSURE_TEXT,
            guarantees: {
              runnerMode: "mock",
              persisted: false,
              realModelCalls: false,
              generatedCodeExecution: false,
              externalDataAccess: false,
              scientificallyValidated: false,
            },
          });
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    return server;
  }

  registerAppTool(
    server,
    "create_research_project",
    {
      title: "Create a research project",
      description: "Create an isolated project from a title, keywords, concise hypothesis, and abstract. This writes internal project state but does not start model calls or code execution.",
      inputSchema: {
        title: z.string().trim().min(3).max(160).describe("Clear research project title."),
        keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(12).describe("Research keywords."),
        tldr: z.string().trim().min(10).max(600).describe("One concise, testable research question or hypothesis."),
        abstract: z.string().trim().min(40).max(5_000).describe("Scope, motivation, expected method, and evaluation criteria."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: TOOL_META,
    },
    async (input) => {
      try {
        assertScope(auth, "research:write");
        const project = await runtime.store.createProject(tenantId, input);
        return result(`Created research project “${project.title}”.`, { view: "project", project, disclosure: DISCLOSURE_TEXT });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "list_research_projects",
    {
      title: "List research projects",
      description: "List research projects belonging only to the authenticated user or tenant.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: TOOL_META,
    },
    async () => {
      try {
        assertScope(auth, "research:read");
        const projects = await runtime.store.listProjects(tenantId);
        return result(`Found ${projects.length} research project${projects.length === 1 ? "" : "s"}.`, { view: "projects", projects });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "start_ideation",
    {
      title: "Start research ideation",
      description: "Queue AI Scientist v2 to generate and refine research ideas, including external literature search. This may consume model-provider credits and access the public internet.",
      inputSchema: {
        projectId: z.string().uuid().describe("Research project identifier."),
        model: z.string().regex(MODEL_PATTERN).default("gpt-4.1").describe("A model identifier supported by the pinned AI Scientist source."),
        maxGenerations: z.number().int().min(1).max(20).default(3).describe("Number of distinct proposals to attempt."),
        reflections: z.number().int().min(1).max(8).default(3).describe("Refinement rounds per proposal."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: TOOL_META,
    },
    async ({ projectId, model, maxGenerations, reflections }) => {
      try {
        assertScope(auth, "research:write");
        const job = await runtime.jobs.enqueue(tenantId, projectId, "ideation", { model, maxGenerations, reflections });
        return result("Research ideation was queued. Use get_job_status to monitor it.", { view: "job", job: publicJob(job) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "list_research_ideas",
    {
      title: "List generated research ideas",
      description: "Read the structured research ideas generated for a project. This does not start a model call or experiment.",
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: TOOL_META,
    },
    async ({ projectId }) => {
      try {
        assertScope(auth, "research:read");
        const ideas = await runtime.store.readIdeas(tenantId, projectId);
        return result(`Found ${ideas.length} generated idea${ideas.length === 1 ? "" : "s"}.`, { view: "ideas", ideas, projectId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "start_experiment",
    {
      title: "Start an autonomous experiment",
      description: "Queue an AI Scientist v2 experiment for one generated idea. This executes LLM-written code, may access external services, consumes compute and model credits, and must run in the configured sandbox.",
      inputSchema: {
        projectId: z.string().uuid(),
        ideaIndex: z.number().int().min(0).max(99).describe("Zero-based index from list_research_ideas."),
        writeupType: z.enum(["normal", "icbinb"]).default("icbinb"),
        skipWriteup: z.boolean().default(false),
        skipReview: z.boolean().default(false),
        modelWriteup: z.string().regex(MODEL_PATTERN).optional(),
        modelCitation: z.string().regex(MODEL_PATTERN).optional(),
        modelReview: z.string().regex(MODEL_PATTERN).optional(),
        modelAggregatePlots: z.string().regex(MODEL_PATTERN).optional(),
        citationRounds: z.number().int().min(0).max(30).default(10),
        acknowledgeCodeExecutionRisk: z.literal(true).describe("Must be true after the user explicitly accepts autonomous code-execution risk and cost."),
        acknowledgeAiDisclosure: z.literal(true).describe("Must be true after the user accepts the mandatory machine-generation disclosure."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      _meta: TOOL_META,
    },
    async ({
      projectId, ideaIndex, writeupType, skipWriteup, skipReview, modelWriteup,
      modelCitation, modelReview, modelAggregatePlots, citationRounds,
    }) => {
      try {
        assertScope(auth, "research:write");
        const ideas = await runtime.store.readIdeas(tenantId, projectId);
        if (!ideas[ideaIndex]) throw new Error(`Idea index ${ideaIndex} does not exist for this project.`);
        const input: {
          ideaIndex: number;
          writeupType: "normal" | "icbinb";
          skipWriteup: boolean;
          skipReview: boolean;
          citationRounds: number;
          modelWriteup?: string;
          modelCitation?: string;
          modelReview?: string;
          modelAggregatePlots?: string;
        } = { ideaIndex, writeupType, skipWriteup, skipReview, citationRounds };
        if (modelWriteup) input.modelWriteup = modelWriteup;
        if (modelCitation) input.modelCitation = modelCitation;
        if (modelReview) input.modelReview = modelReview;
        if (modelAggregatePlots) input.modelAggregatePlots = modelAggregatePlots;
        const job = await runtime.jobs.enqueue(tenantId, projectId, "experiment", input);
        return result("The autonomous experiment was queued. Keep the disclosure attached to every manuscript artifact.", {
          view: "job", job: publicJob(job), disclosure: DISCLOSURE_TEXT,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "get_job_status",
    {
      title: "Get research job status",
      description: "Read current progress, recent diagnostics, and completion metadata for a queued ideation or experiment job.",
      inputSchema: { projectId: z.string().uuid(), jobId: z.string().uuid() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: TOOL_META,
    },
    async ({ projectId, jobId }) => {
      try {
        assertScope(auth, "research:read");
        const [job, logTail] = await Promise.all([
          runtime.store.getJob(tenantId, projectId, jobId),
          runtime.store.readLogTail(tenantId, projectId, jobId),
        ]);
        return result(`Job ${job.id} is ${job.status}. ${job.progress.message}`, {
          view: "job", job: publicJob(job), logTail,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "cancel_job",
    {
      title: "Cancel a research job",
      description: "Stop a queued or running research job. Partial artifacts are retained for audit, but the active process or container is terminated.",
      inputSchema: { projectId: z.string().uuid(), jobId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: TOOL_META,
    },
    async ({ projectId, jobId }) => {
      try {
        assertScope(auth, "research:write");
        const job = await runtime.jobs.cancel(tenantId, projectId, jobId);
        return result(`Job ${job.id} is ${job.status}.`, { view: "job", job: publicJob(job) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "list_artifacts",
    {
      title: "List research artifacts",
      description: "List auditable files produced for a research project, including ideas, logs, metrics, manuscript sources, disclosure records, and papers.",
      inputSchema: { projectId: z.string().uuid() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: TOOL_META,
    },
    async ({ projectId }) => {
      try {
        assertScope(auth, "research:read");
        const artifacts = await runtime.store.listArtifacts(tenantId, projectId);
        return result(`Found ${artifacts.length} project artifact${artifacts.length === 1 ? "" : "s"}.`, {
          view: "artifacts", artifacts, projectId,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "read_artifact",
    {
      title: "Read a text research artifact",
      description: "Read a bounded text artifact from a project after selecting its path with list_artifacts. Binary files and internal state files cannot be read with this tool.",
      inputSchema: {
        projectId: z.string().uuid(),
        path: z.string().min(1).max(500).describe("Project-relative path returned by list_artifacts."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: TOOL_META,
    },
    async ({ projectId, path }) => {
      try {
        assertScope(auth, "research:read");
        const artifact = await runtime.store.readArtifact(tenantId, projectId, path);
        return result(`Read ${artifact.path}${artifact.truncated ? " (truncated)" : ""}.`, {
          view: "artifact", artifact, projectId,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
