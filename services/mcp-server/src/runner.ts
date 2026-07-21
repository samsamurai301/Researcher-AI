import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import disclosureScript from "../../../infra/disclose_artifacts.py";
import type { ServiceConfig } from "./config.js";
import type {
  ExperimentInput,
  IdeationInput,
  JobOutput,
  ProgressUpdate,
  ResearchIdea,
  ResearchJob,
  ResearchProject,
} from "./types.js";
import { DISCLOSURE_TEXT } from "./types.js";
import type { ResearchStore } from "./store.js";

type ProgressCallback = (update: ProgressUpdate) => Promise<void> | void;

interface ActiveProcess {
  child: ChildProcess;
  containerName?: string;
}

const PROVIDER_ENVIRONMENT_KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "S2_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION_NAME",
] as const;

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Job was cancelled."));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Job was cancelled."));
    }, { once: true });
  });
}

async function collectFiles(root: string, limit = 200): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  };
  await visit(root);
  return files.sort();
}

function isExperimentInput(input: ResearchJob["input"]): input is ExperimentInput {
  return "ideaIndex" in input;
}

function safeModel(model: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/.test(model)) throw new Error(`Model identifier is invalid: ${model}`);
  return model;
}

function redactSensitive(text: string, environment: NodeJS.ProcessEnv): string {
  let redacted = text
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted-secret]");
  for (const key of PROVIDER_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value && value.length >= 8) redacted = redacted.replaceAll(value, `[redacted-${key.toLowerCase()}]`);
  }
  return redacted;
}

const MOCK_DIRECTIONS = [
  {
    slug: "controlled_baseline",
    label: "Controlled baseline study",
    method: "Compare a pre-registered intervention with the simplest credible baseline under identical data splits and reporting rules.",
    experiment: "Run a controlled baseline comparison with fixed seeds and confidence intervals.",
    risk: "A narrow benchmark may not represent real deployment conditions.",
  },
  {
    slug: "robustness_stress_test",
    label: "Robustness stress test",
    method: "Stress-test the hypothesis across controlled shifts, noise levels, and subgroup slices while holding the evaluation protocol fixed.",
    experiment: "Sweep pre-declared stress conditions and report performance degradation curves.",
    risk: "Synthetic stress conditions may omit important real-world failure modes.",
  },
  {
    slug: "mechanism_ablation",
    label: "Mechanism and ablation study",
    method: "Isolate the proposed mechanism with component ablations, negative controls, and sensitivity analysis.",
    experiment: "Remove or perturb each proposed mechanism and compare the change against negative controls.",
    risk: "Ablations can reveal association without establishing a complete causal explanation.",
  },
] as const;

function mockIdeas(project: ResearchProject, count: number): ResearchIdea[] {
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const metrics = project.brief.evaluationCriteria.length > 0
    ? project.brief.evaluationCriteria
    : ["Primary effect versus baseline", "Uncertainty or confidence interval", "Failure rate by evaluation slice"];
  const baseline = project.brief.baseline ?? "The simplest credible non-adaptive or current-practice baseline.";
  return Array.from({ length: Math.min(count, MOCK_DIRECTIONS.length) }, (_, index) => {
    const direction = MOCK_DIRECTIONS[index]!;
    const novelty = 68 + index * 7;
    const feasibility = 86 - index * 6;
    const clarity = 90 - index * 3;
    const testability = 88 - index * 2;
    const overall = Math.round((novelty + feasibility + clarity + testability) / 4);
    return {
      Name: `mock_${direction.slug}_${slug}`,
      Title: `${project.title}: ${direction.label}`,
      "Short Hypothesis": project.tldr,
      "Related Work": "No live literature search was performed in mock mode; validate novelty and citations independently before execution.",
      Abstract: project.abstract,
      Method: direction.method,
      Baseline: baseline,
      Experiments: [
        direction.experiment,
        "Repeat across at least three deterministic seeds or folds.",
        "Report uncertainty, subgroup behavior, and all pre-declared failure cases.",
      ],
      "Evaluation Metrics": metrics,
      "Falsification Criteria": [
        "The primary criterion does not improve over the declared baseline beyond uncertainty.",
        "The effect reverses or becomes practically negligible under a pre-declared robustness slice.",
      ],
      "Expected Artifacts": ["configuration manifest", "per-run metrics", "comparison table", "failure-case report"],
      "Risk Factors and Limitations": [
        direction.risk,
        ...project.brief.constraints,
        "This is a deterministic planning artifact, not a scientifically evaluated result.",
      ],
      "Planning Score": { novelty, feasibility, clarity, testability, overall, label: "heuristic-mock-score" },
    };
  });
}

