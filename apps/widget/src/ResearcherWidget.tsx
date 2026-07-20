import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useCallback, useState } from "react";

type Status = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface ProjectView {
  id: string;
  title: string;
  keywords: string[];
  tldr: string;
  abstract: string;
  createdAt: string;
  updatedAt: string;
}

interface JobView {
  id: string;
  projectId: string;
  kind: "ideation" | "experiment";
  status: Status;
  createdAt: string;
  updatedAt: string;
  progress: {
    stage: string;
    message: string;
    percent?: number;
  };
  error?: string;
  output?: Record<string, unknown>;
}

interface ArtifactView {
  path: string;
  bytes: number;
  modifiedAt: string;
  mediaType: string;
  readable: boolean;
}

interface ToolView {
  view: "service" | "project" | "projects" | "ideas" | "job" | "artifacts" | "artifact";
  message: string;
  service?: Record<string, unknown>;
  project?: ProjectView;
  projects?: ProjectView[];
  ideas?: Array<Record<string, unknown>>;
  job?: JobView;
  artifacts?: ArtifactView[];
  artifact?: { path: string; content: string; mediaType: string };
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

export function ResearcherWidget() {
  const [data, setData] = useState<ToolView | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const captureResult = useCallback((result: { structuredContent?: unknown }) => {
    if (result.structuredContent && typeof result.structuredContent === "object") {
      setData(result.structuredContent as ToolView);
    }
  }, []);

  const { app, error } = useApp({
    appInfo: { name: "Researcher AI", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (created: McpApp) => {
      created.ontoolresult = captureResult;
    },
  });

  const refreshJob = async () => {
    if (!app || !data?.job) return;
    setActionMessage("Refreshing…");
    const result = await app.callServerTool({
      name: "get_job_status",
      arguments: { projectId: data.job.projectId, jobId: data.job.id },
    });
    captureResult(result);
    setActionMessage(null);
  };

  const cancelJob = async () => {
    if (!app || !data?.job) return;
    setActionMessage("Cancelling…");
    const result = await app.callServerTool({
      name: "cancel_job",
      arguments: { projectId: data.job.projectId, jobId: data.job.id },
    });
    captureResult(result);
    setActionMessage(null);
  };

  if (error) {
    return <main className="shell"><div className="empty danger-text">Unable to connect: {error.message}</div></main>;
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="mark" aria-hidden="true">R</div>
        <div>
          <p className="eyebrow">AUDITABLE AUTONOMOUS RESEARCH</p>
          <h1>Researcher AI</h1>
        </div>
      </header>

      {!app && <div className="empty">Connecting to the research service…</div>}
      {app && !data && <div className="empty">Waiting for a Researcher AI tool result…</div>}

      {data && (
        <section className="content">
          <p className="message">{data.message}</p>

          {data.service && (
            <div className="metric-grid">
              {Object.entries(data.service).map(([key, value]) => (
                <div className="metric" key={key}>
                  <span>{key.replaceAll(/([A-Z])/g, " $1")}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
          )}

          {data.project && <ProjectCard project={data.project} />}

          {data.projects && (
            <div className="stack">
              {data.projects.length === 0 ? <div className="empty">No research projects yet.</div> : null}
              {data.projects.map((project) => <ProjectCard project={project} key={project.id} compact />)}
            </div>
          )}

          {data.ideas && (
            <div className="stack">
              {data.ideas.map((idea, index) => (
                <article className="card" key={`${String(idea.Name ?? "idea")}-${index}`}>
                  <p className="eyebrow">IDEA {index + 1}</p>
                  <h2>{String(idea.Title ?? idea.Name ?? "Untitled idea")}</h2>
                  <p>{String(idea["Short Hypothesis"] ?? idea.Abstract ?? "No hypothesis provided.")}</p>
                </article>
              ))}
            </div>
          )}

          {data.job && (
            <article className="card job-card">
              <div className="row between">
                <div>
                  <p className="eyebrow">{data.job.kind.toUpperCase()} JOB</p>
                  <h2>{data.job.progress.stage}</h2>
                </div>
                <span className={`badge ${statusTone(data.job.status)}`}>{data.job.status}</span>
              </div>
              <p>{data.job.progress.message}</p>
              {typeof data.job.progress.percent === "number" && (
                <div className="progress" aria-label={`${data.job.progress.percent}% complete`}>
                  <div style={{ width: `${Math.max(0, Math.min(100, data.job.progress.percent))}%` }} />
                </div>
              )}
              {data.job.error && <pre className="error-panel">{data.job.error}</pre>}
              <div className="actions">
                <button type="button" onClick={refreshJob} disabled={Boolean(actionMessage)}>Refresh</button>
                {(data.job.status === "queued" || data.job.status === "running") && (
                  <button type="button" className="danger-button" onClick={cancelJob} disabled={Boolean(actionMessage)}>
                    Cancel
                  </button>
                )}
                {actionMessage && <span>{actionMessage}</span>}
              </div>
            </article>
          )}

          {data.artifacts && (
            <div className="artifact-list">
              {data.artifacts.map((artifact) => (
                <div className="artifact" key={artifact.path}>
                  <div>
                    <strong>{artifact.path}</strong>
                    <span>{artifact.mediaType}</span>
                  </div>
                  <span>{formatBytes(artifact.bytes)}</span>
                </div>
              ))}
            </div>
          )}

          {data.artifact && (
            <article className="card">
              <p className="eyebrow">{data.artifact.path}</p>
              <pre className="artifact-content">{data.artifact.content}</pre>
            </article>
          )}

          <aside className="disclosure">
            <strong>Required disclosure</strong>
            <span>{disclosure}</span>
          </aside>
        </section>
      )}
    </main>
  );
}

function ProjectCard({ project, compact = false }: { project: ProjectView; compact?: boolean }) {
  return (
    <article className={`card ${compact ? "compact" : ""}`}>
      <p className="eyebrow">RESEARCH PROJECT</p>
      <h2>{project.title}</h2>
      <p>{project.tldr}</p>
      {!compact && <p className="secondary">{project.abstract}</p>}
      <div className="chips">
        {project.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
      </div>
    </article>
  );
}
