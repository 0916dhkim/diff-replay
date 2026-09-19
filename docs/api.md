# API Reference

Diff Replay exposes a Fastify REST and SSE API on port `7890` by default.

> **Security Note:** Diff Replay has no authentication. It binds to `127.0.0.1` by default and is designed for local machine or private network/tailscale use. Do not expose it directly to the public internet.

## Endpoints Summary

| Method   | Path                             | Purpose                                                |
| -------- | -------------------------------- | ------------------------------------------------------ |
| `GET`    | `/api/health`                    | Check service readiness                                |
| `GET`    | `/api/replays`                   | List all stored replays                                |
| `POST`   | `/api/replays`                   | Create or synchronize a replay                         |
| `GET`    | `/api/replays/:id`               | Retrieve a replay by ID                                |
| `GET`    | `/api/replays/:id/events`        | Subscribe to live SSE updates for a replay             |
| `PATCH`  | `/api/replays/:id/state`         | Update active step selection                           |
| `PATCH`  | `/api/replays/:id/steps/:stepId` | Set step review status (`approved`, `flagged`, `null`) |
| `POST`   | `/api/replays/:id/notes`         | Add a review note                                      |
| `DELETE` | `/api/replays/:id/notes/:noteId` | Delete a review note                                   |

---

## Detailed Endpoints

### `GET /api/health`

Returns service status.

**Response `200 OK`:**

```json
{
  "ok": true
}
```

---

### `GET /api/replays`

Lists all replays stored on the server.

**Response `200 OK`:**

```json
[
  {
    "id": "3653bd7d4e348a61",
    "sourceKey": "github.com/acme/widgets#pull/42",
    "title": "Add widget sharing",
    "repository": "acme/widgets",
    "baseRef": "main",
    "headRef": "feature/sharing",
    "stepCount": 17,
    "createdAt": "2026-09-14T10:00:00.000Z",
    "updatedAt": "2026-09-14T10:05:00.000Z"
  }
]
```

---

### `POST /api/replays`

Creates a new replay or synchronizes an existing one if the `sourceKey` already exists.

- **Request Body:** JSON replay manifest (see [Manifest Format](manifest-format.md)). Maximum size: 100 MiB.
- **Headers:** `Content-Type: application/json`

**Response `200 OK`:**

```json
{
  "id": "3653bd7d4e348a61",
  "url": "/replays/3653bd7d4e348a61"
}
```

---

### `GET /api/replays/:id`

Retrieves the complete replay snapshot including steps, approvals, notes, and active state.

---

### `GET /api/replays/:id/events`

Opens a Server-Sent Events (SSE) connection streaming real-time review updates (state changes, step approvals, new notes) for collaborative or live viewing.

---

### `PATCH /api/replays/:id/state`

Updates the active step selection in the viewer.

**Request Body:**

```json
{
  "activeStepId": "session-store-interface"
}
```

---

### `PATCH /api/replays/:id/steps/:stepId`

Updates the review status of an individual step.

**Request Body:**

```json
{
  "decision": "approved" // or "flagged" or null to reset
}
```

---

### `POST /api/replays/:id/notes`

Adds a review note to a replay or specific step.

**Request Body:**

```json
{
  "stepId": "session-store-interface",
  "content": "Verify that Redis connection timeout does not block startup."
}
```

---

### `DELETE /api/replays/:id/notes/:noteId`

Deletes an existing review note.

---

## Environment Variables

| Variable               | Default          | Description                                               |
| ---------------------- | ---------------- | --------------------------------------------------------- |
| `DIFF_REPLAY_HOST`     | `127.0.0.1`      | Network interface to bind (e.g. `0.0.0.0` for LAN access) |
| `DIFF_REPLAY_PORT`     | `7890`           | HTTP port                                                 |
| `DIFF_REPLAY_DATA_DIR` | `~/.diff-replay` | Filesystem storage path for snapshots and replays         |