function ideationSummary(project: ResearchProject, ideas: ResearchIdea[], reflections: number): string {
  const ranking = [...ideas]
    .sort((left, right) => right["Planning Score"].overall - left["Planning Score"].overall)
    .map((idea, index) => `${index + 1}. **${idea.Title}** — heuristic planning score ${idea["Planning Score"].overall}/100`)
    .join("\n");
  return [
    "# Mock ideation report",
    "",
    `Research question: ${project.tldr}`,
    "",
    "## Ranked directions",
    ranking,
    "",
    "## Refinement trace",
    ...Array.from({ length: reflections }, (_, index) =>
      `- Round ${index + 1}: checked baseline clarity, measurable criteria, falsification conditions, and stated limitations.`),
    "",
    "> Scores are deterministic planning heuristics. They are not evidence, peer review, or scientific validation.",
    "",
    "## Machine-generation disclosure",
    DISCLOSURE_TEXT,
    "",
  ].join("\n");
}

export class ResearchRunner {
  private readonly active = new Map<string, ActiveProcess>();

  constructor(
    private readonly config: ServiceConfig,
    private readonly store: ResearchStore,
  ) {}

  async execute(
    tenantId: string,
    job: ResearchJob,
    project: ResearchProject,
    signal: AbortSignal,
    onProgress: ProgressCallback,
  ): Promise<JobOutput> {
    if (signal.aborted) throw new Error("Job was cancelled before execution started.");
    if (this.config.runnerMode === "mock") return this.runMock(tenantId, job, project, signal, onProgress);
    if (this.config.runnerMode === "docker") return this.runDocker(tenantId, job, project, signal, onProgress);
    return this.runNative(tenantId, job, project, signal, onProgress);
  }

  async cancel(jobId: string): Promise<void> {
    const active = this.active.get(jobId);
    if (!active) return;
    if (active.containerName) {
      const stopper = spawn("docker", ["stop", "--time", "10", active.containerName], { stdio: "ignore" });
      stopper.unref();
    }
    active.child.kill("SIGTERM");
  }

