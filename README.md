# Diff Replay

Diff Replay is a persistent local viewer and review workflow for large diffs, PR stacks, and complex branch changes. Instead of forcing reviewers to digest massive single diffs or running ad-hoc throwaway servers, Diff Replay breaks changes into small, causally ordered, reviewable steps hosted on a single persistent background service.

## Core Concepts

- **Persistent Local Service:** One lightweight Fastify server hosts all replays on your machine. Agents publish manifests to it; you view and review them at any time.
- **Semantic Decomposition:** Large changes are decomposed in authoring order: foundations $\rightarrow$ core behavior $\rightarrow$ integration $\rightarrow$ tests and codegen.
- **Exact Line Fidelity:** Every added and deleted line across all steps is mechanically verified against the original source diff before publishing.
- **Approval Persistence:** Diff Replay hashes canonical reviewed content (excluding volatile hunk line shifts, git index headers, and unchanged context), so approvals and notes survive refactors and re-syncs.

---

## Setup

### 1. Prerequisites

- **Node.js:** `>= 22`
- **pnpm:** `>= 9` (tested with pnpm 12)

### 2. Clone and Build

```bash
git clone https://github.com/0916dhkim/diff-replay.git
cd diff-replay
pnpm install
pnpm build
```

### 3. Run the Service

You can run Diff Replay in the foreground for testing:

```bash
pnpm start
```

The web interface is available at `http://127.0.0.1:7890`.

#### Recommended: Run as a Persistent Daemon

To ensure the service is always available for your AI agents and review sessions:

- **macOS (launchd):** See [Daemon Setup (launchd)](docs/daemon-setup.md#macos-launchd) for configuring a `com.diff-replay.serve` agent.
- **Linux (systemd):** See [Daemon Setup (systemd)](docs/daemon-setup.md#linux-systemd-user-service) for configuring a user service.

### 4. Verify Service Health

```bash
curl -fsS http://127.0.0.1:7890/api/health
# {"ok":true}
```

### 5. Install the AI Agent Skill

Diff Replay manifests are produced by AI coding agents. The repository bundles an example agent skill under [`skills/big-diff-replay/`](skills/big-diff-replay/):

- **OpenCode:** Copy `skills/big-diff-replay` into your local configuration:
  ```bash
  cp -r skills/big-diff-replay ~/.config/opencode/skills/
  ```
- **Cursor / Claude Code / other agents:** Load the instructions from [`skills/big-diff-replay/SKILL.md`](skills/big-diff-replay/SKILL.md) and the verification script into your agent's system prompt or workspace rules.

### 6. Quick Test: Prompt Your Agent

With the service running and the skill installed, test the end-to-end workflow by asking your agent to replay a pull request or branch:

> **"Diff replay this PR \<url\>"**  
> _(or "Diff replay current branch against main")_

Your agent will autonomously:

1. Verify the persistent service is reachable (`http://127.0.0.1:7890/api/health`).
2. Retrieve the raw diff using `gh pr diff` or `git diff`.
3. Decompose the diff into causally ordered, single-concept review steps.
4. Mechanically verify exact line-by-line coverage using `verify-diff-sum.js`.
5. Publish the manifest and return the local review URL (`http://127.0.0.1:7890/replays/<id>`).

---

## Documentation

- [Agent Skill & Decomposition Workflow](skills/big-diff-replay/SKILL.md)
- [Replay Manifest Schema & Rules](docs/manifest-format.md)
- [HTTP & SSE API Reference](docs/api.md)
- [Daemon Setup (macOS launchd & Linux systemd)](docs/daemon-setup.md)
- [Development Guide](docs/development.md)

---

## License

[MIT](LICENSE)
