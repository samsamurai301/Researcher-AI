import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useCallback, useState } from "react";

type Status = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface ResearchBrief {
  question: string;
  objectives: string[];
  constraints: string[];
  evaluationCriteria: string[];
  baseline?: string;
  evidenceNotes: Array<{ title: string; finding: string; limitation?: string }>;
  outputStyle: "concise" | "balanced" | "detailed";
}

interface ProjectView {
  id?: string;
  title: string;
  keywords: string[];
  tldr: string;
  abstract: string;
  brief?: ResearchBrief;
  createdAt?: string;
  updatedAt?: string;
}

interface JobView {
  id: string;
  projectId: string;
  kind: "ideation" | "experiment";
  status: Status;
  createdAt: string;
  updatedAt: string;
  progress: { stage: string; message: string; percent?: number };
  error?: string;
  output?: Record<string, unknown>;
}

interface PlanningScore {
  novelty: number;
  feasibility: number;
  clarity: number;
  testability: number;
  overall: number;
  label: string;
}

interface IdeaView extends Record<string, unknown> {
  Name?: string;
  Title?: string;
  "Short Hypothesis"?: string;
  Method?: string;
  Baseline?: string;
  Experiments?: string[];
  "Evaluation Metrics"?: string[];
  "Falsification Criteria"?: string[];
  "Risk Factors and Limitations"?: string[];
  "Planning Score"?: PlanningScore;
}

interface ArtifactView {
  path: string;
  bytes: number;
  modifiedAt: string;
  mediaType: string;
  readable: boolean;
}

interface WorkflowView {
  id: string;
  schemaVersion: string;
  status: "succeeded";
  mode: "mock";
  durationMs: number;
  recommendation?: { ideaIndex: number; title: string; planningScore: number };
  ranking: Array<{ ideaIndex: number; title: string; planningScore: number }>;
  stages: Array<{ name: string; status: string }>;
  refinementTrace: Array<{ round: number; checks: string[]; result: string }>;
  ideas: IdeaView[];
  artifacts: Array<{ name: string; mediaType: string; bytes: number; content: string }>;
}

interface DashboardView {
  project: ProjectView;
  recommendation?: { ideaIndex: number; title: string; planningScore: number };
  rankedIdeas: Array<{ ideaIndex: number; title: string; planningScore: number }>;
  recentJobs: JobView[];
  jobStatusCounts: Record<string, number>;
  artifactSummary: { total: number; readable: number; totalBytes: number };
  nextAction: string;
}

interface ToolView {
  view: "service" | "project" | "projects" | "dashboard" | "ideas" | "job" | "artifacts" | "artifact" | "workflow";
  message: string;
  error?: boolean;
  errorCode?: string;
  retryable?: boolean;
  service?: Record<string, unknown>;
  project?: ProjectView;
  projects?: ProjectView[];
  dashboard?: DashboardView;
  ideas?: IdeaView[];
  job?: JobView;
  artifacts?: ArtifactView[];
  artifact?: { path: string; content: string; mediaType: string };
  workflow?: WorkflowView;
}

const disclosure =
  "Any resulting manuscript must prominently disclose that it was machine-generated or produced using The AI Scientist.";

