export const DISCLOSURE_TEXT =
  "This manuscript was autonomously generated or produced using The AI Scientist. Human reviewers remain responsible for verification, attribution, and publication decisions.";

export type RunnerMode = "mock" | "native" | "docker";
export type AuthMode = "none" | "static" | "oidc";
export type JobKind = "ideation" | "experiment";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ResearchProject {
  id: string;
  title: string;
  keywords: string[];
  tldr: string;
  abstract: string;
  disclosure: string;
  createdAt: string;
  updatedAt: string;
  ideasFile?: string;
}

export interface IdeationInput {
  model: string;
  maxGenerations: number;
  reflections: number;
}

export interface ExperimentInput {
  ideaIndex: number;
  writeupType: "normal" | "icbinb";
  skipWriteup: boolean;
  skipReview: boolean;
  modelWriteup?: string;
  modelCitation?: string;
  modelReview?: string;
  modelAggregatePlots?: string;
  citationRounds: number;
}

export type JobInput = IdeationInput | ExperimentInput;

export interface JobProgress {
  stage: string;
  message: string;
  percent?: number;
}

export interface JobOutput {
  summary: string;
  artifactRoot: string;
  files: string[];
  metadata?: Record<string, unknown>;
}

export interface ResearchJob {
  id: string;
  tenantKey: string;
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  input: JobInput;
  progress: JobProgress;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  output?: JobOutput;
}

export interface ArtifactDescriptor {
  path: string;
  bytes: number;
  modifiedAt: string;
  mediaType: string;
  readable: boolean;
}

export interface ArtifactContent {
  path: string;
  content: string;
  mediaType: string;
  truncated: boolean;
}

export interface ProgressUpdate {
  stage: string;
  message: string;
  percent?: number;
}
