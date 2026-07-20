import type { ResearchRunner } from "./runner.js";
import type { ResearchStore } from "./store.js";
import type { JobInput, JobKind, ResearchJob } from "./types.js";

interface QueuedJob {
  tenantId: string;
  projectId: string;
  jobId: string;
}

export class JobManager {
  private readonly queue: QueuedJob[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private running = 0;

  constructor(
    private readonly store: ResearchStore,
    private readonly runner: ResearchRunner,
    private readonly maxConcurrency: number,
  ) {}

  async enqueue(tenantId: string, projectId: string, kind: JobKind, input: JobInput): Promise<ResearchJob> {
    const job = await this.store.createJob(tenantId, projectId, kind, input);
    this.queue.push({ tenantId, projectId, jobId: job.id });
    queueMicrotask(() => void this.drain());
    return job;
  }

  async cancel(tenantId: string, projectId: string, jobId: string): Promise<ResearchJob> {
    const job = await this.store.getJob(tenantId, projectId, jobId);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;

    const queuedIndex = this.queue.findIndex((entry) => entry.tenantId === tenantId && entry.projectId === projectId && entry.jobId === jobId);
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
    this.controllers.get(jobId)?.abort();
    await this.runner.cancel(jobId);
    const timestamp = new Date().toISOString();
    return this.store.updateJob(tenantId, projectId, jobId, {
      status: "cancelled",
      progress: { stage: "cancelled", message: "The job was cancelled before completion." },
      finishedAt: timestamp,
    });
  }

  private async drain(): Promise<void> {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) return;
      this.running += 1;
      void this.run(entry).finally(() => {
        this.running -= 1;
        void this.drain();
      });
    }
  }

  private async run(entry: QueuedJob): Promise<void> {
    const { tenantId, projectId, jobId } = entry;
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    const startedAt = new Date().toISOString();
    let job = await this.store.updateJob(tenantId, projectId, jobId, {
      status: "running",
      startedAt,
      progress: { stage: "starting", message: "The execution worker accepted the job.", percent: 1 },
    });

    try {
      const project = await this.store.getProject(tenantId, projectId);
      const output = await this.runner.execute(tenantId, job, project, controller.signal, async (progress) => {
        const current = await this.store.getJob(tenantId, projectId, jobId);
        if (current.status === "cancelled") return;
        job = await this.store.updateJob(tenantId, projectId, jobId, { progress });
      });
      const current = await this.store.getJob(tenantId, projectId, jobId);
      if (current.status !== "cancelled") {
        await this.store.updateJob(tenantId, projectId, jobId, {
          status: "succeeded",
          output,
          progress: { stage: "complete", message: output.summary, percent: 100 },
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      const current = await this.store.getJob(tenantId, projectId, jobId);
      if (current.status !== "cancelled") {
        const message = error instanceof Error ? error.message : "Unknown execution error.";
        await this.store.updateJob(tenantId, projectId, jobId, {
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: message,
          progress: {
            stage: controller.signal.aborted ? "cancelled" : "failed",
            message,
          },
          finishedAt: new Date().toISOString(),
        });
      }
    } finally {
      this.controllers.delete(jobId);
    }
  }
}