  private async runMock(
    tenantId: string,
    job: ResearchJob,
    project: ResearchProject,
    signal: AbortSignal,
    onProgress: ProgressCallback,
  ): Promise<JobOutput> {
    const projectDirectory = this.store.projectDirectory(tenantId, project.id);
    const artifactDirectory = path.join(this.store.jobDirectory(tenantId, project.id, job.id), "artifacts");
    await onProgress({ stage: "preparing", message: "Preparing an isolated mock research workspace.", percent: 15 });
    await sleep(this.config.mockDelayMs, signal);

    if (job.kind === "ideation") {
      const input = job.input as IdeationInput;
      await onProgress({ stage: "literature-planning", message: "Drafting and checking candidate research directions.", percent: 55 });
      await sleep(this.config.mockDelayMs, signal);
      const ideas = mockIdeas(project, input.maxGenerations);
      await writeFile(path.join(projectDirectory, "topic.json"), `${JSON.stringify(ideas, null, 2)}\n`, "utf8");
      await writeFile(path.join(artifactDirectory, "ideation-summary.md"), ideationSummary(project, ideas, input.reflections), "utf8");
      await writeFile(
        path.join(artifactDirectory, "run-manifest.json"),
        `${JSON.stringify({
          schemaVersion: "0.2.0",
          mode: "mock",
          deterministic: true,
          modelCalls: false,
          externalDataAccess: false,
          generatedCodeExecution: false,
          scientificallyValidated: false,
          parameters: { maxGenerations: input.maxGenerations, reflections: input.reflections },
          disclosure: DISCLOSURE_TEXT,
        }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(artifactDirectory, "AI_GENERATION_DISCLOSURE.md"),
        `# AI-generation disclosure\n\n${DISCLOSURE_TEXT}\n`,
        "utf8",
      );
      await this.store.updateProject(tenantId, project.id, { ideasFile: "topic.json" });
      await onProgress({ stage: "complete", message: `Generated ${ideas.length} mock research ideas.`, percent: 100 });
      return {
        summary: `Generated ${ideas.length} mock research ideas.`,
        artifactRoot: path.relative(projectDirectory, artifactDirectory).split(path.sep).join("/"),
        files: await collectFiles(artifactDirectory),
        metadata: {
          mock: true,
          ideaCount: ideas.length,
          recommendedIdea: ideas
            .map((idea, ideaIndex) => ({ ideaIndex, title: idea.Title, planningScore: idea["Planning Score"].overall }))
            .sort((left, right) => right.planningScore - left.planningScore)[0],
          scoreMeaning: "Deterministic planning heuristic; not scientific evidence.",
        },
      };
    }

    const input = job.input as ExperimentInput;
    const experimentDirectory = path.join(artifactDirectory, `mock-experiment-${job.id}`);
    await mkdir(experimentDirectory, { recursive: true });
    await onProgress({ stage: "experimenting", message: "Running a deterministic mock experiment tree.", percent: 58 });
    await sleep(this.config.mockDelayMs, signal);
    await writeFile(
      path.join(experimentDirectory, "paper.md"),
      `# ${project.title}\n\n> **AI disclosure:** ${DISCLOSURE_TEXT}\n\n## Abstract\n\n${project.abstract}\n\n## Result\n\nMock execution completed. No scientific claim was evaluated.\n`,
      "utf8",
    );
    await writeFile(
      path.join(experimentDirectory, "metrics.json"),
      `${JSON.stringify({ mock: true, ideaIndex: input.ideaIndex, score: null, publicationReady: false }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(experimentDirectory, "AI_GENERATION_DISCLOSURE.md"),
      `# AI-generation disclosure\n\n${DISCLOSURE_TEXT}\n`,
      "utf8",
    );
    await onProgress({ stage: "complete", message: "Mock experiment and disclosure artifacts are ready.", percent: 100 });
    return {
      summary: "Mock experiment completed. No scientific claim was evaluated.",
      artifactRoot: path.relative(projectDirectory, experimentDirectory).split(path.sep).join("/"),
      files: await collectFiles(experimentDirectory),
      metadata: { mock: true, publicationReady: false },
    };
  }