function statusTone(status: Status): string {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running") return "active";
  return "muted";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function metricValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function downloadArtifact(app: McpApp | null, artifact: WorkflowView["artifacts"][number]): Promise<void> {
  if (app) {
    try {
      const result = await app.downloadFile({
        contents: [{
          type: "resource",
          resource: {
            uri: `file:///${artifact.name}`,
            mimeType: artifact.mediaType,
            text: artifact.content,
          },
        }],
      });
      if (!result.isError) return;
    } catch {
      // Older hosts can still use the browser fallback below.
    }
  }
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ResearcherWidget() {
  const [data, setData] = useState<ToolView | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const captureResult = useCallback((result: { structuredContent?: unknown }) => {
    if (result.structuredContent && typeof result.structuredContent === "object") {
      setData(result.structuredContent as ToolView);
    }
  }, []);

  const { app, error } = useApp({
    appInfo: { name: "Researcher AI", version: "0.2.0" },
    capabilities: {},
    onAppCreated: (created: McpApp) => {
      created.ontoolresult = captureResult;
    },
  });

  const refreshJob = async () => {
    if (!app || !data?.job) return;
    setActionMessage("Refreshing…");
    try {
      captureResult(await app.callServerTool({
        name: "get_job_status",
        arguments: { projectId: data.job.projectId, jobId: data.job.id },
      }));
    } finally {
      setActionMessage(null);
    }
  };

  const cancelJob = async () => {
    if (!app || !data?.job) return;
    setActionMessage("Cancelling…");
    try {
      captureResult(await app.callServerTool({
        name: "cancel_job",
        arguments: { projectId: data.job.projectId, jobId: data.job.id },
      }));
    } finally {
      setActionMessage(null);
    }
  };

  if (error) {
    return <main className="shell"><div className="empty danger-text">Unable to connect: {error.message}</div></main>;
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="mark" aria-hidden="true">R</div>
        <div>
          <p className="eyebrow">AUDITABLE RESEARCH CONTROL PLANE</p>
          <h1>Researcher AI</h1>
        </div>
        <span className="version">v0.2</span>
      </header>

      {!app && <div className="empty">Connecting to the research service…</div>}
      {app && !data && <div className="empty">Waiting for a Researcher AI tool result…</div>}

      {data && (
        <section className="content">
          <div className={`notice ${data.error ? "error-notice" : ""}`}>
            <p className="message">{data.message}</p>
            {data.errorCode && <span className="badge danger">{data.errorCode}</span>}
          </div>

          {data.service && (
            <div className="metric-grid">
              {Object.entries(data.service).map(([key, value]) => (
                <div className="metric" key={key}>
                  <span>{key.replaceAll(/([A-Z])/g, " $1")}</span>
                  <strong>{metricValue(value)}</strong>
                </div>
              ))}
            </div>
          )}

          {data.workflow && <WorkflowPanel app={app} workflow={data.workflow} project={data.project} />}
          {data.dashboard && <DashboardPanel dashboard={data.dashboard} />}
          {data.project && !data.workflow && <ProjectCard project={data.project} />}

          {data.projects && (
            <div className="stack">
              {data.projects.length === 0 ? <div className="empty">No research projects yet.</div> : null}
              {data.projects.map((project, index) => <ProjectCard project={project} key={project.id ?? `${project.title}-${index}`} compact />)}
            </div>
          )}

          {data.ideas && <div className="stack">{data.ideas.map((idea, index) => <IdeaCard idea={idea} index={index} key={`${idea.Name ?? "idea"}-${index}`} />)}</div>}

          {data.job && <JobCard job={data.job} actionMessage={actionMessage} refreshJob={refreshJob} cancelJob={cancelJob} />}

          {data.artifacts && (
            <div className="artifact-list">
              {data.artifacts.map((artifact) => (
                <div className="artifact" key={artifact.path}>
                  <div><strong>{artifact.path}</strong><span>{artifact.mediaType}{artifact.readable ? " · readable" : ""}</span></div>
                  <span>{formatBytes(artifact.bytes)}</span>
                </div>
              ))}
            </div>
          )}

          {data.artifact && (
            <article className="card"><p className="eyebrow">{data.artifact.path}</p><pre className="artifact-content">{data.artifact.content}</pre></article>
          )}

          <aside className="disclosure"><strong>Required disclosure</strong><span>{disclosure}</span></aside>
        </section>
      )}
    </main>
  );
}

function WorkflowPanel({ app, workflow, project }: { app: McpApp | null; workflow: WorkflowView; project?: ProjectView | undefined }) {
  return (
    <div className="stack">
      <article className="card recommendation">
        <div className="row between">
          <div><p className="eyebrow">RECOMMENDED DIRECTION</p><h2>{workflow.recommendation?.title ?? "No direction generated"}</h2></div>
          {workflow.recommendation && <Score value={workflow.recommendation.planningScore} />}
        </div>
        <p>Ranked by a deterministic planning heuristic only. Validate novelty, evidence, and scientific merit independently.</p>
        <div className="run-meta"><span>{workflow.mode}</span><span>{workflow.durationMs} ms</span><span>schema {workflow.schemaVersion}</span></div>
      </article>
      {project && <ProjectCard project={project} />}
      <div className="timeline">
        {workflow.stages.map((stage) => <div key={stage.name}><span aria-hidden="true">✓</span><strong>{stage.name.replaceAll("-", " ")}</strong></div>)}
      </div>
      <div className="stack">{workflow.ideas.map((idea, index) => <IdeaCard idea={idea} index={index} key={`${idea.Name ?? "idea"}-${index}`} />)}</div>
      <article className="card">
        <p className="eyebrow">INLINE AUDIT EXPORTS</p>
        <div className="artifact-list">
          {workflow.artifacts.map((artifact) => (
            <div className="artifact" key={artifact.name}>
              <div><strong>{artifact.name}</strong><span>{artifact.mediaType} · {formatBytes(artifact.bytes)}</span></div>
              <button className="small-button" type="button" onClick={() => void downloadArtifact(app, artifact)}>Download</button>
            </div>
          ))}
        </div>
      </article>
      <details className="card details"><summary>Refinement trace ({workflow.refinementTrace.length})</summary>
        {workflow.refinementTrace.map((entry) => <p key={entry.round}><strong>Round {entry.round}:</strong> {entry.checks.join(", ")} — {entry.result}</p>)}
      </details>
    </div>
  );
}

function DashboardPanel({ dashboard }: { dashboard: DashboardView }) {
  return (
    <div className="stack">
      <ProjectCard project={dashboard.project} />
      <article className="card next-action"><p className="eyebrow">RECOMMENDED NEXT ACTION</p><h2>{dashboard.nextAction}</h2>
        {dashboard.recommendation && <p>Top direction: {dashboard.recommendation.title} ({dashboard.recommendation.planningScore}/100 planning score)</p>}
      </article>
      <div className="metric-grid">
        <div className="metric"><span>jobs</span><strong>{dashboard.recentJobs.length}</strong></div>
        <div className="metric"><span>ideas</span><strong>{dashboard.rankedIdeas.length}</strong></div>
        <div className="metric"><span>artifacts</span><strong>{dashboard.artifactSummary.total}</strong></div>
        <div className="metric"><span>artifact size</span><strong>{formatBytes(dashboard.artifactSummary.totalBytes)}</strong></div>
      </div>
      {dashboard.recentJobs.length > 0 && <div className="stack">{dashboard.recentJobs.slice(0, 3).map((job) => <MiniJob job={job} key={job.id} />)}</div>}
    </div>
  );
}

function IdeaCard({ idea, index }: { idea: IdeaView; index: number }) {
  const score = idea["Planning Score"];
  const list = (values: string[] | undefined) => values?.map((value) => <li key={value}>{value}</li>);
  return (
    <article className="card idea-card">
      <div className="row between"><div><p className="eyebrow">DIRECTION {index + 1}</p><h2>{String(idea.Title ?? idea.Name ?? "Untitled idea")}</h2></div>{score && <Score value={score.overall} />}</div>
      <p>{String(idea["Short Hypothesis"] ?? idea.Abstract ?? "No hypothesis provided.")}</p>
      {idea.Method && <div className="callout"><strong>Method</strong><span>{idea.Method}</span></div>}
      <details className="idea-details"><summary>Evaluation and failure conditions</summary>
        {idea.Baseline && <><h3>Baseline</h3><p>{idea.Baseline}</p></>}
        {idea["Evaluation Metrics"]?.length ? <><h3>Evaluation criteria</h3><ul>{list(idea["Evaluation Metrics"])}</ul></> : null}
        {idea["Falsification Criteria"]?.length ? <><h3>Falsification criteria</h3><ul>{list(idea["Falsification Criteria"])}</ul></> : null}
        {idea["Risk Factors and Limitations"]?.length ? <><h3>Risks and limitations</h3><ul>{list(idea["Risk Factors and Limitations"])}</ul></> : null}
      </details>
    </article>
  );
}

function ProjectCard({ project, compact = false }: { project: ProjectView; compact?: boolean }) {
  return (
    <article className={`card ${compact ? "compact" : ""}`}>
      <p className="eyebrow">RESEARCH BRIEF</p><h2>{project.title}</h2><p>{project.tldr}</p>
      {!compact && <><p className="secondary">{project.abstract}</p>{project.brief && (
        <div className="brief-grid">
          <BriefList title="Objectives" values={project.brief.objectives} />
          <BriefList title="Evaluation" values={project.brief.evaluationCriteria} />
          <BriefList title="Constraints" values={project.brief.constraints} />
          {project.brief.baseline && <div><strong>Baseline</strong><p>{project.brief.baseline}</p></div>}
        </div>
      )}</>}
      <div className="chips">{project.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
    </article>
  );
}

function BriefList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null;
  return <div><strong>{title}</strong><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></div>;
}

function Score({ value }: { value: number }) {
  return <div className="score" aria-label={`Planning score ${value} out of 100`}><strong>{value}</strong><span>/100</span></div>;
}

function MiniJob({ job }: { job: JobView }) {
  return <div className="mini-job"><div><strong>{job.kind}</strong><span>{job.progress.message}</span></div><span className={`badge ${statusTone(job.status)}`}>{job.status}</span></div>;
}

function JobCard({ job, actionMessage, refreshJob, cancelJob }: { job: JobView; actionMessage: string | null; refreshJob: () => Promise<void>; cancelJob: () => Promise<void> }) {
  return (
    <article className="card job-card">
      <div className="row between"><div><p className="eyebrow">{job.kind.toUpperCase()} JOB</p><h2>{job.progress.stage}</h2></div><span className={`badge ${statusTone(job.status)}`}>{job.status}</span></div>
      <p>{job.progress.message}</p>
      {typeof job.progress.percent === "number" && <div className="progress" aria-label={`${job.progress.percent}% complete`}><div style={{ width: `${Math.max(0, Math.min(100, job.progress.percent))}%` }} /></div>}
      {job.error && <pre className="error-panel">{job.error}</pre>}
      <div className="actions"><button type="button" onClick={() => void refreshJob()} disabled={Boolean(actionMessage)}>Refresh</button>
        {(job.status === "queued" || job.status === "running") && <button type="button" className="danger-button" onClick={() => void cancelJob()} disabled={Boolean(actionMessage)}>Cancel</button>}
        {actionMessage && <span>{actionMessage}</span>}
      </div>
    </article>
  );
}
