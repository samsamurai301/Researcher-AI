# Researcher AI plugin

This folder is installable by both Codex/ChatGPT and Claude Code. It contains platform-specific manifests, one shared Agent Skill, a Claude research-manager agent, and a bundled stdio MCP server produced by the root build. Version 0.2 adds rich briefs, transparent heuristic ranking, a unified project dashboard, retry-safe job starts, and improved audit exports.

The default execution mode is `mock`, which is safe for verifying installation. For a live AI Scientist run, configure either a dedicated container with `RESEARCHER_RUNNER=native` or the per-job Docker runner. See the repository deployment and security documentation before enabling live execution.

The plugin wrapper is Apache-2.0 licensed. AI Scientist v2 is a pinned third-party component under its own restricted source-code license; see this package's `THIRD_PARTY_NOTICES.md` and `licenses/AI-SCIENTIST-SOURCE-CODE-LICENSE`.