  private async runNative(
    tenantId: string,
    job: ResearchJob,
    project: ResearchProject,
    signal: AbortSignal,
    onProgress: ProgressCallback,
  ): Promise<JobOutput> {
    const jobDirectory = this.store.jobDirectory(tenantId, project.id, job.id);
    const projectDirectory = this.store.projectDirectory(tenantId, project.id);
    const sandbox = path.join(jobDirectory, "sandbox", "ai-scientist-v2");
    const inputDirectory = path.join(sandbox, "inputs");
    const artifactDirectory = path.join(jobDirectory, "artifacts");
    const logPath = path.join(jobDirectory, "run.log");

    await onProgress({ stage: "preparing", message: "Copying the pinned upstream source into a job-local sandbox.", percent: 5 });
    await cp(this.config.aiScientistRoot, sandbox, {
      recursive: true,
      filter: (source) => !source.split(path.sep).some((part) => part === ".git" || part === "__pycache__" || part === "experiments"),
    });
    await mkdir(inputDirectory, { recursive: true });
    await copyFile(path.join(projectDirectory, "topic.md"), path.join(inputDirectory, "topic.md"));

    let args: string[];
    if (job.kind === "ideation") {
      const input = job.input as IdeationInput;
      args = [
        path.join(sandbox, "ai_scientist/perform_ideation_temp_free.py"),
        "--workshop-file", path.join(inputDirectory, "topic.md"),
        "--model", safeModel(input.model),
        "--max-num-generations", String(input.maxGenerations),
        "--num-reflections", String(input.reflections),
      ];
    } else {
      const input = job.input as ExperimentInput;
      const ideasSource = path.join(projectDirectory, "topic.json");
      await copyFile(ideasSource, path.join(inputDirectory, "topic.json"));
      args = [
        path.join(sandbox, "launch_scientist_bfts.py"),
        "--load_ideas", path.join(inputDirectory, "topic.json"),
        "--idea_idx", String(input.ideaIndex),
        "--writeup-type", input.writeupType,
        "--num_cite_rounds", String(input.citationRounds),
      ];
      if (input.skipWriteup) args.push("--skip_writeup");
      if (input.skipReview) args.push("--skip_review");
      if (input.modelWriteup) args.push("--model_writeup", safeModel(input.modelWriteup));
      if (input.modelCitation) args.push("--model_citation", safeModel(input.modelCitation));
      if (input.modelReview) args.push("--model_review", safeModel(input.modelReview));
      if (input.modelAggregatePlots) args.push("--model_agg_plots", safeModel(input.modelAggregatePlots));
    }

    await onProgress({ stage: job.kind === "ideation" ? "ideating" : "experimenting", message: "AI Scientist v2 is running inside the job sandbox.", percent: 12 });
    await this.runProcess(job.id, this.config.pythonBin, args, {
      cwd: sandbox,
      env: { ...process.env, AI_SCIENTIST_ROOT: sandbox, PYTHONDONTWRITEBYTECODE: "1" },
      logPath,
      signal,
      onProgress,
    });

    if (job.kind === "ideation") {
      await copyFile(path.join(inputDirectory, "topic.json"), path.join(projectDirectory, "topic.json"));
      await this.store.updateProject(tenantId, project.id, { ideasFile: "topic.json" });
    } else {
      await cp(path.join(sandbox, "experiments"), path.join(artifactDirectory, "experiments"), { recursive: true });
      await this.applyDisclosureNative(job.id, artifactDirectory, logPath, signal, onProgress);
    }

    const files = job.kind === "ideation" ? ["topic.json"] : await collectFiles(artifactDirectory);
    await onProgress({ stage: "complete", message: "Execution completed and artifacts were indexed.", percent: 100 });
    return {
      summary: `${job.kind === "ideation" ? "Ideation" : "Experiment"} completed with the pinned AI Scientist v2 source.`,
      artifactRoot: job.kind === "ideation" ? "." : path.relative(projectDirectory, artifactDirectory).split(path.sep).join("/"),
      files,
      metadata: { mock: false, runner: "native", upstreamCommit: "96bd51617cfdbb494a9fc283af00fe090edfae48" },
    };
  }

