import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactContent,
  ArtifactDescriptor,
  JobInput,
  JobKind,
  ResearchJob,
  ResearchProject,
  ResearchProjectInput,
} from "./types.js";
import { DISCLOSURE_TEXT } from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READABLE_EXTENSIONS = new Set([
  ".bib", ".csv", ".html", ".json", ".log", ".md", ".py", ".tex", ".toml", ".tsv", ".txt", ".yaml", ".yml",
]);
const INTERNAL_FILES = new Set(["project.json", "job.json"]);
const PRIVATE_DIRECTORIES = new Set(["inputs", "sandbox"]);
const MAX_ARTIFACT_BYTES = 200_000;

function now(): string {
  return new Date().toISOString();
}

function mediaType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".bib": "application/x-bibtex",
    ".csv": "text/csv",
    ".html": "text/html",
    ".json": "application/json",
    ".log": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".py": "text/x-python",
    ".svg": "image/svg+xml",
    ".tex": "application/x-tex",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
  };
  return types[extension] ?? "application/octet-stream";
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} is not a valid identifier.`);
}

function tenantKey(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex");
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

async function parseJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function topicMarkdown(project: ResearchProject): string {
  const list = (values: string[], fallback: string) => values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${fallback}`;
  const evidence = project.brief.evidenceNotes.length > 0
    ? project.brief.evidenceNotes.map((note) => [
      `### ${note.title}`,
      note.finding,
      note.limitation ? `Limitation: ${note.limitation}` : undefined,
    ].filter(Boolean).join("\n\n")).join("\n\n")
    : "No source notes were supplied. Any literature claims require independent verification.";
  return [
    `# ${project.title}`,
    "",
    "## Keywords",
    project.keywords.join(", "),
    "",
    "## TL;DR",
    project.tldr,
    "",
    "## Abstract",
    project.abstract,
    "",
    "## Objectives",
    list(project.brief.objectives, "Define a measurable answer to the research question."),
    "",
    "## Constraints",
    list(project.brief.constraints, "No additional constraints supplied."),
    "",
    "## Evaluation criteria",
    list(project.brief.evaluationCriteria, "Compare against a stated baseline and report uncertainty."),
    "",
    "## Baseline",
    project.brief.baseline ?? "Establish the simplest credible baseline before testing the intervention.",
    "",
    "## Supplied evidence notes",
    evidence,
    "",
    `## Requested output style\n${project.brief.outputStyle}`,
    "",
    "## Responsible-use disclosure",
    project.disclosure,
    "",
  ].join("\n");
}

function compactStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeProject(project: ResearchProject): ResearchProject {
  if (project.brief) return project;
  return {
    ...project,
    brief: {
      question: project.tldr,
      objectives: [],
      constraints: [],
      evaluationCriteria: [],
      evidenceNotes: [],
      outputStyle: "balanced",
    },
  };
}

