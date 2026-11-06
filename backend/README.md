# AUTONEX (PAG Autonomous Coding Engine)

A personal, terminal-first, autonomous coding agent that mirrors Google Antigravity's permissions, safety sandboxing, and diff visibility — powered exclusively by models from **0G Private Computer**.

**0G-powered inference. Privacy-first. Your machine, your rules.**

---

## Quick Start (5 minutes)

### 1. Configure 0G Private Computer

Create a 0G Private Computer API key and set it as `ZG_API_KEY` in `.env`.

### 2. Configure

```bash
cd /mnt/d/AUTONEX
cp .env.example .env
chmod 600 .env
# Edit .env — set ZG_API_KEY
nano .env
```

### 3. Run preflight (first time only)

```bash
./scripts/preflight.sh
```

### 4. Launch

```bash
# Recommended for everyday work:
pag /path/to/project assist

# For new/untrusted projects (asks before every edit):
pag /path/to/project strict

# Full auto-pilot on clean repos:
pag /path/to/project turbo
```

You can also use the alias `autonex` instead of `pag`.

---

## Switching Models

### Per-session override
```bash
pag ~/myproject assist --model 0g/qwen3-coder-flash
```

### See all configured models
```bash
pag --list-models
```

### Change defaults
Edit `profiles/base.json` → `agents.build.model` and `agents.plan.model`.

---

## Available Models

The supported model catalogue is maintained in `profiles/base.json` and contains
only 0G Private Computer models. Run `pag --list-models` to see the configured
models, or see `frontend/docs/MODEL_ROUTING_AND_RATE_LIMITS.md` for role routing.

---

## Terminal Layout

AUTONEX opens in a 3-pane `tmux` session:

1. **Left (Agent TUI):** Interactive OpenCode session with permissions, chat, and tool execution
2. **Top-Right (Live Audit):** Real-time log of every file modified with exact line ranges
3. **Bottom-Right (Live Diff):** `git diff --stat` refreshing every 2 seconds

On exit, a full `git diff -U0` summary is printed with one-command rollback.

---

## Security Profiles

| Feature | `strict` | `assist` | `turbo` |
|---------|----------|----------|---------|
| File reads | ✅ Auto | ✅ Auto | ✅ Auto |
| File edits | ❓ Ask | ✅ Auto | ✅ Auto |
| Safe shell (`git status`, `ls`, `rg`) | ✅ Auto | ✅ Auto | ✅ Auto |
| Other shell commands | ❓ Ask | ❓ Ask | ✅ Auto |
| Web search | ❓ Ask | ✅ Auto | ✅ Auto |
| **Always denied** | `sudo`, `rm -rf`, `git push`, `ssh`, `scp`, `git reset --hard` |||

**Security is enforced by the container**, not just permission rules.

---

## Privacy & Hosted Models

- **Privacy gate:** Projects must be explicitly authorized before code is sent to any API
- **The 0G API key stays outside the agent container** — injected by the local nginx proxy in Docker mode
- **Data handling:** Review the current 0G Private Computer terms before sending sensitive project data
- **No telemetry, no tracking, no cloud deployment**

To authorize a new project:
```bash
pag /path/to/project --allow-hosted
```

Authorized projects are listed in `hosted-allowed.txt`.

---

## Project-Specific Commands

Pre-approve common shell commands for `assist`/`turbo` profiles:

1. Create `.pag/commands.txt` in your project root:
   ```text
   pytest *
   npm test *
   npm run lint *
   cargo check *
   ```
2. On launch, AUTONEX shows these, asks for confirmation, then allows them without prompting.

---

## Egress Allowlist

The agent container can only reach:
- The local LLM proxy (no direct API access)
- The private search engine (SearXNG)
- Domains in `docker/allowlist.txt`

To add a documentation site:
```bash
echo ".docs.rs" >> docker/allowlist.txt
cd /mnt/d/AUTONEX/docker && docker compose restart egress
```

---

## Key Rotation

```bash
# 1. Edit .env with new key(s)
nano /mnt/d/AUTONEX/.env

# 2. Restart the proxy
cd /mnt/d/AUTONEX/docker && docker compose up -d --force-recreate llmproxy
```

---

## Resource Usage

Optimized for low-resource PCs (total Docker overhead ~2.5 GB):

| Container | Memory Limit |
|-----------|-------------|
| Agent (OpenCode) | 2 GB |
| SearXNG (search) | 256 MB |
| nginx (proxy) | 128 MB |
| Squid (egress) | 128 MB |

---

## Safety Verification

```bash
# Run all safety escape tests (S1-S9)
/mnt/d/AUTONEX/scripts/escape-tests.sh

# Run context management unit tests
cd /mnt/d/AUTONEX/plugins/context && npx tsx --test lib.test.ts

# View API quota usage
/mnt/d/AUTONEX/scripts/quota.sh
```

---

## Evaluation Harness

Run evaluations on configured 0G models:
```bash
# Run evals with a specific model and profile
/mnt/d/AUTONEX/evals/run.sh 0g/glm-5.3-flash assist 3 1

# Evaluate the coding model
/mnt/d/AUTONEX/evals/run.sh 0g/qwen3-coder-flash assist 3 3
```

---

## Rollback & Recovery

If an agent run produces unwanted edits:
```bash
# 1. Exit the agent (Ctrl+C or /exit)
# 2. AUTONEX prints the branch name (e.g. agent/20261002-173000)

# Discard all changes:
git checkout main && git branch -D agent/<timestamp>

# Keep and merge:
git checkout main && git merge agent/<timestamp>
```

---
