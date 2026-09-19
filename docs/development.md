# Development Guide

This guide covers contributing to and developing the Diff Replay application.

## Architecture

Diff Replay consists of:

- **Backend (`src/`):** A Fastify server written in TypeScript. Handles replay persistence, SSE event broadcasts, and canonical diff hashing.
- **Frontend (`web/`):** A single-page application built with SolidJS 2.0 and Vite 8. Renders unified diffs, steps list, notes, and approval states.
- **Storage (`src/storage.ts`):** Stores atomic replay snapshots as JSON files under `~/.diff-replay/replays/`.
- **CLI (`src/cli.ts`):** Executable entry point (`diff-replay serve` and `diff-replay publish`).

---

## Local Development Workflow

To work on both the server and the frontend with hot module reloading:

### Terminal 1: Backend Server

```bash
pnpm dev:server
```

Starts the Fastify API server with `tsx watch` on `http://127.0.0.1:7890`.

### Terminal 2: Web UI

```bash
pnpm dev
```

Starts the Vite dev server on `http://127.0.0.1:7891` with automatic proxies forwarding `/api` calls to `7890`. Open `http://127.0.0.1:7891` in your browser.

---

## Validation & Testing

Run all quality gates (formatting, type checks, unit tests):

```bash
pnpm check
```

Or run individual steps:

```bash
pnpm test     # Vitest suite
pnpm format   # Prettier format check and write
```

---

## Production Build

Compile TypeScript and build the web client bundle:

```bash
pnpm build
```

This compiles:

1. Server code into `dist/`.
2. SolidJS client into `dist/public/`.

Test the production build:

```bash
pnpm start
```

Diff Replay will serve both the API and client at `http://127.0.0.1:7890`.