  private async runDocker(
    tenantId: string,
    job: ResearchJob,
    project: ResearchProject,
    signal: AbortSignal,
    onProgress: ProgressCallback,
  ): Promise<JobOutput> {
    const jobDirectory = this.store.jobDirectory(tenantId, project.id, job.id);
    const projectDirectory = this.store.projectDirectory(tenantId, project.id);
    const inputDirectory = path.join(jobDirectory, "inputs");
    const artifactDirectory = path.join(jobDirectory, "artifacts");
    const logPath = path.join(jobDirectory, "run.log");
    const containerName = `researcher-ai-${job.id}`;
    await mkdir(inputDirectory, { recursive: true });
    if (job.kind === "ideation") {
      await copyFile(path.join(projectDirectory, "topic.md"), path.join(inputDirectory, "topic.md"));
    } else {
      await copyFile(path.join(projectDirectory, "topic.json"), path.join(inputDirectory, "topic.json"));
    }
    const dockerArgs = [
      "run", "--rm", "--name", containerName,
      "--security-opt", "no-new-privileges:true",
      "--cap-drop", "ALL",
      "--pids-limit", this.config.dockerPids,
      "--cpus", this.config.dockerCpus,
      "--memory", this.config.dockerMemory,
      "--network", this.config.dockerNetwork,
      "--read-only",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=4g",
      "--gpus", this.config.dockerGpus,
      "--mount", `type=bind,src=${inputDirectory},dst=/workspace`,
      "--mount", `type=bind,src=${artifactDirectory},dst=/opt/ai-scientist/experiments`,
      "--workdir", "/opt/ai-scientist",
      "--env", "PYTHONDONTWRITEBYTECODE=1",
      "--env", "HOME=/tmp/home",
      "--env", "XDG_CACHE_HOME=/tmp/cache",
      "--env", "MPLCONFIGDIR=/tmp/matplotlib",
    ];
    for (const key of PROVIDER_ENVIRONMENT_KEYS) {
      if (process.env[key]) dockerArgs.push("--env", key);
    }
    dockerArgs.push(this.config.dockerImage, this.config.dockerPythonBin);

    if (job.kind === "ideation") {
      const input = job.input as IdeationInput;
      dockerArgs.push(
        "/opt/ai-scientist/ai_scientist/perform_ideation_temp_free.py",
        "--workshop-file", "/workspace/topic.md",
        "--model", safeModel(input.model),
        "--max-num-generations", String(input.maxGenerations),
        "--num-reflections", String(input.reflections),
      );
    } else {
      const input = job.input as ExperimentInput;
      dockerArgs.push(
        "/opt/ai-scientist/launch_scientist_bfts.py",
        "--load_ideas", "/workspace/topic.json",
        "--idea_idx", String(input.ideaIndex),
        "--writeup-type", input.writeupType,
        "--num_cite_rounds", String(input.citationRounds),
      );
      if (input.skipWriteup) dockerArgs.push("--skip_writeup");
      if (input.skipReview) dockerArgs.push("--skip_review");
      if (input.modelWriteup) dockerArgs.push("--model_writeup", safeModel(input.modelWriteup));
      if (input.modelCitation) dockerArgs.push("--model_citation", safeModel(input.modelCitation));
      if (input.modelReview) dockerArgs.push("--model_review", safeModel(input.modelReview));
      if (input.modelAggregatePlots) dockerArgs.push("--model_agg_plots", safeModel(input.modelAggregatePlots));
    }

    await onProgress({ stage: "sandbox-starting", message: "Starting a resource-limited AI Scientist container.", percent: 8 });
    await this.runProcess(job.id, "docker", dockerArgs, {
      cwd: projectDirectory,
      env: process.env,
      logPath,
      signal,
      onProgress,
      containerName,
    });

    if (job.kind === "ideation") {
      await copyFile(path.join(inputDirectory, "topic.json"), path.join(projectDirectory, "topic.json"));
      await this.store.updateProject(tenantId, project.id, { ideasFile: "topic.json" });
    } else {
      await this.applyDisclosureDocker(job.id, artifactDirectory, logPath, signal, onProgress);
    }

    await onProgress({ stage: "complete", message: "Container execution completed and artifacts were indexed.", percent: 100 });
    return {
      summary: `${job.kind === "ideation" ? "Ideation" : "Experiment"} completed in a per-job container.`,
      artifactRoot: job.kind === "ideation" ? "." : path.relative(projectDirectory, artifactDirectory).split(path.sep).join("/"),
      files: job.kind === "ideation" ? ["topic.json"] : await collectFiles(artifactDirectory),
      metadata: { mock: false, runner: "docker", upstreamCommit: "96bd51617cfdbb494a9fc283af00fe090edfae48" },
    };
  }

