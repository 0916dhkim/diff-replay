# Diff Replay

Diff Replay is a persistent local viewer for reviewing large diffs as a sequence of small,
understandable steps. One server can host many independent replays, so agents publish review
manifests instead of starting a new web server for every session.

## Quick start

```bash
pnpm install
pnpm build
pnpm start
```

Open [http://127.0.0.1:7890](http://127.0.0.1:7890). Replay data is stored as one atomic,
validated snapshot per replay under `~/.diff-replay/replays` by default.

To develop the server and UI with live reload, run these in separate terminals:

```bash
pnpm dev:server
pnpm dev
```

The Vite development UI runs at `http://127.0.0.1:7891` and proxies API requests to the service.

## Publish a replay

Create a manifest:

```json
{
  "sourceKey": "github.com/acme/widgets#pull/42",
  "title": "Add widget sharing",
  "repository": "acme/widgets",
  "baseRef": "main",
  "headRef": "feature/widget-sharing",
  "steps": [
    {
      "stepId": "api-route",
      "diffHash": "5d5caae0d18adf14",
      "action": "Add the sharing route",
      "takeaway": "Introduces the authenticated endpoint used to share a widget.",
      "risk": "Medium",
      "filePath": "src/routes/share.ts",
      "fileName": "share.ts",
      "diff": "diff --git a/src/routes/share.ts b/src/routes/share.ts\n...",
      "isCodegen": false,
      "isTest": false
    }
  ]
}
```

Publish it with the CLI:

```bash
pnpm diff-replay publish ./manifest.json
```

You can try the bundled example with `pnpm diff-replay publish examples/basic.json`.

The command prints the stable replay URL. Publishing the same `sourceKey` updates the existing
replay. Approvals and flags survive only when a step keeps both its `stepId` and `diffHash`; notes
remain as accumulated review history.

## API

| Method   | Path                             | Purpose                                 |
| -------- | -------------------------------- | --------------------------------------- |
| `GET`    | `/api/health`                    | Check whether the service is ready      |
| `GET`    | `/api/replays`                   | List all replays                        |
| `POST`   | `/api/replays`                   | Create or synchronize a replay manifest |
| `GET`    | `/api/replays/:id`               | Read one replay                         |
| `GET`    | `/api/replays/:id/events`        | Subscribe to replay-scoped SSE updates  |
| `PATCH`  | `/api/replays/:id/state`         | Select the active step                  |
| `PATCH`  | `/api/replays/:id/steps/:stepId` | Approve, flag, or reset one step        |
| `POST`   | `/api/replays/:id/notes`         | Add a review note                       |
| `DELETE` | `/api/replays/:id/notes/:noteId` | Delete a review note                    |

Set `DIFF_REPLAY_HOST`, `DIFF_REPLAY_PORT`, or `DIFF_REPLAY_DATA_DIR` to override server defaults.
The service binds to `127.0.0.1` by default and has no authentication; do not expose it publicly.
Replay manifests may be up to 100 MiB and contain up to 10,000 uniquely identified steps.

## Design boundary

Diff Replay stores, synchronizes, and presents replay manifests. The producer that understands the
source diff remains responsible for semantic decomposition, stable step IDs, hashes, narrative
ordering, and exact verification that the steps sum to the original diff.

## License

MIT
