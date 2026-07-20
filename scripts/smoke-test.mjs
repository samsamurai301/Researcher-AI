import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "researcher-ai-smoke-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(process.cwd(), "plugins/researcher-ai/bin/researcher-ai-mcp.mjs")],
  env: {
    ...process.env,
    RESEARCHER_DATA_DIR: dataDir,
    RESEARCHER_RUNNER: "mock",
    RESEARCHER_MOCK_DELAY_MS: "5",
  },
});
const client = new Client({ name: "researcher-ai-smoke", version: "0.1.0" });

function structured(result) {
  if (result.isError) {
    const message = result.content?.find((entry) => entry.type === "text")?.text ?? "MCP tool returned an error";
    throw new Error(message);
  }
  if (!result.structuredContent || typeof result.structuredContent !== "object") {
    throw new Error("MCP tool did not return structured content");
  }
  return result.structuredContent;
}

async function waitForJob(projectId, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = structured(await client.callTool({
      name: "get_job_status",
      arguments: { projectId, jobId },
    }));
    if (["succeeded", "failed", "cancelled"].includes(status.job?.status)) return status.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  if (tools.tools.length !== 10) throw new Error(`Expected 10 tools, got ${tools.tools.length}`);
  const service = structured(await client.callTool({ name: "get_service_status", arguments: {} }));
  if (service.service?.runnerMode !== "mock") throw new Error("Smoke test did not start in mock mode");

  const created = structured(await client.callTool({
    name: "create_research_project",
    arguments: {
      title: "Researcher AI end-to-end smoke test",
      keywords: ["integration", "auditability"],
      tldr: "The packaged MCP service completes its deterministic workflow end to end.",
      abstract: "Exercise project creation, queued ideation, experiment execution, artifact indexing, and disclosure preservation.",
    },
  }));
  const projectId = created.project?.id;
  if (!projectId) throw new Error("Project creation did not return an ID");

  const ideation = structured(await client.callTool({
    name: "start_ideation",
    arguments: { projectId, model: "gpt-4.1", maxGenerations: 2, reflections: 1 },
  }));
  const ideationJob = await waitForJob(projectId, ideation.job?.id);
  if (ideationJob.status !== "succeeded") throw new Error(`Ideation ended as ${ideationJob.status}`);
  const ideas = structured(await client.callTool({ name: "list_research_ideas", arguments: { projectId } }));
  if (ideas.ideas?.length !== 2) throw new Error("Mock ideation did not produce two ideas");

  const experiment = structured(await client.callTool({
    name: "start_experiment",
    arguments: {
      projectId,
      ideaIndex: 0,
      writeupType: "icbinb",
      skipWriteup: false,
      skipReview: false,
      citationRounds: 1,
      acknowledgeCodeExecutionRisk: true,
      acknowledgeAiDisclosure: true,
    },
  }));
  const experimentJob = await waitForJob(projectId, experiment.job?.id);
  if (experimentJob.status !== "succeeded") throw new Error(`Experiment ended as ${experimentJob.status}`);

  const artifactResult = structured(await client.callTool({ name: "list_artifacts", arguments: { projectId } }));
  const paper = artifactResult.artifacts?.find((artifact) => artifact.path?.endsWith("paper.md"));
  if (!paper) throw new Error("Mock experiment paper was not indexed");
  const readResult = structured(await client.callTool({
    name: "read_artifact",
    arguments: { projectId, path: paper.path },
  }));
  if (!readResult.artifact?.content?.includes("AI disclosure")) {
    throw new Error("Mock manuscript did not preserve the disclosure");
  }

  console.log(`Smoke test passed the complete workflow with ${tools.tools.length} MCP tools.`);
} finally {
  await client.close();
}