  private async applyDisclosureNative(
    jobId: string,
    artifactDirectory: string,
    logPath: string,
    signal: AbortSignal,
    onProgress: ProgressCallback,
  ): Promise<void> {
    await onProgress({ stage: "disclosure", message: "Applying the mandatory AI-generation disclosure to manuscript artifacts.", percent: 94 });
    const scriptPath = path.join(path.dirname(artifactDirectory), `disclose-${randomUUID()}.py`);
    await writeFile(scriptPath, disclosureScript, { encoding: "utf8", mode: 0o700 });
    await this.runProcess(jobId, this.config.pythonBin, [scriptPath, artifactDirectory], {
      cwd: path.dirname(artifactDirectory), env: process.env, logPath, signal, onProgress,
    });
  }

  private async applyDisclosureDocker(
    jobId: string,
    artifactDirectory: string,
    logPath: string,
    signal: AbortSignal,
    onProgress: ProgressCallback,
  ): Promise<void> {
    await onProgress({ stage: "disclosure", message: "Applying the mandatory AI-generation disclosure to manuscript artifacts.", percent: 94 });
    const containerName = `researcher-ai-disclose-${jobId}`;
    const args = [
      "run", "--rm", "--name", containerName,
      "--security-opt", "no-new-privileges:true", "--cap-drop", "ALL", "--network", "none", "--read-only",
      "--mount", `type=bind,src=${artifactDirectory},dst=/artifacts`,
      this.config.dockerImage,
      this.config.dockerPythonBin, "/opt/researcher/disclose_artifacts.py", "/artifacts",
    ];
    await this.runProcess(jobId, "docker", args, {
      cwd: artifactDirectory, env: process.env, logPath, signal, onProgress, containerName,
    });
  }

  private async runProcess(
    jobId: string,
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      logPath: string;
      signal: AbortSignal;
      onProgress: ProgressCallback;
      containerName?: string;
    },
  ): Promise<void> {
    await mkdir(path.dirname(options.logPath), { recursive: true });
    const log = await import("node:fs").then(({ createWriteStream }) => createWriteStream(options.logPath, { flags: "a", mode: 0o600 }));
    const commandPreview = [path.basename(command), ...args.map((argument) =>
      path.isAbsolute(argument) ? `[internal-path:${path.basename(argument)}]` : argument
    )].join(" ");
    log.write(`\n[researcher-ai] command: ${commandPreview}\n`);
    if (options.signal.aborted) {
      log.end();
      throw new Error("Job was cancelled before the research process started.");
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
      const active: ActiveProcess = { child };
      if (options.containerName) active.containerName = options.containerName;
      this.active.set(jobId, active);
      let lineBuffer = "";

      const consume = (chunk: Buffer, stream: "stdout" | "stderr") => {
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        const safeLines = lines.map((line) => redactSensitive(line, options.env));
        for (const line of safeLines) log.write(`[${stream}] ${line}\n`);
        const latest = safeLines.at(-1)?.trim();
        if (latest) {
          const message = latest.length > 280 ? `${latest.slice(0, 277)}…` : latest;
          void options.onProgress({
            stage: stream === "stderr" ? "running-with-diagnostics" : "running",
            message,
            percent: 50,
          });
        }
      };

      child.stdout.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
      child.once("error", (error) => {
        this.active.delete(jobId);
        log.end();
        reject(error);
      });
      child.once("exit", (code, signalName) => {
        this.active.delete(jobId);
        if (lineBuffer) log.write(`[output] ${redactSensitive(lineBuffer, options.env)}\n`);
        log.end();
        if (options.signal.aborted) reject(new Error("Job was cancelled."));
        else if (code === 0) resolve();
        else reject(new Error(`Research process exited with code ${String(code)}${signalName ? ` (${signalName})` : ""}.`));
      });

      options.signal.addEventListener("abort", () => {
        void this.cancel(jobId);
      }, { once: true });
    });
  }
}
