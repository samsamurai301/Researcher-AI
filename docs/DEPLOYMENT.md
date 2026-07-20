# Deployment

## 1. Choose the operating profile

| Profile | Runner | Use |
| --- | --- | --- |
| Local verification | `mock` | Plugin development, marketplace review, UI and workflow testing |
| Private dedicated container | `native` | One trusted operator; the whole service container is disposable and resource-limited |
| Live GPU host | `docker` | Recommended for real ideation/experiments; one sandbox container per job |

Do not offer a shared public experiment service with native execution. A no-auth public ChatGPT listing must use `RESEARCHER_RUNNER=mock`, `AUTH_MODE=none`, and `PUBLIC_REVIEW_MODE=stateless`. That profile exposes only status and one complete deterministic mock workflow, uses a random tenant for temporary working files, and deletes those files before returning. The live GPU path remains restricted to authenticated, approved tenants.

## 2. Mock HTTP deployment

The server image intentionally contains only the MCP control plane and starts in mock mode:

```bash
docker compose -f infra/compose.mock.yml up --build
curl http://localhost:8000/ready
```

Put it behind HTTPS before connecting ChatGPT. The included Nginx file is an example, not a certificate automation solution.

## 3. Build the GPU runner

On a Linux NVIDIA host with the NVIDIA Container Toolkit:

```bash
git submodule update --init --recursive
docker build --platform linux/amd64 -f infra/Dockerfile.ai-scientist -t researcher-ai-scientist:0.1.0 .
docker run --rm --gpus all researcher-ai-scientist:0.1.0 python3 -c "import torch; print(torch.cuda.is_available())"
```

The image includes the pinned upstream source, PyTorch/CUDA base, LaTeX/PDF tools, Python requirements, disclosure helper, and complete upstream license.

## 4. Run the MCP control plane on a rootless-Docker host

Install Node.js 22+, clone/build the repository at `/opt/researcher-ai`, create a non-login `researcher-ai` user, and place service data at `/var/lib/researcher-ai`. Configure rootless Docker for that user rather than granting access to a privileged system Docker socket.

Example `/etc/researcher-ai.env`:

```dotenv
PORT=8000
BASE_URL=https://researcher.example.com
RESEARCHER_DATA_DIR=/var/lib/researcher-ai
RESEARCHER_RUNNER=docker
RESEARCHER_MAX_CONCURRENCY=1
RESEARCHER_DOCKER_IMAGE=researcher-ai-scientist:0.1.0
RESEARCHER_DOCKER_PYTHON_BIN=python3
RESEARCHER_DOCKER_GPUS=all
RESEARCHER_DOCKER_CPUS=8
RESEARCHER_DOCKER_MEMORY=32g
RESEARCHER_DOCKER_PIDS=512
RESEARCHER_DOCKER_NETWORK=researcher-egress
AUTH_MODE=oidc
OIDC_ISSUER=https://identity.example.com/
OIDC_AUDIENCE=https://researcher.example.com
OIDC_JWKS_URI=https://identity.example.com/.well-known/jwks.json
CORS_ORIGINS=https://chatgpt.com
# OPENAI_APPS_CHALLENGE=copy-the-current-portal-token-here
```

Add provider credentials through the host secrets manager, not this file when the platform supports secret injection. Install `infra/researcher-ai.service`, adjust executable paths, then enable it with systemd. The service advertises `/health`, `/ready`, and `/.well-known/oauth-protected-resource` for operations and OAuth discovery.

## 5. Authentication behavior

- `none`: local only for the persistent tool set. It is also allowed for the no-auth public review profile only when `PUBLIC_REVIEW_MODE=stateless`; the temporary tenant is server-generated and deleted within the tool call.
- `session`: public mock review only; each MCP session receives an unguessable tenant identifier, hashes it before filesystem use, and expires after `RESEARCHER_SESSION_TTL_SECONDS` (24 hours by default). Configuration validation rejects this mode with `native` or `docker` execution.
- `static`: one bearer token and one storage tenant; private testing only.
- `oidc`: verifies issuer, audience, and signature against remote JWKS; `sub` becomes the tenant ID and tools enforce `research:read`/`research:write` scopes.

The current implementation is the OAuth resource server and does not implement an authorization server. Use an OAuth 2.1 provider that satisfies the MCP authorization specification, including authorization-server discovery, PKCE/client registration as applicable, and propagation of the `resource` parameter. Its access tokens must be JWTs verifiable with the configured issuer, audience, and JWKS.

## 6. Operational checks

Before connecting a marketplace client:

```bash
curl -fsS https://researcher.example.com/health
curl -fsS https://researcher.example.com/ready
npm run smoke
```

Also verify cancellation, provider spend limits, disclosure insertion, volume backups, log retention, GPU exhaustion behavior, and an intentionally failed experiment. Run one control-plane instance unless you replace the in-memory queue with a durable shared queue.
