# Big Diff Replay

Turn a large diff into a causally ordered review manifest and publish it to the already-running
[Diff Replay](https://github.com/0916dhkim/diff-replay) service. One service hosts many independent
replays; never copy or start a session-local viewer server.

## Invariants

1. **Decompose semantically:** A step is one logical concept, not one file or an arbitrary line range.
2. **Authoring order:** Order by how the change would be authored: foundations, behavior, integration, then tests and generated output.
3. **Stable descriptive step IDs:** Use identifiers such as `pr-42-auth-policy` (`[A-Za-z0-9._:-]`, no slashes). Do not use positional IDs such as `1.2` that shift when steps are inserted.
4. **Omit diffHash:** Omit `diffHash` from producer manifests. The service derives an authoritative canonical SHA-256 hash from each step's reviewed diff content.
5. **Tag tests and codegen:** Tag tests with `isTest: true`. Bundle machine-generated artifacts into dedicated `isCodegen: true` steps.
6. **Mechanical verification:** Mechanically verify that the replay contains the exact multiset of added and deleted lines for every original file before publishing.
7. **Reuse sourceKey:** Reuse the same `sourceKey` when syncing an updated PR, stack, branch diff, or working tree. The service preserves decisions when a step keeps its `stepId`, file identity, and reviewed additions/removals; notes remain as review history.
8. **Preserve approvals across line shifts:** Never change product code, formatting, or file layout solely to preserve approvals. Hunk positions, index hashes, and unchanged context are excluded from approval identity.

## Workflow

### 1. Check the shared service

```bash
curl -fsS http://127.0.0.1:7890/api/health
```

If that fails, stop. Do not start a temporary ad-hoc server. Ensure the persistent service is running (see [Daemon Setup](../../docs/daemon-setup.md)).

### 2. Retrieve and decompose the diff

- Retrieve raw diffs with `gh pr diff`, `git diff <base>...<head>`, or commit-level diffs.
- For a working-tree replay, `git diff <base>` includes staged and unstaged tracked changes but not untracked files. Add each intended untracked file with a separate `git diff --no-index -- /dev/null <file>` section, or use `git add -N -- <file>` only when changing the index is acceptable. Never blanket-stage unrelated work.
- For a PR stack plus current local edits, keep immutable lower-stack PR diffs and replace the edited top PR's remote diff with one aggregate diff from its base to the working tree. Before composing, compare the clean top-branch diff with `gh pr diff` and match GitHub's object-ID abbreviation (for example `--abbrev=11`) so unchanged sections retain byte identity.
- Preserve the original source in a file such as `original.diff` or a JSON array whose items contain `diff`.
- Build `replay-manifest.json` matching the manifest schema:

```json
{
  "sourceKey": "github.com/owner/repository#pull/42",
  "title": "Add authenticated sharing",
  "repository": "owner/repository",
  "baseRef": "main",
  "headRef": "feature/sharing",
  "steps": [
    {
      "stepId": "pr-42-sharing-route",
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

One step may include multiple files when they form one indivisible concept. One file may appear in
multiple steps when distinct concepts can be represented as valid partial unified diffs.

#### Stable partial diffs

When one file is split across steps, construct each step as a minimal valid unified diff. Keep the
required path headers and accurate hunk ranges so the display and exact-coverage verification remain
truthful, for example:

```diff
diff --git a/src/feed.ts b/src/feed.ts
new file mode 100644
--- /dev/null
+++ b/src/feed.ts
@@ -0,0 +120,8 @@
+export const example = true;
```

The service excludes hunk positions, textual `index` hashes, source headers, and unchanged context
from approval identity. Earlier insertions may shift accurate hunk ranges without invalidating an
otherwise unchanged partial step. Standard non-payload binary diffs are the exception: their `index`
hashes are the only available content identity and are therefore retained.

### 3. Verify exact coverage

Run `verify-diff-sum.js` relative to this skill directory:

```bash
node scripts/verify-diff-sum.js original.diff replay-manifest.json
```

Do not publish unless verification passes with no missing files, extra files, omitted lines,
duplicated lines, or fabricated lines.

### 4. Perform a bounded qualitative self-review

Review the manifest directly before publishing:

- Each step represents one concept rather than a file bucket or collection of unrelated flows.
- The order follows causal implementation: foundations, behavior, integration, then tests and codegen.
- Each action and takeaway accurately describes all and only the included diff.
- Tests are tagged and placed near the behavior they protect; codegen is isolated.
- Partial-file boundaries do not cut through a function or separate code required to understand the step.
- No step is so large that its distinct concepts should be split further. Treat 500 changed lines as a prompt to inspect the boundary, not an automatic failure.
- When synchronizing an existing replay, investigate unexpectedly broad invalidation. Hunk positions, textual index hashes, source headers, and unchanged context alone must not reset decisions.
- Do not manufacture step IDs or boundaries to preserve approvals after the reviewed additions, removals, file identity, or semantic file metadata actually changes.

### 5. Publish or synchronize

POST the verified manifest to the running service:

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  --data-binary @replay-manifest.json \
  http://127.0.0.1:7890/api/replays
```

Return the stable URL `http://127.0.0.1:7890/replays/<id>`. The service owns UI, state, notes,
approval invalidation, persistence, and live updates.
