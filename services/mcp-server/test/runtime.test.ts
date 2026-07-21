import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { DISCLOSURE_TEXT } from "../src/types.js";

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "researcher-ai-runtime-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function waitForTerminalJob(
  runtime: Awaited<ReturnType<typeof createRuntime>>,
  tenantId: string,
  projectId: string,
  jobId: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = await runtime.store.getJob(tenantId, projectId, jobId);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for mock job");
}

describe("mock research runtime", () => {
  it("runs ideation and preserves a machine-generation disclosure", async () => {
    const root = await temporaryRoot();
    const config = loadConfig({
      RESEARCHER_DATA_DIR: root,
      RESEARCHER_RUNNER: "mock",
      RESEARCHER_MOCK_DELAY_MS: "1",
    });
    const runtime = await createRuntime(config);
    const tenantId = "test-tenant";
    const project = await runtime.store.createProject(tenantId, {
      title: "Mock integration experiment",
      keywords: ["integration", "reproducibility"],
      tldr: "The integration produces auditable state without a provider call.",
      abstract: "Verify the complete queue, storage, artifact, and disclosure path using deterministic mock execution.",
      objectives: ["Verify deterministic ranking", "Preserve an audit trail"],
      constraints: ["No provider calls"],
      evaluationCriteria: ["Repeatable proposal order", "Disclosure present"],
      baseline: "The v0.1 thin mock proposal",
    });

    const job = await runtime.jobs.enqueue(tenantId, project.id, "ideation", {
      model: "gpt-4.1",
      maxGenerations: 2,
      reflections: 1,
    });
    const completed = await waitForTerminalJob(runtime, tenantId, project.id, job.id);
    const ideas = await runtime.store.readIdeas(tenantId, project.id);
    const artifacts = await runtime.store.listArtifacts(tenantId, project.id);

    expect(completed.status).toBe("succeeded");
    expect(ideas).toHaveLength(2);
    expect(ideas[0]).toMatchObject({
      Method: expect.any(String),
      "Falsification Criteria": expect.any(Array),
      "Planning Score": { label: "heuristic-mock-score", overall: expect.any(Number) },
    });
    await expect(runtime.store.getProject(tenantId, project.id)).resolves.toMatchObject({
      brief: { objectives: ["Verify deterministic ranking", "Preserve an audit trail"] },
    });
    expect(artifacts.some((artifact) => artifact.path.endsWith("ideation-summary.md"))).toBe(true);
    expect(artifacts.some((artifact) => artifact.path.endsWith("run-manifest.json"))).toBe(true);
    const summary = artifacts.find((artifact) => artifact.path.endsWith("ideation-summary.md"));
    expect(summary).toBeDefined();
    const content = await runtime.store.readArtifact(tenantId, project.id, summary!.path);
    expect(content.content).toContain(DISCLOSURE_TEXT);
  });

  it("deduplicates identical retry calls while a job is active or newly completed", async () => {
    const root = await temporaryRoot();
    const runtime = await createRuntime(loadConfig({
      RESEARCHER_DATA_DIR: root,
      RESEARCHER_RUNNER: "mock",
      RESEARCHER_MOCK_DELAY_MS: "20",
    }));
    const tenantId = "retry-tenant";
    const project = await runtime.store.createProject(tenantId, {
      title: "Retry-safe ideation",
      keywords: ["retries", "stability"],
      tldr: "Identical immediate retry calls resolve to one research job.",
      abstract: "Verify that model or network retries do not duplicate an active or newly completed ideation job.",
    });
    const input = { model: "gpt-4.1", maxGenerations: 2, reflections: 2 };
    const first = await runtime.jobs.enqueue(tenantId, project.id, "ideation", input);
    const activeRetry = await runtime.jobs.enqueue(tenantId, project.id, "ideation", input);
    expect(activeRetry.id).toBe(first.id);
    await waitForTerminalJob(runtime, tenantId, project.id, first.id);
    const completedRetry = await runtime.jobs.enqueue(tenantId, project.id, "ideation", input);
    expect(completedRetry.id).toBe(first.id);
    await expect(runtime.store.listJobs(tenantId, project.id)).resolves.toHaveLength(1);
  });

  it("keeps a cancelled running job cancelled", async () => {
    const root = await temporaryRoot();
    const runtime = await createRuntime(loadConfig({
      RESEARCHER_DATA_DIR: root,
      RESEARCHER_RUNNER: "mock",
      RESEARCHER_MOCK_DELAY_MS: "200",
    }));
    const tenantId = "cancel-tenant";
    const project = await runtime.store.createProject(tenantId, {
      title: "Cancellation race test",
      keywords: ["cancellation"],
      tldr: "Cancelling an accepted job prevents successful completion.",
      abstract: "Exercise cancellation after the worker accepts a job and ensure terminal state cannot return to running or success.",
    });
    const job = await runtime.jobs.enqueue(tenantId, project.id, "ideation", {
      model: "gpt-4.1",
      maxGenerations: 1,
      reflections: 1,
    });

    const runningDeadline = Date.now() + 2_000;
    while ((await runtime.store.getJob(tenantId, project.id, job.id)).status === "queued") {
      if (Date.now() > runningDeadline) throw new Error("Job never started");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await runtime.jobs.cancel(tenantId, project.id, job.id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(runtime.store.getJob(tenantId, project.id, job.id)).resolves.toMatchObject({ status: "cancelled" });
  });
});
