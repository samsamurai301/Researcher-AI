import type { ServiceConfig } from "./config.js";
import { JobManager } from "./job-manager.js";
import { ResearchRunner } from "./runner.js";
import { ResearchStore } from "./store.js";

export interface ServiceRuntime {
  config: ServiceConfig;
  store: ResearchStore;
  runner: ResearchRunner;
  jobs: JobManager;
}

export async function createRuntime(config: ServiceConfig): Promise<ServiceRuntime> {
  const store = new ResearchStore(config.dataDir);
  await store.initialize();
  const runner = new ResearchRunner(config, store);
  const jobs = new JobManager(store, runner, config.maxConcurrency);
  return { config, store, runner, jobs };
}
