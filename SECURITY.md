# Security policy and deployment boundary

## The central risk

AI Scientist-v2 executes code proposed or edited by a language model. Treat every experiment as untrusted code with the same risk as an unknown third-party program. It may consume unexpected compute, contact network services, disclose credentials available to it, modify mounted files, or exploit vulnerabilities in its runtime.

Researcher AI therefore defaults to mock mode and requires explicit risk and disclosure acknowledgments before the experiment tool accepts a job.

## Supported security boundary

For live use, the supported boundary is a dedicated Linux GPU host using rootless Docker and `RESEARCHER_RUNNER=docker`:

- one container per job;
- all Linux capabilities dropped;
- `no-new-privileges` enabled;
- read-only container root;
- bounded CPU, memory, PIDs, and temporary storage;
- only a job-local input directory and that job's artifact directory mounted;
- explicit network selection;
- cancellation by container name;
- provider secrets passed only when required.

Docker isolation is not a perfect security boundary. Keep the host patched, do not mount a privileged Docker socket into the public MCP service, and use a dedicated host or VM without unrelated credentials or data.

## Production requirements

1. Use HTTPS and `AUTH_MODE=oidc` for the persistent or live-execution tool set. `AUTH_MODE=none` trusts a local tenant header and is otherwise only for loopback/stdin development. The sole public exception is `PUBLIC_REVIEW_MODE=stateless` with the mock runner; that profile registers no persistent or execution tools and deletes its random per-call working state before returning. Static auth represents a single tenant and is appropriate only for private testing.
2. Configure OIDC tokens with `research:read` and/or `research:write` scopes. Tenant storage is keyed by the verified token subject.
3. Restrict CORS with `CORS_ORIGINS`; do not use `*` for a public deployment.
4. Use provider credentials dedicated to this service, with strict spend limits, minimal cloud permissions, rotation, and no access to production resources.
5. Put model and literature traffic behind an egress proxy or allowlist where feasible. The default `bridge` network allows outbound traffic because ideation and citation workflows require it.
6. Encrypt the data volume, back it up according to your retention policy, and avoid placing sensitive or regulated datasets in research prompts or artifacts.
7. Keep `RESEARCHER_MAX_CONCURRENCY` within GPU capacity. The queue is process-local; run one service instance unless replacing it with an external durable queue.
8. Retain run logs and failed branches for audit, but apply an explicit retention/deletion policy because they can contain prompts, code, citations, and provider diagnostics.
9. Do not publish generated work automatically. Human review must verify claims, citations, licenses, privacy, conflicts, and the mandatory AI disclosure.

## Secrets

Never commit `.env`, provider keys, static bearer tokens, cloud credentials, generated project data, or job logs. The repository ignores the standard local paths, but operators must configure a secrets manager in production.

AI Scientist needs provider credentials inside its execution boundary. Generated code can potentially read any secret present in that boundary. Use low-privilege, budget-limited keys and assume they may need rotation after an untrusted run.

## Multi-tenancy

Project paths use a SHA-256 tenant key derived from the authenticated identity. Artifact reads reject absolute paths, traversal, internal state files, and symlinks. This protects against ordinary cross-tenant access through MCP but does not make a compromised shared worker safe. High-assurance tenants should receive separate service and runner deployments.

## Reporting vulnerabilities

Do not open a public issue for a suspected vulnerability. Contact the repository owner privately with the affected version, reproduction steps, impact, and any suggested mitigation. Add a monitored security contact before publishing the repository or marketplace listings.