export class ResearchStore {
  constructor(readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.join(this.root, "tenants"), { recursive: true, mode: 0o700 });
    await this.recoverInterruptedJobs();
  }

  tenantKey(tenantId: string): string {
    return tenantKey(tenantId);
  }

  tenantDirectory(tenantId: string): string {
    return path.join(this.root, "tenants", tenantKey(tenantId));
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await rm(this.tenantDirectory(tenantId), { recursive: true, force: true });
  }

  projectDirectory(tenantId: string, projectId: string): string {
    assertUuid(projectId, "projectId");
    return path.join(this.tenantDirectory(tenantId), "projects", projectId);
  }

  jobDirectory(tenantId: string, projectId: string, jobId: string): string {
    assertUuid(jobId, "jobId");
    return path.join(this.projectDirectory(tenantId, projectId), "jobs", jobId);
  }

  async createProject(
    tenantId: string,
    input: ResearchProjectInput,
  ): Promise<ResearchProject> {
    const timestamp = now();
    const project: ResearchProject = {
      id: randomUUID(),
      title: input.title.trim(),
      keywords: [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))],
      tldr: input.tldr.trim(),
      abstract: input.abstract.trim(),
      brief: {
        question: input.tldr.trim(),
        objectives: compactStrings(input.objectives),
        constraints: compactStrings(input.constraints),
        evaluationCriteria: compactStrings(input.evaluationCriteria),
        ...(input.baseline?.trim() ? { baseline: input.baseline.trim() } : {}),
        evidenceNotes: (input.evidenceNotes ?? []).map((note) => ({
          title: note.title.trim(),
          finding: note.finding.trim(),
          ...(note.limitation?.trim() ? { limitation: note.limitation.trim() } : {}),
        })),
        outputStyle: input.outputStyle ?? "balanced",
      },
      disclosure: DISCLOSURE_TEXT,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const directory = this.projectDirectory(tenantId, project.id);
    await mkdir(path.join(directory, "jobs"), { recursive: true, mode: 0o700 });
    await atomicJson(path.join(directory, "project.json"), project);
    await writeFile(path.join(directory, "topic.md"), topicMarkdown(project), { encoding: "utf8", mode: 0o600 });
    return project;
  }

  async getProject(tenantId: string, projectId: string): Promise<ResearchProject> {
    const filePath = path.join(this.projectDirectory(tenantId, projectId), "project.json");
    try {
      return normalizeProject(await parseJson<ResearchProject>(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Research project was not found.");
      throw error;
    }
  }

  async updateProject(
    tenantId: string,
    projectId: string,
    updates: Partial<Pick<ResearchProject, "ideasFile">>,
  ): Promise<ResearchProject> {
    const project = await this.getProject(tenantId, projectId);
    const updated: ResearchProject = { ...project, ...updates, updatedAt: now() };
    await atomicJson(path.join(this.projectDirectory(tenantId, projectId), "project.json"), updated);
    return updated;
  }

  async listProjects(tenantId: string): Promise<ResearchProject[]> {
    const projectsDirectory = path.join(this.tenantDirectory(tenantId), "projects");
    let entries;
    try {
      entries = await readdir(projectsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
        .map(async (entry) => normalizeProject(await parseJson<ResearchProject>(path.join(projectsDirectory, entry.name, "project.json")))),
    );
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createJob(tenantId: string, projectId: string, kind: JobKind, input: JobInput): Promise<ResearchJob> {
    await this.getProject(tenantId, projectId);
    const timestamp = now();
    const job: ResearchJob = {
      id: randomUUID(),
      tenantKey: tenantKey(tenantId),
      projectId,
      kind,
      status: "queued",
      input,
      progress: { stage: "queued", message: "Waiting for an execution slot.", percent: 0 },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const directory = this.jobDirectory(tenantId, projectId, job.id);
    await mkdir(path.join(directory, "sandbox"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(directory, "artifacts"), { recursive: true, mode: 0o700 });
    await atomicJson(path.join(directory, "job.json"), job);
    return job;
  }

  async getJob(tenantId: string, projectId: string, jobId: string): Promise<ResearchJob> {
    const filePath = path.join(this.jobDirectory(tenantId, projectId, jobId), "job.json");
    try {
      return await parseJson<ResearchJob>(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Research job was not found.");
      throw error;
    }
  }

  async listJobs(tenantId: string, projectId: string): Promise<ResearchJob[]> {
    const jobsDirectory = path.join(this.projectDirectory(tenantId, projectId), "jobs");
    await this.getProject(tenantId, projectId);
    let entries;
    try {
      entries = await readdir(jobsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const jobs = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
      .map((entry) => parseJson<ResearchJob>(path.join(jobsDirectory, entry.name, "job.json"))));
    return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateJob(
    tenantId: string,
    projectId: string,
    jobId: string,
    updates: Partial<Omit<ResearchJob, "id" | "tenantKey" | "projectId" | "kind" | "input" | "createdAt">>,
  ): Promise<ResearchJob> {
    const job = await this.getJob(tenantId, projectId, jobId);
    const updated: ResearchJob = { ...job, ...updates, updatedAt: now() };
    await atomicJson(path.join(this.jobDirectory(tenantId, projectId, jobId), "job.json"), updated);
    return updated;
  }

  async readIdeas(tenantId: string, projectId: string): Promise<Array<Record<string, unknown>>> {
    const project = await this.getProject(tenantId, projectId);
    if (!project.ideasFile) return [];
    const filePath = path.join(this.projectDirectory(tenantId, projectId), project.ideasFile);
    const ideas = await parseJson<unknown>(filePath);
    if (!Array.isArray(ideas)) throw new Error("The idea artifact is not an array.");
    return ideas.filter((idea): idea is Record<string, unknown> => Boolean(idea) && typeof idea === "object");
  }

  async readLogTail(tenantId: string, projectId: string, jobId: string, maxBytes = 6_000): Promise<string> {
    const filePath = path.join(this.jobDirectory(tenantId, projectId, jobId), "run.log");
    try {
      const descriptor = await open(filePath, "r");
      try {
        const info = await descriptor.stat();
        const length = Math.min(info.size, maxBytes);
        const buffer = Buffer.alloc(length);
        await descriptor.read(buffer, 0, length, Math.max(0, info.size - length));
        return buffer.toString("utf8");
      } finally {
        await descriptor.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }

  async listArtifacts(tenantId: string, projectId: string): Promise<ArtifactDescriptor[]> {
    const root = this.projectDirectory(tenantId, projectId);
    await this.getProject(tenantId, projectId);
    const output: ArtifactDescriptor[] = [];

    const visit = async (directory: string): Promise<void> => {
      if (output.length >= 500) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (output.length >= 500) break;
        if (entry.name.startsWith(".") || INTERNAL_FILES.has(entry.name) || PRIVATE_DIRECTORIES.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
          await visit(absolute);
          continue;
        }
        if (!info.isFile()) continue;
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        const extension = path.extname(relative).toLowerCase();
        output.push({
          path: relative,
          bytes: info.size,
          modifiedAt: info.mtime.toISOString(),
          mediaType: mediaType(relative),
          readable: READABLE_EXTENSIONS.has(extension) && info.size <= MAX_ARTIFACT_BYTES,
        });
      }
    };

    await visit(root);
    return output.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readArtifact(tenantId: string, projectId: string, artifactPath: string): Promise<ArtifactContent> {
    const root = this.projectDirectory(tenantId, projectId);
    await this.getProject(tenantId, projectId);
    if (artifactPath.includes("\0") || path.isAbsolute(artifactPath)) throw new Error("Artifact path is invalid.");
    const normalized = path.normalize(artifactPath);
    const pathParts = normalized.split(path.sep);
    if (normalized.startsWith("..") || INTERNAL_FILES.has(path.basename(normalized)) || pathParts.some((part) => PRIVATE_DIRECTORIES.has(part))) {
      throw new Error("Artifact path is outside the public project artifacts.");
    }
    const candidate = path.join(root, normalized);
    const resolvedRoot = await realpath(root);
    const resolvedCandidate = await realpath(candidate);
    if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("Artifact path escaped the project directory.");
    }
    const info = await stat(resolvedCandidate);
    const extension = path.extname(resolvedCandidate).toLowerCase();
    if (!info.isFile() || !READABLE_EXTENSIONS.has(extension)) throw new Error("Artifact is not a readable text file.");
    const buffer = await readFile(resolvedCandidate);
    const truncated = buffer.byteLength > MAX_ARTIFACT_BYTES;
    return {
      path: normalized.split(path.sep).join("/"),
      content: buffer.subarray(0, MAX_ARTIFACT_BYTES).toString("utf8"),
      mediaType: mediaType(resolvedCandidate),
      truncated,
    };
  }

  async assertReadyForNativeExecution(): Promise<void> {
    await access(this.root, constants.R_OK | constants.W_OK);
  }

  private async recoverInterruptedJobs(): Promise<void> {
    const tenantsRoot = path.join(this.root, "tenants");
    let tenantEntries;
    try {
      tenantEntries = await readdir(tenantsRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const tenant of tenantEntries.filter((entry) => entry.isDirectory())) {
      const projectsRoot = path.join(tenantsRoot, tenant.name, "projects");
      let projectEntries;
      try {
        projectEntries = await readdir(projectsRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const project of projectEntries.filter((entry) => entry.isDirectory())) {
        const jobsRoot = path.join(projectsRoot, project.name, "jobs");
        let jobEntries;
        try {
          jobEntries = await readdir(jobsRoot, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const jobEntry of jobEntries.filter((entry) => entry.isDirectory())) {
          const jobPath = path.join(jobsRoot, jobEntry.name, "job.json");
          try {
            const job = await parseJson<ResearchJob>(jobPath);
            if (job.status === "queued" || job.status === "running") {
              const timestamp = now();
              await atomicJson(jobPath, {
                ...job,
                status: "failed",
                error: "The service restarted before this job completed. Start a new job to retry safely.",
                progress: { stage: "interrupted", message: "Execution was interrupted by a service restart." },
                updatedAt: timestamp,
                finishedAt: timestamp,
              });
            }
          } catch {
            // Corrupt job records are left untouched for operator inspection.
          }
        }
      }
    }
  }
}
