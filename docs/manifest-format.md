# Replay Manifest Format

Diff Replay represents reviews as JSON manifests. Each manifest breaks a large diff into causally ordered, conceptual steps.

## Schema Overview

A manifest contains top-level metadata and an ordered array of review steps.

```json
{
  "sourceKey": "github.com/acme/project#pull/123",
  "title": "Migrate authentication to session tokens",
  "repository": "acme/project",
  "baseRef": "main",
  "headRef": "feature/session-tokens",
  "steps": [
    {
      "stepId": "session-store-interface",
      "action": "Define the SessionStore interface",
      "takeaway": "Establishes the storage abstraction before implementing Redis and in-memory adapters.",
      "risk": "Low",
      "filePath": "src/auth/session-store.ts",
      "fileName": "session-store.ts",
      "diff": "diff --git a/src/auth/session-store.ts b/src/auth/session-store.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/auth/session-store.ts\n@@ -0,0 +25,12 @@\n+export interface SessionStore {\n+  get(sessionId: string): Promise<Session | null>;\n+  set(sessionId: string, session: Session, ttlSeconds: number): Promise<void>;\n+  destroy(sessionId: string): Promise<void>;\n+}\n",
      "isCodegen": false,
      "isTest": false
    }
  ]
}
```

## Field Specifications

### Root Fields

| Field        | Type     | Required | Description                                                                                                                                                                                              |
| ------------ | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceKey`  | `string` | Yes      | Stable identifier for the change source (e.g. `github.com/org/repo#pull/42` or `repo#branch`). Re-publishing with the same `sourceKey` synchronizes the existing replay instead of creating a duplicate. |
| `title`      | `string` | Yes      | Human-readable title of the overall change.                                                                                                                                                              |
| `repository` | `string` | Yes      | Repository identifier or name (e.g. `org/repo`).                                                                                                                                                         |
| `baseRef`    | `string` | Yes      | Target or base ref (e.g. `main` or `origin/main`).                                                                                                                                                       |
| `headRef`    | `string` | Yes      | Source or branch ref (e.g. `feature/tokens` or `working-tree`).                                                                                                                                          |
| `steps`      | `array`  | Yes      | Ordered array of step objects (1 to 10,000 steps).                                                                                                                                                       |

### Step Fields

| Field       | Type      | Required | Description                                                                                                                                                                       |
| ----------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stepId`    | `string`  | Yes      | Stable semantic step identifier (`[A-Za-z0-9._:-]`, no slashes). Must remain stable across manifest updates to preserve approval status. Do not use positional IDs like `step-1`. |
| `action`    | `string`  | Yes      | Short summary of the change action (e.g. "Add session store interface").                                                                                                          |
| `takeaway`  | `string`  | Yes      | Concise architectural or behavioral takeaway explaining _why_ this step exists and what it accomplishes.                                                                          |
| `risk`      | `string`  | No       | Subjective risk rating (`"Low"`, `"Medium"`, `"High"`).                                                                                                                           |
| `filePath`  | `string`  | Yes      | Primary repository file path modified in this step.                                                                                                                               |
| `fileName`  | `string`  | Yes      | Basename of the file (e.g. `session-store.ts`).                                                                                                                                   |
| `diff`      | `string`  | Yes      | Valid unified diff patch representing the exact changes in this step.                                                                                                             |
| `isTest`    | `boolean` | No       | Set to `true` if this step modifies tests. Defaults to `false`.                                                                                                                   |
| `isCodegen` | `boolean` | No       | Set to `true` if this step modifies generated files (e.g. schemas, protobufs). Defaults to `false`.                                                                               |
| `diffHash`  | `string`  | No       | Optional on input and ignored by the server. The server derives an authoritative canonical content hash automatically.                                                            |

---

## Stable Partial Diffs

A single step may encompass multiple files if they form one indivisible concept. Conversely, a single file can be partitioned across multiple steps if distinct concepts are represented as valid partial unified diffs.

When splitting a file across multiple steps:

1. Each step must contain valid unified diff headers (`diff --git a/... b/...`, `--- a/...`, `+++ b/...`).
2. Hunk headers must declare accurate line numbers and counts for the changes included.
3. Every added (`+`) and deleted (`-`) line from the original full diff must appear exactly once across all steps.

---

## Content Hashing and Approval Preservation

Diff Replay computes a canonical SHA-256 review hash for every step from its reviewed diff content:

- **Included in review hash:** Added lines, deleted lines, file path identity, and semantic flags (`isTest`, `isCodegen`).
- **Excluded from review hash:** Hunk line positions (`@@ -10,5 +15,5 @@`), git textual `index` hashes (`index abc..def`), source headers, and unchanged context lines.

This design ensures that if earlier steps add lines and shift line numbers in subsequent steps, the subsequent steps retain their approval and review state without spurious invalidation.
