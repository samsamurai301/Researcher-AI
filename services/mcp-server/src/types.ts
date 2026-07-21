export const DISCLOSURE_TEXT =
  "This manuscript was autonomously generated or produced using The AI Scientist. Human reviewers remain responsible for verification, attribution, and publication decisions.";
export const SERVICE_VERSION = "0.2.0";

export type RunnerMode = "mock" | "native" | "docker";
export type AuthMode = "none" | "session" | "static" | "oidc";
export type JobKind = "ideation" | "experiment";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface EvidenceNote {
  title: string;
  finding: string;
  limitation?: string | undefined;
}

export interface ResearchBrief {
  question: string;
  objectives: string[];
  constraints: string[];
  evaluationCriteria: string[];
  baseline?: string | undefined;
  evidenceNotes: EvidenceNote[];
  outputStyle: "concise" | "balanced" | "detailed";
}

export interface ResearchProjectInput {
  title: string;
  keywords: string[];
  tldr: string;
  abstract: string;
  objectives?: string[] | undefined;
  constraints?: string[] | undefined;
  evaluationCriteria?: string[] | undefined;
  baseline?: string | undefined;
  evidenceNotes?: EvidenceNote[] | undefined;
  outputStyle?: ResearchBrief["outputStyle"] | undefined;
}

export interface ResearchProject {
  id: string;
  title: string;
  keywords: string[];
  tldr: string;
  abstract: string;
  brief: ResearchBrief;
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

export interface PlanningScore {
  novelty: number;
  feasibility: number;
  clarity: number;
  testability: number;
  overall: number;
  label: "heuristic-mock-score";
}

export interface ResearchIdea {
  Name: string;
  Title: string;
  "Short Hypothesis": string;
  "Related Work": string;
  Abstract: string;
  Method: string;
  Baseline: string;
  Experiments: string[];
  "Evaluation Metrics": string[];
  "Falsification Criteria": string[];
  "Expected Artifacts": string[];
  "Risk Factors and Limitations": string[];
  "Planning Score": PlanningScore;
}
