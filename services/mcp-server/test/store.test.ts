import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchStore } from "../src/store.js";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<ResearchStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "researcher-ai-store-"));
  temporaryDirectories.push(root);
  const store = new ResearchStore(root);
  await store.initialize();
  return store;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ResearchStore", () => {
  it("isolates projects by tenant", async () => {
    const store = await createStore();
    const project = await store.createProject("tenant-a", {
      title: "A falsifiable systems hypothesis",
      keywords: ["systems", "testing"],
      tldr: "A controlled intervention changes the selected systems metric.",
      abstract: "Evaluate a controlled intervention against a fixed baseline with uncertainty and failure cases.",
    });

    await expect(store.getProject("tenant-a", project.id)).resolves.toMatchObject({ id: project.id });
    await expect(store.getProject("tenant-b", project.id)).rejects.toThrow("not found");
    await expect(store.listProjects("tenant-b")).resolves.toEqual([]);
  });

  it("blocks traversal, internal state, and symlink-style escape paths", async () => {
    const store = await createStore();
    const project = await store.createProject("tenant-a", {
      title: "Artifact boundary test",
      keywords: ["security"],
      tldr: "Only explicitly public project artifacts can be read through MCP.",
      abstract: "Exercise project-relative artifact paths and verify that internal records remain inaccessible.",
    });
    await writeFile(path.join(store.projectDirectory("tenant-a", project.id), "result.md"), "safe\n", "utf8");

    await expect(store.readArtifact("tenant-a", project.id, "result.md")).resolves.toMatchObject({ content: "safe\n" });
    await expect(store.readArtifact("tenant-a", project.id, "../../outside.md")).rejects.toThrow("outside");
    await expect(store.readArtifact("tenant-a", project.id, "project.json")).rejects.toThrow("outside");
  });
});
