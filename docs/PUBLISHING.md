# Marketplace publishing

The code and local marketplace bundles are complete. Public publication still requires accounts, a public Git repository, a verified HTTPS domain, legal/support URLs, and marketplace review; those external identities cannot be created safely from source code alone.

## Pre-release gate

```bash
git submodule update --init --recursive
npm ci
npm audit
npm run validate
npm run smoke
claude plugin tag plugins/researcher-ai --dry-run
```

Replace the manifest author with the real publisher name before submission. Publish a security contact, privacy policy, terms, support page, and source repository. The terms must preserve all restrictions in The AI Scientist Source Code License.

## ChatGPT app directory

1. Deploy the HTTP MCP service at a stable HTTPS URL ending in `/mcp` with production OIDC/OAuth and a restricted CORS policy.
2. In ChatGPT developer mode, create an app/connector from that MCP URL. Exercise every tool, confirmation, error path, and widget state with mock mode first.
3. Record the assigned `asdk_app_...` ID. To let the Codex plugin install the same ChatGPT app, run:

   ```bash
   npm run link:chatgpt -- asdk_app_YOUR_ID
   npm run validate
   ```

   `.app.json` is intentionally ignored until a real ID exists.
4. For public submission, submit the production MCP server directly through the plugin portal as an app-plus-skills plugin; do not submit the local app ID as a reference. Configure `OPENAI_APPS_CHALLENGE` if the portal requests domain verification, then rescan the tools.
5. Complete the ChatGPT app-directory listing. Provide accurate capability, data-handling, authentication, safety, support, privacy, and terms information. Clearly state that live experiments execute model-written code and that mock mode produces no scientific evidence. The prepared starter prompts and eight review cases are in `docs/SUBMISSION_PACKET.md`.
6. Keep the submitted MCP endpoint and tool schemas stable while review is active. Re-test after any server or authentication change.

Current official references: [connect and test an MCP app in ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt), [app submission requirements](https://developers.openai.com/apps-sdk/deploy/submission), and [submit plugins](https://developers.openai.com/codex/submit-plugins).

## Codex plugin marketplace

The repository catalog is `.agents/plugins/marketplace.json`, with marketplace name `personal` and plugin name `researcher-ai`.

1. Push the repository with the submodule commit, generated plugin bundle (`npm run build`), license files, and a tagged release.
2. Test from the Git source:

   ```bash
   codex plugin marketplace add samsamurai301/Researcher-AI --ref main
   codex plugin add researcher-ai@personal
   ```

3. Share the Git repository or the generated `codex://` install link. A curated marketplace listing, if desired, requires the marketplace owner's review; the public Git marketplace remains independently installable.

## Claude Code marketplace

The Claude catalog is `.claude-plugin/marketplace.json`, with marketplace and plugin name `researcher-ai`.

1. Validate and dry-run the release tag:

   ```bash
   claude plugin validate plugins/researcher-ai
   claude plugin validate .claude-plugin/marketplace.json
   claude plugin tag plugins/researcher-ai --dry-run
   ```

2. Push the repository and install from GitHub:

   ```bash
   claude plugin marketplace add samsamurai301/Researcher-AI --scope user
   claude plugin install researcher-ai@researcher-ai --scope user
   ```

3. Create the actual plugin version tag only after the working tree is clean and the manifest version matches the release. A community marketplace can distribute immediately; inclusion in a marketplace controlled by Anthropic requires that marketplace's review and acceptance.

Current official references: [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) and the [plugin reference](https://code.claude.com/docs/en/plugins-reference).

## Release artifacts

Every release must contain:

- pinned AI Scientist submodule metadata;
- complete upstream source-code license and wrapper Apache license;
- bundled stdio MCP server and plugin assets;
- matching Codex and Claude semantic versions;
- test/validation results;
- disclosure behavior and safety limitations in release notes;
- no provider keys, generated data, logs, `.env`, or placeholder publisher URLs.
