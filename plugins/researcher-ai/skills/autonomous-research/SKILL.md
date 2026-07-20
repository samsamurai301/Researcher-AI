---
name: autonomous-research
description: Create auditable research projects, generate ideas, run sandboxed AI Scientist v2 experiments, or inspect research artifacts. Use for autonomous research workflows; do not use for ordinary web research or unsupported publication claims.
argument-hint: "[research topic or project id]"
---

# Autonomous research with Researcher AI

Use the Researcher AI MCP tools as the system of record. Never replace a tool result with an invented project, idea, job state, metric, citation, or artifact.

## Start with the service boundary

1. Call `get_service_status` before the first write action.
2. Explain the active runner mode:
   - `mock` validates the workflow and produces no scientific claim.
   - `native` must only be used inside a dedicated execution container.
   - `docker` creates a resource-limited container per job.
3. If the user expects a live experiment and the service reports `mock`, stop before claiming that a real experiment ran. Give the exact configuration change needed.

## Project and ideation workflow

1. Convert the user's topic into a specific title, 1-12 keywords, one testable TL;DR hypothesis, and an abstract with evaluation criteria.
2. Call `create_research_project`.
3. Before `start_ideation`, state that literature search can contact external services and consume provider credits.
4. Call `start_ideation`, then report the job ID. Use `get_job_status` when the user asks for progress; do not fabricate completion.
5. Once the job succeeds, call `list_research_ideas`. Compare novelty, falsifiability, feasibility, likely compute cost, and failure modes. Clearly label any judgment that is not directly present in an artifact as analysis rather than evidence.

## Experiment workflow

Before `start_experiment`, obtain explicit user acknowledgment of both facts:

- AI Scientist executes LLM-written code and can access configured external services.
- Every manuscript must prominently retain the required machine-generation disclosure.

Do not set either acknowledgment input to `true` merely because the workflow needs it. The user must have accepted the corresponding fact in the conversation.

After acknowledgment:

1. Use the zero-based idea index returned by `list_research_ideas`.
2. Prefer upstream defaults unless the user provides supported model identifiers or asks for a specific write-up mode.
3. Call `start_experiment` and report the job ID, expected cost uncertainty, and that completion can take hours.
4. Use `get_job_status` for progress and `cancel_job` only when the user asks to stop or an agreed budget or safety boundary is exceeded.
5. After success, call `list_artifacts`, then selectively use `read_artifact` for logs, metrics, reviews, source, and disclosure records.

## Scientific and publication guardrails

- Never describe a mock artifact, model review, self-evaluation, or selected experiment slice as independent scientific validation.
- Do not claim novelty from an ideation result alone. Novelty requires a documented literature review and human verification.
- Do not remove, weaken, hide, or paraphrase away the upstream license disclosure.
- Treat generated citations as unverified until checked against authoritative sources.
- Treat generated code and packages as untrusted. Do not move execution outside the configured sandbox.
- Keep negative results, failed branches, logs, and uncertainty visible in the handoff.
- Do not submit, post, or publish a manuscript without a separate explicit user request and human review.

## Handoff format

Summarize:

1. Project and selected idea.
2. Runner mode and model configuration.
3. Job state and identifiers.
4. Evidence produced, including negative evidence.
5. Disclosure status.
6. Remaining human verification before any scientific or publication claim.
